import type { Disposable } from 'vscode';

type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface ToolFunctionCall {
    id?: string;
    type?: string;
    function?: {
        name: string;
        arguments: string;
    };
}

export interface ConversationMessage {
    role: Role;
    content: string;
    name?: string;
    toolCallId?: string;
    usage?: MessageUsage;
    toolCalls?: ToolFunctionCall[];
}

export interface ContextManagerOptions {
    enabled?: boolean;
    actions?: string[];
    maxInstances?: number;
    summaryEnabled?: boolean;
    summaryThreshold?: number;
    summaryRetention?: number;
    summaryPrefix?: string;
    summaryMaxLineLength?: number;
    summaryTokenThreshold?: number;
}

export interface OptimizationResult {
    optimized: boolean;
    messages: ConversationMessage[];
    removed: number;
    summaryUpdated: boolean;
    summaryLines: number;
}

/**
 * Lightweight port of the IdSiber Codex context optimizer tailored for VS Code.
 * Deduplicates redundant tool calls and folds older turns into rolling summaries
 * so we stay within context limits while preserving recent intent.
 */
export class ContextManager implements Disposable {
    private enabled: boolean;
    private optimizedActions: Set<string>;
    private maxInstances: number;
    private summaryEnabled: boolean;
    private summaryThreshold: number;
    private summaryRetention: number;
    private summaryPrefix: string;
    private summaryMaxLineLength: number;
    private summaryTokenThreshold?: number;
    private summaryLines: string[] = [];
    private summaryHashes = new Set<string>();

    constructor(options: ContextManagerOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.optimizedActions = new Set(options.actions ?? ['read_file']);
        this.maxInstances = options.maxInstances ?? 1;
        this.summaryEnabled = options.summaryEnabled ?? true;
        this.summaryThreshold = options.summaryThreshold ?? 40;
        this.summaryRetention = options.summaryRetention ?? 35;
        this.summaryPrefix = options.summaryPrefix ?? 'Context summary (auto-generated):';
        this.summaryMaxLineLength = options.summaryMaxLineLength ?? 300;
        this.summaryTokenThreshold = options.summaryTokenThreshold;
    }

    dispose(): void {
        this.summaryLines = [];
        this.summaryHashes.clear();
    }

    reset(): void {
        this.summaryLines = [];
        this.summaryHashes.clear();
    }

    updateOptions(options: Partial<ContextManagerOptions>): void {
        if (options.enabled !== undefined) {
            this.enabled = options.enabled;
        }
        if (options.actions) {
            this.optimizedActions = new Set(options.actions);
        }
        if (options.maxInstances !== undefined) {
            this.maxInstances = options.maxInstances;
        }
        if (options.summaryEnabled !== undefined) {
            this.summaryEnabled = options.summaryEnabled;
        }
        if (options.summaryThreshold !== undefined) {
            this.summaryThreshold = options.summaryThreshold;
        }
        if (options.summaryRetention !== undefined) {
            this.summaryRetention = options.summaryRetention;
        }
        if (options.summaryPrefix) {
            this.summaryPrefix = options.summaryPrefix;
        }
        if (options.summaryMaxLineLength !== undefined) {
            this.summaryMaxLineLength = options.summaryMaxLineLength;
        }
        if (options.summaryTokenThreshold !== undefined) {
            this.summaryTokenThreshold = options.summaryTokenThreshold;
        }
    }

