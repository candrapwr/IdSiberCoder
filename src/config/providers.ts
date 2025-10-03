export type ProviderId = 'deepseek' | 'openai';

export interface ProviderModel {
    id: string;
    label: string;
}

export interface ProviderMetadata {
    id: ProviderId;
    label: string;
    defaultBaseUrl: string;
    defaultModel: string;
    models: ProviderModel[];
}

export const PROVIDERS: Record<ProviderId, ProviderMetadata> = {
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        defaultBaseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        models: [
            { id: 'deepseek-chat', label: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' }
        ]
    },
    openai: {
        id: 'openai',
        label: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        models: [
            { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { id: 'codex', label: 'Codex' }
        ]
    }
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
