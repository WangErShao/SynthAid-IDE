import * as fs from 'fs';
import * as fspath from 'path';

import { opeParam, AbsPath } from '../../global';
import { ToolChainType } from '../../global/enum';
import { hdlFile, hdlPath } from '../../hdlFs';
import { t } from '../../i18n';
import {
    LogLevel,
    LogMessage,
    ResourceItem,
    SynthAnalysisResult,
    TimingItem,
    PathGroupItem,
    ClockItem,
    TimingInfo,
    PerformanceItem
} from './types';

export interface SynthLogAnalyzer {
    readonly name: string;
    analyze(content: string, logPath: AbsPath): SynthAnalysisResult;
}

/**
 * @description 从消息文本中提取源文件路径与行号
 *
 * 支持 Windows (C:/...)、Unix (/...) 与相对路径 (design/hdl/top.v)，
 * 行号支持 `file.v:32` 与 `file.v line 32` 两种写法
 */
const FILE_LINE_RE = /((?:[A-Za-z]:[\\/]|[\\/])?[^\s:]+\.(?:v|sv|svh|vhd|vhdl|xdc|fdc|sdc|tcl))/;
const LINE_NUM_RE = /line\s+(\d+)|:\s*(\d+)/;

function extractFileLine(message: string): { file: string, line?: number } | undefined {
    const fileMatch = FILE_LINE_RE.exec(message);
    if (!fileMatch) {
        return undefined;
    }

    const file = fileMatch[1];
    const after = message.slice(fileMatch.index + file.length);
    const lineMatch = LINE_NUM_RE.exec(after);
    const line = lineMatch ? parseInt(lineMatch[1] || lineMatch[2], 10) : undefined;

    return {
        file,
        line: line !== undefined && Number.isNaN(line) ? undefined : line
    };
}

/**
 * @description 解析 Vivado 风格的日志消息
 *
 * 消息以 `LEVEL: [ID] content` 开头，后续以空白开头的缩进行属于同一消息
 */
const LEVEL_RE = /^(CRITICAL WARNING|ERROR|WARNING|INFO):\s*(?:\[([^\]]+)\])?\s*(.*)$/;

function parseMessages(content: string): LogMessage[] {
    const messages: LogMessage[] = [];
    let current: LogMessage | undefined;

    const push = () => {
        if (current) {
            const fileLine = extractFileLine(current.message);
            if (fileLine) {
                current.file = fileLine.file;
                current.line = fileLine.line;
            }
            messages.push(current);
            current = undefined;
        }
    };

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.replace(/\r$/, '');
        if (line.trim().length === 0) {
            // 空行代表当前消息结束
            push();
            continue;
        }

        const match = LEVEL_RE.exec(line);
        if (match) {
            push();
            current = {
                level: match[1] as LogLevel,
                id: match[2],
                message: match[3].trim()
            };
        } else if (current && /^[\s]/.test(line)) {
            // 缩进行视为上一消息的延续
            current.message += '\n' + line.trim();
            if (current.message.length > 2000) {
                push();
            }
        }
    }
    push();

    return messages;
}

/**
 * @description 按消息 id + 首次出现的文件位置去重聚合，统计重复次数
 *
 * Vivado 常把同一条消息重复刷屏，聚合后便于快速定位真正的问题
 */
function aggregateMessages(messages: LogMessage[]): LogMessage[] {
    const map = new Map<string, LogMessage>();

    for (const message of messages) {
        const firstLine = message.message.split('\n')[0];
        const key = [message.id, message.file, message.line, firstLine].filter(Boolean).join('|');

        const existing = map.get(key);
        if (existing) {
            existing.count = (existing.count || 1) + 1;
        } else {
            map.set(key, { ...message, count: 1 });
        }
    }

    return [...map.values()];
}

/**
 * @description 从日志中提取 Vivado 资源利用率表格
 *
 * 表格以包含 `Site Type` 的表头行开始，数据行以 `|` 开头，
 * 兼容 5 列（Site Type/Used/Fixed/Available/Util%）与 6 列（含 Prohibited）格式
 */
