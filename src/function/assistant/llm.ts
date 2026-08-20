/* eslint-disable @typescript-eslint/naming-convention */
import axios from 'axios';

import { AssistantConfig } from './config';

/**
 * @description 聊天消息（OpenAI 兼容格式）
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_call_id?: string;
    tool_calls?: any[];
}

export interface ToolCallbacks {
    onToolCall?: (name: string, args: any) => void;
    onToolResult?: (content: string) => void;
}

/**
 * @description 在 Vivado 进程中执行一条 TCL 命令（由扩展注入）
 */
export type ExecuteTcl = (command: string, timeout?: number) => Promise<string>;

/**
 * @description 工具定义：LLM 可在当前 Vivado 设计中执行 TCL 查询
 */
const RUN_VIVADO_TCL_TOOL = {
    type: 'function',
    function: {
        name: 'run_vivado_tcl',
        description: [
            'Execute a Tcl command in the live Vivado design session and return the result.',
            'Use this to inspect the current FPGA design: query cells, nets, pins, clocks,',
            'timing paths, resource utilization, constraints, and properties.',
            'Also use this to run Vivado report commands like report_timing, report_utilization,',
            'report_drc, report_clock_networks, etc.',
            'CRITICAL RULES:',
            '- Only use read-only commands unless the user explicitly asks for modifications.',
            '- NEVER run exit, close_project, close_design, quit, or file deletion commands.',
            '- Pass the -return_string flag to report commands to capture output as a string.',
            '- If a command fails, analyze the error and try an alternative approach.',
            '- Limit each command to a single operation for clarity.'
        ].join('\n'),
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The Tcl command to execute in Vivado. For report commands, always include -return_string.'
                }
            },
            required: ['command']
        }
    }
};

interface ToolCallResult {
    id: string;
    type?: string;
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * @description 单次调用 OpenAI 兼容 Chat Completions
 */
async function chatOnce(config: AssistantConfig, messages: ChatMessage[]) {
    const url = config.apiBase.replace(/\/+$/, '') + '/chat/completions';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        tools: [RUN_VIVADO_TCL_TOOL],
        tool_choice: 'auto'
    };
    // 推理模型（如 deepseek-v4-*）的 reasoning_content 会显著拖慢响应。
    // 聊天默认保留推理以提升回答质量；想提速可在设置中关闭。
    if (config.thinking === false) {
        body.thinking = { type: 'disabled' };
    }
    return axios.post(
        url,
        body,
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            timeout: 120000,
            // axios 1.x 对 chunked/压缩响应体有 maxContentLength 计算 bug，
            // 需显式设置大有限值避免报 "maxContentLength size of -1 exceeded"。
            maxContentLength: 200 * 1024 * 1024,
            maxBodyLength: 200 * 1024 * 1024
        }
    );
}

/**
 * @description 解析工具调用参数（容错）
 */
function parseToolCallArguments(raw: string): any {
    try {
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

/**
 * @description 执行一次完整的对话（含工具调用循环，最多 maxToolRounds 轮）
 *
 * v1 为非流式：返回最终完整文本；工具调用通过回调实时展示。
 * @param options.designContext 离线解析的 RTL 设计结构，追加到 system prompt
 */
export async function runConversation(
    config: AssistantConfig,
    messages: ChatMessage[],
    executeTcl: ExecuteTcl,
    callbacks?: ToolCallbacks,
    options?: { designContext?: string }
): Promise<string> {
    if (!config.apiKey) {
        throw new Error('apiKey not configured');
    }

    const history: ChatMessage[] = [];
    const systemParts: string[] = [];
    if (config.systemPrompt) {
        systemParts.push(config.systemPrompt);
    }
    if (options?.designContext) {
        systemParts.push('=== RTL Design Structure (parsed offline) ===\n' + options.designContext);
    }
    if (systemParts.length > 0) {
        history.push({ role: 'system', content: systemParts.join('\n\n') });
    }
    history.push(...messages);

    for (let round = 0; round < config.maxToolRounds; round++) {
        const response = await chatOnce(config, history);
        const message = response.data?.choices?.[0]?.message;
        if (!message) {
            throw new Error('Empty response from LLM API');
        }

        const toolCalls: ToolCallResult[] | undefined = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            return message.content || '';
        }

        history.push({ role: 'assistant', content: message.content, tool_calls: toolCalls });

        for (const toolCall of toolCalls) {
            const name = toolCall.function?.name;
            const args = parseToolCallArguments(toolCall.function?.arguments);

            callbacks?.onToolCall?.(name, args);

            let result: string;
            if (name === 'run_vivado_tcl') {
                const command = typeof args.command === 'string' ? args.command : '';
                try {
                    result = await executeTcl(command);
                } catch (error: any) {
                    result = `ERROR: ${error?.message || String(error)}`;
                }
            } else {
                result = `ERROR: unknown tool ${name}`;
            }

            callbacks?.onToolResult?.(result);
            history.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
        }
    }

    throw new Error('Max tool rounds exceeded');
}
