const vscode = acquireVsCodeApi();

const historyEl = document.getElementById('history');
const promptEl = document.getElementById('prompt');
const sendButton = document.getElementById('send');
const workspaceLabel = document.getElementById('workspaceLabel');
const loadingEl = document.getElementById('loadingIndicator');

let baseMessages = [];
const extraMessages = [];

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

const renderMessage = (message) => {
    const container = document.createElement('div');
    container.className = `message message-${message.role}`;

    if (message.role === 'tool') {
        const details = document.createElement('details');
        details.className = `tool-card ${message.success === false ? 'tool-failed' : 'tool-success'}`;

        const summary = document.createElement('summary');
        summary.textContent = message.summary || 'Tool result';
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'tool-body';
        body.innerHTML = message.html || escapeHtml(message.content || '');
        details.appendChild(body);

        container.appendChild(details);
    } else {
        const header = document.createElement('div');
        header.className = 'message-header';

        const roleLabel = document.createElement('div');
        roleLabel.className = 'message-role';
        roleLabel.textContent = message.role.toUpperCase();
        header.appendChild(roleLabel);

        if (typeof message.tokens === 'number' && message.tokens > 0) {
            const chip = document.createElement('span');
            chip.className = 'assistant-chip assistant-usage';
            chip.textContent = `Tokens: ${message.tokens.toLocaleString('id-ID')}`;
            header.appendChild(chip);
        }

        const body = document.createElement('div');
        body.className = 'message-body';
        body.innerHTML = message.html || escapeHtml(message.content || '');

        container.appendChild(header);
        container.appendChild(body);
    }

    return container;
};

const renderHistory = () => {
    historyEl.innerHTML = '';
    const combined = [...baseMessages, ...extraMessages];
    combined.forEach((message) => {
        historyEl.appendChild(renderMessage(message));
    });
    scrollHistoryToBottom();
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

window.addEventListener('message', (event) => {
    const { type, state, message, value } = event.data;
    if (type === 'state') {
        baseMessages = state.messages ?? [];
        extraMessages.length = 0;
        if (state.workingDirectory) {
            workspaceLabel.textContent = `Workspace: ${state.workingDirectory}`;
        }
        renderHistory();
    }
    if (type === 'message') {
        addBaseMessage(message);
    }
    if (type === 'fileResult') {
        addExtraMessage(message);
    }
    if (type === 'loading') {
        if (value) {
            loadingEl.classList.remove('hidden');
            loadingEl.classList.add('active');
        } else {
            loadingEl.classList.add('hidden');
            loadingEl.classList.remove('active');
        }
    }
});

renderHistory();
