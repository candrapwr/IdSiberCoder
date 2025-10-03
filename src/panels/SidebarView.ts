import * as vscode from 'vscode';
import { PanelCallbacks, PanelState, PanelMessage } from './CodexPanel';

export interface SidebarCallbacks extends PanelCallbacks {
    onReady?: () => void;
    onOpenPanel?: () => void;
    onStopProcess?: () => void;
}

export class SidebarView implements vscode.WebviewViewProvider {
    public static readonly viewType = 'idSiberCoder-sidebar';

    private _view?: vscode.WebviewView;
    private _extensionUri: vscode.Uri;
    private _callbacks: SidebarCallbacks;

    constructor(extensionUri: vscode.Uri, callbacks: SidebarCallbacks) {
        this._extensionUri = extensionUri;
        this._callbacks = callbacks;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'ready':
                    this._callbacks.onReady?.();
                    break;
                case 'prompt':
                    this._callbacks.onPrompt?.(data.prompt);
                    break;
                case 'fileTool':
                    this._callbacks.onFileTool?.(data.payload);
                    break;
                case 'sessions:create':
                    this._callbacks.onCreateSession?.();
                    break;
                case 'sessions:delete':
                    this._callbacks.onDeleteSession?.(data.sessionId);
                    break;
                case 'sessions:switch':
                    this._callbacks.onSwitchSession?.(data.sessionId);
                    break;
                case 'model:select':
                    this._callbacks.onModelSelect?.(data.selectionId);
                    break;
                case 'provider:apikey:set':
                    this._callbacks.onSaveApiKey?.(data.providerId, data.apiKey);
                    break;
                case 'provider:apikey:clear':
                    this._callbacks.onSaveApiKey?.(data.providerId, '');
                    break;
                case 'openPanel':
                    this._callbacks.onOpenPanel?.();
                    break;
                case 'stopProcess':
                    this._callbacks.onStopProcess?.();
                    break;
            }
        });
    }

    public postState(state: PanelState): void {
        this._view?.webview.postMessage({ type: 'state', state });
    }

    public appendMessage(message: PanelMessage): void {
        this._view?.webview.postMessage({ type: 'message', message });
    }

    public postFileResult(message: PanelMessage): void {
        this._view?.webview.postMessage({ type: 'fileResult', message });
    }

    public postProcessStopped(): void {
        this._view?.webview.postMessage({ type: 'processStopped' });
    }

    public setLoading(value: boolean): void {
        this._view?.webview.postMessage({ type: 'loading', value });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css'));

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