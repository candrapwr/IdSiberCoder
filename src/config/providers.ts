export type ProviderId = 'deepseek' | 'openai' | 'zhipuai' | 'grok' | 'claude' | 'novita' | 'gemini';

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
    gemini: {
        id: 'gemini',
        label: 'Google Gemini',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.0-flash-exp',
        defaultMaxTokens: 8000,
        models: [
            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
            { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
            { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' }
        ]
    },
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        defaultBaseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        defaultMaxTokens: 7900,
        models: [
            { id: 'deepseek-chat', label: 'DeepSeek Chat' },
        ]
    },
    openai: {
        id: 'openai',
        label: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        defaultMaxTokens: 20000,
        models: [
            { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
            { id: 'codex-mini-latest', label: 'Codex Mini' },
            { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { id: 'gpt-5-nano', label: 'GPT-5 nano' }
        ]
    },
    zhipuai: {
        id: 'zhipuai',
        label: 'ZhiPu AI',
        defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4.5-flash',
        defaultMaxTokens: 8000,
        models: [
            { id: 'glm-4.6', label: 'GLM-4.6' },
            { id: 'glm-4.5', label: 'GLM-4.5' },
            { id: 'glm-4.5-flash', label: 'GLM-4.5-Flash' }
        ]
    },
    grok: {
        id: 'grok',
        label: 'Grok',
        defaultBaseUrl: 'https://api.x.ai/v1',
        defaultModel: 'grok-3-mini',
        defaultMaxTokens: 8000,
        models: [
            { id: 'grok-4-fast-non-reasoning', label: 'Grok-4-Fast' },
            { id: 'grok-4', label: 'Grok-4' },
            { id: 'grok-code-fast-1', label: 'Grok-Code-Fast' },
            { id: 'grok-3-mini', label: 'Grok-3-mini' }
        ]
    },
    claude: {
        id: 'claude',
        label: 'Claude',
        defaultBaseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-3-7-sonnet-latest',
        defaultMaxTokens: 8000,
        models: [
            { id: 'claude-sonnet-4-5', label: 'Claude 4.5 Sonnet' },
            { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
            { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
        ]
    },
    novita: {
        id: 'novita',
        label: 'Novita AI',
        defaultBaseUrl: 'https://api.novita.ai/openai',
        defaultModel: 'deepseek/deepseek-v3.1-terminus',
        defaultMaxTokens: 8000,
        models: [
            { id: 'deepseek/deepseek-v3.1-terminus', label: 'DeepSeek v3.1 Terminus' },
            { id: 'deepseek/deepseek-v3.2-exp', label: 'DeepSeek v3.2 Exp' },
            { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
            { id: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen Coder' }
        ]
    }
};

export const PROVIDER_LIST = Object.values(PROVIDERS);
