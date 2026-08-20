import * as vscode from 'vscode';
import axios from 'axios';

import { FixContext, FixResult, LintFixer, getLintFixConfig } from '../common';

/**
 * @description LLM 修复器（v1：单次调用函数，接口与未来 agent 一致）。
 *
 * 流程：错误 + 代码片段 → LLM → 返回修复后代码 → 生成 TextEdit
 */
export class LlmFixer implements LintFixer {
    constructor() { }

    async fix(diagnostic: any, ctx: FixContext): Promise<FixResult | undefined> {
        const cfg = getLintFixConfig();
        if (!cfg.agentEnabled) {
            return undefined;
        }

        // 复用 assistant 配置（apiBase / apiKey / model）
        const assistant = vscode.workspace.getConfiguration('digital-ide.assistant');
        const apiBase = assistant.get<string>('apiBase', 'https://api.deepseek.com/v1');
        const apiKey = assistant.get<string>('apiKey', '');
        const model = assistant.get<string>('model', 'deepseek-v4-pro');

        if (!apiKey) {
            return undefined; // 无 key，降级到纯规则修复
        }

        // 构建 prompt
        const prompt = this.buildPrompt(ctx);
        // lint 修复多为机械性改动，默认关闭推理（thinking）可提速 4~16 倍；
        // 复杂场景可在设置 synthaid-ide.lintFix.thinking 中重新开启。
        const reply = await this.callLlm(apiBase, apiKey, model, prompt, cfg.thinking);
        if (!reply) {return undefined;}

        // 解析 LLM 返回的修复代码，生成 edits
        return this.buildEdits(ctx, reply);
    }

    /**
     * @description 构建修复 prompt
     */
    private buildPrompt(ctx: FixContext): string {
        const { document, diagnostic, codeSnippet } = ctx;
        const fileName = document.fileName.split(/[\\/]/).pop();
        return [
            `You are an expert Verilog/SystemVerilog engineer.`,
            `Fix the following lint error in ${fileName}.`,
            ``,
            `Error [${diagnostic.code}]: ${diagnostic.message}`,
            `Location: line ${diagnostic.range.start.line + 1}`,
            ``,
            `Code context:`,
            '```verilog',
            codeSnippet,
            '```',
            ``,
            `Return ONLY the corrected code block (fenced with three backticks), no explanation.`,
            `IMPORTANT: Return the COMPLETE code block with ALL lines (both changed and unchanged), exactly as it should appear. Do not omit any context lines.`,
        ].join('\n');
    }

    /**
     * @description 调用 LLM（OpenAI 兼容），带重试。
     *
     * DeepSeek 等 API 会间歇性超时/空输出，因此最多重试 3 次，
     * 每次超时 60s，重试间等待 400ms，避免偶发失败导致修复不可用。
     */
    private async callLlm(apiBase: string, apiKey: string, model: string, prompt: string, thinking: boolean): Promise<string | undefined> {
        const maxRetries = 3;
        let lastError: string = '';
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const reply = await this.callLlmOnce(apiBase, apiKey, model, prompt, thinking);
                if (reply) {
                    return reply;
                }
                lastError = '空响应';
            } catch (e: any) {
                lastError = e?.message || String(e);
            }
            console.warn(`[synthaid-lint] LLM 调用失败(第${attempt}次): ${lastError}，重试中...`);
            if (attempt < maxRetries) {
                // 重试间隔从 1s 降到 400ms：DeepSeek 偶发连接 abort 需快速重试，
                // 过长等待会让用户感觉卡顿。
                await new Promise(r => setTimeout(r, 400));
            }
        }
        console.error(`[synthaid-lint] LLM 调用最终失败: ${lastError}`);
        return undefined;
    }

    /**
     * @description 单次 LLM 调用（OpenAI 兼容）
     */
    private async callLlmOnce(apiBase: string, apiKey: string, model: string, prompt: string, thinking: boolean): Promise<string | undefined> {
        const url = apiBase.replace(/\/+$/, '') + '/chat/completions';
        // max_tokens 需要足够大：语法错误用大上下文（30 行）并要求返回完整代码块，
        // 2048 会截断（finish_reason=length），甚至偶发空输出。
        // 若开启推理，reasoning_content 会额外吃掉数千 token，因此这里用 16384 兜底。
        const maxTokens = 16384;
        /* eslint-disable @typescript-eslint/naming-convention */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            max_tokens: maxTokens,
        };
        if (!thinking) {
            body.thinking = { type: 'disabled' };
        }
        const resp = await axios.post(
            url,
            body,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                timeout: 60000,
                // axios 1.x 对 chunked/压缩响应体有 maxContentLength 计算 bug
                // （报 "maxContentLength size of -1 exceeded"），必须显式设置大有限值。
                maxContentLength: 200 * 1024 * 1024,
                maxBodyLength: 200 * 1024 * 1024,
            }
        );
        /* eslint-enable @typescript-eslint/naming-convention */
        const content = resp.data?.choices?.[0]?.message?.content;
        const finishReason = resp.data?.choices?.[0]?.finish_reason;
        // 若被截断或为空，视为失败，避免应用不完整的修复
        if (!content || finishReason === 'length') {
            throw new Error(`finish_reason=${finishReason}, content_len=${content?.length ?? 0}`);
        }
        return content;
    }

    /**
     * @description 解析 LLM 返回的代码块，生成 edits。
     *
     * LLM 可能只返回「修改后的代码片段」，行数与原始上下文片段不一致
     * （例如只返回 localparam 三行，而上下文片段有七行）。
     * 因此不能整块替换上下文范围，必须逐行 diff LLM 返回内容与原始片段，
     * 只生成实际变化行的最小 edits，避免误删上下文行。
     */
    private buildEdits(ctx: FixContext, reply: string): FixResult | undefined {
        // 提取 ```verilog ... ``` 代码块
        const codeBlockRe = /```(?:verilog|systemverilog|sv)?\s*([\s\S]*?)```/;
        const m = codeBlockRe.exec(reply);
        if (!m) {return undefined;}

        const fixedCode = m[1].trim();
        const originalSnippet = ctx.codeSnippet.trim();
        if (!fixedCode || fixedCode === originalSnippet) {
            return undefined; // 没改
        }

        // 上下文片段在文档中的起始行（由 makeContext 的 extractCodeSnippet 决定）
        const doc = ctx.document;
        const snippetStartLine = ctx.snippetStartLine;

        // 逐行 diff：LLM 返回行 vs 原片段行，生成最小 edits
        const fixedLines = fixedCode.split('\n');
        const origLines = originalSnippet.split('\n');
        const edits = diffLinesToEdits(origLines, fixedLines, snippetStartLine, doc);
        if (!edits.length) {return undefined;}

        return {
            edits,
            description: `LLM 修复 (${ctx.diagnostic.code})`,
        };
    }
}

