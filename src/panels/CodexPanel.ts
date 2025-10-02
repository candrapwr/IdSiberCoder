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
        <div class="title">IdSiberCoder</div>
        <div class="workspace" id="workspaceLabel">Workspace: unknown</div>
    </header>
    <section class="history" id="history"></section>
    <div class="loading hidden" id="loadingIndicator">
        <div class="spinner"></div>
        <span>Processing…</span>
    </div>
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