function extractUtilization(content: string): ResourceItem[] | undefined {
    const items: ResourceItem[] = [];
    let inTable = false;

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.replace(/\r$/, '');
        const trimmed = line.trim();

        if (!inTable && /Site Type/i.test(trimmed)) {
            inTable = true;
            continue;
        }
        if (!inTable) {
            continue;
        }

        // 分隔行 `+--+--+` 或 `|---|`
        if (/^[+|][\-+| ]*$/.test(trimmed)) {
            continue;
        }

        if (trimmed.startsWith('|')) {
            const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
            if (cells.length >= 4) {
                items.push({
                    name: cells[0],
                    used: cells[1],
                    available: cells[cells.length - 2],
                    utilization: cells[cells.length - 1]
                });
            }
        } else {
            // 表格结束
            break;
        }
    }

    return items.length > 0 ? items : undefined;
}

/**
 * @description 提取时序概览（WNS/TNS/WHS/THS）：
 *
 * 1. 按列位置解析 `*_timing_summary_routed.rpt` 的 Design Timing Summary 表
 * 2. 解析 runme.log 内联的 `WNS=value` / `| WNS=value |`（取最后一次，即路由最终值）
 */
function extractDesignTimingSummary(content: string): TimingItem[] {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length - 2; i++) {
        const header = lines[i];
        if (!/WNS\(ns\)/.test(header) || !/TNS\(ns\)/.test(header) ||
            !/WHS\(ns\)/.test(header) || !/THS\(ns\)/.test(header)) {
            continue;
        }
        const valuesLine = lines[i + 2];
        if (!valuesLine) {
            break;
        }
        const items: TimingItem[] = [];
        for (const name of ['WNS', 'TNS', 'WHS', 'THS']) {
            const pos = header.indexOf(`${name}(ns)`);
            if (pos >= 0) {
                const slice = valuesLine.slice(pos, pos + 14).trim();
                if (/^-?[\d.]+$/.test(slice)) {
                    items.push({ name, value: slice });
                }
            }
        }
        if (items.length >= 2) {
            return items;
        }
        break;
    }
    return [];
}

