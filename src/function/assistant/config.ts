import * as vscode from 'vscode';

export interface AssistantConfig {
    apiBase: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    maxToolRounds: number;
    injectRtlContext: boolean;
    thinking: boolean;
}

const DEFAULTS: AssistantConfig = {
    apiBase: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-v4-pro',
    systemPrompt: 'You are an expert FPGA design assistant integrated into Digital IDE. You can inspect the live Vivado design session via the run_vivado_tcl tool. Be concise and thorough.',
    temperature: 0.7,
    maxTokens: 4096,
    maxToolRounds: 10,
    injectRtlContext: true,
    thinking: true
};

/**
 * @description 读取 AI 助手配置（digital-ide.assistant.*）
 */
export function getAssistantConfig(): AssistantConfig {
    const cfg = vscode.workspace.getConfiguration('digital-ide.assistant');
    return {
        apiBase: cfg.get('apiBase', DEFAULTS.apiBase),
        apiKey: cfg.get('apiKey', DEFAULTS.apiKey),
        model: cfg.get('model', DEFAULTS.model),
        systemPrompt: cfg.get('systemPrompt', DEFAULTS.systemPrompt),
        temperature: cfg.get('temperature', DEFAULTS.temperature),
        maxTokens: cfg.get('maxTokens', DEFAULTS.maxTokens),
        maxToolRounds: cfg.get('maxToolRounds', DEFAULTS.maxToolRounds),
        injectRtlContext: cfg.get('injectRtlContext', DEFAULTS.injectRtlContext),
        thinking: cfg.get('thinking', DEFAULTS.thinking)
    };
}

/**
 * @description 打开 AI 助手设置页
 */
export function openAssistantSettings(): void {
    vscode.commands.executeCommand('workbench.action.openSettings', 'digital-ide.assistant');
}