    optimize(messages: ConversationMessage[]): OptimizationResult {
        this.hydrateSummaryFromMessages(messages);

        if (!this.enabled || messages.length <= 2) {
            return {
                optimized: false,
                messages,
                removed: 0,
                summaryUpdated: false,
                summaryLines: this.summaryLines.length
            };
        }

        let working = [...messages];
        const indicesToRemove = new Set<number>();
        const toolOccurrences = new Map<string, number[]>();

        working.forEach((message, index) => {
            if (message.role !== 'assistant') {
                return;
            }

            const match = message.content.match(/Tool:\\s*(\w+)/i);
            if (!match) {
                return;
            }

            const action = match[1];
            if (!this.optimizedActions.has(action)) {
                return;
            }

            const key = `${action}|${message.content}`;
            const indices = toolOccurrences.get(key) ?? [];
            indices.push(index);
            toolOccurrences.set(key, indices);
        });

        for (const [, indices] of toolOccurrences.entries()) {
            if (indices.length <= this.maxInstances) {
                continue;
            }

            indices.sort((a, b) => a - b);
            const stale = indices.slice(0, Math.max(0, indices.length - this.maxInstances));
            stale.forEach((assistantIndex) => {
                indicesToRemove.add(assistantIndex);
                const next = assistantIndex + 1;
                if (next < working.length && working[next].role === 'tool') {
                    indicesToRemove.add(next);
                }
            });
        }

        const filtered = working.filter((_, idx) => !indicesToRemove.has(idx));
        const removed = working.length - filtered.length;

        const forceSummary = this.summaryEnabled ? this.shouldForceSummaryByTokens(filtered) : false;

        const { summaryUpdated, messages: summarized } = this.summaryEnabled
            ? this.applySummaries(filtered, forceSummary)
            : { summaryUpdated: false, messages: filtered };

        return {
            optimized: removed > 0 || summaryUpdated,
            messages: summarized,
            removed,
            summaryUpdated,
            summaryLines: this.summaryLines.length
        };
    }

    private applySummaries(
        messages: ConversationMessage[],
        force: boolean
    ): { summaryUpdated: boolean; messages: ConversationMessage[] } {
        if (!force && messages.length <= this.summaryThreshold) {
            return { summaryUpdated: false, messages };
        }

        const keepTail = Math.max(0, this.summaryRetention);
        let startIndex = Math.max(0, messages.length - keepTail);

        if (startIndex > 0) {
            while (startIndex > 0 && startIndex < messages.length && messages[startIndex].role === 'tool') {
                startIndex -= 1;
            }

            if (
                startIndex > 0 &&
                startIndex <= messages.length &&
                messages[startIndex - 1].role === 'assistant' &&
                Array.isArray(messages[startIndex - 1].toolCalls) &&
                messages[startIndex - 1].toolCalls!.length > 0
            ) {
                startIndex -= 1;
            }
        }

        if (force && startIndex <= 1 && messages.length > 2) {
            const maxStart = Math.max(1, messages.length - 1);
            const suggested = Math.max(2, Math.floor(messages.length / 2));
            startIndex = Math.min(suggested, maxStart);
        }

        const tail = messages.slice(startIndex);
        const head = messages.slice(0, startIndex);

        const newLines: string[] = [];
        const roleLabels: Record<Role, string> = {
            system: 'system',
            user: 'user',
            assistant: 'assistant',
            tool: 'tool'
        };

        for (const entry of head) {
            if (entry.role === 'system') {
                continue;
            }

            if (entry.role === 'assistant' && entry.content.startsWith(this.summaryPrefix)) {
                continue;
            }

            const label =
                entry.role === 'tool'
                    ? `${roleLabels[entry.role]}${entry.name ? ` (${entry.name})` : ''}`
                    : roleLabels[entry.role];

            let content = entry.content.replace(/\s+/g, ' ').trim();

            if(entry.role === 'assistant'){
                let concatTool = '';
                if(entry.toolCalls){
                    for (const entryTool of entry.toolCalls) {
                        const tcName = entryTool.function?.name;
                        let tcContent = '';
                        if(tcName != 'edit_file' && tcName != 'write_file'){
                            tcContent = JSON.stringify(entryTool.function?.arguments);
                        }else{
                            tcContent = this.limitJsonString(entryTool.function?.arguments,200);
                        }
                        concatTool += `\nCall Tool ${tcName} : ${tcContent}`;
                    }
                }
                content = (content)? `${content}${concatTool}`: '';
            }

            if (!content) {
                continue;
            }

            // Handle read_file tool results - truncate file content in summary
            if (entry.role === 'tool' && entry.name === 'read_file' && content.includes('Tool result for read_file:')) {
                content = content.replace(/Tool result for read_file:.*/s, 'Tool result for read_file: ...');
            }

            const bullet = this.truncate(`• ${label}: ${content}`);
            const hash = this.hashSummary(bullet);
            if (!this.summaryHashes.has(hash)) {
                this.summaryHashes.add(hash);
                newLines.push(bullet);
            }
        }

        if (!newLines.length) {
            if (!this.summaryLines.length) {
                return { summaryUpdated: false, messages };
            }
            const summaryMessage: ConversationMessage = {
                role: 'assistant',
                content: `${this.summaryPrefix}\n${this.summaryLines.join('\n')}`.trim()
            };
            return {
                summaryUpdated: false,
                messages: this.mergeWithSummary(messages, summaryMessage, startIndex, tail)
            };
        }

        this.summaryLines.push(...newLines);

        const summaryMessage: ConversationMessage = {
            role: 'assistant',
            content: this.formatSummaryContent()
        };

        return {
            summaryUpdated: true,
            messages: this.mergeWithSummary(messages, summaryMessage, startIndex, tail)
        };
    }

