export type ToolExecutor = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export interface ToolRegistry {
    [action: string]: ToolExecutor;
}

export class ToolCallHandler {
    constructor(private tools: ToolRegistry) {}

    setTools(tools: ToolRegistry): void {
        this.tools = tools;
    }

    async execute(action: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
        const executor = this.tools[action];
        if (!executor) {
            throw new Error(`Unknown tool action: ${action}`);
        }
        return await executor(parameters);
    }
}
