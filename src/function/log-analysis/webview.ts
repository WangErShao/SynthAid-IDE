import * as vscode from 'vscode';
import * as fspath from 'path';

import { SynthAnalysisResult, LogMessage, TimingInfo } from './types';
import { getIconConfig } from '../../hdlFs/icons';
import { t } from '../../i18n';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function totalCount(messages: LogMessage[]): number {
    return messages.reduce((sum, message) => sum + (message.count || 1), 0);
}

function renderKeyValueTable(items: { name: string, value: string }[]): string {
    const rows = items.map(item => {
        const value = item.name === t('synth-report.summary.log')
            ? `<a class="log-link" data-file="${escapeHtml(item.value)}">${escapeHtml(fspath.basename(item.value))}</a>`
            : escapeHtml(item.value);
        return `<tr><td class="kv-name">${escapeHtml(item.name)}</td><td>${value}</td></tr>`;
    }).join('');
    return `<table class="kv-table">${rows}</table>`;
}

function renderResourceTable(resources: { name: string, used: string, available: string, utilization: string }[]): string {
    const header = `<tr>
        <th>${t('synth-report.resources.name')}</th>
        <th>${t('synth-report.resources.used')}</th>
        <th>${t('synth-report.resources.available')}</th>
        <th>${t('synth-report.resources.utilization')}</th>
    </tr>`;
    const rows = resources.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.used)}</td>
        <td>${escapeHtml(item.available)}</td>
        <td class="util">${escapeHtml(item.utilization)}</td>
    </tr>`).join('');
    return `<table class="data-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function renderTimingTable(items: { name: string, value: string }[]): string {
    const rows = items.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="${item.value.startsWith('-') ? 'neg' : 'pos'}">${escapeHtml(item.value)} ns</td>
    </tr>`).join('');
    return `<table class="data-table"><tbody>${rows}</tbody></table>`;
}

function renderPathGroupTable(timing: TimingInfo): string {
    const header = `<tr>
        <th>${t('synth-report.timing.path-group')}</th>
        <th>${t('synth-report.timing.wns')}</th>
        <th>${t('synth-report.timing.tns')}</th>
    </tr>`;
    const rows = timing.pathGroups.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="${item.wns.startsWith('-') ? 'neg' : 'pos'}">${escapeHtml(item.wns)} ns</td>
        <td class="${item.tns.startsWith('-') ? 'neg' : 'pos'}">${escapeHtml(item.tns)} ns</td>
    </tr>`).join('');
    return `<table class="data-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function renderClockTable(clocks: { name: string, period: string, frequency: string }[]): string {
    const header = `<tr>
        <th>${t('synth-report.timing.clock')}</th>
        <th>${t('synth-report.timing.period')}</th>
        <th>${t('synth-report.timing.frequency')}</th>
    </tr>`;
    const rows = clocks.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.period)} ns</td>
        <td>${escapeHtml(item.frequency)} MHz</td>
    </tr>`).join('');
    return `<table class="data-table"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
}

function renderTiming(timing: TimingInfo): string {
    const sections: string[] = [];

    if (timing.summary.length > 0) {
        sections.push(renderTimingTable(timing.summary));
    }

    if (timing.clocks.length > 0) {
        sections.push(`<h3>${t('synth-report.timing.clocks')}</h3>`);
        sections.push(renderClockTable(timing.clocks));
    }

    if (timing.pathGroups.length > 0) {
        sections.push(`<h3>${t('synth-report.timing.path-groups')}</h3>`);
        sections.push(renderPathGroupTable(timing));
    }

    const statusParts: string[] = [];
    if (timing.met === true) {
        statusParts.push(`<span class="timing-met">${t('synth-report.timing.met')}</span>`);
    } else if (timing.met === false) {
        statusParts.push(`<span class="timing-not-met">${t('synth-report.timing.not-met')}</span>`);
    }
    if (timing.violatedPaths !== undefined) {
        statusParts.push(`<span class="${timing.violatedPaths > 0 ? 'timing-not-met' : 'timing-met'}">${t('synth-report.timing.violated-paths', timing.violatedPaths.toString())}</span>`);
    }
    if (statusParts.length > 0) {
        sections.push(`<div class="timing-status">${statusParts.join(' ')}</div>`);
    }

    return sections.join('\n');
}

/**
 * @description 面板标题：综合 / 实现各自独立的标题
 */
function getPanelTitle(stage: 'synth' | 'impl'): string {
    return stage === 'impl'
        ? t('synth-report.panel-title.impl')
        : t('synth-report.panel-title.synth');
}

function renderPerformanceTable(items: { name: string, value: string }[]): string {
    const rows = items.map(item => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.value)}</td>
    </tr>`).join('');
    return `<table class="data-table"><tbody>${rows}</tbody></table>`;
}

