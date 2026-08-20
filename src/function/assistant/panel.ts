import * as vscode from 'vscode';

import { t } from '../../i18n';
import { getAssistantConfig, openAssistantSettings } from './config';
import { buildRtlContext } from './context';
import { ChatMessage, ExecuteTcl, runConversation } from './llm';

export interface ChatPanelOptions {
    executeTcl: ExecuteTcl;
}

/**
 * @description AI 助手聊天 webview 面板（单例）
 *
 * - 发送消息 → runConversation（LLM + 工具调用循环）
 * - 工具调用经 executeTcl 在 Vivado 进程执行，结果实时展示
 * - v1：会话历史存内存，面板单例在 VSCode 运行期间保留
 */
export class ChatPanel {
    private panel?: vscode.WebviewPanel;
    private _onDispose?: () => void;
    private readonly executeTcl: ExecuteTcl;
    private messages: ChatMessage[] = [];
    private processing = false;

    constructor(options: ChatPanelOptions) {
        this.executeTcl = options.executeTcl;
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
            'digital-ide.assistant',
            t('assistant.title'),
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
                    this.onSend(message.text);
                    break;
                case 'clear':
                    this.messages = [];
                    break;
                case 'settings':
                    openAssistantSettings();
                    break;
                default:
                    break;
            }
        });
    }

    /**
     * @description 发送一条消息并驱动 LLM 对话
     */
    private async onSend(text: string) {
        if (this.processing || !text || text.trim().length === 0) {
            return;
        }
        this.processing = true;
        this.append('user', text);
        this.messages.push({ role: 'user', content: text });
        this.setProcessing(true);

        const config = getAssistantConfig();
        if (!config.apiKey) {
            this.append('error', t('assistant.not-configured'));
            this.setProcessing(false);
            this.processing = false;
            return;
        }

        try {
            const designContext = config.injectRtlContext ? buildRtlContext() : '';
            const finalText = await runConversation(config, this.messages, this.executeTcl, {
                onToolCall: (name, args) => {
                    const preview = typeof args?.command === 'string'
                        ? args.command
                        : JSON.stringify(args);
                    this.append('tool', `${name}: ${preview}`);
                },
                onToolResult: content => {
                    const lines = content.split('\n');
                    const preview = lines.slice(0, 5).join('\n');
                    const truncated = lines.length > 5
                        ? `\n... (${content.length} chars total)`
                        : '';
                    this.append('tool', preview + truncated);
                }
            }, { designContext });
            this.append('assistant', finalText);
            this.messages.push({ role: 'assistant', content: finalText });
        } catch (error: any) {
            this.append('error', error?.message || String(error));
        } finally {
            this.setProcessing(false);
            this.processing = false;
        }
    }

    private append(tag: string, text: string): void {
        this.panel?.webview.postMessage({ command: 'append', tag, text });
    }

    private setProcessing(on: boolean): void {
        this.panel?.webview.postMessage({ command: 'processing', on });
    }
}

function makeHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t('assistant.title')}</title>
    <style>
        :root {
            --bg: #1e1e1e;
            --panel: #252526;
            --fg: #d4d4d4;
            --muted: #8b8f98;
            --border: #3c3c3c;
            --user: #4fc3f7;
            --assistant: #e8eaed;
            --tool: #81c995;
            --error: #f28b82;
            --system: #9e9e9e;
            --accent: #0e639c;
        }
        body.vscode-light {
            --bg: #ffffff;
            --panel: #f5f6f8;
            --fg: #202124;
            --muted: #5f6368;
            --border: #e2e5e9;
            --assistant: #202124;
            --system: #80868b;
            --accent: #0e639c;
        }
        * { box-sizing: border-box; }
        html, body {
            height: 100%;
            margin: 0;
            background: var(--bg);
            color: var(--fg);
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            font-size: 13px;
            display: flex;
            flex-direction: column;
        }
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        .msg { margin-bottom: 12px; }
        .msg-label {
            font-size: 11px;
            font-weight: 700;
            margin-bottom: 2px;
        }
        .msg.user .msg-label { color: var(--user); }
        .msg.assistant .msg-label { color: var(--assistant); }
        .msg.tool .msg-label { color: var(--tool); }
        .msg.error .msg-label { color: var(--error); }
        .msg.system .msg-label { color: var(--system); }
        .msg-body {
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.5;
        }
        .msg.user .msg-body { color: var(--user); }
        .msg.tool .msg-body {
            color: var(--tool);
            background: var(--panel);
            border-left: 3px solid var(--tool);
            padding: 6px 8px;
            border-radius: 4px;
        }
        .msg.error .msg-body { color: var(--error); }
        .msg.system .msg-body { color: var(--system); }
        #status {
            font-size: 11px;
            color: var(--muted);
            padding: 2px 12px;
            min-height: 16px;
        }
        .input-row {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            border-top: 1px solid var(--border);
            padding: 8px 12px;
        }
        textarea {
            flex: 1;
            background: var(--panel);
            color: var(--fg);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 8px;
            resize: none;
            outline: none;
            font-family: inherit;
        }
        textarea:focus { border-color: var(--accent); }
        button {
            background: var(--accent);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 8px 14px;
            cursor: pointer;
        }
        button:disabled { opacity: 0.5; cursor: default; }
        #clear, #settings { background: transparent; color: var(--muted); }
        #clear:hover, #settings:hover { background: var(--panel); }
    </style>
</head>
<body>
    <div id="messages"></div>
    <div id="status"></div>
    <div class="input-row">
        <textarea id="input" rows="2" placeholder="${t('assistant.placeholder')}"></textarea>
        <button id="send">${t('assistant.send')}</button>
        <button id="clear">${t('assistant.clear')}</button>
        <button id="settings" title="${t('assistant.settings')}">⚙</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messagesEl = document.getElementById('messages');
        const statusEl = document.getElementById('status');
        const inputEl = document.getElementById('input');
        const sendBtn = document.getElementById('send');
        const clearBtn = document.getElementById('clear');
        const settingsBtn = document.getElementById('settings');

        function addMessage(tag, text) {
            const div = document.createElement('div');
            div.className = 'msg ' + tag;
            const label = document.createElement('div');
            label.className = 'msg-label';
            label.textContent = {
                user: '${t('assistant.you')}',
                assistant: '${t('assistant.assistant')}',
                tool: '${t('assistant.tool')}',
                error: '${t('assistant.error-label')}',
                system: '${t('assistant.system')}'
            }[tag] || tag;
            const body = document.createElement('div');
            body.className = 'msg-body';
            body.textContent = text;
            div.appendChild(label);
            div.appendChild(body);
            messagesEl.appendChild(div);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function send() {
            const text = inputEl.value.trim();
            if (!text) { return; }
            vscode.postMessage({ command: 'send', text });
            inputEl.value = '';
        }

        inputEl.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
            }
        });
        sendBtn.addEventListener('click', send);
        clearBtn.addEventListener('click', () => {
            messagesEl.textContent = '';
            vscode.postMessage({ command: 'clear' });
        });
        settingsBtn.addEventListener('click', () => vscode.postMessage({ command: 'settings' }));

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'append') {
                addMessage(message.tag, message.text);
            } else if (message.command === 'processing') {
                statusEl.textContent = message.on ? '${t('assistant.thinking')}' : '${t('assistant.ready')}';
                sendBtn.disabled = message.on;
                inputEl.disabled = message.on;
                if (!message.on) { inputEl.focus(); }
            }
        });

        inputEl.focus();
    </script>
</body>
</html>`;
}
