const vscode = acquireVsCodeApi();

const historyEl = document.getElementById('history');
const promptEl = document.getElementById('prompt');
const sendButton = document.getElementById('send');
const workspaceLabel = document.getElementById('workspaceLabel');
const modelSelect = document.getElementById('modelSelect');
const tokenUsageLabel = document.getElementById('tokenUsageLabel');
const sessionToggleButton = document.getElementById('sessionToggle');
const sessionsOverlay = document.getElementById('sessionsOverlay');
const sessionsListEl = document.getElementById('sessionsPanelList');
const sessionsCreateButton = document.getElementById('sessionsCreate');
const sessionsCloseButton = document.getElementById('sessionsClose');
const apiKeyToggleButton = document.getElementById('apiKeyToggle');
const apiOverlay = document.getElementById('apiOverlay');
const apiCloseButton = document.getElementById('apiClose');
const apiListEl = document.getElementById('apiList');
const openPanelButton = document.getElementById('openPanel');
const restartExtensionButton = document.getElementById('restartExtension');

const SCROLL_THRESHOLD = 24;
let shouldAutoScroll = true;
let isProgrammaticScroll = false;

const setProgrammaticScroll = (value) => {
    isProgrammaticScroll = value;
};

const isHistoryAtBottom = () => {
    if (!historyEl) {
        return true;
    }
    const distanceFromBottom = historyEl.scrollHeight - historyEl.scrollTop - historyEl.clientHeight;
    return distanceFromBottom <= SCROLL_THRESHOLD;
};

let baseMessages = [];
const extraMessages = [];
let isLoading = false;
let sessions = [];
let activeSessionId;
let sessionsOpen = false;
let modelOptions = [];
let activeModelOptionId;
let providerInfos = [];
let apiOverlayOpen = false;
let isStopping = false;
let totalTokenUsage = 0;

if (historyEl) {
    historyEl.addEventListener('scroll', () => {
        if (isProgrammaticScroll) {
            return;
        }
        shouldAutoScroll = isHistoryAtBottom();
    });
}

const escapeHtml = (value = '') =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

const scrollHistoryToBottom = () => {
    if (!historyEl) {
        return;
    }
    setProgrammaticScroll(true);
    historyEl.scrollTop = historyEl.scrollHeight;
    setTimeout(() => setProgrammaticScroll(false), 0);
};

const ROLE_LABELS = {
    user: 'You',
    assistant: 'IdSiberCoder',
    tool: 'Tool'
};

