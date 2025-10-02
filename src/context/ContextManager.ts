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
    private summaryLines: string[] = [];
    private summaryFingerprint = new Set<string>();

    constructor(options: ContextManagerOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.optimizedActions = new Set(options.actions ?? ['read_file']);
        this.maxInstances = options.maxInstances ?? 1;
        this.summaryEnabled = options.summaryEnabled ?? true;
        this.summaryThreshold = options.summaryThreshold ?? 12;
        this.summaryRetention = options.summaryRetention ?? 6;
        this.summaryPrefix = options.summaryPrefix ?? 'Context summary (auto-generated):';
        this.summaryMaxLineLength = options.summaryMaxLineLength ?? 200;
    }

    dispose(): void {
        this.summaryLines = [];
        this.summaryFingerprint.clear();
    }

    reset(): void {
        this.summaryLines = [];
        this.summaryFingerprint.clear();
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
    }

    optimize(messages: ConversationMessage[]): OptimizationResult {
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

        const { summaryUpdated, messages: summarized } = this.summaryEnabled
            ? this.applySummaries(filtered)
            : { summaryUpdated: false, messages: filtered };

        return {
            optimized: removed > 0 || summaryUpdated,
            messages: summarized,
            removed,
            summaryUpdated,
            summaryLines: this.summaryLines.length
        };
    }

    private applySummaries(messages: ConversationMessage[]): { summaryUpdated: boolean; messages: ConversationMessage[] } {
        if (messages.length <= this.summaryThreshold) {
            return { summaryUpdated: false, messages };
        }

        const keepTail = Math.max(0, this.summaryRetention);
        const tail = messages.slice(-keepTail);
        const head = messages.slice(0, messages.length - keepTail);

        const bullets: string[] = [];
        for (let i = 0; i < head.length; i += 2) {
            const user = head[i];
            const assistant = head[i + 1];
            if (!user || user.role !== 'user' || !assistant) {
                continue;
            }

            const intent = user.content.replace(/\s+/g, ' ').trim();
            const response = assistant.content.replace(/\s+/g, ' ').trim();
            const line = `• ${intent}${response ? ` → ${response}` : ''}`;
            bullets.push(this.truncate(line));
        }

        const newSummary = bullets.join('\n');
        const hash = this.hashSummary(newSummary);
        const changed = !this.summaryFingerprint.has(hash);

        if (changed) {
            this.summaryLines = bullets;
            this.summaryFingerprint = new Set([hash]);
        }

        const summaryMessage: ConversationMessage = {
            role: 'assistant',
            content: `${this.summaryPrefix}\n${this.summaryLines.join('\n')}`.trim()
        };

        return {
            summaryUpdated: changed,
            messages: [messages[0], summaryMessage, ...tail]
        };
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
}
