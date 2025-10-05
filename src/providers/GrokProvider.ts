import axios, { AxiosInstance, isCancel } from 'axios';
import * as vscode from 'vscode';
import type { ConversationMessage, MessageUsage } from '../context/ContextManager';
import type { ChatProvider, ProviderResponse, ToolDefinition } from './types';

export interface GrokConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

export class GrokProvider implements ChatProvider {
    private readonly client: AxiosInstance;

    constructor(private readonly config: GrokConfig) {
        this.client = axios.create({
            baseURL: config.baseUrl.replace(/\/$/, ''),
            timeout: 300000
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

        if (this.config.maxTokens) {
            payload.max_tokens = this.config.maxTokens;
        }

        if (tools.length) {
            payload.tools = tools;
            payload.tool_choice = 'auto';
        }

        try {
            // Create AbortController that can be cancelled by VS Code cancellation token
            const abortController = new AbortController();
            
            // Listen for cancellation from VS Code
            if (cancelToken) {
                const cancellationListener = cancelToken.onCancellationRequested(() => {
                    abortController.abort();
                });
                
                // Clean up listener when request completes
                const cleanup = () => cancellationListener.dispose();
                
                const response = await this.client.post('/chat/completions', payload, {
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    signal: abortController.signal
                }).finally(cleanup);
                
                return this.parseResponse(response.data);
            } else {
                const response = await this.client.post('/chat/completions', payload, {
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                return this.parseResponse(response.data);
            }
        } catch (error: unknown) {
            // Check if the error is due to cancellation
            if (axios.isCancel(error)) {
                throw new Error('Request cancelled by user');
            }
            
            const friendly = axios.isAxiosError(error)
                ? error.response?.data?.error?.message ?? error.message
                : (error as Error).message;

            return {
                message: {
                    role: 'assistant',
                    content: `❌ Grok error: ${friendly}`
                },
                raw: error
            };
        }
    }

    private parseResponse(data: any): ProviderResponse {
        const choice = data?.choices?.[0];
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

        const usageRaw = data?.usage;
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
            raw: data,
            usage,
            toolCalls
        };
    }
}