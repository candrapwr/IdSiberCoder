import * as vscode from 'vscode';
import { PROVIDERS, ProviderId } from './providers';

const SECRET_PREFIX = 'idSiberCoder.apiKey.';

export interface ProviderSettingsSnapshot {
    baseUrl: string;
    model: string;
    maxTokens?: number;
}

export interface SettingsSnapshot {
    provider: ProviderId;
    providers: Record<ProviderId, ProviderSettingsSnapshot>;
    apiKey?: string;
    apiKeys: Record<ProviderId, boolean>;
    enableContextOptimization: boolean;
    contextSummaryThreshold: number;
    contextSummaryRetention: number;
    maxIterations: number;
}

export class SettingsManager {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    private getUpdateTarget(): vscode.ConfigurationTarget {
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }

    private getConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('idSiberCoder');
    }

    private getSecretKey(provider: ProviderId): string {
        return `${SECRET_PREFIX}${provider}`;
    }



    async getSettings(): Promise<SettingsSnapshot> {
        const configuration = this.getConfiguration();
        const provider = configuration.get<ProviderId>('provider', 'deepseek');

        const providers: Record<ProviderId, ProviderSettingsSnapshot> = {} as Record<ProviderId, ProviderSettingsSnapshot>;
        const apiKeys: Record<ProviderId, boolean> = {} as Record<ProviderId, boolean>;

        let activeApiKey: string | undefined;

        for (const providerId of Object.keys(PROVIDERS) as ProviderId[]) {
            const metadata = PROVIDERS[providerId];
            const baseUrl =
                configuration.get<string>(`${providerId}.baseUrl`, metadata.defaultBaseUrl) ||
                metadata.defaultBaseUrl;
            const model =
                configuration.get<string>(`${providerId}.model`, metadata.defaultModel) ||
                metadata.defaultModel;
            const maxTokens = configuration.get<number>(`${providerId}.maxTokens`, metadata.defaultMaxTokens ?? 4096);
            providers[providerId] = { baseUrl, model, maxTokens };

            // Check for API key in secrets storage
            const stored = await this.secrets.get(this.getSecretKey(providerId));
            const hasKey = Boolean(stored?.trim());
            
            if (providerId === provider) {
                activeApiKey = stored?.trim();
            }

            apiKeys[providerId] = hasKey;
        }

        // Back-compat: allow legacy baseUrl/model at root level to seed DeepSeek config once.
        if (!configuration.get<string>('deepseek.baseUrl')) {
            const legacyBase = configuration.get<string>('baseUrl');
            if (legacyBase) {
                providers.deepseek.baseUrl = legacyBase;
            }
        }
        if (!configuration.get<string>('deepseek.model')) {
            const legacyModel = configuration.get<string>('model');
            if (legacyModel) {
                providers.deepseek.model = legacyModel;
            }
        }

        return {
            provider,
            providers,
            apiKey: activeApiKey,
            apiKeys,
            enableContextOptimization: configuration.get<boolean>('enableContextOptimization', true),
            contextSummaryThreshold: configuration.get<number>('contextSummaryThreshold', 12),
            contextSummaryRetention: configuration.get<number>('contextSummaryRetention', 6),
            maxIterations: configuration.get<number>('maxIterations', 12)
        };
    }

    async getApiKey(provider: ProviderId): Promise<string | undefined> {
        const stored = await this.secrets.get(this.getSecretKey(provider));
        return stored ?? undefined;
    }

    async ensureApiKey(provider: ProviderId): Promise<string | undefined> {
        const existing = await this.getApiKey(provider);
        if (existing) {
            return existing;
        }

        const providerLabel = PROVIDERS[provider]?.label ?? provider;
        const input = await vscode.window.showInputBox({
            prompt: `Enter ${providerLabel} API key for IdSiberCoder`,
            placeHolder: 'sk-...'
        });

        if (input && input.trim()) {
            await this.storeApiKey(provider, input.trim());
            return input.trim();
        }

        vscode.window.showWarningMessage(`IdSiberCoder requires a ${providerLabel} API key to operate.`);
        return undefined;
    }

    async clearApiKey(provider: ProviderId): Promise<void> {
        await this.secrets.delete(this.getSecretKey(provider));
    }

    async updateProvider(provider: ProviderId): Promise<void> {
        const configuration = this.getConfiguration();
        await configuration.update('provider', provider, this.getUpdateTarget());
    }

    async updateModel(provider: ProviderId, model: string): Promise<void> {
        const configuration = this.getConfiguration();
        await configuration.update(`${provider}.model`, model, this.getUpdateTarget());
    }

    async updateBaseUrl(provider: ProviderId, baseUrl: string): Promise<void> {
        const configuration = this.getConfiguration();
        await configuration.update(`${provider}.baseUrl`, baseUrl, this.getUpdateTarget());
    }

    async updateMaxTokens(provider: ProviderId, maxTokens?: number): Promise<void> {
        const configuration = this.getConfiguration();
        await configuration.update(`${provider}.maxTokens`, maxTokens, this.getUpdateTarget());
    }

    async setApiKey(provider: ProviderId, apiKey?: string): Promise<void> {
        const trimmed = apiKey?.trim();

        if (trimmed) {
            await this.storeApiKey(provider, trimmed);
        } else {
            await this.secrets.delete(this.getSecretKey(provider));
        }
    }

    private async storeApiKey(provider: ProviderId, value: string): Promise<void> {
        await this.secrets.store(this.getSecretKey(provider), value);
    }
}
