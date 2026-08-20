import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fspath from 'path';

import { t } from '../../i18n';
import { opeParam } from '../../global';
import { hdlDir, hdlPath } from '../../hdlFs';
import { hdlParam } from '../../hdlParser';
import { refreshArchTree, refreshIpCatalogTree } from '../treeView';
import { IpSchema, buildIpCreateTcl, ipSchemas } from './schema';

export interface IpCatalogPanelOptions {
    /** 当前面板对应的 IP schema id */
    schemaId: string;
    /** 执行 TCL 命令（走 Vivado 进程） */
    executeTcl: (command: string, timeout?: number) => Promise<string>;
}

/**
 * @description 单个 IP 的创建面板（webview，每个 IP 一个独立标签）
 *
 * - 仅渲染对应 schema 的参数表单
 * - 提交后生成 create_ip + set_property + generate_target 命令，经 executeTcl 在 Vivado 执行
 * - 创建成功后把 IP 同步到树扫描位置并刷新树
 */
export class IpCatalogPanel {
    private panel?: vscode.WebviewPanel;
    private _onDispose?: () => void;
    private readonly executeTcl: (command: string, timeout?: number) => Promise<string>;
    private readonly schema: IpSchema;

    constructor(options: IpCatalogPanelOptions) {
        this.executeTcl = options.executeTcl;
        const schema = ipSchemas[options.schemaId];
        if (!schema) {
            throw new Error(`unknown ip schema '${options.schemaId}'`);
        }
        this.schema = schema;
    }

    public get schemaId(): string {
        return this.schema.id;
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
            'digital-ide.ip-catalog',
            t('ip-catalog.panel-title', this.schema.displayName),
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

        panel.webview.html = makeHtml(this.schema);

        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'submit':
                    this.onCreate(message.moduleName, message.values);
                    break;
                default:
                    break;
            }
        });
    }

    /**
     * @description 处理创建请求：生成 TCL 命令并在 Vivado 中执行
     */
    private async onCreate(moduleName: string, values: Record<string, string>) {
        if (!moduleName || !moduleName.trim()) {
            this.append(t('ip-catalog.err-no-module-name'), 'err');
            return;
        }

        const tcl = buildIpCreateTcl(this.schema, moduleName.trim(), values);
        this.append(`> ${tcl.split('\n').join('\n> ')}`, 'cmd');

        try {
            const result = await this.executeTcl(tcl, 120000);
            if (result.startsWith('ERROR:')) {
                this.append(result, 'err');
                return;
            }
            this.append(result === '' ? t('ip-catalog.create-ok') : result, 'ok');

            // 将生成的 IP 文件夹同步到树扫描位置，并刷新 IP 树
            const xciPath = result.trim();
            if (xciPath) {
                await this.syncIpToProjectTree(xciPath);
            }
        } catch (error: any) {
            this.append(`${t('ip-catalog.create-fail')}: ${error?.message || String(error)}`, 'err');
        }
    }

    /**
     * @description 把 Vivado 工程里生成的 IP 文件夹复制到树扫描位置，并重建 IP 树
     *
     * 树扫描目录为 <hardware.src 同级的 ip/>，而 create_ip 生成的 IP 位于
     * <prj>/xilinx/<plName>.srcs/sources_1/ip/，二者需在关闭 Vivado 时才会由扩展同步。
     * 此处复制一份到树扫描位置，免去 exit + reload 才能看到新 IP。
     * @param xciPath 生成的 .xci 绝对路径
     */
    private async syncIpToProjectTree(xciPath: string) {
        try {
            const moduleName = fspath.basename(fspath.dirname(xciPath));
            const srcDir = opeParam.prjInfo.arch.hardware.src;
            const ipRoot = hdlPath.resolve(srcDir, '../ip');
            const srcIpDir = fspath.dirname(xciPath);

            hdlDir.mkdir(ipRoot);
            hdlDir.cpdir(srcIpDir, ipRoot, true);

            const ipPaths = this.scanIpPaths(ipRoot);
            await hdlParam.initializeIPsPath(ipPaths, { report: () => undefined } as vscode.Progress<any>);
            refreshArchTree();
            refreshIpCatalogTree();

            this.append(`${t('ip-catalog.synced', ipRoot)}`, 'ok');
        } catch (error: any) {
            this.append(`${t('ip-catalog.sync-fail')}: ${error?.message || String(error)}`, 'err');
        }
    }

    /**
     * @description 扫描 ipRoot 下所有含同名 .xci 的 IP 文件夹（与 getXilinxIPs 逻辑一致）
     */
    private scanIpPaths(ipRoot: string): string[] {
        const valid: string[] = [];
        if (!fs.existsSync(ipRoot) || !hdlDir.isDir(ipRoot)) {
            return valid;
        }
        for (const folder of fs.readdirSync(ipRoot)) {
            const folderPath = hdlPath.join(ipRoot, folder);
            const xci = hdlPath.join(folderPath, `${folder}.xci`);
            if (fs.existsSync(xci)) {
                valid.push(folderPath);
            }
        }
        return valid;
    }

    private append(text: string, cls: 'cmd' | 'ok' | 'err') {
        this.panel?.webview.postMessage({ command: 'append', cls, text });
    }
}

