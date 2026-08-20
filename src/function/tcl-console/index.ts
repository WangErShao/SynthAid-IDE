import * as vscode from 'vscode';

import { t } from '../../i18n';

/**
 * @description 交互式 Vivado TCL 控制台（webview 面板）
 *
 * - 单例：由 PlManage 持有，重复调用 reveal() 只聚焦
 * - 回车发送命令到 Vivado stdin，stdout/stderr 经 onOutput 回显
 * - ↑/↓ 翻历史命令（vscode.setState 会话内持久化）
 */
export class TclConsolePanel {
    private panel?: vscode.WebviewPanel;
    private _onCommand?: (text: string) => void;
    private _onDispose?: () => void;

    public set onCommand(handler: (text: string) => void) {
        this._onCommand = handler;
    }

    public set onDispose(handler: () => void) {
        this._onDispose = handler;
    }

    public reveal(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Two);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'digital-ide.tcl-console',
            t('tcl-console.title'),
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        this.panel = panel;

        panel.onDidDispose(() => {
            this.panel = undefined;
            this._onDispose?.();
        });

        panel.webview.html = makeHtml();

        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'send':
                    this._onCommand?.(message.text);
                    break;
                default:
                    break;
            }
        });
    }

    /**
     * @description 追加进程输出到控制台
     */
    public appendOutput(text: string): void {
        this.panel?.webview.postMessage({ command: 'append', text });
    }
}

function makeHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t('tcl-console.title')}</title>
    <style>
        :root {
            --bg: #1e1e1e;
            --fg: #d4d4d4;
            --border: #3c3c3c;
            --accent: #0e639c;
            --cmd: #569cd6;
        }
        * { box-sizing: border-box; }
        body.vscode-light {
            --bg: #ffffff;
            --fg: #333333;
            --border: #e2e5e9;
            --cmd: #005fb8;
        }
        html, body {
            height: 100%;
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-editor-font-family, Consolas, monospace);
            font-size: 13px;
            display: flex;
            flex-direction: column;
        }
        #output {
            flex: 1;
            overflow-y: auto;
            padding: 8px 10px;
            white-space: pre-wrap;
            word-break: break-all;
            line-height: 1.45;
        }
        #output .cmd { color: var(--cmd); }
        #output .err { color: #f85149; }
        .input-row {
            display: flex;
            align-items: center;
            border-top: 1px solid var(--border);
            padding: 6px 10px;
            gap: 8px;
        }
        #input {
            flex: 1;
            background: var(--bg);
            color: var(--fg);
            border: 1px solid var(--border);
            padding: 6px 8px;
            outline: none;
        }
        #input:focus { border-color: var(--accent); }
        button {
            background: var(--accent);
            color: #fff;
            border: none;
            padding: 6px 12px;
            cursor: pointer;
        }
        button:hover { opacity: 0.9; }
    </style>
</head>
<body>
    <div id="output"></div>
    <div class="input-row">
        <input id="input" type="text" autocomplete="off" spellcheck="false" placeholder="${t('tcl-console.placeholder')}">
        <button id="send">${t('tcl-console.send')}</button>
        <button id="clear">${t('tcl-console.clear')}</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const outputEl = document.getElementById('output');
        const inputEl = document.getElementById('input');
        const state = vscode.getState() || { history: [], index: -1 };
        let history = state.history;
        let historyIndex = state.index;

        function append(text) {
            outputEl.textContent += text;
            outputEl.scrollTop = outputEl.scrollHeight;
        }

        function sendCommand() {
            const text = inputEl.value;
            if (!text.trim()) { return; }
            history.push(text);
            historyIndex = history.length;
            vscode.setState({ history, index: historyIndex });
            vscode.postMessage({ command: 'send', text });
            inputEl.value = '';
        }

        inputEl.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                sendCommand();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    inputEl.value = history[historyIndex] || '';
                }
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (historyIndex < history.length) {
                    historyIndex++;
                    inputEl.value = historyIndex === history.length ? '' : (history[historyIndex] || '');
                }
            }
        });

        document.getElementById('send').addEventListener('click', sendCommand);
        document.getElementById('clear').addEventListener('click', () => {
            outputEl.textContent = '';
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'append') {
                append(message.text);
            }
        });

        inputEl.focus();
    </script>
</body>
</html>`;
}
