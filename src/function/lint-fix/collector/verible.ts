import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as fspath from 'path';

import { LintDiagnostic } from '../common';

/**
 * @description 运行 verible-verilog-lint 并解析输出为诊断。
 *
 * verible 输出格式:
 *   file.sv:5:1: [rule-name] description
 *   file.sv:8:3: [another-rule] description
 */
export function runVeribleLint(filePath: string, veriblePath?: string): Promise<LintDiagnostic[]> {
    return new Promise((resolve) => {
        const bin = veriblePath || 'verible-verilog-lint';
        cp.exec(`"${bin}" "${filePath}"`, { timeout: 30000 }, (err, stdout, stderr) => {
            // verible 有 lint 违规时 exit code 非 0，但仍有输出可解析
            const output = stdout || stderr || '';
            resolve(parseVeribleOutput(output, filePath));
        });
    });
}

/**
 * @description 对**内存中的文本**运行 verible lint（写入临时文件再检查），
 * 反映编辑器当前内容（含未保存的修改），用于修复后的即时重验证。
 */
export async function runVeribleLintOnText(text: string, originalPath: string, veriblePath?: string): Promise<LintDiagnostic[]> {
    const baseName = fspath.basename(originalPath);
    const tmpDir = fs.mkdtempSync(fspath.join(os.tmpdir(), 'synthaid-lint-'));
    const tmpFile = fspath.join(tmpDir, baseName);
    try {
        fs.writeFileSync(tmpFile, text, 'utf-8');
        return await runVeribleLint(tmpFile, veriblePath);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

/**
 * @description 解析 verible 输出
 *
 * 兼容三种真实行格式:
 *   A) file:1:8-10: 消息 [Style: file-names] [module-filename]  双括号在结尾，规则名在最后一个括号
 *   B) file:2:5-9: syntax error at token "input"                语法错误，无括号
 *   C) file:5: [Style: module-filename] 消息                    单括号在开头（旧版）
 */
export function parseVeribleOutput(output: string, filePath: string): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
    // 组: 1=文件 2=行 3=列(可含范围) 4=剩余部分(消息+括号)
    const locRe = /^(.*?):(\d+)(?::(\d+(?:-\d+)?))?:\s*(.*)$/;
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {continue;}
        const m = locRe.exec(trimmed);
        if (!m) {continue;}

        const lineNo = parseInt(m[2], 10) - 1;
        // 列范围取起始列（"8-10" -> 8）
        const colNo = m[3] ? parseInt(m[3].split('-')[0], 10) - 1 : 0;
        if (lineNo < 0) {continue;}

        const rest = m[4];
        // 收集所有括号组（可同时兼容单/双括号）
        const bracketRe = /\[([^\]]+)\]/g;
        const brackets: string[] = [];
        let bm: RegExpExecArray | null;
        while ((bm = bracketRe.exec(rest)) !== null) {
            brackets.push(bm[1]);
        }
        // 纯消息 = 去掉括号后的部分
        const message = rest.replace(/\[[^\]]+\]\s*/g, '').trim();

        let code: string;
        if (brackets.length >= 2) {
            // A: 最后一个括号是规则名（[Style: group] [rule]）
            code = brackets[brackets.length - 1];
        } else if (brackets.length === 1) {
            // C: 单个括号，可能带级别前缀（"Style: rule"）或纯规则名
            const only = brackets[0];
            code = only.includes(':') ? only.split(':')[1].trim() : only.trim();
        } else {
            // B: 语法错误等，无规则名
            code = message.includes('syntax error') ? 'syntax-error' : 'error';
        }
        if (!code) {continue;}

        // 判断是否可自动修复：verible 的 style 类规则通常可修
        const fixable: LintDiagnostic['fixable'] =
            isAutoFixable(code) ? 'verible' : 'llm';

        diagnostics.push({
            source: 'verible',
            code,
            severity: 'warning',
            range: new vscode.Range(lineNo, colNo, lineNo, colNo + 1),
            message,
            fixable,
        });
    }
    return diagnostics;
}

/**
 * @description 导出供 lint-fix 复用（诊断回读时判定 fixable）
 */
export function isAutoFixableRule(code: string): boolean {
    return isAutoFixable(code);
}

/**
 * @description 判断规则是否 verible 原生支持自动修复。
 *
 * verible 可 autofix 的规则主要是 style 类（对齐/空白/分号/命名等）。
 * 这里维护一个已知可修复规则的集合 + 启发式判断。
 */
const AUTO_FIXABLE_RULES = new Set([
    'module-filename', 'port-name-style', 'signal-name-style',
    'parameter-name-style', 'line-length', 'forbidden-macro',
    'package-filename', 'explicit-parameter-storage-type',
    'explicit-function-task-parameter-type', 'no-tabs',
]);

function isAutoFixable(code: string): boolean {
    if (AUTO_FIXABLE_RULES.has(code)) {return true;}
    // 启发式：含 style/format/spacing 等词的规则倾向可修
    return /style|spacing|format|align|space/i.test(code);
}
