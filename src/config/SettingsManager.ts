import * as vscode from 'vscode';

const SECRET_KEY = 'idSiberCoder.deepseek.apiKey';

export interface SettingsSnapshot {
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
    enableContextOptimization: boolean;
    contextSummaryThreshold: number;
    contextSummaryRetention: number;
    maxIterations: number;
}

export class SettingsManager {
    private readonly configuration = vscode.workspace.getConfiguration('idSiberCoder');

    constructor(private readonly secrets: vscode.SecretStorage) {}

    async getSettings(): Promise<SettingsSnapshot> {
        const storedKey = await this.secrets.get(SECRET_KEY);
        const configuredKey = this.configuration.get<string>('apiKey');

        return {
            apiKey: configuredKey?.trim() || storedKey || undefined,
            baseUrl: this.configuration.get<string>('baseUrl', 'https://api.deepseek.com'),
            model: this.configuration.get<string>('model', 'deepseek-chat'),
            enableContextOptimization: this.configuration.get<boolean>('enableContextOptimization', true),
            contextSummaryThreshold: this.configuration.get<number>('contextSummaryThreshold', 12),
            contextSummaryRetention: this.configuration.get<number>('contextSummaryRetention', 6),
            maxIterations: this.configuration.get<number>('maxIterations', 12)
        };
    }

    async ensureApiKey(): Promise<string | undefined> {
        const settings = await this.getSettings();
        if (settings.apiKey) {
            return settings.apiKey;
        }

        const input = await vscode.window.showInputBox({
            prompt: 'Enter DeepSeek API key for IdSiberCoder',
            placeHolder: 'sk-...'
        });

        if (input && input.trim()) {
            await this.secrets.store(SECRET_KEY, input.trim());
            return input.trim();
        }

        vscode.window.showWarningMessage('IdSiberCoder requires a DeepSeek API key to operate.');
        return undefined;
    }

    async clearApiKey(): Promise<void> {
        await this.secrets.delete(SECRET_KEY);
    }
}
