export type LogLevel = 'ERROR' | 'CRITICAL WARNING' | 'WARNING' | 'INFO';

export interface LogMessage {
    level: LogLevel;
    id?: string;
    message: string;
    file?: string;
    line?: number;
    /**
     * 该消息在日志中出现的次数。
     * 聚合后相同 id + 文件位置的重复消息会被合并，count 记录合并前的数量
     */
    count?: number;
}

export interface ResourceItem {
    name: string;
    used: string;
    available: string;
    utilization: string;
}

export interface TimingItem {
    name: string;
    value: string;
}

export interface PathGroupItem {
    name: string;
    wns: string;
    tns: string;
}

export interface ClockItem {
    name: string;
    period: string;
    frequency: string;
}

export interface TimingInfo {
    summary: TimingItem[];
    /**
     * 各时钟域（Intra Clock Table / Path Group Table）的 WNS/TNS
     */
    pathGroups: PathGroupItem[];
    /**
     * 时钟汇总（Clock Summary）：时钟名 / 周期 / 频率
     */
    clocks: ClockItem[];
    /**
     * 时序是否满足约束，无法从日志判断时为 undefined
     */
    met: boolean | undefined;
    /**
     * 违例路径条数，无法从日志判断时为 undefined
     */
    violatedPaths: number | undefined;
}

export interface PerformanceItem {
    name: string;
    value: string;
}

export interface SynthAnalysisResult {
    toolChain: string;
    /**
     * 所属阶段：synth / impl
     */
    stage: 'synth' | 'impl';
    runName: string;
    logPath: string;
    success: boolean;
    completed: boolean;
    summary: PerformanceItem[];
    errors: LogMessage[];
    criticalWarnings: LogMessage[];
    warnings: LogMessage[];
    resources: ResourceItem[] | undefined;
    timing: TimingInfo | undefined;
    performance: PerformanceItem[] | undefined;
}
