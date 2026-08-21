import * as fs from 'fs';
import * as fspath from 'path';

import { opeParam, AbsPath } from '../../global';
import { hdlFile, hdlPath } from '../../hdlFs';
import { t } from '../../i18n';
import type { SynthLogAnalyzer } from './analyzer';
import {
    LogMessage,
    ResourceItem,
    SynthAnalysisResult,
    TimingItem,
    ClockItem,
    PathGroupItem,
    TimingInfo,
    PerformanceItem
} from './types';

/**
 * @description Gowin 综合/布局布线日志解析器。
 *
 * Gowin 日志格式（与 Vivado 不同）:
 *   - 消息: `ERROR (EX3863) : Syntax error near ';'("D:\bad.v":1)`
 *     `WARNING (EX0000) : ...` / `NOTE (EX0101) : ...`
 *   - 资源: 综合产物 `*_syn_rsc.xml`（<Module Register=".." Lut=".." ...>）
 *   - 完成: `GowinSynthesis finish` / `Place & Route completed`
 *
 * 本解析器实现 SynthLogAnalyzer 接口，与 XilinxSynthAnalyzer 并列，
 * 由 analyzeSynthLog 按 toolChain 分发。
 */
export class GowinSynthAnalyzer implements SynthLogAnalyzer {
    public readonly name: string = 'gowin';