function extractInlineTiming(content: string): TimingItem[] {
    const items: TimingItem[] = [];
    for (const name of ['WNS', 'TNS', 'WHS', 'THS']) {
        const re = new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)`, 'g');
        let match: RegExpExecArray | null;
        let last: string | undefined;
        while ((match = re.exec(content)) !== null) {
            last = match[1];
        }
        if (last !== undefined) {
            items.push({ name, value: last });
        }
    }
    return items;
}

/**
 * @description 兜底解析 `WNS(ns): value` / `WNS (ns): value` 键值格式
 */
function extractKeyValueTiming(content: string): TimingItem[] {
    const items: TimingItem[] = [];
    for (const name of ['WNS', 'TNS', 'WHS', 'THS']) {
        const match = new RegExp(`\\b${name}\\s*\\(ns\\)\\s*[:=]\\s*(-?[\\d.]+)`, 'i').exec(content);
        if (match) {
            items.push({ name, value: match[1] });
        }
    }
    return items;
}

function mergeTimingSummary(design: TimingItem[], inline: TimingItem[]): TimingItem[] {
    const merged: TimingItem[] = [...design];
    for (const item of inline) {
        if (!merged.some(i => i.name === item.name)) {
            merged.push(item);
        }
    }
    return merged;
}

/**
 * @description 解析 `*_timing_summary_routed.rpt` 的 Clock Summary（时钟名/周期/频率）
 */
function extractClockSummary(content: string): ClockItem[] {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const header = lines[i];
        if (!/\bClock\b/.test(header) || !/Period\(ns\)/.test(header) || !/Frequency\(MHz\)/.test(header)) {
            continue;
        }
        const nameEnd = header.indexOf('Waveform(ns)');
        const periodPos = header.indexOf('Period(ns)');
        const freqPos = header.indexOf('Frequency(MHz)');
        if (nameEnd < 0 || periodPos < 0 || freqPos < 0) {
            break;
        }
        const clocks: ClockItem[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.trim();
            if (trimmed.length === 0) {
                break;
            }
            if (/^[-\+|\s]+$/.test(trimmed)) {
                continue;
            }
            const name = line.slice(0, nameEnd).trim();
            const period = line.slice(periodPos, freqPos).trim();
            const freq = line.slice(freqPos, freqPos + 14).trim();
            if (name && /^[\d.]+$/.test(period) && /^[\d.]+$/.test(freq)) {
                clocks.push({ name, period, frequency: freq });
            }
        }
        if (clocks.length > 0) {
            return clocks;
        }
        break;
    }
    return [];
}

/**
 * @description 解析 Other Path Groups Table（每个路径组的 WNS/TNS）
 */
function extractPathGroups(content: string): PathGroupItem[] {
    const pathGroups: PathGroupItem[] = [];
    let inTable = false;

    for (const raw of content.split(/\r?\n/)) {
        const line = raw.replace(/\r$/, '');
        const trimmed = line.trim();

        if (!inTable && /Path Group/.test(trimmed) && /WNS/i.test(trimmed)) {
            inTable = true;
            continue;
        }
        if (!inTable) {
            continue;
        }

        if (/^[+|][\-+| ]*$/.test(trimmed)) {
            continue;
        }

        if (trimmed.startsWith('|')) {
            const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
            if (cells.length >= 3 &&
                /^-?[\d.]+$/.test(cells[1]) &&
                /^-?[\d.]+$/.test(cells[2]) &&
                !/Path Group/.test(cells[0])) {
                pathGroups.push({ name: cells[0], wns: cells[1], tns: cells[2] });
            }
        } else {
            inTable = false;
        }
    }

    return pathGroups;
}

/**
 * @description 解析 Intra Clock Table（每个时钟域的 WNS/TNS），按列位置取值
 */
function extractIntraClockTable(content: string): PathGroupItem[] {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (!/Intra Clock Table/.test(lines[i])) {
            continue;
        }
        for (let j = i + 1; j < lines.length; j++) {
            const header = lines[j];
            if (!/WNS\(ns\)/.test(header) || !/TNS\(ns\)/.test(header)) {
                continue;
            }
            const wnsPos = header.indexOf('WNS(ns)');
            const tnsPos = header.indexOf('TNS(ns)');
            const items: PathGroupItem[] = [];
            for (let k = j + 1; k < lines.length; k++) {
                const line = lines[k];
                const trimmed = line.trim();
                if (trimmed.length === 0) {
                    break;
                }
                if (/^[-\+|\s]+$/.test(trimmed)) {
                    continue;
                }
                const name = line.slice(0, wnsPos).trim();
                const wns = line.slice(wnsPos, tnsPos).trim();
                const tns = line.slice(tnsPos, tnsPos + 14).trim();
                if (name && /^-?[\d.]+$/.test(wns)) {
                    items.push({ name, wns, tns: /^-?[\d.]+$/.test(tns) ? tns : '' });
                }
            }
            if (items.length > 0) {
                return items;
            }
            break;
        }
        break;
    }
    return [];
}

/**
 * @description 从日志中提取时序信息
 *
 * 综合日志一般没有；实现日志的来源有 runme.log 内联 `WNS=value` 与
 * `*_timing_summary_routed.rpt` 的 Design Timing Summary / Clock Summary / Intra Clock Table
 */
function extractTimingInfo(content: string): TimingInfo | undefined {
    const summary = mergeTimingSummary(
        extractDesignTimingSummary(content),
        [...extractInlineTiming(content), ...extractKeyValueTiming(content)]
    );
    const pathGroups = [...extractPathGroups(content), ...extractIntraClockTable(content)];
    const clocks = extractClockSummary(content);

    let met: boolean | undefined;
    if (/Timing constraints are met/i.test(content)) {
        met = true;
    } else if (/Timing constraints are not met/i.test(content)) {
        met = false;
    }

    let violatedPaths: number | undefined;
    const violatedMatch = /(\d+)\s+paths?\s+with (?:failing|violated)/i.exec(content);
    if (violatedMatch) {
        violatedPaths = parseInt(violatedMatch[1], 10);
    }

    if (summary.length === 0 && pathGroups.length === 0 && clocks.length === 0 &&
        met === undefined && violatedPaths === undefined) {
        return undefined;
    }

    return { summary, pathGroups, clocks, met, violatedPaths };
}

/**
 * @description 从日志中提取性能信息（耗时、内存）
 */
function extractPerformance(content: string): PerformanceItem[] | undefined {
    const items: PerformanceItem[] = [];

    const timeMatch = /elapsed\s*=\s*([\d:\.]+)/.exec(content);
    if (timeMatch) {
        items.push({ name: t('synth-report.performance.elapsed'), value: timeMatch[1] });
    }

    const memoryMatch = /peak\s*=\s*([\d\.]+)/.exec(content);
    if (memoryMatch) {
        items.push({ name: t('synth-report.performance.memory'), value: memoryMatch[1] + ' MB' });
    }

    return items.length > 0 ? items : undefined;
}

/**
 * @description 从日志中提取 Vivado 版本号
 */
function extractVivadoVersion(content: string): string | undefined {
    const match = /Vivado v([\d\.]+)/.exec(content);
    return match ? match[1] : undefined;
}

/**
 * @description 判断运行是否成功、是否完成
 */
function judgeStatus(content: string, errors: LogMessage[]): { success: boolean, completed: boolean } {
    const completed = /Exiting Vivado|synthesis completed|synth_design completed|implementation completed|write_bitstream completed|design completed/i.test(content);
    const success = errors.length === 0;
    return { success, completed };
}

/**
 * @description 从日志路径推断所属阶段
 */
function detectStage(logPath: AbsPath): 'synth' | 'impl' {
    const runName = fspath.basename(fspath.dirname(logPath));
    return /^impl/i.test(runName) ? 'impl' : 'synth';
}

/**
 * @description Xilinx Vivado 日志分析器（综合 / 实现通用）
 */
export class XilinxSynthAnalyzer implements SynthLogAnalyzer {
    public readonly name: string = 'xilinx';

    public analyze(content: string, logPath: AbsPath): SynthAnalysisResult {
        const messages = aggregateMessages(parseMessages(content));
        const errors = messages.filter(m => m.level === 'ERROR');
        const criticalWarnings = messages.filter(m => m.level === 'CRITICAL WARNING');
        const warnings = messages.filter(m => m.level === 'WARNING');

        const { success, completed } = judgeStatus(content, errors);

        const runName = fspath.basename(fspath.dirname(logPath));
        const stage = detectStage(logPath);

        const summary: PerformanceItem[] = [];
        summary.push({
            name: t('synth-report.summary.project'),
            value: opeParam.prjInfo.prjName.PL
        });
        summary.push({
            name: t('synth-report.summary.top'),
            value: opeParam.firstSrcTopModule.name || '-'
        });
        summary.push({
            name: t('synth-report.summary.device'),
            value: opeParam.prjInfo.device || '-'
        });
        summary.push({
            name: t('synth-report.summary.run'),
            value: runName
        });
        const version = extractVivadoVersion(content);
        if (version) {
            summary.push({
                name: t('synth-report.summary.version'),
                value: version
            });
        }
        summary.push({
            name: t('synth-report.summary.log'),
            value: logPath
        });

        return {
            toolChain: this.name,
            stage,
            runName,
            logPath,
            success,
            completed,
            summary,
            errors,
            criticalWarnings,
            warnings,
            resources: extractUtilization(content),
            timing: extractTimingInfo(content),
            performance: extractPerformance(content)
        };
    }
}

function getAnalyzer(toolChain: ToolChainType): SynthLogAnalyzer {
    return new XilinxSynthAnalyzer();
}

/**
 * @description 收集与日志同目录的配套报告文件内容
 *
 * 资源利用率在 `*_utilization_*.rpt`、时序在 `*_timing_summary_*.rpt`、
 * 功耗在 `*_power_*.rpt` 等，均不在 runme.log 中，需要一并读取解析
 */
function collectCompanionContent(logPath: AbsPath): string {
    const dir = fspath.dirname(logPath);
    if (!hdlFile.isDir(dir)) {
        return '';
    }

    const parts: string[] = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.rpt')) {
            continue;
        }
        if (!/utilization|timing_summary|power|clock_utilization/i.test(file)) {
            continue;
        }
        const fullPath = hdlPath.join(dir, file);
        const content = hdlFile.readFile(fullPath);
        if (content) {
            parts.push(`\n===== ${file} =====\n${content}`);
        }
    }
    return parts.join('\n');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @description 分析日志，返回分析结果
 *
 * 日志文件可能尚未完全写入，这里会做有限的等待重试；同时读取同目录配套报告。
 */
export async function analyzeSynthLog(logPath: AbsPath, toolChain?: ToolChainType): Promise<SynthAnalysisResult | undefined> {
    const chain = toolChain !== undefined ? toolChain : opeParam.prjInfo.toolChain;
    let content: string | undefined;

    for (let i = 0; i < 10; i++) {
        content = hdlFile.readFile(logPath);
        if (content !== undefined) {
            break;
        }
        await sleep(500);
    }

    if (content === undefined) {
        return undefined;
    }

    const companion = collectCompanionContent(logPath);
    const analyzer = getAnalyzer(chain);
    return analyzer.analyze(content + companion, hdlPath.toSlash(logPath));
}
