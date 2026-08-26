/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as fspath from 'path';

/**
 * @description 光标点进 property.json 的空字符串值（如 "toolChain": ""）时，
 * 自动触发补全弹出枚举备选（xilinx / gowin / device 列表），
 * 用户无需输入字符或按快捷键（Ctrl+Space 常被中文输入法占用）。
 */
const ASSIST_PROPERTIES = new Set([
    'toolChain',
    'device',
    // soc 下同级的枚举字段（core / bd / os / app）
    'core',
    'bd',
    'os',
    'app',
    // 工程名称（自由字符串，配合示例名补全）
    'PL',
    'PS'
]);

/**
 * @description PL / PS 工程名的示例命名（补全下拉用）
 */
const PROJECT_NAME_EXAMPLES: { label: string; detail: string }[] = [
    { label: 'led', detail: 'LED 闪灯示例工程' },
    { label: 'counter', detail: '计数器示例工程' },
    { label: 'fifo_ex', detail: 'FIFO 示例工程' },
    { label: 'top', detail: '与顶层模块同名的工程' },
    { label: 'traffic_light', detail: '交通灯状态机示例工程' },
    { label: 'uart_rx', detail: 'UART 接收示例工程' },
    { label: 'pwm_led', detail: 'PWM 调光示例工程' },
];

function isPropertyJson(document: vscode.TextDocument): boolean {
    return document.languageId === 'json' && fspath.basename(document.uri.fsPath) === 'property.json';
}

export function activateJsonAssist(context: vscode.ExtensionContext) {
    let lastTrigger = 0;
    let timer: NodeJS.Timeout | undefined;

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            const editor = e.textEditor;
            if (!editor || !isPropertyJson(editor.document)) {
                return;
            }

            const position = editor.selection.active;
            const line = editor.document.lineAt(position.line).text;

            // 匹配 "key": ""，仅当值为空字符串时协助
            const m = /"([A-Za-z]+)"\s*:\s*""/.exec(line);
            if (!m || !ASSIST_PROPERTIES.has(m[1])) {
                return;
            }

            // 空字符串 "  " 的引号位置，光标须落在其上或其内
            const valueStart = m.index + m[0].indexOf('""');
            if (position.character < valueStart || position.character > valueStart + 1) {
                return;
            }

            // 防抖，避免同一位置反复触发
            const now = Date.now();
            if (now - lastTrigger < 1000) {
                return;
            }
            lastTrigger = now;

            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                vscode.commands.executeCommand('editor.action.triggerSuggest');
            }, 60);
        })
    );

    // 为 property.json 的 prjName.PL / PS 提供示例工程名补全（自由字符串，无 schema enum）
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'json', pattern: '**/property.json' },
            {
                provideCompletionItems(document, position) {
                    const line = document.lineAt(position.line).text;
                    const m = /"([A-Za-z]+)"\s*:\s*""/.exec(line);
                    if (!m || !ASSIST_PROPERTIES.has(m[1]) || !(m[1] === 'PL' || m[1] === 'PS')) {
                        return undefined;
                    }
                    const key = m[1];
                    const isPL = key === 'PL';
                    return PROJECT_NAME_EXAMPLES.map(ex => {
                        const item = new vscode.CompletionItem(ex.label, vscode.CompletionItemKind.Value);
                        item.detail = isPL ? `FPGA 工程名示例：${ex.detail}` : `SOC 工程名示例：${ex.detail}`;
                        item.documentation = new vscode.MarkdownString(
                            `**${isPL ? 'PL（FPGA 硬件工程）名称' : 'PS（SOC 软件工程）名称'}**：可自由命名，建议小写字母与下划线。\n\n示例：\n\`\`\`json\n{"prjName": {"${key}": "${ex.label}"}}\n\`\`\``
                        );
                        return item;
                    });
                }
            }
        )
    );
}