/**
 * @description 对「原片段行」与「LLM 返回行」做 LCS diff，
 * 把变化映射回文档绝对行号，生成最小 TextEdit。
 *
 * 关键：只替换/删除实际变化的行，未变化的上下文行保持不变。
 *
 * 文本拼接规则：用「删除整行 + 用新行替换」的模型——
 * 删除范围是 [delStart, delEnd) 的整行（含其行尾换行），
 * 替换文本是 replacement 行，末尾是否补 '\n' 取决于是否还有后续行。
 */
function diffLinesToEdits(
    origLines: string[],
    fixedLines: string[],
    startLine: number,
    doc: vscode.TextDocument
): vscode.TextEdit[] {
    const edits: vscode.TextEdit[] = [];

    const n = origLines.length, m2 = fixedLines.length;
    // LCS dp
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m2 + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m2 - 1; j >= 0; j--) {
            dp[i][j] = origLines[i] === fixedLines[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    // 收集变化块
    interface Block { delStart: number; delEnd: number; insStart: number; insEnd: number; }
    const blocks: Block[] = [];
    let i = 0, j = 0;
    while (i < n || j < m2) {
        if (i < n && j < m2 && origLines[i] === fixedLines[j]) { i++; j++; continue; }
        const delStart = i, insStart = j;
        while (i < n || j < m2) {
            if (i < n && j < m2 && origLines[i] === fixedLines[j]) { break; }
            if (j >= m2 || (i < n && dp[i + 1][j] >= dp[i][j + 1])) { i++; }
            else { j++; }
        }
        blocks.push({ delStart, delEnd: i, insStart, insEnd: j });
    }

    // 每个变化块生成一个 edit
    for (const b of blocks) {
        const absStart = startLine + b.delStart;   // 删除起始行（绝对）
        const absEnd = startLine + b.delEnd;       // 删除结束行（绝对，不含）
        const repl = fixedLines.slice(b.insStart, b.insEnd);

        const rangeStart = new vscode.Position(absStart, 0);
        // 删除范围：整行（含换行）。若 delStart==delEnd（纯插入），起点即插入点。
        const rangeEnd = new vscode.Position(absEnd, 0);

        let newText = repl.join('\n');
        // 若替换后文档还有内容（absEnd 之后仍有行），需要在末尾补换行，
        // 因为删除范围吃掉了 [absStart, absEnd) 各行及其行尾换行，下一行会紧跟。
        if (newText.length > 0 && absEnd < doc.lineCount) {
            newText += '\n';
        }

        edits.push(vscode.TextEdit.replace(new vscode.Range(rangeStart, rangeEnd), newText));
    }

    return edits;
}
