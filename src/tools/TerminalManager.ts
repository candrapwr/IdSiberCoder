import * as vscode from 'vscode';
import { exec, ExecException } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TerminalOperationResult {
    success: boolean;
    message?: string;
    error?: string;
    output?: string;
}

export class TerminalManager {
    private outputChannel: vscode.OutputChannel;
    private readonly MAX_OUTPUT_LENGTH = 1000;
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('IdSiberCoder CLI');
    }

    private isSafeCommand(command: string): boolean {
        const safePatterns = [
            /^git\s+(status|log|branch|show|diff|remote|fetch|pull|push|clone|init|add|commit|stash|tag|describe)/i,
            /^npm\s+(install|list|view|info|search|outdated|audit|run|start|test|version|init)/i,
            /^yarn\s+(install|list|info|search|outdated|audit|run|start|test|version|init)/i,
            /^pnpm\s+(install|list|info|search|outdated|audit|run|start|test|version|init)/i,
            /^composer\s+/i,
            /^php\s+/i,
            /^python\s+/i,
            /^python3\s+/i,
            /^node\s+/i,
            /^(ls|dir|pwd|mkdir|cat|head|tail|grep|find|which|whereis|file|stat|du|df|free|uname|arch|whoami|hostname|date|cal|echo|printf)/i,
            /^cd\s+/i,
            /^echo\s+/i,
            /^printf\s+/i
        ];

        const dangerousPatterns = [
            /rm\s+-rf/i,
            /rm\s+-r\s+-f/i,
            /sudo\s+/i,
            /chmod\s+[0-7]{3,4}\s+/i,
            /chown\s+[^\s]+\s+[^\s]+\s+/i,
            /dd\s+/i,
            /mkfs\s+/i,
            /fdisk\s+/i,
            /format\s+/i,
            /shutdown\s+/i,
            /reboot\s+/i,
            /poweroff\s+/i,
            /killall\s+/i,
            /pkill\s+/i,
            /^>\s*\/dev\/null/i,
            /\|\s*tee\s+/i
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

        // Default to unsafe for unknown commands
        return false;
    }

    private truncateOutput(output: string): string {
        if (output.length <= this.MAX_OUTPUT_LENGTH) {
            return output;
        }
        
        const truncated = output.substring(0, this.MAX_OUTPUT_LENGTH);
        return `${truncated}\n\n[Output truncated - ${output.length} characters total, showing first ${this.MAX_OUTPUT_LENGTH} characters]`;
    }

    async executeCommand(command: string, captureOutput: boolean = false): Promise<TerminalOperationResult> {
        try {
            const trimmedCommand = command.trim();
            
            if (!this.isSafeCommand(trimmedCommand)) {
                return {
                    success: false,
                    error: `Command blocked for security: ${trimmedCommand}. Only safe development commands are allowed.`
                };
            }

            return await this.executeWithChildProcess(trimmedCommand);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Command execution failed: ${errorMessage}`
            };
        }
    }

    private async executeWithChildProcess(command: string): Promise<TerminalOperationResult> {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            
            this.outputChannel.appendLine(`Executing: ${command}`);
            
            const { stdout, stderr } = await execAsync(command, { 
                cwd: workspacePath,
                encoding: 'utf8',
                timeout: 30000 // Timeout 30 detik
            });

            // Clean up the output
            const cleanOutput = (stdout || stderr || '').trim();
            const truncatedOutput = this.truncateOutput(cleanOutput);
            
            if (stderr && !stdout) {
                this.outputChannel.appendLine(`Stderr: ${stderr}`);
            } else if (stdout) {
                this.outputChannel.appendLine(`Output: ${stdout.substring(0, 500)}...`); // Log hanya 500 karakter pertama
            }

            const result: TerminalOperationResult = {
                success: true,
                output: truncatedOutput || 'Command executed with no output'
            };
            
            return result;

        } catch (error) {
            const execError = error as ExecException;
            const errorMessage = execError.message || 'Unknown error';
            const errorOutput = (execError.stderr || execError.stdout || '').trim();
            const truncatedError = this.truncateOutput(errorOutput);
            
            this.outputChannel.appendLine(`Error: ${errorMessage}`);
            if (errorOutput) {
                this.outputChannel.appendLine(`Error output: ${errorOutput.substring(0, 500)}...`);
            }
            
            return {
                success: false,
                error: `Command failed: ${errorMessage}`,
                output: truncatedError || 'No error details available'
            };
        }
    }

    dispose() {
        this.outputChannel.dispose();
    }
}