import * as vscode from 'vscode';

import { FixContext, FixResult, LintDiagnostic, LintFixer } from '../common';
import { VeribleFixer } from './veribleFix';
import { LlmFixer } from './llmFix';

/**
 * @description 修复路由器：根据诊断类型分发到 Verible 或 LLM。
 *
 * 策略:
 *  - fixable === 'verible' → Verible 确定性修复
 *  - 其余诊断（含语法错误）→ **本地确定性规则优先**（毫秒级，不依赖 code），
 *    修不了才调 LLM（LLM 内部会判断是否可用：无 key / 关闭 agent 时自动跳过）
 *  - 用户手动选择时，强制走指定路径
 */
export class FixRouter {
    private veribleFixer: VeribleFixer;
    private llmFixer: LlmFixer;

    constructor(veriblePath?: string) {
        this.veribleFixer = new VeribleFixer(veriblePath);
        this.llmFixer = new LlmFixer();
    }

    /**
     * @description 按诊断类型路由修复
     */
    async route(diagnostic: LintDiagnostic, ctx: FixContext, force?: 'verible' | 'llm'): Promise<FixResult | undefined> {
        const verible = () => this.tryFix(this.veribleFixer, diagnostic, ctx);
        const llm = () => this.tryFix(this.llmFixer, diagnostic, ctx);

        if (force === 'verible') {
            return verible();
        }
        if (force === 'llm') {
            // 本地确定性规则优先（毫秒级，不依赖诊断 code）：
            // 常见根因（parameter 列表缺分号等）直接命中即修，避免白白调 LLM。
            const local = await verible();
            if (local) {return local;}
            return llm();
        }

        // 自动路由
        if (diagnostic.fixable === 'verible') {
            return verible();
        }
        const local = await verible();
        if (local) {return local;}
        return llm();
    }

    /**
     * @description 安全调用修复器，异常一律返回 undefined（不打断流程）
     */
    private async tryFix(fixer: LintFixer, diagnostic: LintDiagnostic, ctx: FixContext): Promise<FixResult | undefined> {
        try {
            return await fixer.fix(diagnostic, ctx);
        } catch (e) {
            console.error('修复失败:', e);
            return undefined;
        }
    }

    /**
     * @description 应用修复（写回文档）。返回是否成功。
     */
    static async apply(editor: vscode.TextEditor, result: FixResult): Promise<boolean> {
        if (!result || !result.edits.length) {return false;}
        const edit = new vscode.WorkspaceEdit();
        for (const e of result.edits) {
            edit.replace(editor.document.uri, e.range, e.newText);
        }
        return vscode.workspace.applyEdit(edit);
    }
}
