import * as vscode from 'vscode';
import * as fspath from 'path';

/**
 * @description 统一诊断结构，来自不同 lint 工具的标准化输出
 */
export interface LintDiagnostic {
    source: 'verible' | 'vivado' | 'lsp';   // 来源
    code: string;                            // 诊断码/规则名
    severity: 'error' | 'warning' | 'info';
    range: vscode.Range;                     // 位置
    message: string;                         // 描述
    fixable: 'verible' | 'llm' | 'none';     // 修复路由
}

/**
 * @description 修复结果
 */
export interface FixResult {
    edits: vscode.TextEdit[];                // 应用到文档的编辑
    description: string;                     // 修复说明（用于 diff/日志）
    verified?: boolean;                      // 是否已通过重 lint 验证
}

/**
 * @description 修复上下文：诊断 + 相关代码片段
 */
export interface FixContext {
    document: vscode.TextDocument;
    diagnostic: LintDiagnostic;
    codeSnippet: string;                     // 诊断行附近代码
    snippetStartLine: number;                // codeSnippet 在文档中的起始行号
}

/**
 * @description 修复器统一接口（v1 函数 与 Phase3 agent 都实现它）
 */
export interface LintFixer {
    fix(diagnostic: LintDiagnostic, ctx: FixContext): Promise<FixResult | undefined>;
}

/**
 * @description 判断是否语法类诊断（无确定性 verible autofix，但可由本地规则/LLM 修复）
 */
export function isSyntaxDiagnostic(diag: { code?: string }): boolean {
    const code = String(diag?.code || '');
    return code === 'syntax-error' || /syntax|parse error/i.test(code);
}

/**
 * @description 从诊断读取相关代码片段（诊断行 + 上下文若干行）。
 * 返回文本与起始行号。
 */
export function extractCodeSnippet(document: vscode.TextDocument, range: vscode.Range, contextLines = 3): { text: string; startLine: number } {
    const startLine = Math.max(0, range.start.line - contextLines);
    const endLine = Math.min(document.lineCount - 1, range.end.line + contextLines);
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
        lines.push(document.lineAt(i).text);
    }
    return { text: lines.join('\n'), startLine };
}

/**
 * @description 读取配置
 */
export function getLintFixConfig() {
    const cfg = vscode.workspace.getConfiguration('synthaid-ide.lintFix');
    let veriblePath = cfg.get<string>('verible.path', '');
    // 回退：workspace 未配置时，读取全局 digital-ide.prj.verible.install.path（可能是目录或 exe）
    if (!veriblePath) {
        const installPath = vscode.workspace.getConfiguration('digital-ide.prj').get<string>('verible.install.path', '');
        if (installPath) {
            veriblePath = installPath.toLowerCase().endsWith('.exe')
                ? installPath
                : fspath.join(installPath, 'verible-verilog-lint.exe');
        }
    }
    return {
        enable: cfg.get<boolean>('enable', true),
        vivadoOnSave: cfg.get<boolean>('vivadoOnSave', false),
        agentEnabled: cfg.get<boolean>('agentEnabled', true),
        maxIterations: cfg.get<number>('maxIterations', 3),
        onlyUserDir: cfg.get<boolean>('onlyUserDir', false),
        thinking: cfg.get<boolean>('thinking', false),
        veriblePath,
        vivadoPath: cfg.get<string>('vivado.path', ''),
    };
}
