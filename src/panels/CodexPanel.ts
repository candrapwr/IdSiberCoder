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
}

export interface PanelSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
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
        }, undefined, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
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
            <div class="title">IdSiberCoder</div>
            <div class="workspace" id="workspaceLabel">Workspace: unknown</div>
            <div class="header-actions">
                <button class="header-icon" id="sessionToggle" title="Sessions" aria-label="Sessions">☰</button>
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
    <section class="history" id="history"></section>
    <section class="composer">
        <textarea id="prompt" rows="3" placeholder="Ask IdSiberCoder..."></textarea>
        <div class="actions">
            <button id="send">Ask DeepSeek</button>
        </div>
    </section>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
