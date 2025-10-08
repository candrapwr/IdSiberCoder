import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import type { ConversationMessage, MessageUsage } from '../context/ContextManager';
import type { ChatProvider, ProviderResponse, ToolDefinition } from './types';

type ToolCall = {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
};

export interface GeminiConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface GeminiPart {
    text?: string;
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
    };
    functionResponse?: {
        name: string;
        response: {
            content: string;
        };
    };
}

export class GeminiProvider implements ChatProvider {
    private readonly client: AxiosInstance;
    private readonly config: GeminiConfig;

    constructor(config: GeminiConfig) {
        this.config = config;
        this.client = axios.create({
            baseURL: 'https://generativelanguage.googleapis.com',
            timeout: 300000
        });
    }

    async sendChat(
        messages: ConversationMessage[],
        tools: ToolDefinition[] = [],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse> {
        const url = `/v1beta/models/${this.config.model}:generateContent`;

        let systemInstruction: string | undefined;
        const regularMessages = messages.filter(msg => {
            if (msg.role === 'system') {
                systemInstruction = msg.content;
                return false;
            }
            return true;
        });

        const payload: Record<string, unknown> = {
            contents: this.mapMessagesToGemini(regularMessages),
            generationConfig: {
                temperature: 0.4
            }
        };

        if (systemInstruction) {
            payload.system_instruction = {
                parts: [{ text: systemInstruction }]
            };
        }

        if (tools.length > 0) {
            payload.tools = [{
                function_declarations: tools.map(tool => tool.function)
            }];
        }

        try {
            const abortController = new AbortController();
            
            if (cancelToken) {
                const cancellationListener = cancelToken.onCancellationRequested(() => {
                    abortController.abort();
                });
                
                const cleanup = () => cancellationListener.dispose();
                
                const response = await this.client.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    params: { key: this.config.apiKey },
                    signal: abortController.signal
                }).finally(cleanup);
                
                return this.parseResponse(response.data);
            } else {
                 const response = await this.client.post(url, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    params: { key: this.config.apiKey }
                });
                
                return this.parseResponse(response.data);
            }
        } catch (error: unknown) {
            if (axios.isCancel(error)) {
                throw new Error('Request dibatalkan oleh pengguna');
            }
            
            const friendly = axios.isAxiosError(error)
                ? error.response?.data?.error?.message ?? error.message
                : (error as Error).message;

            return {
                message: {
                    role: 'assistant',
                    content: `❌ Gemini error: ${friendly}`
                },
                raw: error
            };
        }
    }

    private mapMessagesToGemini(messages: ConversationMessage[]): GeminiContent[] {
        const geminiContents: GeminiContent[] = [];

        for (const msg of messages) {
            const role = (msg.role === 'assistant') ? 'model' : 'user';
            const parts: GeminiPart[] = [];

            if (msg.content) {
                if (msg.role === 'tool') {
                    parts.push({
                        functionResponse: {
                            name: msg.name ?? 'unknown_function',
                            response: {
                                content: msg.content
                            }
                        }
                    });
                } else {
                     parts.push({ text: msg.content });
                }
            }

            if (msg.toolCalls?.length) {
                for (const call of msg.toolCalls) {
                    if (call.function) {
                        try {
                            parts.push({
                                functionCall: {
                                    name: call.function.name,
                                    args: JSON.parse(call.function.arguments)
                                }
                            });
                        } catch (e) {
                            console.error('Gagal mem-parsing argumen tool call:', e);
                        }
                    }
                }
            }
            
            const lastContent = geminiContents.at(-1);
            if (lastContent && lastContent.role === role) {
                lastContent.parts.push(...parts);
            } else {
                 geminiContents.push({ role, parts });
            }
        }
        return geminiContents;
    }

    private parseResponse(data: any): ProviderResponse {
        const candidate = data?.candidates?.[0];
        if (!candidate) {
            return {
                message: { role: 'assistant', content: '❌ Gemini error: Respons tidak valid atau kosong.' },
                raw: data
            };
        }
        
        let content = '';
        const toolCalls: ToolCall[] = [];

        if (Array.isArray(candidate.content?.parts)) {
            candidate.content.parts.forEach((part: GeminiPart, index: number) => {
                if (part.text) {
                    content += part.text;
                }
                if (part.functionCall) {
                    toolCalls.push({
                        id: `gemini_call_${Date.now()}_${index}`, 
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args ?? {})
                        }
                    });
                }
            });
        }
        
        const usageRaw = data?.usageMetadata;
        const usage: MessageUsage | undefined = usageRaw
            ? {
                  promptTokens: usageRaw.promptTokenCount,
                  completionTokens: usageRaw.candidatesTokenCount,
                  totalTokens: usageRaw.totalTokenCount
              }
            : undefined;

        return {
            message: {
                role: 'assistant',
                content,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            },
            raw: data,
            usage,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }
}