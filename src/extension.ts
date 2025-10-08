import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { CodexPanel, PanelMessage, PanelSession } from './panels/CodexPanel';
import { SidebarView } from './panels/SidebarView';
import { SettingsManager, ProviderSettingsSnapshot } from './config/SettingsManager';
import { PROVIDERS, PROVIDER_LIST, ProviderId } from './config/providers';
import { GeneralMCPHandler } from './handlers/GeneralMCPHandler';
import { ToolRegistry } from './handlers/ToolCallHandler';
import { FileManager, FileOperationResult } from './tools/FileManager';
import { TerminalManager, TerminalOperationResult } from './tools/TerminalManager';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { ZhiPuAIProvider } from './providers/ZhiPuAIProvider';
import { GrokProvider } from './providers/GrokProvider';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { NovitaAIProvider } from './providers/NovitaAIProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import type { ToolDefinition, ChatProvider } from './providers/types';
import type { PromptOutcome } from './handlers/GeneralMCPHandler';
import type { ConversationMessage, MessageUsage, ToolFunctionCall } from './context/ContextManager';
import { SessionManager } from './handlers/SessionManager';
import type { SessionSummary } from './handlers/SessionManager';

const SYSTEM_PROTOCOL = `# IdSiberCoder Guidelines

You are **IdSiberCoder**, a **highly efficient** AI coding assistant for **VS Code**.

1.  **Strictly workspace-focused:** All actions must pertain to the active VS Code workspace.
2.  **Concise response:** Keep all answers **minimal, direct, and non-verbose.**
3.  **Intent first:** Always state your explicit intent (e.g., "I will generate...") **before** performing a complex action.
`;

type FileToolPayload = {
    action: string;
    path?: string;
    destination?: string;
    content?: string;
    edits?: Array<{ find: string; replace?: string }>;
};

const fileToolAlias: Record<string, string> = {
    read: 'read_file',
    write: 'write_file',
    append: 'append_to_file',
    delete: 'delete_file',
    copy: 'copy_file',
    move: 'move_file',
    list: 'list_directory',
    edit: 'edit_file'
};

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const CONTEXT_SUMMARY_PREFIX = 'Context summary (auto-generated)';
const SUMMARY_TOKEN_THRESHOLD = 40000;

const ensureString = (value: unknown, field: string): string => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }
    throw new Error(`${field} is required`);
};

const buildSystemPrompt = (workspaceFolder?: string): string => {
    const workspaceLine = workspaceFolder
        ? `Current workspace root: ${workspaceFolder}`
        : 'No workspace folder detected. Request the user to open a folder before attempting file operations.';
    return `${SYSTEM_PROTOCOL}\n\n${workspaceLine}`;
};

interface Tooling {
    registry: ToolRegistry;
    definitions: ToolDefinition[];
}

