import * as vscode from 'vscode';
import { hdlFile } from '../hdlFs';
import { AbsPath, LspClient, opeParam } from '../global';
import { DoFastRequestType, DoFastFileType, DoFastToolChainType, DoPrimitivesJudgeType } from '../global/lsp';
import { Fast, Macro, Range } from './common';

/**
 * LSP `api/fast` 请求超时（毫秒）。
 * 如果 Rust LSP 未响应（卡死 / 被拦截 / 单文件解析异常），启动会永远停在
 * 「初始化 1/N」的进度上。加超时后，超时即跳过该文件并**短路后续文件**，
 * 保证插件一定能加载完成（模块树可能不完整，但插件可用）。
 */
const LSP_FAST_TIMEOUT = 5000;

// LSP 是否已判定为「卡住」。连续超时后置 true，后续请求立即返回 undefined；
// 一旦某个请求成功则复位（LSP 可能恢复）。
let lspFastStalled = false;
let lspStallWarned = false;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
}

export async function doFastApi(path: string, fileType: DoFastFileType): Promise<Fast | undefined> {
    try {
        const client = LspClient.DigitalIDE;
        const langID = hdlFile.getLanguageId(path);
        const toolChain = opeParam.prjInfo.toolChain as DoFastToolChainType;
        if (!client) {
            return undefined;
        }
        // 已被判定卡住：不再发请求，立即跳过
        if (lspFastStalled) {
            console.warn(`[hdlParser] LSP 卡住，跳过解析: ${path}`);
            return undefined;
        }

        // 给 sendRequest 加超时；迟到的 rejection 吞掉避免 unhandled rejection
        const safe = client.sendRequest(DoFastRequestType, { path, fileType, toolChain })
            .catch((err: any) => {
                console.warn(`[hdlParser] api/fast 失败: ${err?.message || err}, path: ${path}`);
                return undefined;
            });
        const response = await withTimeout<Fast | undefined>(safe, LSP_FAST_TIMEOUT, undefined);
        if (!response) {
            // 超时（fallback=undefined）或失败 → 判定 LSP 卡住，短路剩余文件
            lspFastStalled = true;
            console.warn(`[hdlParser] api/fast 超过 ${LSP_FAST_TIMEOUT}ms 未响应，判定 LSP 卡住: ${path}`);
            if (!lspStallWarned) {
                lspStallWarned = true;
                vscode.window.showWarningMessage(
                    'SynthAid-IDE: LSP 解析卡住，已跳过部分文件以完成加载。' +
                    '请查看输出面板 SynthAid LintFix / 开发者控制台日志，或重启窗口后重试。'
                );
            }
            return undefined;
        }
        // 成功 → 复位
        lspFastStalled = false;
        response.languageId = langID;
        return response;
    } catch (error) {
        console.error("error happen when run doFastApi, " + error);
        console.error("error file path: " + path);
        return undefined;
    }
}

export async function doPrimitivesJudgeApi(primitiveName: string): Promise<boolean> {
    try {
        const client = LspClient.DigitalIDE;
        if (client) {
            const safe = client.sendRequest(DoPrimitivesJudgeType, { name: primitiveName })
                .catch((err: any) => {
                    console.warn(`[hdlParser] judgePrimitives 失败: ${err?.message || err}`);
                    return false;
                });
            const response = await withTimeout<boolean>(safe, LSP_FAST_TIMEOUT, false);
            return response;
        }
    } catch (error) {
        console.error("error happen when run judgePrimitivesApi, " + error);
        console.error("error query primitive name: " + primitiveName);
        return false;
    }
    return false;
}


export namespace HdlSymbol {
    /**
     * @description 计算出模块级的信息
     * @param path 文件绝对路径
     * @returns 
     */
    export function fast(path: AbsPath, fileType: DoFastFileType): Promise<Fast | undefined> {
        return doFastApi(path, fileType);
    }
}

export const defaultRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
};

export const defaultMacro: Macro = {
    errors: [],
    includes: [],
    defines: [],
    invalid: []
};