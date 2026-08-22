import * as vscode from 'vscode';
import * as fspath from 'path';
import * as fs from 'fs';

import { hdlFile, hdlPath } from '../../hdlFs';
import { opeParam, ReportType, WaveViewOutput } from '../../global';
import { LaunchFiles, loadView, saveView, saveViewAs } from './api';
import { BSON } from 'bson';
import { getIconConfig } from '../../hdlFs/icons';
import { t } from '../../i18n';

function getWebviewContent(context: vscode.ExtensionContext, panel?: vscode.WebviewPanel): string | undefined {
    const dideviewerPath = hdlPath.join(context.extensionPath, 'resources', 'dide-viewer', 'view');
    const htmlIndexPath = hdlPath.join(dideviewerPath, 'index.html');
    const html = hdlFile.readFile(htmlIndexPath)?.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (m, $1, $2) => {
        const absLocalPath = fspath.resolve(dideviewerPath, $2);
        const webviewUri = panel?.webview.asWebviewUri(vscode.Uri.file(absLocalPath));
        const replaceHref = $1 + webviewUri?.toString() + '"';
        return replaceHref;
    });
    if (!html || !panel) {
        return html;
    }
    // 注入 CSP：允许 Emscripten（eval + wasm）与 webview 资源 fetch（vcd.js 需 fetch vcd.wasm）
    const src = panel.webview.cspSource;
    const csp = [
        "default-src 'none'",
        `style-src ${src}`,
        `font-src ${src}`,
        `script-src ${src} 'unsafe-eval' 'wasm-unsafe-eval'`,
        `img-src ${src} data:`,
        `connect-src ${src}`,
        `worker-src ${src} blob:`,
    ].join('; ');
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    // 注入自动点击脚本：查看器默认只显示信号树，需点击信号才画波形；
    // 打开 VCD 后自动点击信号树中的信号项，让波形立即显示。
    const autoClick = `<script>
(function () {
    var clicked = false;
    var timer = setInterval(function () {
        var items = document.querySelectorAll('.vcd-signal-signal-item');
        if (items.length > 0) {
            if (!clicked) {
                items.forEach(function (i) { i.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
                clicked = true;
            }
            clearInterval(timer);
        }
    }, 400);
    setTimeout(function () { clearInterval(timer); }, 8000);
})();
</script>`;
    // 插到 <head> 开头（若已有 CSP 则替换），自动点击脚本插到 </body> 前
    let result = html;
    if (/<head>/i.test(result)) {
        result = result.replace(/<head>/i, `<head>${cspMeta}`);
    } else {
        result = cspMeta + result;
    }
    if (/<\/body>/i.test(result)) {
        result = result.replace(/<\/body>/i, `${autoClick}</body>`);
    } else {
        result += autoClick;
    }
    return result;
}

class WaveViewer {
    context: vscode.ExtensionContext;
    openFileUri?: vscode.Uri;
    panel?: vscode.WebviewPanel;
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public async open(uri: vscode.Uri) {
        this.create(uri);
    }

    private create(uri: vscode.Uri) {
        this.openFileUri = uri;
        const context = this.context;
        this.panel = vscode.window.createWebviewPanel(
            'Wave Viewer',
            'Wave Viewer',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableForms: true,
                retainContextWhenHidden: true,
                // 允许 webview 访问波形查看器资源（vcd.js/vcd.wasm）+ 打开的 VCD 文件目录
                localResourceRoots: [
                    vscode.Uri.file(hdlPath.join(context.extensionPath, 'resources', 'dide-viewer', 'view')),
                    vscode.Uri.file(fspath.dirname(uri.fsPath))
                ]
            }
        );

        this.panel.onDidDispose(() => {
            this.panel?.dispose();
            this.panel = undefined;
        }, null, this.context.subscriptions);

        const previewHtml = getWebviewContent(context, this.panel);
        if (this.panel && previewHtml) {
            const launchFiles = getViewLaunchFiles(context, uri, this.panel);
            if (launchFiles instanceof Error) {
                vscode.window.showErrorMessage(launchFiles.message);
                return;
            }

            const { vcd, view, wasm, vcdjs, worker, root } = launchFiles;
            let preprocessHtml = previewHtml
                .replace('test.vcd', vcd)
                .replace('test.view', view)
                .replace('vcd.js', vcdjs)
                .replace('vcd.wasm', wasm)
                .replace('worker.js', worker);
            this.panel.webview.html = preprocessHtml;
            this.panel.iconPath = getIconConfig('view');
            registerMessageEvent(this.panel, uri);
        } else {
            WaveViewOutput.report('preview html in <WaveViewer.create> is empty', { level: ReportType.Warn });
        }
    }

    // vscode 前端向 webview 发送消息
    public send(uri: vscode.Uri) {
        this.panel?.webview.postMessage({

        });
    }
}

async function openWaveViewer(context: vscode.ExtensionContext, uri: vscode.Uri) {
    const viewer = new WaveViewer(context);
    viewer.open(uri);
}

class VcdViewerDocument implements vscode.CustomDocument {
    uri: vscode.Uri;
    constructor(uri: vscode.Uri) {
        this.uri = uri;
    }
    dispose(): void {
        
    }
}

