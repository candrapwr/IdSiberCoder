import { ContextManager, ConversationMessage, MessageUsage } from '../context/ContextManager';

export interface ConversationState {
    messages: ConversationMessage[];
    summaryLines: number;
}

export class ConversationHandler {
    private history: ConversationMessage[] = [];

    constructor(private readonly optimizer: ContextManager) {}

    initialize(systemPrompt: string): void {
        this.optimizer.reset();
        this.history = [{ role: 'system', content: systemPrompt }];
        this.optimizer.optimize(this.history);
    }

    reset(systemPrompt: string): void {
        this.initialize(systemPrompt);
    }

    addUserMessage(content: string): void {
        this.history.push({ role: 'user', content });
    }

    addAssistantMessage(
        content: string,
        usage?: MessageUsage,
        toolCalls?: ConversationMessage['toolCalls']
    ): void {
        this.history.push({ role: 'assistant', content, usage, toolCalls });
    }

    addToolResult(content: string, toolName: string, toolCallId?: string): void {
        this.history.push({ role: 'tool', content, name: toolName, toolCallId });
    }

    load(history: ConversationMessage[], fallbackSystemPrompt: string): void {
        this.optimizer.reset();

        if (!history.length || history[0].role !== 'system') {
            this.history = [];
            this.initialize(fallbackSystemPrompt);
            return;
        }

        this.history = history.map((message) => ({ ...message }));
        const result = this.optimizer.optimize(this.history);
        if (result.optimized) {
            this.history = result.messages;
        }
    }

    getHistory(): ConversationMessage[] {
        return [...this.history];
    }

    optimize(): ConversationState {
        const result = this.optimizer.optimize(this.history);
        if (result.optimized) {
            this.history = result.messages;
        }
        return {
            messages: this.getHistory(),
            summaryLines: result.summaryLines
        };
    }
}
