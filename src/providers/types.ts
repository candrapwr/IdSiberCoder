import type { ConversationMessage, MessageUsage } from '../context/ContextManager';
import * as vscode from 'vscode';

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

export interface ChatProvider {
    sendChat(
        messages: ConversationMessage[],
        tools?: ToolDefinition[],
        cancelToken?: vscode.CancellationToken
    ): Promise<ProviderResponse>;
}