    public analyze(content: string, logPath: AbsPath): SynthAnalysisResult {
        const messages = this.parseMessages(content);
        const errors = messages.filter(m => m.level === 'ERROR');
        const warnings = messages.filter(m => m.level === 'WARNING');
        const criticalWarnings = messages.filter(m => m.level === 'CRITICAL WARNING');

        const { success, completed } = this.judgeStatus(content, errors);

        const runName = fspath.basename(fspath.dirname(logPath));
        const stage = this.detectStage(logPath);

        const summary: PerformanceItem[] = [];
        summary.push({ name: t('synth-report.summary.project'), value: opeParam.prjInfo.prjName.PL });
        summary.push({ name: t('synth-report.summary.top'), value: opeParam.firstSrcTopModule.name || '-' });
        summary.push({ name: t('synth-report.summary.device'), value: opeParam.prjInfo.device || '-' });
        summary.push({ name: t('synth-report.summary.run'), value: runName });
        summary.push({ name: t('synth-report.summary.log'), value: logPath });

        const resources = this.extractUtilization(logPath);
        const timing = this.extractTiming(logPath);

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
            resources,
            timing,
            performance: undefined
        };
    }

    /**
     * @description 解析 Gowin 日志消息
     *
     * 格式: `LEVEL (CODE) : message` 或 `NOTE (CODE) : message`
     * 消息里可能带源文件位置 `("file":line)`
     */
    private parseMessages(content: string): LogMessage[] {
        const messages: LogMessage[] = [];
        // Gowin 消息: ERROR|WARNING|NOTE|INFO (CODE) : ...
        const msgRe = /^(ERROR|WARNING|NOTE|INFO)\s*\(([^)]*)\)\s*:\s*(.*)$/;
        for (const line of content.split('\n')) {
            const m = msgRe.exec(line.trim());
            if (!m) {
                continue;
            }
            const [, levelStr, id, rest] = m;
            const level = levelStr === 'ERROR' ? 'ERROR'
                : levelStr === 'WARNING' ? 'WARNING'
                : 'INFO';

            const { file, line: lineNo } = this.extractFileLine(rest);
            messages.push({
                level,
                id: id || undefined,
                message: rest.trim(),
                file,
                line: lineNo
            });
        }
        return this.aggregate(messages);
    }

    /**
     * @description 从消息中提取 `"path/file.v":line` 的文件与行号
     */
    private extractFileLine(message: string): { file?: string, line?: number } {
        const m = /"([^"]+\.(?:v|sv|svh|vhd|sdc|fdc|gdc))"\s*:\s*(\d+)/.exec(message);
        if (m) {
            return { file: m[1], line: parseInt(m[2], 10) };
        }
        return {};
    }

    /**
     * @description 按 id + 文件位置聚合重复消息
     */
    private aggregate(messages: LogMessage[]): LogMessage[] {
        const map = new Map<string, LogMessage>();
        for (const message of messages) {
            const firstLine = message.message.split('\n')[0];
            const key = [message.id, message.file, message.line, firstLine].filter(Boolean).join('|');
            const existing = map.get(key);
            if (existing) {
                existing.count = (existing.count || 1) + 1;
            } else {
                map.set(key, { ...message });
            }
        }
        return [...map.values()];
    }

    /**
     * @description 从日志判断成功/完成
     */
    private judgeStatus(content: string, errors: LogMessage[]): { success: boolean, completed: boolean } {
        const finished = /GowinSynthesis finish|Place & Route completed|routing finished|P&R finish/i.test(content);
        const hasFatal = errors.length > 0 || /FATAL|failed to/i.test(content);
        return {
            success: !hasFatal,
            completed: finished
        };
    }

    private detectStage(logPath: AbsPath): 'synth' | 'impl' {
        if (logPath.includes('gwsynthesis')) {
            return 'synth';
        }
        if (logPath.includes('pnr')) {
            return 'impl';
        }
        return 'synth';
    }

    /**
     * @description 提取资源利用率：从同目录 `*_syn_rsc.xml` 解析
     *
     * Gowin 资源 XML 格式（单行，正则即可解析）:
     *   <Module name="fifo_top" Register="19" Alu="22" Lut="6" Bsram="1"
     *            T_Register="36(19)" T_Alu="64(22)" ...>
     *     <SubModule .../>
     *   </Module>
     */
    private extractUtilization(logPath: AbsPath): ResourceItem[] | undefined {
        const dir = fspath.dirname(logPath);
        if (!hdlFile.isDir(dir)) {
            return undefined;
        }
        let xmlFile: string | undefined;
        for (const file of fs.readdirSync(dir)) {
            if (file.endsWith('_syn_rsc.xml') || file.endsWith('_rsc.xml')) {
                xmlFile = hdlPath.join(dir, file);
                break;
            }
        }
        if (!xmlFile || !hdlFile.isFile(xmlFile)) {
            return undefined;
        }

        const raw = hdlFile.readFile(xmlFile);
        if (!raw) {
            return undefined;
        }

        // 取顶层 <Module ...> 标签的属性
        const moduleRe = /<Module\s+([^>]*)>/;
        const m = moduleRe.exec(raw);
        if (!m) {
            return undefined;
        }
        const attrs = this.parseAttrs(m[1]);
        const name = attrs.get('name');
        if (!name) {
            return undefined;
        }

        const items: ResourceItem[] = [];
        // 资源类型映射: XML 属性 -> 显示名
        const resourceMap: [string, string][] = [
            ['Register', '寄存器'],
            ['Lut', 'LUT'],
            ['Alu', 'ALU'],
            ['Bsram', 'BRAM'],
            ['Dsp', 'DSP'],
            ['Ssr', 'SSR'],
        ];
        for (const [key, label] of resourceMap) {
            const val = attrs.get(key);
            if (val !== undefined && val !== '0') {
                items.push({
                    name: label,
                    used: val,
                    available: '',
                    utilization: ''
                });
            }
        }
        return items.length ? items : undefined;
    }

    /**
     * @description 解析 XML 标签属性 `key="value"` -> Map
     */
    private parseAttrs(attrStr: string): Map<string, string> {
        const map = new Map<string, string>();
        const attrRe = /([\w-]+)\s*=\s*"([^"]*)"/g;
        let match: RegExpExecArray | null;
        while ((match = attrRe.exec(attrStr)) !== null) {
            map.set(match[1], match[2]);
        }
        return map;
    }

    /**
     * @description 提取时序信息（Phase 2 简化：从 PnR 日志尾部找时序摘要）
     */
    private extractTiming(logPath: AbsPath): TimingInfo | undefined {
        const dir = fspath.dirname(logPath);
        if (!hdlFile.isDir(dir)) {
            return undefined;
        }
        // Gowin PnR 时序在 *.tr.html / timing_paths；简化处理
        const summary: TimingItem[] = [];
        const timing: TimingInfo = {
            summary,
            pathGroups: [],
            clocks: [],
            met: undefined,
            violatedPaths: undefined
        };
        return timing;
    }
}
