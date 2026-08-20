import * as vscode from 'vscode';

import { FixResult } from './common';

type DiffLine =
    | { type: 'same'; text: string }
    | { type: 'removed'; text: string }
    | { type: 'added'; text: string };

/**
 * @description diff 预览面板：展示修复前后对比（逐行高亮），用户确认后应用。
 */
export class DiffView {
    private panel: vscode.WebviewPanel | undefined;
    private onApplyCallback: (() => void) | undefined;

    /**
     * @description 显示修复 diff
     * @param originalText 修复前文本
     * @param result 修复结果（含 edits）
     * @param onApply 用户点「应用」时回调
     */
    show(originalText: string, result: FixResult, onApply: () => void) {
        this.onApplyCallback = onApply;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'synthaid.diffview',
                'Lint 修复预览',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
            this.panel.onDidDispose(() => { this.panel = undefined; });
            // 接收 webview 发来的消息（应用/取消）
            this.panel.webview.onDidReceiveMessage(
                msg => this.handleMessage(msg),
                undefined,
            );
        }

        // 根据 edits 生成修复后文本
        // 注意：range 的 line/character 是行内坐标，需换算成整文绝对偏移
        let fixedText = originalText;
        const lineOffsets = computeLineOffsets(originalText);
        // 从后往前应用，避免前面的修改影响后续偏移
        const sortedEdits = [...result.edits].sort((a, b) =>
            b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
        for (const edit of sortedEdits) {
            const start = lineOffsets[edit.range.start.line] + edit.range.start.character;
            const end = lineOffsets[edit.range.end.line] + edit.range.end.character;
            fixedText = fixedText.slice(0, start) + edit.newText + fixedText.slice(end);
        }

        this.panel.webview.html = this.renderDiffHtml(
            result.description,
            originalText,
            fixedText,
        );
        this.panel.reveal();
    }

    private handleMessage(msg: any) {
        if (msg === 'apply' && this.onApplyCallback) {
            this.onApplyCallback();
            this.panel?.dispose();
        } else if (msg === 'cancel') {
            this.panel?.dispose();
        }
    }

    private renderDiffHtml(desc: string, before: string, after: string): string {
        const lines = diffLines(before, after);
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rows = lines.map(l => {
            const cls = l.type === 'removed' ? 'removed' : l.type === 'added' ? 'added' : '';
            const sign = l.type === 'removed' ? '-' : l.type === 'added' ? '+' : ' ';
            return `<div class="row ${cls}"><span class="sign">${sign}</span><span class="txt">${esc(l.text)}</span></div>`;
        }).join('');
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: Consolas, monospace; padding: 16px; background: #1e1e1e; color: #d4d4d4; }
  h3 { color: #569cd6; }
  .diff { background: #252526; border-radius: 6px; padding: 8px 0; font-size: 13px; max-height: 400px; overflow: auto; }
  .row { display: flex; white-space: pre; }
  .row .sign { width: 1.2em; flex: none; color: #6a737d; user-select: none; }
  .row .txt { flex: 1; white-space: pre; }
  .row.removed { background: #5a1d1d; }
  .row.removed .sign, .row.removed .txt { color: #f48771; }
  .row.added { background: #1d3d1d; }
  .row.added .sign, .row.added .txt { color: #7ee787; }
  .btns { margin-top: 16px; text-align: right; }
  button { padding: 8px 20px; margin-left: 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
  .apply { background: #0e639c; color: #fff; }
  .cancel { background: #3a3d41; color: #fff; }
</style></head>
<body>
  <h3>${esc(desc)}</h3>
  <div class="diff">${rows}</div>
  <div class="btns">
    <button class="cancel" onclick="msg('cancel')">取消</button>
    <button class="apply" onclick="msg('apply')">应用</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function msg(m) { vscode.postMessage(m); }
  </script>
</body></html>`;
    }
}

/**
 * @description 按行计算 before/after 的 diff（LCS 最长公共子序列）。
 * 相同的行归为 'same'，其余分别标为 'removed' / 'added'。
 */
function diffLines(before: string, after: string): DiffLine[] {
    const a = splitLines(before);
    const b = splitLines(after);

    // LCS 动态规划，记录每行是否被保留
    const dp: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
        dp.push(new Array(b.length + 1).fill(0));
    }
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const result: DiffLine[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            result.push({ type: 'same', text: a[i] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            result.push({ type: 'removed', text: a[i] });
            i++;
        } else {
            result.push({ type: 'added', text: b[j] });
            j++;
        }
    }
    while (i < a.length) { result.push({ type: 'removed', text: a[i] }); i++; }
    while (j < b.length) { result.push({ type: 'added', text: b[j] }); j++; }

    return result;
}

/**
 * @description 按行拆分文本（保留空行）
 */
function splitLines(text: string): string[] {
    return text.split('\n');
}

/**
 * @description 计算每行首字符在整文中的绝对偏移
 */
function computeLineOffsets(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
            offsets.push(i + 1);
        }
    }
    return offsets;
}
