import * as vscode from 'vscode';

export class LoggingHandler {
    private readonly channel: vscode.OutputChannel;

    constructor(channelName = 'IdSiberCoder') {
        this.channel = vscode.window.createOutputChannel(channelName);
    }

    info(message: string, data?: unknown): void {
        this.write('INFO', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.write('WARN', message, data);
    }

    error(message: string, data?: unknown): void {
        this.write('ERROR', message, data);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private write(level: string, message: string, data?: unknown): void {
        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] [${level}] ${message}`);
        if (data !== undefined) {
            const serialized = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this.channel.appendLine(serialized);
        }
    }
}
