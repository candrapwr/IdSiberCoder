import type { Memento } from 'vscode';
import type { ConversationMessage } from '../context/ContextManager';

export interface SessionRecord {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ConversationMessage[];
}

export interface SessionSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'idsibercoder.sessions';
const ACTIVE_KEY = 'idsibercoder.sessions.active';

export class SessionManager {
    private sessions: SessionRecord[] = [];
    private activeSessionId: string | undefined;
    private defaultSystemPrompt = '';

    constructor(private readonly storage: Memento) {
        this.sessions = this.storage.get<SessionRecord[]>(STORAGE_KEY, []);
        this.activeSessionId = this.storage.get<string>(ACTIVE_KEY);
    }

    setDefaultSystemPrompt(prompt: string): void {
        this.defaultSystemPrompt = prompt;
    }

    ensureBootstrapped(): SessionRecord {
        if (!this.sessions.length) {
            const session = this.createSession();
            this.setActiveSession(session.id);
        }

        if (!this.activeSessionId || !this.sessions.find((session) => session.id === this.activeSessionId)) {
            this.activeSessionId = this.sessions[0]?.id;
            this.persistActiveSession();
        }

        return this.getActiveSession()!;
    }

    getSessions(): SessionRecord[] {
        return this.sessions.map((session) => ({ ...session, messages: [...session.messages] }));
    }

    getSessionSummaries(): SessionSummary[] {
        return this.sessions.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
    }

    getActiveSession(): SessionRecord | undefined {
        return this.sessions.find((session) => session.id === this.activeSessionId);
    }

    getActiveSessionId(): string | undefined {
        return this.activeSessionId;
    }

    setActiveSession(sessionId: string): void {
        if (!this.sessions.find((session) => session.id === sessionId)) {
            return;
        }
        this.activeSessionId = sessionId;
        this.persistActiveSession();
    }

    createSession(title?: string, systemPrompt?: string): SessionRecord {
        const finalTitle = title ?? 'New Chat';
        const systemMessage: ConversationMessage = {
            role: 'system',
            content: systemPrompt ?? this.defaultSystemPrompt
        };

        const now = Date.now();
        const session: SessionRecord = {
            id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
            title: finalTitle,
            createdAt: now,
            updatedAt: now,
            messages: [systemMessage]
        };

        this.sessions = [session, ...this.sessions];
        this.persistSessions();
        this.setActiveSession(session.id);
        return session;
    }

    deleteSession(sessionId: string): void {
        if (this.sessions.length <= 1) {
            return;
        }

        this.sessions = this.sessions.filter((session) => session.id !== sessionId);
        this.persistSessions();

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = this.sessions[0]?.id;
            this.persistActiveSession();
        }
    }

    updateSessionMessages(sessionId: string, messages: ConversationMessage[]): void {
        const session = this.sessions.find((item) => item.id === sessionId);
        if (!session) {
            return;
        }

        const cloned = messages.map((message) => ({ ...message }));
        session.messages = cloned;
        session.updatedAt = Date.now();

        const derivedTitle = this.deriveTitleFromMessages(cloned);
        if (derivedTitle) {
            session.title = derivedTitle;
        }
        this.persistSessions();
    }

    renameSession(sessionId: string, title: string): void {
        const session = this.sessions.find((item) => item.id === sessionId);
        if (!session) {
            return;
        }
        session.title = title.trim() || session.title;
        session.updatedAt = Date.now();
        this.persistSessions();
    }

    private deriveTitleFromMessages(messages: ConversationMessage[]): string | undefined {
        const firstMeaningful = messages.find((message) => message.role === 'user' && message.content.trim().length);
        const fallback = messages.find((message) => message.role === 'assistant' && message.content.trim().length);
        const source = firstMeaningful?.content ?? fallback?.content ?? '';
        const sanitized = source.replace(/\s+/g, ' ').trim();
        if (!sanitized) {
            return undefined;
        }
        const maxLength = 42;
        return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength).trimEnd()}…` : sanitized;
    }

    private persistSessions(): void {
        this.storage.update(STORAGE_KEY, this.sessions);
    }

    private persistActiveSession(): void {
        this.storage.update(ACTIVE_KEY, this.activeSessionId);
    }
}