class VcdViewerProvider implements vscode.CustomEditorProvider {
    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<VcdViewerDocument>>();
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    context: vscode.ExtensionContext;
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async resolveCustomEditor(document: VcdViewerDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken) {
        webviewPanel.webview.options = {
            enableScripts: true,
            enableForms: true,
            // 允许加载波形查看器资源 + 打开的 VCD 文件目录
            localResourceRoots: [
                vscode.Uri.file(hdlPath.join(this.context.extensionPath, 'resources', 'dide-viewer', 'view')),
                vscode.Uri.file(fspath.dirname(document.uri.fsPath))
            ]
        };

        webviewPanel.onDidDispose(() => {
            webviewPanel.dispose();
        }, null);

        const context = this.context;
        const previewHtml = getWebviewContent(context, webviewPanel);
        registerMessageEvent(webviewPanel, document.uri);

        if (webviewPanel && previewHtml) {
            const launchFiles = getViewLaunchFiles(context, document.uri, webviewPanel);
            if (launchFiles instanceof Error) {
                vscode.window.showErrorMessage(launchFiles.message);
                return;
            }

            const { vcd, view, wasm, vcdjs, worker, root } = launchFiles;
            let preprocessHtml = previewHtml
                .replace('test.vcd', vcd)
                .replace('test.view', view)
                .replace('vcd.js', vcdjs)
                .replace('vcd.wasm', wasm)
                .replace('worker.js', worker);            

            webviewPanel.webview.html = preprocessHtml;
            webviewPanel.iconPath = getIconConfig('view');
        } else {
            WaveViewOutput.report('preview html in <WaveViewer.create> is empty', { level: ReportType.Warn });
        }
    }

    openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): VcdViewerDocument | Thenable<VcdViewerDocument> {
        const document = new VcdViewerDocument(uri);
        return document;
    }

    async revertCustomDocument(document: VcdViewerDocument, cancellation: vscode.CancellationToken): Promise<void> {
        return;
    }

    async saveCustomDocument(document: VcdViewerDocument, cancellation: vscode.CancellationToken): Promise<void> {
        
    }


    async saveCustomDocumentAs(document: VcdViewerDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        
    }


    async backupCustomDocument(document: VcdViewerDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        return {
            id: -1,
            then(onfulfilled, onrejected) {
                
            },
            delete() {
                
            },
        };
    }
}

// vscode 前端接受 webview 的消息
function registerMessageEvent(panel: vscode.WebviewPanel, uri: vscode.Uri) {
    panel.webview.onDidReceiveMessage(message => {
        const { command, data } = message;

        switch (command) {
            case 'save-view':
                saveView(data, uri, panel);
                break;
            case 'save-view-as':
                saveViewAs(data, uri, panel);
                break;
            case 'load-view':
                loadView(data, uri, panel);
            default:
                break;
        }
    });
}


/**
 * @description 准备启动 webview 的基础资源
 * @param context 
 * @param uri 
 * @param panel 
 * @returns 
 */
function getViewLaunchFiles(context: vscode.ExtensionContext, uri: vscode.Uri, panel: vscode.WebviewPanel): LaunchFiles | Error {
    const entryPath = uri.fsPath;
    const dideviewerPath = hdlPath.join(context.extensionPath, 'resources', 'dide-viewer', 'view');
    const workerAbsPath = hdlPath.join(dideviewerPath, 'worker.js');
    const vcdjsAbsPath = hdlPath.join(dideviewerPath, 'vcd.js');
    const wasmAbsPath = hdlPath.join(dideviewerPath, 'vcd.wasm');
    const worker = panel.webview.asWebviewUri(vscode.Uri.file(workerAbsPath)).toString();
    const vcdjs = panel.webview.asWebviewUri(vscode.Uri.file(vcdjsAbsPath)).toString();
    const wasm = panel.webview.asWebviewUri(vscode.Uri.file(wasmAbsPath)).toString();
    const root = panel.webview.asWebviewUri(vscode.Uri.file(dideviewerPath)).toString();

    // 根据打开文件的类型来判断资源加载方案
    if (entryPath.endsWith('.vcd')) {
        const defaultViewPath = entryPath.slice(0, -4) + '.view';
        const vcd = panel.webview.asWebviewUri(uri).toString();
        const view = panel.webview.asWebviewUri(vscode.Uri.file(defaultViewPath)).toString();

        return { vcd, view, wasm, vcdjs, worker, root };
    } else if (entryPath.endsWith('.view')) {
        const buffer = fs.readFileSync(entryPath);
        const recoverJson = BSON.deserialize(new Uint8Array(buffer));
        if (recoverJson.originVcdFile) {
            const vcdPath = recoverJson.originVcdFile;
            if (!fs.existsSync(vcdPath)) {
                // 如果不存在，去相同目录下寻找同名 vcd
                const sameFolderVcdPath = entryPath.slice(0, -5) + '.vcd';
                if (fs.existsSync(sameFolderVcdPath)) {
                    const vcd = panel.webview.asWebviewUri(vscode.Uri.file(sameFolderVcdPath)).toString();
                    const view = panel.webview.asWebviewUri(uri).toString();
                    return { vcd, view, wasm, vcdjs, worker, root };
                } else {
                    return new Error(t('error.vcd-viewer.unexist-direct-vcd-file') + ':' + vcdPath);
                }
            }
            const vcd = panel.webview.asWebviewUri(vscode.Uri.file(recoverJson.originVcdFile)).toString();
            const view = panel.webview.asWebviewUri(uri).toString();

            return { vcd, view, wasm, vcdjs, worker, root };
        } else {
            return new Error(t('error.vcd-viewer.bad-view-file') + ':' + entryPath);
        }
    }
    return new Error('unsupported languages');
}

export {
    openWaveViewer,
    VcdViewerProvider
};