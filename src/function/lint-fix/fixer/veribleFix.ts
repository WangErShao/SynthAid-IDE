import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as fspath from 'path';

import { FixContext, FixResult, LintFixer, getLintFixConfig } from '../common';

/**
 * @description Verible 确定性修复器。
 *
 * 修复路径:
 *  1. 本地确定性规则（毫秒级，不启进程不调 LLM，不依赖诊断 code）
 *  2. verible --autofix=inplace: 复制到临时文件修复，对比生成 edits（不污染源文件）
 */
export class VeribleFixer implements LintFixer {
    constructor(private veriblePath?: string) { }

    async fix(diagnostic: any, ctx: FixContext): Promise<FixResult | undefined> {
        // 本地确定性规则优先（毫秒级，不启进程不调 LLM）：
        // 不依赖诊断 code——常见根因（parameter 列表缺分号、end 缺分号、
        // 行尾空格）由规则本身保守判定，命中即修。
        const localEdit = this.fixViaLocalRules(ctx.document, ctx.diagnostic);
        if (localEdit) {
            return { edits: [localEdit], description: `规则修复 (${ctx.diagnostic.code})` };
        }

        // 再走 verible --autofix=inplace（对原生可修风格规则）
        const viaAutofix = await this.fixViaAutofix(ctx.document);
        if (viaAutofix) {
            return { ...viaAutofix, description: `Verible 自动修复 (${diagnostic.code})` };
        }

        return undefined;
    }

    /**
     * @description 每次修复重新读取最新 verible 路径（可能被 lintDocument 更新过）
     */
    private currentBin(): string {
        const cfg = getLintFixConfig();
        return cfg.veriblePath || this.veriblePath || 'verible-verilog-lint';
    }

    /**
     * @description 用 verible-verilog-lint --autofix=inplace 修复。
     * 复制源文件到临时目录，在临时副本上 inplace 修复，读回对比生成整文件 edits。
     * 不直接改动源文件，避免污染用户未保存的编辑。
     */
    private async fixViaAutofix(doc: vscode.TextDocument): Promise<FixResult | undefined> {
        const bin = this.currentBin();
        const before = doc.getText();

        // 复制到临时文件（保留原文件名，让 verible 的 module-filename 规则按正确文件名检查）
        const baseName = fspath.basename(doc.fileName);
        const tmpDir = fs.mkdtempSync(fspath.join(os.tmpdir(), 'synthaid-fix-'));
        const tmpFile = fspath.join(tmpDir, baseName);
        fs.writeFileSync(tmpFile, before, 'utf-8');

        return new Promise((resolve) => {
            cp.exec(
                `"${bin}" --autofix=inplace "${tmpFile}"`,
                { timeout: 20000 },
                (err, stdout, stderr) => {
                    try {
                        const after = fs.readFileSync(tmpFile, 'utf-8');
                        if (after && after !== before) {
                            const lastLine = doc.lineCount - 1;
                            const fullRange = new vscode.Range(
                                new vscode.Position(0, 0),
                                new vscode.Position(lastLine, doc.lineAt(lastLine).text.length)
                            );
                            resolve({ edits: [vscode.TextEdit.replace(fullRange, after)], description: 'Verible autofix' });
                            return;
                        }
                    } catch { /* ignore */ }
                    finally {
                        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
                    }
                    resolve(undefined);
                }
            );
        });
    }

    /**
     * @description 本地确定性规则（不依赖 verible）。
     */
    private fixViaLocalRules(doc: vscode.TextDocument, diag: any): vscode.TextEdit | undefined {
        const line = doc.lineAt(diag.range.start.line).text;
        const code = diag.code || '';

        // 缺分号：行尾 `end`/`endmodule` 缺 `;`（在 always 块内的 end）
        if (/end$/.test(line.trim()) && !/;/.test(line.trim())) {
            const pos = new vscode.Position(diag.range.start.line, line.length);
            return vscode.TextEdit.insert(pos, ';');
        }

        // 行尾多余空格
        if (/[ \t]+$/.test(line) && /trailing|space/.test(code)) {
            const trimmed = line.replace(/[ \t]+$/, '');
            const range = new vscode.Range(
                new vscode.Position(diag.range.start.line, 0),
                new vscode.Position(diag.range.start.line, line.length)
            );
            return vscode.TextEdit.replace(range, trimmed);
        }

        // 语法错误（或未知 code）：parameter/localparam 列表末尾缺分号
        // （级联语法错误的常见根因，如 `GRAY = 16'hD69A,` 后直接结束，未写 `;`）
        const semicolon = this.fixMissingParamSemicolon(doc, diag.range.start.line);
        if (semicolon) {return semicolon;}

        return undefined;
    }

