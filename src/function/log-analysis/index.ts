import { AbsPath } from '../../global';
import { ToolChainType } from '../../global/enum';
import { analyzeSynthLog } from './analyzer';
import { showSynthReport } from './webview';
import { SynthAnalysisResult } from './types';

/**
 * @description 分析综合日志，并将分析结果展示为 webview 面板
 */
export async function analyzeSynthLogAndShow(logPath: AbsPath, toolChain?: ToolChainType): Promise<SynthAnalysisResult | undefined> {
    const result = await analyzeSynthLog(logPath, toolChain);
    if (result !== undefined) {
        showSynthReport(result);
    }
    return result;
}

export {
    analyzeSynthLog,
    showSynthReport
};

export * from './types';
export { XilinxSynthAnalyzer } from './analyzer';
