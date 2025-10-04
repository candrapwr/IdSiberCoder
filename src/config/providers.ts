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
    defaultMaxTokens?: number;
    models: ProviderModel[];
}

export const PROVIDERS: Record<ProviderId, ProviderMetadata> = {
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        defaultBaseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        defaultMaxTokens: 7900,
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
        defaultMaxTokens: 20000,
        models: [
            { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { id: 'gpt-5-nano', label: 'GPT-5 nano' }
        ]
    }
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