    private shouldForceSummaryByTokens(messages: ConversationMessage[]): boolean {
        if (!this.summaryTokenThreshold || this.summaryTokenThreshold <= 0) {
            return false;
        }
        const lastTokens = this.getLastUsageTokens(messages);
        return lastTokens >= this.summaryTokenThreshold;
    }

    private getLastUsageTokens(messages: ConversationMessage[]): number {
        for (let index = messages.length - 1; index >= 0; index--) {
            const usage = messages[index].usage;
            if (!usage) {
                continue;
            }
            if (typeof usage.totalTokens === 'number') {
                return usage.totalTokens;
            }
            const prompt = typeof usage.promptTokens === 'number' ? usage.promptTokens : 0;
            const completion = typeof usage.completionTokens === 'number' ? usage.completionTokens : 0;
            if (prompt + completion > 0) {
                return prompt + completion;
            }
        }
        return 0;
    }

    private mergeWithSummary(
        messages: ConversationMessage[],
        summaryMessage: ConversationMessage,
        startIndex: number,
        tail: ConversationMessage[]
    ): ConversationMessage[] {
        if (!messages.length) {
            return [summaryMessage];
        }

        const systemMessage = messages[0];
        const remaining = startIndex === 0 ? tail.slice(1) : tail;
        return [systemMessage, summaryMessage, ...remaining];
    }

    private truncate(value: string): string {
        if (value.length <= this.summaryMaxLineLength) {
            return value;
        }
        return `${value.slice(0, this.summaryMaxLineLength - 3)}...`;
    }

    private hashSummary(value: string): string {
        let hash = 0;
        for (let i = 0; i < value.length; i++) {
            hash = (hash << 5) - hash + value.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(16);
    }

    private hydrateSummaryFromMessages(messages: ConversationMessage[]): void {
        if (this.summaryLines.length) {
            return;
        }
        const candidate = messages.find(
            (message) => message.role === 'assistant' && message.content.startsWith(this.summaryPrefix)
        );
        if (!candidate) {
            return;
        }
        const marker = `${this.summaryPrefix}\n`;
        const raw = candidate.content.startsWith(marker)
            ? candidate.content.slice(marker.length)
            : candidate.content;

        const lines = raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        if (!lines.length) {
            return;
        }
        this.summaryLines = lines;
        this.summaryHashes = new Set(lines.map((line) => this.hashSummary(line)));
    }

    private formatSummaryContent(): string {
        const header = this.summaryPrefix.endsWith(':') ? this.summaryPrefix : `${this.summaryPrefix}:`;
        return `${header}\n${this.summaryLines.join('\n')}`;
    }

    private limitJsonString(jsonObj: any, maxLength = 500) {
        const str = JSON.stringify(jsonObj || {});
        return str.length <= maxLength ? str : str.slice(0, maxLength - 3) + '...';
    }
}
