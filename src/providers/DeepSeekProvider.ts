import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import type { ConversationMessage, MessageUsage } from '../context/ContextManager';

export interface DeepSeekConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

export interface ProviderResponse {
    message: ConversationMessage;
    raw: unknown;
    usage?: MessageUsage;
    toolCalls?: ConversationMessage['toolCalls'];
}

export class DeepSeekProvider {
    private readonly client: AxiosInstance;

    constructor(private readonly config: DeepSeekConfig) {
        this.client = axios.create({
            baseURL: config.baseUrl.replace(/\/$/, ''),
            timeout: 60000
        });
    }

    async sendChat(
        messages: ConversationMessage[],
        tools: ToolDefinition[] = [],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse> {
        const payload: Record<string, unknown> = {
            model: this.config.model,
            messages: messages.map(({ role, content, name, toolCalls, toolCallId }) => {
                const mapped: Record<string, unknown> = { role };
                if (content) {
                    mapped.content = content;
                }
                if (name) {
                    mapped.name = name;
                }
                if (role === 'tool' && toolCallId) {
                    mapped.tool_call_id = toolCallId;
                }
                if (toolCalls?.length) {
                    mapped.tool_calls = toolCalls.map((call) => ({
                        id: call.id,
                        type: call.type,
                        function: call.function
                    }));
                }
                return mapped;
            }),
            stream: false
        };

        if (tools.length) {
            payload.tools = tools;
            payload.tool_choice = 'auto';
        }

        try {
            const response = await this.client.post('/chat/completions', payload, {
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json'
                },
                signal: cancelToken as unknown as AbortSignal
            });

            const choice = response.data?.choices?.[0];
            const messagePayload = choice?.message ?? {};
            const content: string = messagePayload?.content ?? '';
            const toolCalls = Array.isArray(messagePayload?.tool_calls)
                ? messagePayload.tool_calls.map((call: any) => ({
                      id: call?.id,
                      type: call?.type,
                      function: {
                          name: call?.function?.name,
                          arguments: call?.function?.arguments ?? ''
                      }
                  }))
                : undefined;

            const usageRaw = response.data?.usage;
            const usage: MessageUsage | undefined = usageRaw
                ? {
                      promptTokens: usageRaw.prompt_tokens,
                      completionTokens: usageRaw.completion_tokens,
                      totalTokens:
                          usageRaw.total_tokens ??
                          (typeof usageRaw.prompt_tokens === 'number' || typeof usageRaw.completion_tokens === 'number'
                              ? (usageRaw.prompt_tokens ?? 0) + (usageRaw.completion_tokens ?? 0)
                              : undefined)
                  }
                : undefined;

            return {
                message: {
                    role: 'assistant',
                    content,
                    toolCalls
                },
                raw: response.data,
                usage,
                toolCalls
            };
        } catch (error: unknown) {
            const friendly = axios.isAxiosError(error)
                ? error.response?.data?.error?.message ?? error.message
                : (error as Error).message;

            return {
                message: {
                    role: 'assistant',
                    content: `❌ DeepSeek error: ${friendly}`
                },
                raw: error
            };
        }
    }
}