const formatTokens = (value = 0) => {
    if (!value || value <= 0) {
        return '0';
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return value.toLocaleString('id-ID');
};

const updateTokenUsageLabel = () => {
    if (!tokenUsageLabel) {
        return;
    }
    if (!totalTokenUsage) {
        tokenUsageLabel.textContent = 'Tokens 0';
        tokenUsageLabel.classList.add('is-empty');
        return;
    }
    tokenUsageLabel.textContent = `Tokens ${formatTokens(totalTokenUsage)}`;
    tokenUsageLabel.classList.remove('is-empty');
};

const renderMessage = (message, index, total) => {
    const container = document.createElement('article');
    container.className = 'timeline-entry';
    container.dataset.role = message.role;

    if (index === 0) {
        container.classList.add('is-first');
    }
    if (index === total - 1) {
        container.classList.add('is-last');
    }

    const card = document.createElement('div');
    card.className = 'timeline-card';

    if (message.role === 'tool') {
        card.classList.add('timeline-card-tool');

        const details = document.createElement('details');
        details.className = `tool-card ${message.success === false ? 'tool-failed' : 'tool-success'}`;

        const summary = document.createElement('summary');
        summary.textContent = message.summary || 'Tool result';
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'tool-body';
        body.innerHTML = message.html || escapeHtml(message.content || '');
        details.appendChild(body);

        card.appendChild(details);
    } else {
        const header = document.createElement('div');
        header.className = 'timeline-header';

        const roleLabel = document.createElement('span');
        roleLabel.className = 'timeline-role';
        roleLabel.textContent = ROLE_LABELS[message.role] ?? message.role.toUpperCase();
        header.appendChild(roleLabel);

        if (typeof message.tokens === 'number' && message.tokens > 0) {
            const chip = document.createElement('span');
            chip.className = 'timeline-chip timeline-chip-usage';
            chip.textContent = `Tokens: ${message.tokens.toLocaleString('id-ID')}`;
            header.appendChild(chip);
        }

        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'timeline-body';
        body.innerHTML = message.html || escapeHtml(message.content || '');
        card.appendChild(body);
    }

    container.appendChild(card);

    return container;
};

const renderWelcomeScreen = () => {
    const welcomeContainer = document.createElement('div');
    welcomeContainer.className = 'welcome-screen';
    welcomeContainer.innerHTML = `
        <div class="welcome-content">
            <div class="welcome-icon">🤖</div>
            <h2 class="welcome-title">IdSiberCoder</h2>
            <p class="welcome-description">
                Ask me anything about coding, debugging, or technical solutions.
            </p>
        </div>
    `;
    return welcomeContainer;
};

const renderHistory = () => {
    if (!historyEl) {
        return;
    }

    const wasAtBottom = isHistoryAtBottom();
    shouldAutoScroll = wasAtBottom;

    historyEl.innerHTML = '';
    const combined = [...baseMessages, ...extraMessages];
    const total = combined.length + (isLoading ? 1 : 0);
    historyEl.classList.toggle('history-empty', combined.length === 0 && !isLoading);

    // Show welcome screen if no messages and not loading
    if (combined.length === 0 && !isLoading) {
        historyEl.appendChild(renderWelcomeScreen());
    } else {
        combined.forEach((message, index) => {
            historyEl.appendChild(renderMessage(message, index, total));
        });

        if (isLoading) {
            historyEl.appendChild(renderLoadingEntry(combined.length === 0));
        }
    }
    if (wasAtBottom) {
        scrollHistoryToBottom();
    }
};

const renderLoadingEntry = (isFirstEntry) => {
    const container = document.createElement('article');
    container.className = 'timeline-entry timeline-loading';
    container.dataset.role = 'loading';
    if (isFirstEntry) {
        container.classList.add('is-first');
    }
    container.classList.add('is-last');

    const card = document.createElement('div');
    card.className = 'timeline-card timeline-card-loading';

    const header = document.createElement('div');
    header.className = 'timeline-header timeline-header-loading';
    const label = document.createElement('span');
    label.className = 'timeline-role';
    label.textContent = 'Processing';
    header.appendChild(label);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'timeline-body timeline-body-loading';
    body.innerHTML = `
        <div class="loading-row">
            <div class="spinner"></div>
            <span>Sedang memproses…</span>
        </div>
    `;
    card.appendChild(body);

    container.appendChild(card);
    return container;
};

const renderModelOptions = () => {
    if (!modelSelect) {
        return;
    }

    modelSelect.innerHTML = '';

    if (!modelOptions.length) {
        modelSelect.disabled = true;
        return;
    }

    if (!activeModelOptionId || !modelOptions.some((option) => option.id === activeModelOptionId)) {
        activeModelOptionId = modelOptions[0].id;
    }

    modelOptions.forEach((option) => {
        const node = document.createElement('option');
        node.value = option.id;
        node.textContent = option.label;
        modelSelect.appendChild(node);
    });

    modelSelect.value = activeModelOptionId;
    modelSelect.disabled = false;
};

const renderApiList = () => {
    if (!apiListEl) {
        return;
    }

    apiListEl.innerHTML = '';

    if (!providerInfos.length) {
        const empty = document.createElement('div');
        empty.className = 'apikey-empty';
        empty.textContent = 'Tidak ada penyedia yang tersedia.';
        apiListEl.appendChild(empty);
        return;
    }

    providerInfos.forEach((provider) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'apikey-item';

        const header = document.createElement('div');
        header.className = 'apikey-item-header';

        const title = document.createElement('div');
        title.className = 'apikey-item-title';
        title.textContent = provider.label;
        header.appendChild(title);

        if (provider.hasApiKey) {
            const status = document.createElement('span');
            status.className = 'apikey-status';
            status.textContent = 'tersimpan';
            header.appendChild(status);
        }

        const inputRow = document.createElement('div');
        inputRow.className = 'apikey-input-row';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Masukkan API key';
        input.autocomplete = 'off';
        input.autocapitalize = 'none';
        input.spellcheck = false;
        input.dataset.providerId = provider.id;

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Simpan';
        saveButton.addEventListener('click', () => {
            const value = input.value.trim();
            vscode.postMessage({
                type: value ? 'provider:apikey:set' : 'provider:apikey:clear',
                providerId: provider.id,
                apiKey: value
            });
            input.value = '';
        });

        inputRow.appendChild(input);
        inputRow.appendChild(saveButton);

        wrapper.appendChild(header);
        wrapper.appendChild(inputRow);
        apiListEl.appendChild(wrapper);
    });
};