/**
 * @description 渲染单个 IP 的表单页面
 */
function makeHtml(schema: IpSchema): string {
    const card = makeFormCard(schema);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t('ip-catalog.title')}</title>
<style>
    :root {
        --bg: #1e1e1e;
        --fg: #d4d4d4;
        --border: #3c3c3c;
        --accent: #0e639c;
        --cmd: #569cd6;
        --ok: #4ec9b0;
        --err: #f85149;
        --card: #252526;
    }
    * { box-sizing: border-box; }
    body.vscode-light {
        --bg: #ffffff;
        --fg: #333333;
        --border: #e2e5e9;
        --card: #f3f3f3;
    }
    html, body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family, sans-serif);
        font-size: 13px;
    }
    .container { padding: 12px; }
    h2 { margin: 4px 0 12px; font-size: 16px; }
    .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 14px;
        max-width: 720px;
    }
    .card h3 { margin: 0 0 2px; font-size: 14px; }
    .card .sub { color: #9d9d9d; margin: 0 0 10px; font-size: 12px; }
    .field { display: flex; align-items: center; margin-bottom: 8px; }
    .field label { width: 180px; flex-shrink: 0; }
    .field input, .field select {
        flex: 1;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        padding: 4px 6px;
        outline: none;
    }
    .field input:focus, .field select:focus { border-color: var(--accent); }
    .field .hint { margin-left: 8px; color: #9d9d9d; font-size: 11px; }
    .actions { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
    button {
        background: var(--accent);
        color: #fff;
        border: none;
        padding: 6px 14px;
        cursor: pointer;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: default; }
    #output {
        margin-top: 12px;
        max-width: 720px;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        white-space: pre-wrap;
        word-break: break-all;
        font-family: var(--vscode-editor-font-family, Consolas, monospace);
        font-size: 12px;
        max-height: 300px;
        overflow-y: auto;
    }
    .cmd { color: var(--cmd); }
    .ok { color: var(--ok); }
    .err { color: var(--err); }
</style>
</head>
<body>
<div class="container">
    ${card}
</div>
<script>
    const vscode = acquireVsCodeApi();
    const outputEl = document.createElement('div');
    outputEl.id = 'output';
    document.querySelector('.container').appendChild(outputEl);

    function collectValues(card) {
        const values = {};
        card.querySelectorAll('input[data-param], select[data-param]').forEach(el => {
            if (el.type === 'checkbox') {
                values[el.dataset.param] = el.checked ? 'true' : 'false';
            } else {
                values[el.dataset.param] = el.value.trim();
            }
        });
        return values;
    }

    document.querySelectorAll('button[data-submit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.card');
            const moduleNameInput = card.querySelector('input[data-module-name]');
            const moduleName = moduleNameInput.value.trim();
            if (!moduleName) {
                appendText('ERROR: ' + ${JSON.stringify(t('ip-catalog.err-no-module-name'))}, 'err');
                return;
            }
            btn.disabled = true;
            vscode.postMessage({
                command: 'submit',
                moduleName,
                values: collectValues(card)
            });
            setTimeout(() => { btn.disabled = false; }, 1500);
        });
    });

    function appendText(text, cls) {
        const line = document.createElement('div');
        line.className = cls;
        line.textContent = text;
        outputEl.appendChild(line);
        outputEl.scrollTop = outputEl.scrollHeight;
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'append') {
            appendText(message.text, message.cls);
        }
    });
</script>
</body>
</html>`;
}

/**
 * @description 生成单个 IP 的表单卡片
 */
function makeFormCard(schema: IpSchema): string {
    const fields = schema.params.map(param => {
        const def = param.default ?? '';
        if (param.type === 'enum') {
            const options = (param.options ?? [])
                .map(opt => `<option value="${opt}"${opt === def ? ' selected' : ''}>${opt}</option>`)
                .join('');
            return `<div class="field"><label>${param.label}</label>` +
                `<select data-param="${param.name}">${options}</select>` +
                (param.hint ? `<span class="hint">${param.hint}</span>` : '') + `</div>`;
        }
        if (param.type === 'bool') {
            const checked = def === 'true' ? ' checked' : '';
            return `<div class="field"><label>${param.label}</label>` +
                `<input type="checkbox" data-param="${param.name}"${checked}>` +
                (param.hint ? `<span class="hint">${param.hint}</span>` : '') + `</div>`;
        }
        const inputType = param.type === 'number' ? 'number' : 'text';
        return `<div class="field"><label>${param.label}</label>` +
            `<input type="${inputType}" step="any" data-param="${param.name}" value="${def}">` +
            (param.hint ? `<span class="hint">${param.hint}</span>` : '') + `</div>`;
    }).join('');

    return `<div class="card" data-schema="${schema.id}">
    <h3>${schema.displayName} <span style="color:#9d9d9d">(${schema.id} ${schema.version})</span></h3>
    <p class="sub">${schema.vendor}:${schema.library}:${schema.id}:${schema.version} · ${schema.category}</p>
    <div class="field"><label>模块实例名</label>
        <input type="text" data-module-name value="${schema.id}_0">
    </div>
    ${fields}
    <div class="actions">
        <button data-submit>${t('ip-catalog.create')}</button>
    </div>
</div>`;
}
