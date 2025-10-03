import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { CodexPanel, PanelMessage, PanelSession } from './panels/CodexPanel';
import { SettingsManager } from './config/SettingsManager';
import { GeneralMCPHandler } from './handlers/GeneralMCPHandler';
import { ToolRegistry } from './handlers/ToolCallHandler';
import { FileManager, FileOperationResult } from './tools/FileManager';
import { DeepSeekProvider, ToolDefinition } from './providers/DeepSeekProvider';
import type { PromptOutcome } from './handlers/GeneralMCPHandler';
import type { ConversationMessage, MessageUsage, ToolFunctionCall } from './context/ContextManager';
import { SessionManager } from './handlers/SessionManager';
import type { SessionSummary } from './handlers/SessionManager';

const SYSTEM_PROTOCOL = `# IdSiberCoder Guidelines

You are **IdSiberCoder**, an AI coding assistant embedded inside VS Code. Operate strictly within the active workspace, keep answers short, and make your intent explicit before acting.
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

const buildTooling = (fileManager: FileManager): Tooling => {
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
        )
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

    let { registry: toolRegistry, definitions: toolDefinitions } = buildTooling(fileManager);

    let cachedProvider: DeepSeekProvider | undefined;
    let cachedKey: string | undefined;
    let cachedBaseUrl = settings.baseUrl;
    let cachedModel = settings.model;

    const providerFactory = async () => {
        const apiKey = await settingsManager.ensureApiKey();
        if (!apiKey) {
            throw new Error('DeepSeek API key not configured. Set it via Settings → Extensions → IdSiberCoder.');
        }

        if (
            !cachedProvider ||
            cachedKey !== apiKey ||
            cachedBaseUrl !== settings.baseUrl ||
            cachedModel !== settings.model
        ) {
            cachedProvider = new DeepSeekProvider({
                apiKey,
                baseUrl: settings.baseUrl,
                model: settings.model
            });
            cachedKey = apiKey;
            cachedBaseUrl = settings.baseUrl;
            cachedModel = settings.model;
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
            summaryRetention: settings.contextSummaryRetention
        }
    });

    const sessionManager = new SessionManager(context.workspaceState);
    sessionManager.setDefaultSystemPrompt(systemPrompt);
    const activeSession = sessionManager.ensureBootstrapped();
    if (activeSession) {
        mcp.loadConversation(activeSession.messages);
    }

    const ensurePanel = () =>
        CodexPanel.createOrShow(context, {
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
            }
        });

    function escapeHtml(value = ''): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const formatAssistantHtml = (raw: string, toolCalls?: ToolFunctionCall[]) => {
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
            html: markdown.render(message.content)
        };
    };

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

    const buildPanelState = () => ({
        messages: renderMessagesForPanel(),
        workingDirectory: workspaceFolder,
        sessions: toPanelSessions(),
        activeSessionId: sessionManager.getActiveSessionId()
    });

    const updatePanelState = (panel: CodexPanel) => {
        panel.postState(buildPanelState());
    };

    const persistActiveSession = () => {
        const sessionId = sessionManager.getActiveSessionId();
        if (!sessionId) {
            return;
        }
        sessionManager.updateSessionMessages(sessionId, mcp.getConversation());
    };

    function handleCreateSession() {
        const session = sessionManager.createSession(undefined, systemPrompt);
        mcp.loadConversation(session.messages);
        const panel = ensurePanel();
        panel.setLoading(false);
        updatePanelState(panel);
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
        const panel = ensurePanel();
        panel.setLoading(false);
        updatePanelState(panel);
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
        const panel = ensurePanel();
        panel.setLoading(false);
        updatePanelState(panel);
    }

    const sendPanelMessage = (panel: CodexPanel, message: ConversationMessage) => {
        const renderable = toPanelMessage(message);
        if (renderable) {
            panel.appendMessage(renderable);
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
            default:
                return {};
        }
    };

    const executeFileTool = async (action: string, params: Record<string, unknown>): Promise<FileOperationResult> => {
        const result = await mcp.executeTool(action, params);
        if (isFileOperationResult(result)) {
            return result;
        }
        return {
            success: false,
            error: `Unexpected tool result shape for action ${action}`
        };
    };

    const buildToolOutputs = (action: string, result: FileOperationResult) => {
        const lines: string[] = [];
        if (result.message) {
            lines.push(result.message);
        }
        if (result.content) {
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

    async function processOutcome(outcome: PromptOutcome, panel: CodexPanel) {
        let currentOutcome: PromptOutcome | null = outcome;

        while (currentOutcome) {
            sendPanelMessage(panel, currentOutcome.message);
            updatePanelState(panel);
            persistActiveSession();

            const toolCalls = getToolCalls(currentOutcome);
            if (!toolCalls?.length) {
                break;
            }

            for (const call of toolCalls) {
                const requestedName = call?.function?.name ?? '';
                const normalizedAction = fileToolAlias[requestedName] ?? requestedName;
                if (!normalizedAction) {
                    continue;
                }

                const args = parseToolArguments(call);

                let result: FileOperationResult;
                try {
                    const params = ensureToolParameters(normalizedAction, args);
                    result = await executeFileTool(normalizedAction, params);
                } catch (error) {
                    const friendly = error instanceof Error ? error.message : String(error);
                    result = { success: false, error: friendly };
                }

                const { conversationText } = buildToolOutputs(normalizedAction, result);
                mcp.addToolResult(normalizedAction, conversationText, call?.id);
                updatePanelState(panel);
                persistActiveSession();
            }

            try {
                currentOutcome = await mcp.continueAfterTool();
            } catch (error) {
                const friendly = error instanceof Error ? error.message : String(error);
                sendPanelMessage(panel, { role: 'assistant', content: `❌ ${friendly}` });
                updatePanelState(panel);
                persistActiveSession();
                currentOutcome = null;
            }
        }
        persistActiveSession();
    }

    async function handlePrompt(prompt: string) {
        const panel = ensurePanel();
        panel.setLoading(true);
        try {
            const outcome = await mcp.handlePrompt(prompt);
            await processOutcome(outcome, panel);
        } finally {
            panel.setLoading(false);
        }
    }

    async function handleFileTool(payload: FileToolPayload) {
        const panel = ensurePanel();
        const action = fileToolAlias[payload.action] ?? payload.action;

        panel.setLoading(true);
        try {
            const params = ensureToolParameters(action, {
                file_path: payload.path,
                content: payload.content,
                source_path: payload.path,
                destination_path: payload.destination,
                dir_path: payload.path,
                edits: payload.edits
            });
            const result = await executeFileTool(action, params);
            const { panelMessage } = buildToolOutputs(action, result);
            panel.postFileResult(panelMessage);
        } catch (error: unknown) {
            const friendly = error instanceof Error ? error.message : String(error);
            panel.postFileResult({
                role: 'tool',
                content: friendly,
                html: markdown.render(friendly),
                summary: `Tool • ${action} (failed)`,
                success: false
            });
        } finally {
            panel.setLoading(false);
        }
    }

    const openPanelDisposable = vscode.commands.registerCommand('idSiberCoder.openPanel', () => {
        const panel = ensurePanel();
        updatePanelState(panel);
    });

    const sendPromptDisposable = vscode.commands.registerCommand('idSiberCoder.sendPrompt', async () => {
        const panel = ensurePanel();
        updatePanelState(panel);
        const prompt = await vscode.window.showInputBox({ prompt: 'Send prompt to IdSiberCoder' });
        if (prompt) {
            await handlePrompt(prompt);
        }
    });

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        workspaceFolder = getWorkspaceFolder();
        fileManager.setWorkspaceRoot(workspaceFolder ?? '');
        const tooling = buildTooling(fileManager);
        toolRegistry = tooling.registry;
        toolDefinitions = tooling.definitions;
        mcp.updateTools(toolRegistry, toolDefinitions);
        systemPrompt = buildSystemPrompt(workspaceFolder);
        sessionManager.setDefaultSystemPrompt(systemPrompt);
        mcp.updateSystemPrompt(systemPrompt);
        persistActiveSession();
        const panel = ensurePanel();
        updatePanelState(panel);
    });

    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('idSiberCoder')) {
            return;
        }
        settings = await settingsManager.getSettings();
        cachedProvider = undefined;
        cachedBaseUrl = settings.baseUrl;
        cachedModel = settings.model;
        mcp.updateContextOptions({
            enabled: settings.enableContextOptimization,
            summaryThreshold: settings.contextSummaryThreshold,
            summaryRetention: settings.contextSummaryRetention
        });
        mcp.resetConversation();
        sessionManager.setDefaultSystemPrompt(systemPrompt);
        persistActiveSession();
        const panel = ensurePanel();
        updatePanelState(panel);
    });

    context.subscriptions.push(
        openPanelDisposable,
        sendPromptDisposable,
        workspaceWatcher,
        configWatcher,
        { dispose: () => mcp.dispose() }
    );

    if (workspaceFolder) {
        const panel = ensurePanel();
        updatePanelState(panel);
    } else {
        vscode.window.showInformationMessage('Open a workspace folder to enable IdSiberCoder file tools.');
    }
}

export function deactivate() {
    // noop
}