    /**
     * @description 从诊断行向上寻找未收尾的 parameter/localparam 列表，
     * 若最后一行以逗号结尾且无 `;`，则补上分号。
     *
     * 向上扫描**不设边界**：级联语法错误可能位于 always/if 块深处，
     * 需跨过这些行才能找到上方真正缺分号的参数列表（最多回看 60 行）。
     * 向下则用逗号/分号逻辑判断列表是否已收尾，避免误改。
     */
    private fixMissingParamSemicolon(doc: vscode.TextDocument, diagLine: number): vscode.TextEdit | undefined {
        const PARAM_RE = /^\s*(parameter|localparam)\b/;

        for (let i = diagLine - 1; i >= 0 && i > diagLine - 60; i--) {
            const t = doc.lineAt(i).text.trim();
            if (!PARAM_RE.test(t)) {continue;}
            const fix = this.scanParamList(doc, i);
            if (fix) {return fix;}
            // 该列表已正确收尾，继续向上找下一个 parameter 声明
        }
        return undefined;
    }

    /**
     * @description 从 parameter 声明行向下验证列表是否未收尾。
     * 列表内任一行（含下一行单独写 `;`）出现分号即视为已收尾；否则在最后一个
     * 逗号结尾行补分号。行内 `//` 注释先剥离，避免注释内容干扰判断。
     */
    private scanParamList(doc: vscode.TextDocument, startLine: number): vscode.TextEdit | undefined {
        const BOUNDARY_RE = /^(module|endmodule|assign|initial|function|endfunction|task|endtask|generate|endgenerate)\b/;
        let j = startLine;
        let lastCommaLine = -1;
        while (j < doc.lineCount) {
            const cur = doc.lineAt(j).text.trim();
            if (BOUNDARY_RE.test(cur)) {break;}
            const codePart = cur.replace(/\/\/.*$/, '').trim();
            if (codePart.includes(';')) {return undefined;}   // 已正常收尾
            if (codePart.endsWith(',')) {lastCommaLine = j; j++; continue;}
            // 既不以逗号结尾也不含分号：列表到此结束。
            // 若下一行单独写 `;`（`B = 2\n;` 的写法）视为已收尾。
            if (j + 1 < doc.lineCount && doc.lineAt(j + 1).text.replace(/\/\/.*$/, '').includes(';')) {
                return undefined;
            }
            break;
        }
        if (lastCommaLine >= 0) {
            // 把最后一个逗号替换为分号。必须在行内注释之前（注释会吞掉后面的分号）。
            const lineText = doc.lineAt(lastCommaLine).text;
            const commentIdx = lineText.indexOf('//');
            if (commentIdx >= 0) {
                // 行内含注释：分号插在注释前，并删掉代码尾部的逗号
                const codeText = lineText.slice(0, commentIdx);
                const trimmedCode = codeText.trimEnd();
                if (trimmedCode.endsWith(',')) {
                    const commaPos = commentIdx - (codeText.length - trimmedCode.length) - 1;
                    return vscode.TextEdit.replace(
                        new vscode.Range(new vscode.Position(lastCommaLine, commaPos), new vscode.Position(lastCommaLine, commaPos + 1)),
                        ';'
                    );
                }
            } else {
                // 无注释：行尾本身就是逗号，直接替换
                const trimmedLine = lineText.trimEnd();
                if (trimmedLine.endsWith(',')) {
                    const commaPos = trimmedLine.length - 1;
                    return vscode.TextEdit.replace(
                        new vscode.Range(new vscode.Position(lastCommaLine, commaPos), new vscode.Position(lastCommaLine, commaPos + 1)),
                        ';'
                    );
                }
            }
        }
        return undefined;
    }
}
