import * as vscode from 'vscode';

import { LintDiagnostic, FixContext, FixResult, extractCodeSnippet, getLintFixConfig } from './common';
import { FixRouter } from './fixer/router';
import { DiffView } from './diffView';
import { runVeribleLintOnText, isAutoFixableRule } from './collector/verible';

/**
 * @description 统一诊断管理器：收集 Verible 结果 → DiagnosticCollection。
 */
export class LintFixManager implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    private diagCollection: vscode.DiagnosticCollection;
    private router: FixRouter;
    private diffView: DiffView;
    private output: vscode.OutputChannel;
    private veriblePath: string = '';
    private vivadoPath: string = '';
    private enabled: boolean = true;
    private vivadoOnSave: boolean = false;
    private agentEnabled: boolean = true;

    constructor(context: vscode.ExtensionContext) {
        this.diagCollection = vscode.languages.createDiagnosticCollection('synthaid-lint');
        this.diffView = new DiffView();
        this.output = vscode.window.createOutputChannel('SynthAid LintFix');
        this.log('lint-fix 模块初始化...');
        this.veriblePath = this.loadConfig().veriblePath;
        this.enabled = this.loadConfig().enable;
        this.vivadoOnSave = this.loadConfig().vivadoOnSave;
        this.vivadoPath = this.loadConfig().vivadoPath;
        this.router = new FixRouter(this.veriblePath);
        this.log(`配置: enable=${this.enabled} agentEnabled=${this.agentEnabled} veriblePath=${this.veriblePath || '(空)'}`);

        // 注册 CodeActionProvider（💡）
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                [{ language: 'verilog' }, { language: 'systemverilog' }],
                this,
                { providedCodeActionKinds: LintFixManager.providedCodeActionKinds }
            )
        );

        // 存盘触发 Verible lint
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                this.onDidSave(doc);
            })
        );

        // 命令
        context.subscriptions.push(
            vscode.commands.registerCommand('synthaid-ide.lintFix.vivado', () => this.runVivadoLint()),
            vscode.commands.registerCommand('synthaid-ide.lintFix.ai-fix', () => this.aiFixCurrent()),
            vscode.commands.registerCommand('synthaid-ide.lintFix.debug', () => this.debugFixCurrent()),
            vscode.commands.registerCommand('synthaid-ide.lintFix.apply', () => { /* 由 diffView 内部处理 */ }),
        );
    }

    private log(msg: string) {
        console.log(`[synthaid-lint] ${msg}`);
        this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    private loadConfig() {
        const cfg = getLintFixConfig();
        this.veriblePath = cfg.veriblePath;
        this.vivadoPath = cfg.vivadoPath;
        this.enabled = cfg.enable;
        this.vivadoOnSave = cfg.vivadoOnSave;
        this.agentEnabled = cfg.agentEnabled;
        return cfg;
    }

    // ── CodeActionProvider（💡 显示修复选项） ──
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken,
    ): vscode.CodeAction[] {
        if (!this.enabled) {return [];}
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
            const lintDiag = this.toLintDiagnostic(diag, document);
            if (!lintDiag) {continue;}
            if (lintDiag.fixable === 'none') {continue;}
            this.log(`codeAction diag code=${lintDiag.code} fixable=${lintDiag.fixable} source=${diag.source}`);

            // Verible 可修
            if (lintDiag.fixable === 'verible') {
                const action = new vscode.CodeAction(
                    `使用 Verible 修复 (${lintDiag.code})`,
                    vscode.CodeActionKind.QuickFix
                );
                action.diagnostics = [diag];
                action.command = {
                    command: '_synthaid.lintFix.doVerible',
                    title: 'Verible fix',
                    arguments: [{ document, diagnostic: lintDiag }],
                };
                actions.push(action);
            }

            // SynthAid 修复：本地规则优先，LLM 兜底。
            // 不设 agentEnabled 门槛——本地确定性规则不依赖 API Key/agent，
            // LLM 兜底内部会自我判断（无 key / 关闭 agent 时自动跳过）。
            const aiAction = new vscode.CodeAction(
                `使用 SynthAid 修复 (${lintDiag.code})`,
                vscode.CodeActionKind.QuickFix
            );
            aiAction.diagnostics = [diag];
            aiAction.command = {
                command: '_synthaid.lintFix.doAI',
                title: 'SynthAid fix',
                arguments: [{ document, diagnostic: lintDiag }],
            };
            actions.push(aiAction);
        }
        return actions;
    }

    // ── 内部命令 ──
    async doVeribleFix(args: { document: vscode.TextDocument; diagnostic: LintDiagnostic }) {
        let editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri !== args.document.uri) {
            editor = await vscode.window.showTextDocument(args.document);
        }
        if (!editor) {return;}
        const ed = editor;
        const ctx = this.makeContext(ed.document, args.diagnostic);
        this.log(`doVeribleFix code=${args.diagnostic.code} line=${args.diagnostic.range.start.line + 1}`);
        const result = await this.router.route(args.diagnostic, ctx, 'verible');
        if (result && result.edits.length) {
            this.applyAndVerify(ed, result, ctx);
        } else {
            vscode.window.showInformationMessage('Verible 无法自动修复此问题');
        }
    }

    async doAIFix(args: { document: vscode.TextDocument; diagnostic: LintDiagnostic }) {
        let editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri !== args.document.uri) {
            editor = await vscode.window.showTextDocument(args.document);
        }
        if (!editor) {return;}
        const ed = editor;
        const ctx = this.makeContext(ed.document, args.diagnostic);
        this.log(`doAIFix code=${args.diagnostic.code} fixable=${args.diagnostic.fixable} line=${args.diagnostic.range.start.line + 1}`);
        const result = await this.router.route(args.diagnostic, ctx, 'llm');
        if (result && result.edits.length) {
            this.log(`fix result: ${result.description}, edits=${result.edits.length}`);
            // 本地确定性规则（description 以「规则修复」开头）直接应用，跳过 diff 确认；
            // 只有真正走 LLM 的修复才需要用户预览确认。
            if (result.description?.startsWith('规则修复')) {
                this.applyAndVerify(ed, result, ctx);
                vscode.window.showInformationMessage(`已自动修复：${result.description}`);
            } else {
                const before = ed.document.getText();
                this.diffView.show(before, result, () => {
                    this.applyAndVerify(ed, result, ctx);
                });
            }
        } else {
            this.log('fix failed: no result');
            vscode.window.showInformationMessage('SynthAid 修复失败（可能是未配置 API Key 或模型无法修复）');
        }
    }

    /**
     * @description 调试命令：对当前文件完整跑一遍「lint → 修复 → 应用 → 重 lint」管线，
     * 每个步骤输出到 Output 面板（View → Output → SynthAid LintFix）并弹窗报告结果，
     * 用于绕过灯泡 UI 直接定位问题环节。
     */
    async debugFixCurrent() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('请先打开一个 Verilog/SystemVerilog 文件');
            return;
        }
        const doc = editor.document;
        this.output.show(true);
        this.log(`==== debugFixCurrent: ${doc.uri.fsPath} lang=${doc.languageId} ====`);
        if (doc.languageId !== 'verilog' && doc.languageId !== 'systemverilog') {
            this.log('debug: 非 verilog/systemverilog 文件，跳过');
            return;
        }

        // 1. 跑 verible lint（内存文本）
        const cfg = getLintFixConfig();
        this.log(`debug: veriblePath=${cfg.veriblePath || '(空)'}`);
        const results = await runVeribleLintOnText(doc.getText(), doc.uri.fsPath, cfg.veriblePath);
        this.log(`debug: lint 发现 ${results.length} 条诊断`);
        for (const r of results.slice(0, 5)) {
            this.log(`  code=${r.code} line=${r.range.start.line + 1} fixable=${r.fixable} msg=${r.message}`);
        }
        if (results.length === 0) {
            vscode.window.showWarningMessage('该文件当前没有 lint 诊断。请确认已保存文件，且 verible 路径已配置（设置 digital-ide.prj.verible.install.path）');
            return;
        }

        // 2. 取第一条诊断，走修复管线（本地规则优先，LLM 兜底）
        const diag = results[0];
        const ctx = this.makeContext(doc, diag);
        this.log(`debug: 对第一条诊断 code=${diag.code} line=${diag.range.start.line + 1} 开始修复...`);
        const result = await this.router.route(diag, ctx, 'llm');
        if (!result || !result.edits.length) {
            this.log('debug: 本地规则和 LLM 均未产出修复');
            vscode.window.showErrorMessage(`修复失败：本地规则和 LLM 均未产出修复（code=${diag.code}）。详见输出面板 SynthAid LintFix`);
            return;
        }
        this.log(`debug: 修复描述=${result.description} edits=${result.edits.length}`);
        for (const e of result.edits) {
            this.log(`  edit: line ${e.range.start.line + 1}-${e.range.end.line + 1} → ${JSON.stringify(e.newText)}`);
        }

        // 3. 应用
        const applied = await FixRouter.apply(editor, result);
        this.log(`debug: 应用结果=${applied}`);
        if (!applied) {
            vscode.window.showErrorMessage('修复已生成但写入文档失败。详见输出面板 SynthAid LintFix');
            return;
        }

        // 4. 重 lint（用修复后的编辑器内容）
        const after = await runVeribleLintOnText(editor.document.getText(), doc.uri.fsPath, cfg.veriblePath);
        this.log(`debug: 修复后诊断数=${after.length}`);
        this.diagCollection.set(doc.uri, after.map(r => this.toVscodeDiagnostic(r)));

        vscode.window.showInformationMessage(
            `修复完成：${result.description}。修复前 ${results.length} 条诊断 → 修复后 ${after.length} 条。`
        );
    }

    private aiFixCurrent() {
        // 对当前诊断用 AI 修复（命令入口，取当前光标处诊断）
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return;}
        const diags = vscode.languages.getDiagnostics(editor.document.uri);
        const atCursor = diags.find(d => d.range.contains(editor.selection.active));
        if (atCursor) {
            const lintDiag = this.toLintDiagnostic(atCursor, editor.document);
            if (lintDiag) {this.doAIFix({ document: editor.document, diagnostic: lintDiag });}
        }
    }

    // ── 修复应用 + 重 lint 验证 ──
    private async applyAndVerify(editor: vscode.TextEditor, result: FixResult, ctx: FixContext) {
        const applied = await FixRouter.apply(editor, result);
        this.log(`apply edits: ${applied}`);
        if (applied) {
            // 重 lint 验证（用编辑器当前内存内容，含本次修复），更新诊断
            await this.lintDocument(editor.document);
        }
    }

    // ── 存盘触发 ──
    private onDidSave(doc: vscode.TextDocument) {
        if (!this.enabled) {return;}
        if (doc.languageId === 'verilog' || doc.languageId === 'systemverilog') {
            this.lintDocument(doc);
        }
    }

    /**
     * @description 对单个文件跑 Verible lint，写入诊断集合。
     * 用编辑器内存文本（临时文件）lint，确保修复后的即时重验证反映未保存的修改。
     */
    async lintDocument(doc: vscode.TextDocument) {
        try {
            // 每次 lint 重新读取配置，保证跨工作区/改配置后仍能拿到 verible 路径
            const cfg = getLintFixConfig();
            this.veriblePath = cfg.veriblePath;
            const results = await runVeribleLintOnText(doc.getText(), doc.uri.fsPath, this.veriblePath);
            const diags = results.map(r => this.toVscodeDiagnostic(r));
            this.diagCollection.set(doc.uri, diags);
            this.log(`lintDocument: verible path=${this.veriblePath || '(空)'} file=${doc.uri.fsPath} diagnostics=${diags.length}`);
            if (diags.length === 0 && !this.veriblePath) {
                vscode.window.showWarningMessage('SynthAid-IDE: 未找到 verible-verilog-lint，请在设置 digital-ide.prj.verible.install.path 中配置路径');
            }
        } catch (e) {
            // verible 未安装等，静默（不打扰）
            this.log(`lintDocument error: ${(e as Error)?.message || String(e)}`);
        }
    }

    /**
     * @description Vivado 深度检查（手动触发）
     */
    private async runVivadoLint() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {return;}
        const file = editor.document.fileName;
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Vivado synth_design -rtl 检查中...',
        }, async () => {
            // MVP: 提示未实现，后续补 Vivado 集成
            vscode.window.showInformationMessage('Vivado 深度检查将在 Phase 2 实现');
        });
    }

    // ── 转换工具 ──
    private toLintDiagnostic(diag: vscode.Diagnostic, doc: vscode.TextDocument): LintDiagnostic | undefined {
        const isVerible = diag.source === 'Verible';
        const code = diag.code ? String(diag.code) : 'unknown';
        return {
            // 保留原始来源，Verible 诊断可判定是否可确定性修复
            source: isVerible ? 'verible' : 'lsp',
            code,
            severity: diag.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                diag.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info',
            range: diag.range,
            // 去掉 toVscodeDiagnostic 添加的 [Verible] 前缀
            message: diag.message.replace(/^\[Verible\]\s*/, ''),
            fixable: isVerible && isAutoFixableRule(code) ? 'verible' : 'llm',
        };
    }

    private toVscodeDiagnostic(d: LintDiagnostic): vscode.Diagnostic {
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error :
            d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
                vscode.DiagnosticSeverity.Information;
        const vd = new vscode.Diagnostic(d.range, `[Verible] ${d.message}`, severity);
        vd.source = 'Verible';
        vd.code = d.code;
        return vd;
    }

    private makeContext(doc: vscode.TextDocument, diag: LintDiagnostic): FixContext {
        // 语法错误是「级联」的：真实错误往往在诊断位置之前（如缺分号/缺 begin-end），
        // 报错位置距离真实错误可能隔很多行。因此语法错误用更大的上下文窗口（最多 30 行）。
        const isSyntax = diag.code === 'syntax-error' || /syntax/.test(diag.code);
        const contextLines = isSyntax ? 30 : 3;
        const { text, startLine } = extractCodeSnippet(doc, diag.range, contextLines);
        return {
            document: doc,
            diagnostic: diag,
            codeSnippet: text,
            snippetStartLine: startLine,
        };
    }
}

// 隐藏命令需要注册到 extension 层，这里导出一个注册函数
export function registerLintFix(context: vscode.ExtensionContext) {
    const manager = new LintFixManager(context);

    // 注册隐藏命令（CodeAction 的 command 指向这里）
    context.subscriptions.push(
        vscode.commands.registerCommand('_synthaid.lintFix.doVerible', (args) => manager.doVeribleFix(args)),
        vscode.commands.registerCommand('_synthaid.lintFix.doAI', (args) => manager.doAIFix(args)),
    );

    return manager;
}