function renderMessageList(messages: LogMessage[]): string {
    if (messages.length === 0) {
        return `<div class="empty">${t('synth-report.messages.empty')}</div>`;
    }

    const items = messages.map((message, index) => {
        const location = message.file
            ? `<div class="msg-loc" data-file="${escapeHtml(message.file)}" data-line="${message.line ?? ''}">${escapeHtml(message.file)}${message.line ? ':' + message.line : ''}</div>`
            : '';
        const id = message.id ? `<span class="msg-id">${escapeHtml(message.id)}</span>` : '';
        const count = (message.count !== undefined && message.count > 1)
            ? `<span class="msg-count" title="count">×${message.count}</span>`
            : '';
        const body = `<pre class="msg-body">${escapeHtml(message.message)}</pre>`;

        return `<details class="msg ${message.level.toLowerCase().replace(/ /g, '-')}" ${index < 20 ? 'open' : ''}>
            <summary>${id}${count}<span class="msg-level">${message.level}</span><span class="msg-head">${escapeHtml(message.message.split('\n')[0])}</span></summary>
            <div class="msg-detail">${body}${location}</div>
        </details>`;
    }).join('');

    return `<div class="msg-list">${items}</div>`;
}

function renderCard(value: string, label: string, cssClass: string): string {
    return `<div class="card ${cssClass}"><div class="card-value">${value}</div><div class="card-label">${label}</div></div>`;
}