const renderSessions = () => {
    if (!sessionsListEl) {
        return;
    }
    sessionsListEl.innerHTML = '';

    if (!sessions.length) {
        const empty = document.createElement('div');
        empty.className = 'sessions-empty';
        empty.textContent = 'Belum ada sesi. Mulai percakapan baru!';
        sessionsListEl.appendChild(empty);
        return;
    }

    sessions.forEach((session) => {
        const item = document.createElement('div');
        item.className = 'sessions-item';

        const button = document.createElement('button');
        button.className = 'sessions-item-button';
        button.textContent = session.title;
        if (session.id === activeSessionId) {
            button.classList.add('sessions-item-button-active');
        }
        button.addEventListener('click', () => {
            if (session.id !== activeSessionId) {
                vscode.postMessage({ type: 'sessions:switch', sessionId: session.id });
            }
            closeSessions();
        });

        const meta = document.createElement('div');
        meta.className = 'sessions-item-meta';
        const date = new Date(session.updatedAt ?? session.createdAt ?? Date.now());
        meta.textContent = date.toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short'
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'sessions-item-delete';
        deleteButton.setAttribute('title', 'Hapus sesi');
        deleteButton.innerHTML = '&times;';
        deleteButton.addEventListener('click', (event) => {
            event.stopPropagation();
            vscode.postMessage({ type: 'sessions:delete', sessionId: session.id });
        });

        const textWrapper = document.createElement('div');
        textWrapper.className = 'sessions-item-text';
        textWrapper.appendChild(button);
        textWrapper.appendChild(meta);

        item.appendChild(textWrapper);
        if (sessions.length > 1) {
            item.appendChild(deleteButton);
        }

        sessionsListEl.appendChild(item);
    });
};

const openSessions = () => {
    if (!sessionsOverlay) {
        return;
    }
    closeApiOverlay();
    sessionsOpen = true;
    sessionsOverlay.classList.remove('hidden');
    renderSessions();
};

const closeSessions = () => {
    if (!sessionsOverlay) {
        return;
    }
    sessionsOpen = false;
    sessionsOverlay.classList.add('hidden');
};

const openApiOverlay = () => {
    if (!apiOverlay) {
        return;
    }
    closeSessions();
    apiOverlayOpen = true;
    apiOverlay.classList.remove('hidden');
    renderApiList();
};

const closeApiOverlay = () => {
    if (!apiOverlay) {
        return;
    }
    apiOverlayOpen = false;
    apiOverlay.classList.add('hidden');
};

const addBaseMessage = (message) => {
    const wasAtBottom = isHistoryAtBottom();
    shouldAutoScroll = wasAtBottom;
    baseMessages = [...baseMessages, message];
    renderHistory();
};

const addExtraMessage = (message) => {
    const wasAtBottom = isHistoryAtBottom();
    shouldAutoScroll = wasAtBottom;
    extraMessages.push(message);
    renderHistory();
};

function sendPrompt() {
    const prompt = promptEl.value.replace(/^\s*/, '').replace(/\s*$/, '');
    
    // If loading and not already stopping, stop the process
    if (isLoading && !isStopping) {
        isStopping = true;
        updateSendButton();
        vscode.postMessage({ type: 'stopProcess' });
        return;
    }
    
    // If not loading, send the prompt
    if (prompt && !isLoading) {
        vscode.postMessage({ type: 'prompt', prompt });
        addBaseMessage({ role: 'user', content: prompt, html: `<div style="white-space: pre-wrap;">${escapeHtml(prompt)}</div>` });
        promptEl.value = '';
        promptEl.focus();
    }
}

