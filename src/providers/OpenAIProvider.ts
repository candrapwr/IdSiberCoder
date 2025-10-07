import axios, { AxiosInstance, isCancel } from 'axios';
import * as vscode from 'vscode';
import type { ConversationMessage, MessageUsage } from '../context/ContextManager';
import type { ChatProvider, ProviderResponse, ToolDefinition } from './types';

export interface OpenAIConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

export class OpenAIProvider implements ChatProvider {
    private readonly client: AxiosInstance;

    constructor(private readonly config: OpenAIConfig) {
        this.client = axios.create({
            baseURL: config.baseUrl.replace(/\/$/, ''),
            timeout: 300000
        });
    }

    /**
     * Determine if the model requires the new /v1/responses API
     */
    private isResponsesAPI(model: string): boolean {
        // Models that require the new /v1/responses API
        const responsesModels = [
            'gpt-5-nano',
            'gpt-5-codex',
            'codex-mini-latest'
        ];
        
        return responsesModels.some(responsesModel => 
            model.toLowerCase().includes(responsesModel.toLowerCase())
        );
    }

    async sendChat(
        messages: ConversationMessage[],
        tools: ToolDefinition[] = [],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse> {
        const useResponsesAPI = this.isResponsesAPI(this.config.model);
        
        if (useResponsesAPI) {
            return this.sendResponsesAPI(messages, tools, cancelToken);
        } else {
            return this.sendChatCompletionsAPI(messages, tools, cancelToken);
        }
    }

    /**
     * Send request using the legacy /v1/chat/completions API
     */
    private async sendChatCompletionsAPI(
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

        payload.temperature = 0.4;

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
                
                return this.parseChatCompletionsResponse(response.data);
            } else {
                const response = await this.client.post('/chat/completions', payload, {
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                return this.parseChatCompletionsResponse(response.data);
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
                    content: `❌ OpenAI error: ${friendly}`
                },
                raw: error
            };
        }
    }

    /**
     * Send request using the new /v1/responses API
     */
    private async sendResponsesAPI(
        messages: ConversationMessage[],
        tools: ToolDefinition[] = [],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse> {
        // Convert messages to the new format for /v1/responses
        const input = messages.map(({ role, content, name, toolCalls, toolCallId }) => {
            // For /v1/responses, we need to handle tool messages differently
            if (role === 'tool' && toolCallId) {
                return {
                    type: 'function_call_output',
                    call_id: toolCallId,
                    output: content
                };
            }
            
            // Handle assistant tool calls
            if (role === 'assistant' && toolCalls?.length) {
                const toolCall = toolCalls[0];
                if (toolCall.function) {
                    return {
                        type: 'function_call',
                        status: 'completed',
                        arguments: toolCall.function.arguments,
                        call_id: toolCall.id,
                        name: toolCall.function.name
                    };
                }
            }
            
            // Regular messages
            const mapped: Record<string, unknown> = { role };
            if (content) {
                mapped.content = content;
            }
            if (name) {
                mapped.name = name;
            }
            return mapped;
        });

        const payload: Record<string, unknown> = {
            model: this.config.model,
            input,
            stream: false
        };

        if (tools.length) {
            // For /v1/responses API, tools use 'name' directly, not nested in 'function'
            payload.tools = tools.map(tool => ({
                type: 'function',
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters
            }));
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
                
                const response = await this.client.post('/responses', payload, {
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    signal: abortController.signal
                }).finally(cleanup);
                
                return this.parseResponsesAPIResponse(response.data);
            } else {
                const response = await this.client.post('/responses', payload, {
                    headers: {
                        Authorization: `Bearer ${this.config.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                return this.parseResponsesAPIResponse(response.data);
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
                    content: `❌ OpenAI error: ${friendly}`
                },
                raw: error
            };
        }
    }

    /**
     * Parse response from /v1/chat/completions API
     */
    private parseChatCompletionsResponse(data: any): ProviderResponse {
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

    /**
     * Parse response from /v1/responses API
     */
    private parseResponsesAPIResponse(data: any): ProviderResponse {
        const outputs = data?.output ?? [];
        
        let content = '';
        let toolCalls;
        
        // Process all outputs to find message and function_call
        for (const output of outputs) {
            if (output.type === 'message' && output.content?.[0]?.type === 'output_text') {
                content = output.content[0].text ?? '';
            }
            else if (output.type === 'function_call') {
                toolCalls = [{
                    id: output.call_id,
                    type: 'function',
                    function: {
                        name: output.name,
                        arguments: output.arguments ?? ''
                    }
                }];
            }
        }

        const usageRaw = data?.usage;
        const usage: MessageUsage | undefined = usageRaw
            ? {
                  promptTokens: usageRaw.input_tokens ?? usageRaw.prompt_tokens,
                  completionTokens: usageRaw.output_tokens ?? usageRaw.completion_tokens,
                  totalTokens:
                      usageRaw.total_tokens ??
                      (typeof usageRaw.input_tokens === 'number' || typeof usageRaw.output_tokens === 'number'
                          ? (usageRaw.input_tokens ?? 0) + (usageRaw.output_tokens ?? 0)
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
