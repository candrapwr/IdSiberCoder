import * as vscode from 'vscode';
import {
    PanelCallbacks,
    PanelMessage,
    PanelState,
    initializeCodexWebview
} from './CodexPanel';

export class CodexViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewType = 'idSiberCoder.assistantView';

    private webviewView: vscode.WebviewView | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private latestState: PanelState | undefined;
    private pendingMessages: PanelMessage[] = [];
    private pendingFileResults: PanelMessage[] = [];
    private loadingState: boolean | undefined;
    private ready = false;
    private pingTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly callbacks: PanelCallbacks
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        initializeCodexWebview(webviewView.webview, this.context, this.callbacks, this.disposables);

        webviewView.onDidDispose(() => this.disposeWebview(), null, this.disposables);

        // trigger a handshake so the webview can reply with `webview:ready`/`pong`
        this.sendPing();
        this.pingTimer = setInterval(() => this.sendPing(), 500);
    }

    dispose(): void {
        this.disposeWebview();
    }

    postState(state: PanelState): void {
        this.latestState = state;
        if (this.webviewView) {
            this.webviewView.webview.postMessage({ type: 'state', state });
        }
    }

    appendMessage(message: PanelMessage): void {
        if (this.webviewView) {
            this.webviewView.webview.postMessage({ type: 'message', message });
            return;
        }
        this.pendingMessages.push(message);
    }

    postFileResult(message: PanelMessage): void {
        if (this.webviewView) {
            this.webviewView.webview.postMessage({ type: 'fileResult', message });
            return;
        }
        this.pendingFileResults.push(message);
    }

    setLoading(value: boolean): void {
        this.loadingState = value;
        if (this.webviewView) {
            this.webviewView.webview.postMessage({ type: 'loading', value });
        }
    }

    isResolved(): boolean {
        return Boolean(this.webviewView);
    }

    notifyReady(): void {
        this.ready = true;
        this.stopPing();
        this.flushState();
        this.flushMessages();
        this.flushFileResults();
        this.flushLoading();
    }

    private disposeWebview(): void {
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }
        this.webviewView = undefined;
        this.ready = false;
        this.stopPing();
    }

    private flushState() {
        if (this.webviewView && this.latestState && this.ready) {
            this.webviewView.webview.postMessage({ type: 'state', state: this.latestState });
        }
    }

    private flushMessages() {
        if (!this.webviewView || !this.pendingMessages.length || !this.ready) {
            return;
        }
        for (const message of this.pendingMessages) {
            this.webviewView.webview.postMessage({ type: 'message', message });
        }
        this.pendingMessages = [];
    }

    private flushFileResults() {
        if (!this.webviewView || !this.pendingFileResults.length || !this.ready) {
            return;
        }
        for (const message of this.pendingFileResults) {
            this.webviewView.webview.postMessage({ type: 'fileResult', message });
        }
        this.pendingFileResults = [];
    }

    private flushLoading() {
        if (this.webviewView && this.loadingState !== undefined && this.ready) {
            this.webviewView.webview.postMessage({ type: 'loading', value: this.loadingState });
        }
    }

    private sendPing() {
        if (this.webviewView) {
            this.webviewView.webview.postMessage({ type: 'ping' });
        }
    }

    private stopPing() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
    }
}