function updateSendButton() {
    if (!sendButton) return;
    
    if (isLoading) {
        if (isStopping) {
            sendButton.textContent = 'Stopping...';
            sendButton.disabled = true;
        } else {
            sendButton.textContent = 'Stop';
            sendButton.disabled = false;
        }
    } else {
        sendButton.textContent = 'Send';
        sendButton.disabled = false;
    }
}

sendButton?.addEventListener('click', sendPrompt);
promptEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (!promptEl.value.includes('\n')) {
            event.preventDefault();
            sendPrompt();
        }
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        sendPrompt();
    }
});

modelSelect?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
        return;
    }
    const selection = target.value;
    if (!selection || selection === activeModelOptionId) {
        return;
    }
    activeModelOptionId = selection;
    vscode.postMessage({ type: 'model:select', selectionId: selection });
});

sessionToggleButton?.addEventListener('click', () => {
    if (sessionsOpen) {
        closeSessions();
    } else {
        openSessions();
    }
});

apiKeyToggleButton?.addEventListener('click', () => {
    if (apiOverlayOpen) {
        closeApiOverlay();
    } else {
        openApiOverlay();
    }
});

restartExtensionButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'restartExtension' });
});

sessionsOverlay?.addEventListener('click', (event) => {
    if (event.target === sessionsOverlay) {
        closeSessions();
    }
});

sessionsCloseButton?.addEventListener('click', () => {
    closeSessions();
});

apiOverlay?.addEventListener('click', (event) => {
    if (event.target === apiOverlay) {
        closeApiOverlay();
    }
});

apiCloseButton?.addEventListener('click', () => {
    closeApiOverlay();
});

sessionsCreateButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'sessions:create' });
    closeSessions();
});

openPanelButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openPanel' });
});

window.addEventListener('message', (event) => {
    const { type, state, message, value } = event.data;
    if (!type || !historyEl) {
        return;
    }
    if (!isProgrammaticScroll) {
        shouldAutoScroll = isHistoryAtBottom();
    }
    if (type === 'state') {
        shouldAutoScroll = isHistoryAtBottom();
        baseMessages = state.messages ?? [];
        extraMessages.length = 0;
        sessions = Array.isArray(state.sessions) ? state.sessions : [];
        activeSessionId = state.activeSessionId;
        providerInfos = Array.isArray(state.providers) ? state.providers : [];
        modelOptions = Array.isArray(state.modelOptions) ? state.modelOptions : [];
        activeModelOptionId = state.activeModelOptionId;
        totalTokenUsage = typeof state.totalTokens === 'number' ? state.totalTokens : 0;
        updateTokenUsageLabel();
        
        // Handle isProcessing state
        if (state.isProcessing !== undefined) {
            isLoading = state.isProcessing;
            isStopping = false;
            updateSendButton();
        }
        
        renderModelOptions();
        if (apiOverlayOpen) {
            renderApiList();
        }
        renderSessions();
        renderHistory();
    }
    if (type === 'message') {
        shouldAutoScroll = isHistoryAtBottom();
        addBaseMessage(message);
        if (typeof message?.tokens === 'number' && message.tokens > 0) {
            totalTokenUsage += message.tokens;
            updateTokenUsageLabel();
        }
    }
    if (type === 'fileResult') {
        shouldAutoScroll = isHistoryAtBottom();
        addExtraMessage(message);
    }
    if (type === 'loading') {
        shouldAutoScroll = isHistoryAtBottom();
        isLoading = Boolean(value);
        isStopping = false; // Reset stopping state when loading state changes
        updateSendButton();
        renderHistory();
    }
    if (type === 'processStopped') {
        shouldAutoScroll = isHistoryAtBottom();
        isLoading = false;
        isStopping = false;
        updateSendButton();
        renderHistory();
    }
});

// Wait for DOM to be fully ready before sending ready event
document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    renderModelOptions();
    updateTokenUsageLabel();
    
    // Notify extension that webview is ready
    setTimeout(() => {
        vscode.postMessage({ type: 'ready' });
    }, 100);
});
