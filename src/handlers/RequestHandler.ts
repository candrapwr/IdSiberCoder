import type { ConversationMessage, MessageUsage, ToolFunctionCall } from '../context/ContextManager';
import type { ConversationHandler } from './ConversationHandler';
import type { ProviderResponse, ToolDefinition, ChatProvider } from '../providers/types';
import { LoggingHandler } from './LoggingHandler';

export type ProviderFactory = () => Promise<ChatProvider>;

export interface PromptResult {
    message: ConversationMessage;
    raw: unknown;
    summaryLines: number;
    usage?: MessageUsage;
    toolCalls?: ToolFunctionCall[];
}

export class RequestHandler {
    constructor(
        private readonly conversationHandler: ConversationHandler,
        private readonly providerFactory: ProviderFactory,
        private readonly logger: LoggingHandler,
        private toolDefinitions: ToolDefinition[] = []
    ) {}

    updateToolDefinitions(tools: ToolDefinition[]): void {
        this.toolDefinitions = tools;
    }

    async handle(prompt: string): Promise<PromptResult> {
        this.conversationHandler.addUserMessage(prompt);
        const optimized = this.conversationHandler.optimize();

        const provider = await this.providerFactory();
        this.logger.info('Dispatching prompt to provider', { tokenCount: optimized.messages.length });

        const response: ProviderResponse = await provider.sendChat(optimized.messages, this.toolDefinitions);
        this.conversationHandler.addAssistantMessage(
            response.message.content,
            response.usage,
            response.toolCalls
        );

        return {
            message: response.message,
            raw: response.raw,
            summaryLines: optimized.summaryLines,
            usage: response.usage,
            toolCalls: response.toolCalls
        };
    }

    async continueConversation(): Promise<PromptResult> {
        const optimized = this.conversationHandler.optimize();
        const provider = await this.providerFactory();
        this.logger.info('Continuing conversation after tool result', {
            tokenCount: optimized.messages.length
        });

        const response: ProviderResponse = await provider.sendChat(optimized.messages, this.toolDefinitions);
        this.conversationHandler.addAssistantMessage(
            response.message.content,
            response.usage,
            response.toolCalls
        );

        return {
            message: response.message,
            raw: response.raw,
            summaryLines: optimized.summaryLines,
            usage: response.usage,
            toolCalls: response.toolCalls
        };
    }
}
