import axios, { AxiosInstance, isCancel } from 'axios';
import * as vscode from 'vscode';
import type { ConversationMessage, MessageUsage } from '../context/ContextManager';
import type { ChatProvider, ProviderResponse, ToolDefinition } from './types';

export interface ClaudeConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

export class ClaudeProvider implements ChatProvider {
    private config: ClaudeConfig;
    private client: AxiosInstance;

    constructor(config: ClaudeConfig) {
        this.config = config;
        this.client = axios.create({
            baseURL: this.config.baseUrl || 'https://api.anthropic.com',
            headers: {
                'x-api-key': this.config.apiKey,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
            }
        });
    }

    async sendChat(
        messages: ConversationMessage[],
        tools: ToolDefinition[],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse> {
        try {
            // Separate system message
            let systemMessage = '';
            const filteredMessages = messages.filter(msg => {
                if (msg.role === 'system') {
                    systemMessage = msg.content || '';
                    return false;
                }
                return true;
            });

            // Convert messages to Claude format
            const claudeMessages = this.formatMessages(filteredMessages);
            const formattedTools = this.formatTools(tools);

            const requestBody: any = {
                model: this.config.model,
                messages: claudeMessages,
                max_tokens: this.config.maxTokens || 8000
            };

            if (systemMessage) {
                requestBody.system = systemMessage;
            }

            if (formattedTools.length > 0) {
                requestBody.tools = formattedTools;
                requestBody.tool_choice = { type: 'auto' };
            }

            const response = await this.client.post('/v1/messages', requestBody, {
                cancelToken: cancelToken ? new axios.CancelToken(c => {
                    const disposable = cancelToken.onCancellationRequested(() => {
                        c('Request cancelled');
                    });
                    if (cancelToken.isCancellationRequested) {
                        c('Request cancelled');
                    }
                }) : undefined
            });

            return this.parseResponse(response.data);
        } catch (error) {
            if (isCancel(error)) {
                throw new vscode.CancellationError();
            }
            
            const friendly = axios.isAxiosError(error)
                ? error.response?.data?.error?.message ?? error.message
                : (error as Error).message;

            return {
                message: {
                    role: 'assistant',
                    content: `❌ Claude error: ${friendly}`
                },
                raw: error
            };
        }
    }

    private formatMessages(messages: ConversationMessage[]): any[] {
        const formatted: any[] = [];
        
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            
            if (message.role === 'tool') {
                // Tool results should be added as user messages with tool_result content
                // We need to find the corresponding tool call ID from previous assistant message
                const toolCallId = this.findToolCallId(messages, i);
                formatted.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: toolCallId,
                            content: message.content
                        }
                    ]
                });
            } else if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
                // Assistant messages with tool calls
                const content = [
                    {
                        type: 'text',
                        text: message.content || ''
                    },
                    ...message.toolCalls.map(toolCall => ({
                        type: 'tool_use',
                        id: toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: toolCall.function?.name || 'unknown',
                        input: JSON.parse(toolCall.function?.arguments || '{}')
                    }))
                ];

                formatted.push({
                    role: 'assistant',
                    content
                });
            } else {
                // Regular user or assistant messages
                formatted.push({
                    role: message.role,
                    content: message.content
                });
            }
        }

        return formatted;
    }

    private findToolCallId(messages: ConversationMessage[], toolMessageIndex: number): string {
        // Look backwards to find the assistant message that contains the tool call
        for (let i = toolMessageIndex - 1; i >= 0; i--) {
            const message = messages[i];
            if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
                // Return the first tool call ID
                return message.toolCalls[0]?.id || 'unknown';
            }
        }
        return 'unknown';
    }

    private formatTools(tools: ToolDefinition[]): any[] {
        return tools.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
        }));
    }

    private parseResponse(data: any): ProviderResponse {
        const content = data?.content ?? [];
        let textContent = '';
        let toolCalls: any[] = [];

        content.forEach((block: any) => {
            if (block.type === 'text') {
                textContent += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input)
                    }
                });
            }
        });

        const usageRaw = data?.usage;
        const usage: MessageUsage | undefined = usageRaw
            ? {
                  promptTokens: usageRaw.input_tokens,
                  completionTokens: usageRaw.output_tokens,
                  totalTokens: usageRaw.input_tokens + usageRaw.output_tokens
              }
            : undefined;

        return {
            message: {
                role: 'assistant',
                content: textContent,
                toolCalls: toolCalls.length ? toolCalls : undefined
            },
            raw: data,
            usage,
            toolCalls: toolCalls.length ? toolCalls : undefined
        };
    }
}