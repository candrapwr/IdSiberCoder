import * as vscode from 'vscode';

export interface TerminalOperationResult {
    success: boolean;
    message?: string;
    error?: string;
    command?: string;
}

export class TerminalManager {
    private terminal: vscode.Terminal | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('IdSiberCoder CLI');
    }

    /**
     * Execute a command in VS Code terminal
     * @param command The command to execute
     * @param captureOutput Whether to capture output (limited functionality)
     */
    async executeCommand(command: string, captureOutput: boolean = false): Promise<TerminalOperationResult> {
        try {
            // Validate command for security
            if (!this.isSafeCommand(command)) {
                return {
                    success: false,
                    error: `Command "${command}" is not allowed for security reasons. Only basic file and project management commands are permitted.`
                };
            }

            if (!this.terminal || this.terminal.exitStatus) {
                this.terminal = vscode.window.createTerminal('IdSiberCoder CLI');
            }
            
            this.terminal.show();
            this.terminal.sendText(command);
            
            // Log to output channel for visibility
            this.outputChannel.appendLine(`[${new Date().toISOString()}] Executed: ${command}`);
            
            if (captureOutput) {
                // For commands where we might want to capture output, we can use a different approach
                // This is limited due to terminal API constraints
                return {
                    success: true,
                    message: `Command "${command}" executed in terminal. Output will be displayed in the terminal panel.`,
                    command
                };
            }
            
            return {
                success: true,
                message: `Command "${command}" executed in terminal. Check the terminal panel for output.`,
                command
            };
            
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: message
            };
        }
    }

    /**
     * Execute a command and capture output using child_process (for safe commands only)
     * @param command The command to execute
     * @param args Command arguments
     */
    async executeAndCapture(command: string, args: string[] = []): Promise<TerminalOperationResult> {
        try {
            // Only allow safe commands for child_process execution
            if (!this.isSafeCommandForCapture(command)) {
                return {
                    success: false,
                    error: `Command "${command}" is not allowed for output capture. Only basic informational commands are permitted.`
                };
            }

            const { exec } = await import('child_process');
            
            return new Promise((resolve) => {
                exec(`${command} ${args.join(' ')}`.trim(), { 
                    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath 
                }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({
                            success: false,
                            error: stderr || error.message
                        });
                    } else {
                        resolve({
                            success: true,
                            message: stdout || 'Command executed successfully',
                            command: `${command} ${args.join(' ')}`.trim()
                        });
                    }
                });
            });
            
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: message
            };
        }
    }

    /**
     * Check if a command is safe to execute in terminal
     */
    private isSafeCommand(command: string): boolean {
        const safePatterns = [
            /^git\s+(status|log|diff|branch|remote|fetch|pull|push|add|commit|clone)/i,
            /^npm\s+(list|view|info|install|uninstall|run|test|start|build)/i,
            /^yarn\s+(list|info|install|remove|run|test|start|build)/i,
            /^pnpm\s+(list|info|install|remove|run|test|start|build)/i,
            /^(ls|dir|pwd|cd|mkdir|rmdir|cp|copy|mv|move|rm|del|cat|type|more|less|head|tail|grep|find|which|where)/i,
            /^node\s+/i,
            /^php\s+/i,
            /^python\s+/i,
            /^echo\s+/i,
            /^date$/i,
            /^whoami$/i
        ];

        const dangerousPatterns = [
            /rm\s+-rf/i,
            /format\s+/i,
            /shutdown/i,
            /reboot/i,
            /init\s+/i,
            /dd\s+/i,
            /mkfs/i,
            /fdisk/i,
            /chmod\s+[0-7]{3,4}\s+/i,
            /chown\s+root/i,
            /sudo\s+/i,
            /su\s+/i,
            /passwd/i,
            /ssh-keygen/i
        ];

        // Check for dangerous patterns first
        for (const pattern of dangerousPatterns) {
            if (pattern.test(command)) {
                return false;
            }
        }

        // Check for safe patterns
        for (const pattern of safePatterns) {
            if (pattern.test(command)) {
                return true;
            }
        }

        // If no pattern matches, consider it unsafe
        return false;
    }

    /**
     * Check if a command is safe for output capture (more restrictive)
     */
    private isSafeCommandForCapture(command: string): boolean {
        const safeCapturePatterns = [
            /^git\s+(status|log|branch|remote|--version)/i,
            /^npm\s+(list|view|info|--version)/i,
            /^yarn\s+(list|info|--version)/i,
            /^pnpm\s+(list|info|--version)/i,
            /^(ls|dir|pwd|which|where|echo)/i,
            /^node\s+--version$/i,
            /^python\s+--version$/i,
            /^date$/i,
            /^whoami$/i
        ];

        for (const pattern of safeCapturePatterns) {
            if (pattern.test(command)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Clear the terminal
     */
    clearTerminal(): void {
        if (this.terminal) {
            this.terminal.sendText('clear');
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.terminal) {
            this.terminal.dispose();
        }
        this.outputChannel.dispose();
    }
}