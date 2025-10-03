const vscode = acquireVsCodeApi();

const historyEl = document.getElementById('history');
const promptEl = document.getElementById('prompt');
const sendButton = document.getElementById('send');
const workspaceLabel = document.getElementById('workspaceLabel');
const sessionToggleButton = document.getElementById('sessionToggle');
const sessionsOverlay = document.getElementById('sessionsOverlay');
const sessionsListEl = document.getElementById('sessionsPanelList');
const sessionsCreateButton = document.getElementById('sessionsCreate');
const sessionsCloseButton = document.getElementById('sessionsClose');

let baseMessages = [];
const extraMessages = [];
let isLoading = false;
let sessions = [];
let activeSessionId;
let sessionsOpen = false;

const escapeHtml = (value = '') =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

const scrollHistoryToBottom = () => {
    historyEl.scrollTop = historyEl.scrollHeight;
};

const ROLE_LABELS = {
    user: 'You',
    assistant: 'IdSiberCoder',
    tool: 'Tool'
};

const MARKER_ICONS = {
    user: '',
    assistant: '',
    tool: ''
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

    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    marker.dataset.role = message.role;
    marker.dataset.icon = MARKER_ICONS[message.role] ?? '';

    if (message.role === 'tool' && message.success === false) {
        marker.dataset.status = 'failed';
        marker.dataset.icon = '!';
    }

    container.appendChild(marker);

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

const renderHistory = () => {
    historyEl.innerHTML = '';
    const combined = [...baseMessages, ...extraMessages];
    const total = combined.length + (isLoading ? 1 : 0);
    historyEl.classList.toggle('history-empty', combined.length === 0 && !isLoading);

    combined.forEach((message, index) => {
        historyEl.appendChild(renderMessage(message, index, total));
    });

    if (isLoading) {
        historyEl.appendChild(renderLoadingEntry(combined.length === 0));
    }
    scrollHistoryToBottom();
};

const renderLoadingEntry = (isFirstEntry) => {
    const container = document.createElement('article');
    container.className = 'timeline-entry timeline-loading';
    if (isFirstEntry) {
        container.classList.add('is-first');
    }
    container.classList.add('is-last');

    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    marker.dataset.role = 'loading';
    container.appendChild(marker);

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

const addBaseMessage = (message) => {
    baseMessages = [...baseMessages, message];
    renderHistory();
};

const addExtraMessage = (message) => {
    extraMessages.push(message);
    renderHistory();
};

function sendPrompt() {
    const prompt = promptEl.value.trim();
    if (!prompt) {
        return;
    }
    vscode.postMessage({ type: 'prompt', prompt });
    addBaseMessage({ role: 'user', content: prompt, html: `<p>${escapeHtml(prompt)}</p>` });
    promptEl.value = '';
    promptEl.focus();
}

sendButton?.addEventListener('click', sendPrompt);
promptEl?.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        sendPrompt();
    }
});

sessionToggleButton?.addEventListener('click', () => {
    if (sessionsOpen) {
        closeSessions();
    } else {
        openSessions();
    }
});

sessionsOverlay?.addEventListener('click', (event) => {
    if (event.target === sessionsOverlay) {
        closeSessions();
    }
});

sessionsCloseButton?.addEventListener('click', () => {
    closeSessions();
});

sessionsCreateButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'sessions:create' });
    closeSessions();
});

window.addEventListener('message', (event) => {
    const { type, state, message, value } = event.data;
    if (type === 'state') {
        baseMessages = state.messages ?? [];
        extraMessages.length = 0;
        if (state.workingDirectory) {
            workspaceLabel.textContent = `Workspace: ${state.workingDirectory}`;
        }
        sessions = Array.isArray(state.sessions) ? state.sessions : [];
        activeSessionId = state.activeSessionId;
        renderSessions();
        renderHistory();
    }
    if (type === 'message') {
        addBaseMessage(message);
    }
    if (type === 'fileResult') {
        addExtraMessage(message);
    }
    if (type === 'loading') {
        isLoading = Boolean(value);
        renderHistory();
    }
});

renderHistory();