function makeReportHtml(result: SynthAnalysisResult): string {
    const statusClass = result.success ? 'ok' : 'fail';
    const statusText = result.success
        ? t('synth-report.status.success')
        : t('synth-report.status.fail');

    const cards = `
        ${renderCard(statusText, t('synth-report.status'), statusClass)}
        ${renderCard(totalCount(result.errors).toString(), t('synth-report.error-count'), 'err')}
        ${renderCard(totalCount(result.criticalWarnings).toString(), t('synth-report.critical-warning-count'), 'crit')}
        ${renderCard(totalCount(result.warnings).toString(), t('synth-report.warning-count'), 'warn')}
    `;

    let resourcesSection = '';
    if (result.resources && result.resources.length > 0) {
        resourcesSection = `
            <h2>${t('synth-report.resources')}</h2>
            ${renderResourceTable(result.resources)}
        `;
    }

    let timingSection = '';
    if (result.timing) {
        timingSection = `
            <h2>${t('synth-report.timing')}</h2>
            ${renderTiming(result.timing)}
        `;
    }

    let performanceSection = '';
    if (result.performance && result.performance.length > 0) {
        performanceSection = `
            <h2>${t('synth-report.performance')}</h2>
            ${renderPerformanceTable(result.performance)}
        `;
    }

    let errorsSection = '';
    if (result.errors.length > 0) {
        errorsSection = `
            <h2 class="section-err">${t('synth-report.errors')} (${result.errors.length})</h2>
            ${renderMessageList(result.errors)}
        `;
    }

    let criticalSection = '';
    if (result.criticalWarnings.length > 0) {
        criticalSection = `
            <h2 class="section-crit">${t('synth-report.critical-warnings')} (${result.criticalWarnings.length})</h2>
            ${renderMessageList(result.criticalWarnings)}
        `;
    }

    let warningsSection = '';
    if (result.warnings.length > 0) {
        warningsSection = `
            <h2 class="section-warn">${t('synth-report.warnings')} (${result.warnings.length})</h2>
            ${renderMessageList(result.warnings)}
        `;
    }

    const noMessages = errorsSection === '' && criticalSection === '' && warningsSection === '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${getPanelTitle(result.stage)}</title>
    <style>
        :root {
            --bg: #f5f6f8;
            --panel: #ffffff;
            --text: #1f2328;
            --muted: #6b7280;
            --border: #e2e5e9;
            --ok: #2da44e;
            --err: #d1242f;
            --crit: #d98324;
            --warn: #9a6700;
        }
        body.vscode-dark {
            --bg: #1e1e1e;
            --panel: #252526;
            --text: #d4d4d4;
            --muted: #8b949e;
            --border: #3c3c3c;
            --ok: #3fb950;
            --err: #f85149;
            --crit: #dbab09;
            --warn: #d29922;
        }
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 16px 24px 40px;
            font-size: 13px;
            line-height: 1.5;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }
        .header h1 {
            font-size: 18px;
            margin: 0;
            font-weight: 600;
        }
        .badge {
            padding: 3px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            color: #fff;
        }
        .badge.ok { background: var(--ok); }
        .badge.fail { background: var(--err); }
        .cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }
        .card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px 16px;
        }
        .card-value {
            font-size: 22px;
            font-weight: 700;
        }
        .card-label {
            font-size: 12px;
            color: var(--muted);
            margin-top: 2px;
        }
        .card.ok .card-value { color: var(--ok); }
        .card.fail .card-value { color: var(--err); }
        .card.err .card-value { color: var(--err); }
        .card.crit .card-value { color: var(--crit); }
        .card.warn .card-value { color: var(--warn); }
        h2 {
            font-size: 14px;
            margin: 24px 0 8px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--border);
        }
        h2.section-err { color: var(--err); }
        h2.section-crit { color: var(--crit); }
        h2.section-warn { color: var(--warn); }
        table {
            width: 100%;
            border-collapse: collapse;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
        }
        th, td {
            text-align: left;
            padding: 6px 10px;
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
        }
        thead th {
            background: var(--bg);
            font-weight: 600;
            font-size: 12px;
            color: var(--muted);
        }
        .kv-table td.kv-name {
            color: var(--muted);
            width: 1%;
            padding-right: 24px;
        }
        td.util { text-align: right; }
        td.neg { color: var(--err); font-weight: 600; }
        td.pos { color: var(--ok); font-weight: 600; }
        .log-link {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
        }
        .empty {
            color: var(--muted);
            font-style: italic;
            padding: 8px 0;
        }
        .msg-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .msg {
            background: var(--panel);
            border: 1px solid var(--border);
            border-left-width: 4px;
            border-radius: 6px;
            padding: 8px 12px;
        }
        .msg-error { border-left-color: var(--err); }
        .msg-critical-warning { border-left-color: var(--crit); }
        .msg-warning { border-left-color: var(--warn); }
        .msg summary {
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
        }
        .msg-level {
            font-size: 11px;
            font-weight: 700;
            color: var(--muted);
            flex-shrink: 0;
        }
        .msg-id {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            color: var(--muted);
            flex-shrink: 0;
        }
        .msg-count {
            font-size: 11px;
            font-weight: 700;
            color: #fff;
            background: var(--muted);
            border-radius: 8px;
            padding: 1px 7px;
            flex-shrink: 0;
        }
        .msg-head {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .msg-detail {
            margin-top: 8px;
        }
        .msg-body {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            margin: 0;
            padding: 8px;
            background: var(--bg);
            border-radius: 4px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .msg-loc {
            margin-top: 6px;
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
        }
        h3 {
            font-size: 13px;
            margin: 16px 0 6px;
        }
        .timing-status {
            margin-top: 10px;
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .timing-met {
            color: var(--ok);
            font-weight: 600;
        }
        .timing-not-met {
            color: var(--err);
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${getPanelTitle(result.stage)}</h1>
        <span class="badge ${statusClass}">${statusText}</span>
    </div>
    ${result.completed ? '' : `<div class="empty">${t('synth-report.incomplete')}</div>`}
    <div class="cards">${cards}</div>
    <h2>${t('synth-report.summary')}</h2>
    ${renderKeyValueTable(result.summary)}
    ${resourcesSection}
    ${performanceSection}
    ${timingSection}
    ${noMessages ? `<h2>${t('synth-report.messages')}</h2>${renderMessageList([])}` : errorsSection + criticalSection + warningsSection}
    <script>
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', event => {
            const target = event.target;
            const file = target.getAttribute && target.getAttribute('data-file');
            if (file) {
                vscode.postMessage({
                    command: 'openFile',
                    filePath: file,
                    line: target.getAttribute('data-line') || undefined
                });
            }
        });
    </script>
</body>
</html>`;
}

/**
 * @description 展示综合日志分析报告的 webview 面板
 */
export function showSynthReport(result: SynthAnalysisResult): void {
    const panel = vscode.window.createWebviewPanel(
        'digital-ide.synth-report',
        getPanelTitle(result.stage),
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.iconPath = getIconConfig('dide');
    panel.webview.html = makeReportHtml(result);

    panel.webview.onDidReceiveMessage(message => {
        switch (message.command) {
            case 'openFile':
                let filePath: string = message.filePath;
                if (filePath.startsWith('file://')) {
                    filePath = filePath.slice(7);
                }
                const line = message.line !== undefined && message.line !== ''
                    ? parseInt(message.line, 10)
                    : undefined;
                if (line !== undefined && !Number.isNaN(line)) {
                    const uri = vscode.Uri.file(filePath);
                    vscode.window.showTextDocument(uri, { selection: new vscode.Range(line - 1, 0, line - 1, 0) });
                } else {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
                }
                return;
        }
    });
}
