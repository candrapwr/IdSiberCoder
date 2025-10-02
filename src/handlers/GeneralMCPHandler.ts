import {
    ContextManager,
    ConversationMessage,
    ContextManagerOptions,
    MessageUsage,
    ToolFunctionCall
} from '../context/ContextManager';
import { ConversationHandler } from './ConversationHandler';
import { ToolCallHandler, ToolRegistry } from './ToolCallHandler';
import { LoggingHandler } from './LoggingHandler';
import { ProviderFactory, RequestHandler } from './RequestHandler';
import type { ToolDefinition } from '../providers/DeepSeekProvider';

export interface MCPOptions {
    systemPrompt: string;
    tools: ToolRegistry;
    providerFactory: ProviderFactory;
    contextOptions?: ContextManagerOptions;
    toolDefinitions: ToolDefinition[];
}

export interface PromptOutcome {
    message: ConversationMessage;
    summaryLines: number;
    usage?: MessageUsage;
    toolCalls?: ToolFunctionCall[];
}

export class GeneralMCPHandler {
    private readonly contextManager: ContextManager;
    private readonly conversationHandler: ConversationHandler;
    private readonly toolCallHandler: ToolCallHandler;
    private readonly loggingHandler: LoggingHandler;
    private requestHandler: RequestHandler;
    private providerFactory: ProviderFactory;
    private systemPrompt: string;
    private toolDefinitions: ToolDefinition[];

    constructor(options: MCPOptions) {
        this.contextManager = new ContextManager(options.contextOptions);
        this.conversationHandler = new ConversationHandler(this.contextManager);
        this.systemPrompt = options.systemPrompt;
        this.conversationHandler.initialize(this.systemPrompt);

        this.toolCallHandler = new ToolCallHandler(options.tools);
        this.loggingHandler = new LoggingHandler();
        this.toolDefinitions = [...options.toolDefinitions];

        this.providerFactory = options.providerFactory;
        this.requestHandler = new RequestHandler(
            this.conversationHandler,
            () => this.providerFactory(),
            this.loggingHandler,
            this.toolDefinitions
        );
        this.requestHandler.updateToolDefinitions(this.toolDefinitions);
    }

    async handlePrompt(prompt: string): Promise<PromptOutcome> {
        try {
            const result = await this.requestHandler.handle(prompt);
            this.loggingHandler.info('Received response from provider');
            return {
                message: result.message,
                summaryLines: result.summaryLines,
                usage: result.usage,
                toolCalls: result.toolCalls
            };
        } catch (error: unknown) {
            const friendly = error instanceof Error ? error.message : String(error);
            this.loggingHandler.error('Failed to obtain provider response', friendly);
            const fallback = {
                role: 'assistant' as const,
                content: `❌ ${friendly}`
            };
            this.conversationHandler.addAssistantMessage(fallback.content);
            return {
                message: fallback,
                summaryLines: this.conversationHandler.optimize().summaryLines
            };
        }
    }

    async executeTool(action: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
        this.loggingHandler.info(`Executing tool ${action}`);
        return this.toolCallHandler.execute(action, parameters);
    }

    addToolResult(toolName: string, content: string, toolCallId?: string): void {
        this.conversationHandler.addToolResult(content, toolName, toolCallId);
    }

    async continueAfterTool(): Promise<PromptOutcome> {
        const result = await this.requestHandler.continueConversation();
        this.loggingHandler.info('Provider responded after tool execution');
        return {
            message: result.message,
            summaryLines: result.summaryLines,
            usage: result.usage,
            toolCalls: result.toolCalls
        };
    }

    getConversation(): ConversationMessage[] {
        return this.conversationHandler.getHistory();
    }

    resetConversation(): void {
        this.conversationHandler.reset(this.systemPrompt);
    }

    updateSystemPrompt(systemPrompt: string): void {
        this.systemPrompt = systemPrompt;
        this.resetConversation();
    }

    updateProviderFactory(factory: ProviderFactory): void {
        this.providerFactory = factory;
    }

    updateContextOptions(options: Partial<ContextManagerOptions>): void {
        this.contextManager.updateOptions(options);
    }

    updateTools(tools: ToolRegistry, definitions?: ToolDefinition[]): void {
        this.toolCallHandler.setTools(tools);
        if (definitions) {
            this.toolDefinitions = [...definitions];
        }
        this.requestHandler.updateToolDefinitions(this.toolDefinitions);
    }

    dispose(): void {
        this.loggingHandler.dispose();
    }
}