const buildTooling = (fileManager: FileManager, terminalManager: TerminalManager): Tooling => {
    const registry: ToolRegistry = {
        read_file: async ({ file_path }) => fileManager.readFile(ensureString(file_path, 'file_path')),
        write_file: async ({ file_path, content }) => fileManager.writeFile(
            ensureString(file_path, 'file_path'),
            typeof content === 'string' ? content : String(content ?? '')
        ),
        append_to_file: async ({ file_path, content }) => fileManager.appendFile(
            ensureString(file_path, 'file_path'),
            typeof content === 'string' ? content : String(content ?? '')
        ),
        delete_file: async ({ file_path }) => fileManager.deleteFile(ensureString(file_path, 'file_path')),
        copy_file: async ({ source_path, destination_path }) => fileManager.copyFile(
            ensureString(source_path, 'source_path'),
            ensureString(destination_path, 'destination_path')
        ),
        move_file: async ({ source_path, destination_path }) => fileManager.moveFile(
            ensureString(source_path, 'source_path'),
            ensureString(destination_path, 'destination_path')
        ),
        list_directory: async ({ dir_path }) => fileManager.listDirectory(
            typeof dir_path === 'string' && dir_path.length > 0 ? dir_path : '.'
        ),
        edit_file: async ({ file_path, edits }) => fileManager.editFile(
            ensureString(file_path, 'file_path'),
            Array.isArray(edits) ? edits : []
        ),
        execute_cli: async ({ command, capture_output }) => {
            const capture = capture_output === true;
            return terminalManager.executeCommand(
                ensureString(command, 'command'),
                capture
            );
        }
    };

    const definitions: ToolDefinition[] = [
        {
            type: 'function',
            function: {
                name: 'read_file',
                description: 'Read a file relative to the workspace root.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string', description: 'Relative path to the file to read.' }
                    },
                    required: ['file_path']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_file',
                description: 'Create or overwrite a file with new content.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['file_path', 'content']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'append_to_file',
                description: 'Append content to an existing file, creating it if necessary.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['file_path', 'content']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_file',
                description: 'Delete a file from the workspace.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' }
                    },
                    required: ['file_path']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'copy_file',
                description: 'Copy a file to a new location, creating directories as needed.',
                parameters: {
                    type: 'object',
                    properties: {
                        source_path: { type: 'string' },
                        destination_path: { type: 'string' }
                    },
                    required: ['source_path', 'destination_path']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'move_file',
                description: 'Move or rename a file within the workspace.',
                parameters: {
                    type: 'object',
                    properties: {
                        source_path: { type: 'string' },
                        destination_path: { type: 'string' }
                    },
                    required: ['source_path', 'destination_path']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'list_directory',
                description: 'List the contents of a directory.',
                parameters: {
                    type: 'object',
                    properties: {
                        dir_path: { type: 'string', description: 'Directory to list. Defaults to workspace root.' }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'edit_file',
                description: 'Apply text replacements to an existing file.',
                parameters: {
                    type: 'object',
                    properties: {
                        file_path: { type: 'string' },
                        edits: {
                            type: 'array',
                            description: 'Sequential find/replace operations to apply.',
                            items: {
                                type: 'object',
                                properties: {
                                    find: { type: 'string', description: 'Exact text to replace.' },
                                    replace: { type: 'string', description: 'Replacement text.' }
                                },
                                required: ['find']
                            }
                        }
                    },
                    required: ['file_path', 'edits']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'execute_cli',
                description: 'Execute a CLI command in VS Code terminal. Only safe commands are allowed for security.',
                parameters: {
                    type: 'object',
                    properties: {
                        command: { 
                            type: 'string', 
                            description: 'The command to execute. Only basic file operations, git, npm, and project management commands are allowed.' 
                        },
                        capture_output: { 
                            type: 'boolean', 
                            description: 'Whether to capture command output. Only works for safe informational commands.' 
                        }
                    },
                    required: ['command']
                }
            }
        }
    ];

    return { registry, definitions };
};

export async function activate(context: vscode.ExtensionContext) {
    const settingsManager = new SettingsManager(context.secrets);
    let settings = await settingsManager.getSettings();

    const getWorkspaceFolder = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let workspaceFolder = getWorkspaceFolder();
    const fileManager = new FileManager(workspaceFolder ?? '');
    const terminalManager = new TerminalManager();

    let { registry: toolRegistry, definitions: toolDefinitions } = buildTooling(fileManager, terminalManager);

    let cachedProvider: ChatProvider | undefined;
    let cachedProviderId: ProviderId | undefined;
    let cachedKey: string | undefined;
    let cachedBaseUrl = settings.providers[settings.provider].baseUrl;
    let cachedModel = settings.providers[settings.provider].model;
    let cachedMaxTokens = settings.providers[settings.provider].maxTokens;

    const providerFactory = async (): Promise<ChatProvider> => {
        const providerId = settings.provider;
        const providerSettings = settings.providers[providerId];
        const apiKey = await settingsManager.ensureApiKey(providerId);
        if (!apiKey) {
            throw new Error(
                `${PROVIDERS[providerId].label} API key not configured. Use the 🔑 API Keys panel or VS Code settings to add one.`
            );
        }

        if (
            !cachedProvider ||
            cachedProviderId !== providerId ||
            cachedKey !== apiKey ||
            cachedBaseUrl !== providerSettings.baseUrl ||
            cachedModel !== providerSettings.model ||
            (cachedMaxTokens ?? 4096) !== (providerSettings.maxTokens ?? 4096)
        ) {
            if (providerId === 'deepseek') {
                cachedProvider = new DeepSeekProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'openai') {
                cachedProvider = new OpenAIProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'zhipuai') {
                cachedProvider = new ZhiPuAIProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'grok') {
                cachedProvider = new GrokProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'claude') {
                cachedProvider = new ClaudeProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'novita') {
                cachedProvider = new NovitaAIProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else if (providerId === 'gemini') {
                cachedProvider = new GeminiProvider({
                    apiKey,
                    baseUrl: providerSettings.baseUrl,
                    model: providerSettings.model,
                    maxTokens: providerSettings.maxTokens
                });
            } else {
                throw new Error(`Unsupported provider: ${providerId}`);
            }
            cachedProviderId = providerId;
            cachedKey = apiKey;
            cachedBaseUrl = providerSettings.baseUrl;
            cachedModel = providerSettings.model;
            cachedMaxTokens = providerSettings.maxTokens;
        }

        return cachedProvider;
    };

    let systemPrompt = buildSystemPrompt(workspaceFolder);

    const mcp = new GeneralMCPHandler({
        systemPrompt,
        tools: toolRegistry,
        toolDefinitions,
        providerFactory,
        contextOptions: {
            enabled: settings.enableContextOptimization,
            summaryThreshold: settings.contextSummaryThreshold,
            summaryRetention: settings.contextSummaryRetention,
            summaryTokenThreshold: SUMMARY_TOKEN_THRESHOLD
        }
    });

    const sessionManager = new SessionManager(context.workspaceState);
    sessionManager.setDefaultSystemPrompt(systemPrompt);
    const activeSession = sessionManager.ensureBootstrapped();
    if (activeSession) {
        mcp.loadConversation(activeSession.messages);
    }

    // Register sidebar view provider
    const sidebarProvider = new SidebarView(context.extensionUri, {
        onPrompt: async (prompt: string) => {
            await handlePrompt(prompt);
        },
        onFileTool: async (payload: FileToolPayload) => {
            await handleFileTool(payload);
        },
        onCreateSession: () => {
            handleCreateSession();
        },
        onDeleteSession: (sessionId: string) => {
            handleDeleteSession(sessionId);
        },
        onSwitchSession: (sessionId: string) => {
            handleSwitchSession(sessionId);
        },
        onModelSelect: (selectionId: string) => {
            handleModelSelect(selectionId);
        },
        onSaveApiKey: (providerId: string, apiKey: string | undefined) => {
            handleSaveApiKey(providerId as ProviderId, apiKey);
        },
        onReady: () => {
            // Sidebar webview is ready, update state with a small delay
            setTimeout(() => {
                updateSidebarState();
            }, 200);
        },
        onOpenPanel: () => {
            vscode.commands.executeCommand('idSiberCoder.openPanel');
        },
        onStopProcess: () => {
            if (currentProcessController) {
                currentProcessController.cancel();
                currentProcessController = undefined;
                if (currentCancellationTokenSource) {
                    currentCancellationTokenSource.cancel();
                    currentCancellationTokenSource = undefined;
                }
                sidebarProvider.setLoading(false);
                sidebarProvider.postProcessStopped();
                if (activePanel) {
                    activePanel.setLoading(false);
                    activePanel.postProcessStopped();
                }
            }
        }
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarView.viewType,
            sidebarProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true  // Kunci: Pertahankan konteks saat hidden
                }
            }
        )
    );

    function escapeHtml(value = ''): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const renderContextSummaryHtml = (raw: string) => {
        const lines = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (!lines.length) {
            return escapeHtml(raw);
        }

        const [header, ...rest] = lines;
        const items = rest.map((line) => {
            const normalized = line.replace(/^•\s*/, '').trim();
            return `<li>${escapeHtml(normalized)}</li>`;
        });

        const bodyContent = items.length
            ? `<ul class="context-summary-list">${items.join('')}</ul>`
            : '<div class="context-summary-empty">No summary captured yet.</div>';

        return `
            <details class="context-summary" data-collapsible>
                <summary>${escapeHtml(header)}</summary>
                ${bodyContent}
            </details>
        `.trim();
    };

    const formatAssistantHtml = (raw: string, toolCalls?: ToolFunctionCall[]) => {
        const trimmedRaw = raw.trim();
        if (trimmedRaw.startsWith(CONTEXT_SUMMARY_PREFIX)) {
            return {
                role: 'assistant' as PanelMessage['role'],
                content: raw,
                html: renderContextSummaryHtml(raw)
            };
        }

        const lines = raw.split(/\r?\n/);
        const thinkLines: string[] = [];
        const responseLines: string[] = [];
        let toolCallPayload = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            if (/^THINK:/i.test(trimmed)) {
                thinkLines.push(trimmed.replace(/^THINK:\s*/i, ''));
                continue;
            }
            if (/^TOOLCALL:/i.test(trimmed)) {
                toolCallPayload = trimmed.replace(/^TOOLCALL:\s*/i, '');
                continue;
            }
            responseLines.push(line);
        }

        const htmlParts: string[] = [];

        const renderToolCallSegment = (label: string, rawArgs: string) => {
            let renderedContent = '<div class="assistant-toolcall-empty">Tidak ada parameter</div>';

            if (rawArgs && rawArgs.trim()) {
                try {
                    const parsed = JSON.parse(rawArgs);
                    renderedContent = `<pre class="assistant-toolcall-json">${escapeHtml(
                        JSON.stringify(parsed, null, 2)
                    )}</pre>`;
                } catch (error) {
                    renderedContent = `<pre class="assistant-toolcall-json">${escapeHtml(rawArgs)}</pre>`;
                }
            }

            return `<div class="assistant-segment assistant-toolcall">
                <details class="assistant-toolcall-card">
                    <summary>
                        <span class="assistant-toolcall-title">${escapeHtml(label)}</span>
                    </summary>
                    <div class="assistant-toolcall-body">${renderedContent}</div>
                </details>
            </div>`;
        };

        if (thinkLines.length) {
            htmlParts.push(
                `<div class="assistant-segment assistant-think"><span class="assistant-chip">Think</span>${markdown.render(thinkLines.join('\n'))}</div>`
            );
        }

        if (toolCalls && toolCalls.length) {
            for (const call of toolCalls ?? []) {
                const name = call?.function?.name ?? 'tool_call';
                const rawArgs = call?.function?.arguments ?? '';
                htmlParts.push(renderToolCallSegment(`Tool • ${name}`, rawArgs ?? ''));
            }
        } else if (toolCallPayload) {
            htmlParts.push(renderToolCallSegment('Tool Call', toolCallPayload));
        }

        if (responseLines.length) {
            htmlParts.push(
                `<div class="assistant-segment assistant-response">${markdown.render(responseLines.join('\n'))}</div>`
            );
        }

        const textContent = responseLines.join('\n').trim();

        return {
            role: 'assistant' as PanelMessage['role'],
            content: textContent || raw,
            html: htmlParts.join('') || markdown.render(raw)
        };
    };

    const toPanelMessage = (message: ConversationMessage): PanelMessage | null => {
        if (message.role === 'system') {
            return null;
        }

        if (message.role === 'tool' && message.content.startsWith('Tool result for ')) {
            const [headline, ...rest] = message.content.split('\n');
            const actionMatch = headline.match(/^Tool result for (.+?):\s*(.*)$/);
            const actionName = actionMatch?.[1] ?? 'tool';
            const statusFragment = actionMatch?.[2] ?? '';
            const bodyText = rest.join('\n').trim();
            const success = !statusFragment.includes('FAILED');
            const summary = success
                ? `Tool • ${actionName} (success)`
                : `Tool • ${actionName} (failed)`;
            const html = bodyText
                ? markdown.render(bodyText)
                : statusFragment
                    ? markdown.render(statusFragment)
                    : markdown.render(headline);

            return {
                role: 'tool',
                content: bodyText || statusFragment || headline,
                html,
                summary,
                success
            };
        }

        if (message.role === 'assistant') {
            const panelMessage = formatAssistantHtml(message.content ?? '', message.toolCalls);
            (panelMessage as PanelMessage).tokens = message.usage?.totalTokens;
            return panelMessage;
        }

        return {
            role: message.role as PanelMessage['role'],
            content: message.content,
            html: message.role === 'user' ? `<div style="white-space: pre-wrap;">${escapeHtml(message.content)}</div>` : markdown.render(message.content)
        };
    };

    const countTokens = (message: ConversationMessage): number => {
        const usage = message.usage;
        if (!usage) {
            return 0;
        }
        if (typeof usage.totalTokens === 'number') {
            return usage.totalTokens;
        }
        const prompt = typeof usage.promptTokens === 'number' ? usage.promptTokens : 0;
        const completion = typeof usage.completionTokens === 'number' ? usage.completionTokens : 0;
        return prompt + completion;
    };

    const computeTotalTokens = (): number =>
        mcp
            .getConversation()
            .reduce((total, message) => total + countTokens(message), 0);

    const renderMessagesForPanel = (): PanelMessage[] =>
        mcp
            .getConversation()
            .map((entry) => toPanelMessage(entry))
            .filter((message): message is PanelMessage => message !== null);

    const toPanelSessions = (): PanelSession[] =>
        sessionManager.getSessionSummaries().map((session: SessionSummary) => ({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
        }));

    const toPanelProviders = () =>
        PROVIDER_LIST.map((provider) => ({
            id: provider.id,
            label: provider.label,
            models: provider.models.map((model) => ({ ...model })),
            hasApiKey: Boolean(settings.apiKeys?.[provider.id])
        }));

    const MODEL_OPTION_SEPARATOR = '::';

    const toPanelModelOptions = () =>
        PROVIDER_LIST.flatMap((provider) =>
            provider.models.map((model) => ({
                id: `${provider.id}${MODEL_OPTION_SEPARATOR}${model.id}`,
                label: `${model.label} (${provider.label})`,
                providerId: provider.id,
                modelId: model.id
            }))
        );

    const buildPanelState = () => ({
        messages: renderMessagesForPanel(),
        workingDirectory: workspaceFolder,
        sessions: toPanelSessions(),
        activeSessionId: sessionManager.getActiveSessionId(),
        providers: toPanelProviders(),
        modelOptions: toPanelModelOptions(),
        activeModelOptionId: `${settings.provider}${MODEL_OPTION_SEPARATOR}${settings.providers[settings.provider]?.model}`,
        totalTokens: computeTotalTokens()
    });

    const updateSidebarState = () => {
        sidebarProvider.postState(buildPanelState());
    };

    const persistActiveSession = () => {
        const sessionId = sessionManager.getActiveSessionId();
        if (!sessionId) {
            return;
        }
        sessionManager.updateSessionMessages(sessionId, mcp.getConversation());
    };

    const refreshSettings = async () => {
        settings = await settingsManager.getSettings();
        cachedProvider = undefined;
        cachedProviderId = undefined;
        cachedKey = undefined;
        cachedBaseUrl = settings.providers[settings.provider].baseUrl;
        cachedModel = settings.providers[settings.provider].model;
        cachedMaxTokens = settings.providers[settings.provider].maxTokens;
    };

    function handleCreateSession() {
        const session = sessionManager.createSession(undefined, systemPrompt);
        mcp.loadConversation(session.messages);
        sidebarProvider.setLoading(false);
        updateSidebarState();
    }

    function handleSwitchSession(sessionId: string) {
        if (sessionManager.getActiveSessionId() === sessionId) {
            return;
        }
        persistActiveSession();
        sessionManager.setActiveSession(sessionId);
        const session = sessionManager.getActiveSession();
        if (session) {
            mcp.loadConversation(session.messages);
        }
        sidebarProvider.setLoading(false);
        updateSidebarState();
    }

    function handleDeleteSession(sessionId: string) {
        const isActive = sessionManager.getActiveSessionId() === sessionId;
        if (isActive) {
            persistActiveSession();
        }
        sessionManager.deleteSession(sessionId);
        const session = sessionManager.getActiveSession();
        if (session) {
            mcp.loadConversation(session.messages);
        }
        sidebarProvider.setLoading(false);
        updateSidebarState();
    }

    async function handleModelSelect(selectionId: string) {
        const [providerIdRaw, modelId] = selectionId.split(MODEL_OPTION_SEPARATOR);
        if (!providerIdRaw || !modelId) {
            vscode.window.showWarningMessage(`Model option ${selectionId} is not recognised.`);
            return;
        }
        const providerId = providerIdRaw as ProviderId;
        const metadata = PROVIDERS[providerId];
        if (!metadata) {
            vscode.window.showWarningMessage(`Unsupported provider: ${providerIdRaw}`);
            return;
        }
        if (!metadata.models.some((model) => model.id === modelId)) {
            vscode.window.showWarningMessage(`Model ${modelId} is not available for ${metadata.label}.`);
            return;
        }

        // Update local snapshot immediately so UI refreshes without waiting on configuration writes.
        const currentProviderConfig: ProviderSettingsSnapshot = settings.providers[providerId] ?? {
            baseUrl: metadata.defaultBaseUrl,
            model: metadata.defaultModel
        };

        const providerChanged = settings.provider !== providerId;
        const modelChanged = currentProviderConfig.model !== modelId;

        settings.provider = providerId;
        settings.providers[providerId] = {
            baseUrl: currentProviderConfig.baseUrl ?? metadata.defaultBaseUrl,
            model: modelId,
            maxTokens: currentProviderConfig.maxTokens ?? metadata.defaultMaxTokens
        };

        cachedProvider = undefined;
        cachedProviderId = undefined;
        cachedKey = undefined;
        cachedBaseUrl = settings.providers[providerId].baseUrl;
        cachedModel = settings.providers[providerId].model;

        if (providerChanged) {
            await settingsManager.updateProvider(providerId);
        }
        if (modelChanged || providerChanged) {
            await settingsManager.updateModel(providerId, modelId);
        }
        await refreshSettings();
        sidebarProvider.setLoading(false);
        updateSidebarState();
    }

    async function handleSaveApiKey(providerId: ProviderId, apiKey?: string) {
        if (!PROVIDERS[providerId]) {
            vscode.window.showWarningMessage(`Unsupported provider: ${providerId}`);
            return;
        }

        if (apiKey && apiKey.trim()) {
            await settingsManager.setApiKey(providerId, apiKey.trim());
            vscode.window.showInformationMessage(`${PROVIDERS[providerId].label} API key saved.`);
        } else {
            await settingsManager.setApiKey(providerId, undefined);
            vscode.window.showInformationMessage(`${PROVIDERS[providerId].label} API key cleared.`);
        }

        await refreshSettings();
        sidebarProvider.setLoading(false);
        updateSidebarState();
    }

    const sendSidebarMessage = (message: ConversationMessage) => {
        const renderable = toPanelMessage(message);
        if (renderable) {
            sidebarProvider.appendMessage(renderable);
        }
    };

    const isFileOperationResult = (value: unknown): value is FileOperationResult => {
        if (!value || typeof value !== 'object') {
            return false;
        }
        const candidate = value as Partial<FileOperationResult>;
        return typeof candidate.success === 'boolean';
    };

    const getToolCalls = (outcome: PromptOutcome) =>
        outcome.toolCalls ?? outcome.message.toolCalls ?? [];

    const parseToolArguments = (toolCall?: ToolFunctionCall) => {
        try {
            const args = toolCall?.function?.arguments;
            if (typeof args === 'string' && args.trim()) {
                return JSON.parse(args);
            }
        } catch (error) {
            console.warn('Failed to parse tool call arguments:', error);
        }
        return {} as Record<string, unknown>;
    };

    const ensureToolParameters = (action: string, parameters: Record<string, unknown>): Record<string, unknown> => {
        switch (action) {
            case 'read_file':
            case 'delete_file':
                {
                    const pathValue =
                        parameters.file_path ?? parameters.path ?? parameters.directory ?? parameters.target;
                    return { file_path: pathValue };
                }
            case 'write_file':
            case 'append_to_file':
                return {
                    file_path: parameters.file_path ?? parameters.path ?? parameters.target,
                    content: parameters.content ?? ''
                };
            case 'copy_file':
            case 'move_file':
                return {
                    source_path: parameters.source_path ?? parameters.path ?? parameters.from,
                    destination_path:
                        parameters.destination_path ?? parameters.destination ?? parameters.to
                };
            case 'list_directory':
                {
                    const dir = parameters.dir_path ?? parameters.directory ?? parameters.path ?? parameters.target;
                    return { dir_path: typeof dir === 'string' && dir.length > 0 ? dir : '.' };
                }
            case 'edit_file':
                return {
                    file_path: parameters.file_path ?? parameters.path ?? parameters.target,
                    edits: Array.isArray(parameters.edits)
                        ? parameters.edits
                              .map((edit: any) => ({
                                  find: typeof edit?.find === 'string' ? edit.find : '',
                                  replace: typeof edit?.replace === 'string' ? edit.replace : ''
                              }))
                              .filter((edit) => edit.find.length > 0)
                        : []
                };
            case 'execute_cli':
                return {
                    command: parameters.command ?? '',
                    capture_output: parameters.capture_output === true
                };
            default:
                return {};
        }
    };

    const isTerminalOperationResult = (value: unknown): value is TerminalOperationResult => {
        if (!value || typeof value !== 'object') {
            return false;
        }
        const candidate = value as Partial<TerminalOperationResult>;
        return typeof candidate.success === 'boolean';
    };

    const executeTool = async (action: string, params: Record<string, unknown>): Promise<FileOperationResult | TerminalOperationResult> => {
        const result = await mcp.executeTool(action, params);
        if (isFileOperationResult(result) || isTerminalOperationResult(result)) {
            return result;
        }
        return {
            success: false,
            error: `Unexpected tool result shape for action ${action}`
        };
    };

    const buildToolOutputs = (action: string, result: FileOperationResult | TerminalOperationResult) => {
        const lines: string[] = [];
        
        // Handle TerminalOperationResult specifically
        if ('output' in result && result.output) {
            lines.push(result.output);
        }
        
        if (result.message) {
            lines.push(result.message);
        }
        
        if ('content' in result && result.content) {
            lines.push(result.content);
        }
        
        if (!result.success && result.error) {
            lines.push(`Error: ${result.error}`);
        }

        const bodyText = lines.join('\n').trim();
        const conversationText = bodyText
            ? `Tool result for ${action}:\n${bodyText}`
            : result.success
                ? `Tool result for ${action}: Success`
                : `Tool result for ${action}: FAILED - ${result.error ?? 'Unknown error'}`;

        const displayText = bodyText || (result.success ? 'Success' : result.error ?? 'No output');

        const markdownBody = bodyText.includes('\n')
            ? bodyText
                  .split('\n')
                  .map((line) => {
                      const trimmed = line.trim();
                      if (!trimmed) {
                          return '';
                      }
                      if (/^[-*]\s+/.test(trimmed)) {
                          return trimmed;
                      }
                      return `- ${trimmed}`;
                  })
                  .filter(Boolean)
                  .join('\n')
            : displayText;

        const summary = result.success
            ? `Tool • ${action} (success)`
            : `Tool • ${action} (failed)`;

        const panelMessage: PanelMessage = {
            role: 'tool',
            content: displayText,
            html: markdown.render(markdownBody),
            summary,
            success: result.success
        };

        return { conversationText, panelMessage };
    };

    async function processOutcome(outcome: PromptOutcome, cancelToken?: vscode.CancellationToken) {
        let currentOutcome: PromptOutcome | null = outcome;

        while (currentOutcome) {
            sendSidebarMessage(currentOutcome.message);
            updateSidebarState();
            persistActiveSession();

            // Check for cancellation before processing tool calls
            if (cancelToken?.isCancellationRequested) {
                console.log('Process outcome cancelled during tool processing');
                return;
            }

            const toolCalls = getToolCalls(currentOutcome);
            if (!toolCalls?.length) {
                break;
            }

            for (const call of toolCalls) {
                // Check for cancellation before each tool execution
                if (cancelToken?.isCancellationRequested) {
                    console.log('Process outcome cancelled during tool execution');
                    return;
                }

                const requestedName = call?.function?.name ?? '';
                const normalizedAction = fileToolAlias[requestedName] ?? requestedName;
                if (!normalizedAction) {
                    continue;
                }

                const args = parseToolArguments(call);

                let result: FileOperationResult | TerminalOperationResult;
                try {
                    const params = ensureToolParameters(normalizedAction, args);
                    result = await executeTool(normalizedAction, params);
                } catch (error) {
                    const friendly = error instanceof Error ? error.message : String(error);
                    result = { success: false, error: friendly };
                }

                const { conversationText } = buildToolOutputs(normalizedAction, result);
                mcp.addToolResult(normalizedAction, conversationText, call?.id);
                updateSidebarState();
                persistActiveSession();
            }

            try {
                // Check for cancellation before continuing
                if (cancelToken?.isCancellationRequested) {
                    console.log('Process outcome cancelled before continuing');
                    return;
                }
                currentOutcome = await mcp.continueAfterTool(cancelToken);
            } catch (error) {
                const friendly = error instanceof Error ? error.message : String(error);
                sendSidebarMessage({ role: 'assistant', content: `❌ ${friendly}` });
                updateSidebarState();
                persistActiveSession();
                currentOutcome = null;
            }
        }
        persistActiveSession();
    }

    async function handlePrompt(prompt: string) {
        sidebarProvider.setLoading(true);
        
        // Create cancellation controller for this process
        const cancellationTokenSource = new vscode.CancellationTokenSource();
        const controller = {
            cancel: () => {
                cancellationTokenSource.cancel();
                console.log('Cancellation requested for prompt processing');
            }
        };
        
        currentProcessController = controller;
        currentCancellationTokenSource = cancellationTokenSource;
        
        try {
            const outcome = await mcp.handlePrompt(prompt, cancellationTokenSource.token);
            
            // Check if cancellation was requested during the request
            if (cancellationTokenSource.token.isCancellationRequested) {
                console.log('Prompt processing cancelled during request');
                sidebarProvider.postProcessStopped();
                if (activePanel) {
                    activePanel.postProcessStopped();
                }
                return;
            }
            
            await processOutcome(outcome, cancellationTokenSource.token);
        } catch (error: unknown) {
            // Check if the error is due to cancellation
            if (cancellationTokenSource.token.isCancellationRequested) {
                console.log('Prompt processing cancelled with error');
                sidebarProvider.postProcessStopped();
                if (activePanel) {
                    activePanel.postProcessStopped();
                }
                return;
            }
            
            const friendly = error instanceof Error ? error.message : String(error);
            console.error('Error in handlePrompt:', friendly);
            sendSidebarMessage({ role: 'assistant', content: `❌ ${friendly}` });
            updateSidebarState();
            persistActiveSession();
        } finally {
            sidebarProvider.setLoading(false);
            if (currentProcessController === controller) {
                currentProcessController = undefined;
            }
            if (currentCancellationTokenSource === cancellationTokenSource) {
                currentCancellationTokenSource = undefined;
            }
        }
    }

    async function handleFileTool(payload: FileToolPayload) {
        const action = fileToolAlias[payload.action] ?? payload.action;

        sidebarProvider.setLoading(true);
        
        // Create cancellation controller for this process
        const cancellationTokenSource = new vscode.CancellationTokenSource();
        const controller = {
            cancel: () => {
                cancellationTokenSource.cancel();
                console.log('Cancellation requested for file tool processing');
            }
        };
        
        currentProcessController = controller;
        currentCancellationTokenSource = cancellationTokenSource;
        
        try {
            const params = ensureToolParameters(action, {
                file_path: payload.path,
                content: payload.content,
                source_path: payload.path,
                destination_path: payload.destination,
                dir_path: payload.path,
                edits: payload.edits
            });
            const result = await executeTool(action, params);
            
            // Check if cancellation was requested during the request
            if (cancellationTokenSource.token.isCancellationRequested) {
                console.log('File tool processing cancelled during request');
                sidebarProvider.postProcessStopped();
                if (activePanel) {
                    activePanel.postProcessStopped();
                }
                return;
            }
            
            const { panelMessage } = buildToolOutputs(action, result);
            sidebarProvider.postFileResult(panelMessage);
        } catch (error: unknown) {
            // Check if the error is due to cancellation
            if (cancellationTokenSource.token.isCancellationRequested) {
                console.log('File tool processing cancelled with error');
                sidebarProvider.postProcessStopped();
                if (activePanel) {
                    activePanel.postProcessStopped();
                }
                return;
            }
            
            const friendly = error instanceof Error ? error.message : String(error);
            console.error('Error in handleFileTool:', friendly);
            sidebarProvider.postFileResult({
                role: 'tool',
                content: friendly,
                html: markdown.render(friendly),
                summary: `Tool • ${action} (failed)`,
                success: false
            });
        } finally {
            sidebarProvider.setLoading(false);
            if (currentProcessController === controller) {
                currentProcessController = undefined;
            }
            if (currentCancellationTokenSource === cancellationTokenSource) {
                currentCancellationTokenSource = undefined;
            }
        }
    }

    let activePanel: CodexPanel | undefined;
    let currentProcessController: { cancel: () => void } | undefined;
    let currentCancellationTokenSource: vscode.CancellationTokenSource | undefined;

    const openSidebarDisposable = vscode.commands.registerCommand('idSiberCoder.openSidebar', () => {
        vscode.commands.executeCommand('workbench.view.extension.idSiberCoder');
        updateSidebarState();
    });

    const openPanelDisposable = vscode.commands.registerCommand('idSiberCoder.openPanel', () => {
        if (activePanel) {
            activePanel.reveal();
            return;
        }

        activePanel = CodexPanel.createOrShow(context, {
            onPrompt: async (prompt: string) => {
                await handlePrompt(prompt);
            },
            onFileTool: async (payload: FileToolPayload) => {
                await handleFileTool(payload);
            },
            onCreateSession: () => {
                handleCreateSession();
            },
            onDeleteSession: (sessionId: string) => {
                handleDeleteSession(sessionId);
            },
            onSwitchSession: (sessionId: string) => {
                handleSwitchSession(sessionId);
            },
            onModelSelect: (selectionId: string) => {
                handleModelSelect(selectionId);
            },
            onSaveApiKey: (providerId: string, apiKey: string | undefined) => {
                handleSaveApiKey(providerId as ProviderId, apiKey);
            },
            onReady: () => {
                // Panel webview is ready, update state with a small delay
                setTimeout(() => {
                    if (activePanel) {
                        activePanel.postState(buildPanelState());
                    }
                }, 200);
            },
            onStopProcess: () => {
                if (currentProcessController) {
                    currentProcessController.cancel();
                    currentProcessController = undefined;
                    if (currentCancellationTokenSource) {
                        currentCancellationTokenSource.cancel();
                        currentCancellationTokenSource = undefined;
                    }
                    sidebarProvider.setLoading(false);
                    sidebarProvider.postProcessStopped();
                    if (activePanel) {
                        activePanel.setLoading(false);
                        activePanel.postProcessStopped();
                    }
                }
            }
        });

        // Update panel state immediately after creation
        setTimeout(() => {
            if (activePanel) {
                activePanel.postState(buildPanelState());
            }
        }, 100);

        activePanel.onDidDispose(() => {
            activePanel = undefined;
        });
    });

    const sendPromptDisposable = vscode.commands.registerCommand('idSiberCoder.sendPrompt', async () => {
        updateSidebarState();
        const prompt = await vscode.window.showInputBox({ prompt: 'Send prompt to IdSiberCoder' });
        if (prompt) {
            await handlePrompt(prompt);
        }
    });

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        workspaceFolder = getWorkspaceFolder();
        fileManager.setWorkspaceRoot(workspaceFolder ?? '');
        const tooling = buildTooling(fileManager, terminalManager);
        toolRegistry = tooling.registry;
        toolDefinitions = tooling.definitions;
        mcp.updateTools(toolRegistry, toolDefinitions);
        systemPrompt = buildSystemPrompt(workspaceFolder);
        sessionManager.setDefaultSystemPrompt(systemPrompt);
        mcp.updateSystemPrompt(systemPrompt);
        persistActiveSession();
        updateSidebarState();
    });

    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('idSiberCoder')) {
            return;
        }
        const contextSettingsChanged =
            event.affectsConfiguration('idSiberCoder.enableContextOptimization') ||
            event.affectsConfiguration('idSiberCoder.contextSummaryThreshold') ||
            event.affectsConfiguration('idSiberCoder.contextSummaryRetention');

        await refreshSettings();

        if (contextSettingsChanged) {
            mcp.updateContextOptions({
                enabled: settings.enableContextOptimization,
                summaryThreshold: settings.contextSummaryThreshold,
                summaryRetention: settings.contextSummaryRetention,
                summaryTokenThreshold: SUMMARY_TOKEN_THRESHOLD
            });
        }

        persistActiveSession();
        updateSidebarState();
    });

    context.subscriptions.push(
        openSidebarDisposable,
        openPanelDisposable,
        sendPromptDisposable,
        workspaceWatcher,
        configWatcher,
        { dispose: () => mcp.dispose() }
    );

    // Always update sidebar state on activation
    updateSidebarState();
    
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('Open a workspace folder to enable IdSiberCoder file tools.');
    }
}

export function deactivate() {
    // noop
}
