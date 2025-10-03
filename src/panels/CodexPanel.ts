import * as vscode from 'vscode';
export interface PromptHandler {
    (prompt: string): void;
}

export interface FileToolHandler {
    (payload: { action: string; path?: string; destination?: string; content?: string }): void;
}

export interface PanelCallbacks {
    onPrompt: PromptHandler;
    onFileTool: FileToolHandler;
    onCreateSession: () => void;
    onDeleteSession: (sessionId: string) => void;
    onSwitchSession: (sessionId: string) => void;
    onModelSelect: (selectionId: string) => void;
    onSaveApiKey: (providerId: string, apiKey: string | undefined) => void;
    onReady?: () => void;
    onOpenPanel?: () => void;
    onStopProcess?: () => void;
}

export type PanelRole = 'user' | 'assistant' | 'tool';

export interface PanelMessage {
    role: PanelRole;
    content: string;
    html?: string;
    summary?: string;
    success?: boolean;
    tokens?: number;
}

export interface PanelState {
    messages: PanelMessage[];
    workingDirectory?: string;
    sessions: PanelSession[];
    activeSessionId?: string;
    providers: PanelProvider[];
    modelOptions: PanelModelOption[];
    activeModelOptionId?: string;
    isProcessing?: boolean;
}

export interface PanelSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
}

export interface PanelProvider {
    id: string;
    label: string;
    models: Array<{ id: string; label: string }>;
    hasApiKey?: boolean;
}

export interface PanelModelOption {
    id: string;
    label: string;
    providerId: string;
    modelId: string;
}

export class CodexPanel implements vscode.Disposable {
    static readonly viewType = 'idSiberCoder.codexPanel';
    private static currentPanel: CodexPanel | undefined;

    static createOrShow(context: vscode.ExtensionContext, callbacks: PanelCallbacks): CodexPanel {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (CodexPanel.currentPanel) {
            CodexPanel.currentPanel.panel.reveal(column);
            return CodexPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            CodexPanel.viewType,
            'IdSiberCoder',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        CodexPanel.currentPanel = new CodexPanel(panel, context, callbacks);
        return CodexPanel.currentPanel;
    }

    static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, callbacks: PanelCallbacks): void {
        CodexPanel.currentPanel = new CodexPanel(panel, context, callbacks);
    }

    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly callbacks: PanelCallbacks
    ) {
        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage((message) => {
            if (message?.type === 'prompt') {
                callbacks.onPrompt(message.prompt);
            }
            if (message?.type === 'fileTool') {
                callbacks.onFileTool(message.payload);
            }
            if (message?.type === 'sessions:create') {
                callbacks.onCreateSession();
            }
            if (message?.type === 'sessions:switch' && typeof message.sessionId === 'string') {
                callbacks.onSwitchSession(message.sessionId);
            }
            if (message?.type === 'sessions:delete' && typeof message.sessionId === 'string') {
                callbacks.onDeleteSession(message.sessionId);
            }
            if (message?.type === 'model:select' && typeof message.selectionId === 'string') {
                callbacks.onModelSelect(message.selectionId);
            }
            if (
                message?.type === 'provider:apikey:set' &&
                typeof message.providerId === 'string' &&
                typeof message.apiKey === 'string'
            ) {
                callbacks.onSaveApiKey(message.providerId, message.apiKey);
            }
            if (
                message?.type === 'provider:apikey:clear' &&
                typeof message.providerId === 'string'
            ) {
                callbacks.onSaveApiKey(message.providerId, undefined);
            }
            if (message?.type === 'openPanel') {
                callbacks.onOpenPanel?.();
            }
            if (message?.type === 'stopProcess') {
                callbacks.onStopProcess?.();
            }
        }, undefined, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public reveal() {
        this.panel.reveal();
    }

    public onDidDispose(callback: () => void) {
        this.panel.onDidDispose(callback);
    }

    dispose(): void {
        CodexPanel.currentPanel = undefined;
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }
        this.panel.dispose?.();
    }

    postState(state: PanelState): void {
        this.panel.webview.postMessage({ type: 'state', state });
    }

    appendMessage(message: PanelMessage): void {
        this.panel.webview.postMessage({ type: 'message', message });
    }

    postFileResult(message: PanelMessage): void {
        this.panel.webview.postMessage({ type: 'fileResult', message });
    }

    postProcessStopped(): void {
        this.panel.webview.postMessage({ type: 'processStopped' });
    }

    setLoading(value: boolean): void {
        this.panel.webview.postMessage({ type: 'loading', value });
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.css'));

        const cspSource = webview.cspSource;

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<title>IdSiberCoder</title>
</head>
<body>
    <header class="header">
        <div class="header-row">
            <div class="workspace" id="workspaceLabel">Workspace: unknown</div>
            <div class="header-actions">
                <button class="header-icon" id="sessionToggle" title="Sessions" aria-label="Sessions">☰</button>
                <button class="header-icon" id="apiKeyToggle" title="API Keys" aria-label="API Keys">🔑</button>
                <button class="header-icon" id="openPanel" title="Open in Panel" aria-label="Open in Panel">📋</button>
            </div>
        </div>
    </header>
    <div class="sessions-overlay hidden" id="sessionsOverlay" role="dialog" aria-modal="true">
        <div class="sessions-panel">
            <div class="sessions-panel-header">
                <div class="sessions-panel-title">Chat Sessions</div>
                <div class="sessions-panel-actions">
                    <button class="sessions-new" id="sessionsCreate" aria-label="New session">New</button>
                    <button class="sessions-close" id="sessionsClose" aria-label="Close sessions">×</button>
                </div>
            </div>
            <div class="sessions-panel-list" id="sessionsPanelList"></div>
        </div>
    </div>
    <div class="apikey-overlay hidden" id="apiOverlay" role="dialog" aria-modal="true">
        <div class="apikey-panel">
            <div class="apikey-panel-header">
                <div class="apikey-panel-title">API Keys</div>
                <button class="apikey-close" id="apiClose" aria-label="Close API keys">×</button>
            </div>
            <div class="apikey-panel-body" id="apiList"></div>
        </div>
    </div>
    <section class="history" id="history"></section>
    <section class="composer">
        <textarea id="prompt" rows="3" placeholder="Ask IdSiberCoder..."></textarea>
        <div class="composer-bottom">
            <div class="composer-model">
                <select id="modelSelect" aria-label="Model"></select>
            </div>
            <div class="actions">
                <button id="send">Send</button>
            </div>
        </div>
    </section>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
