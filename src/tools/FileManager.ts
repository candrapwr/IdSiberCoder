import * as path from 'path';
import { promises as fs } from 'fs';

export interface FileOperationResult {
    success: boolean;
    message?: string;
    error?: string;
    content?: string;
    path?: string;
    size?: number;
}

export class FileManager {
    constructor(private workspaceRoot: string) {}

    setWorkspaceRoot(folder: string | undefined): void {
        this.workspaceRoot = folder ?? '';
    }

    async readFile(target: string): Promise<FileOperationResult> {
        try {
            const full = this.resolve(target);
            const buffer = await fs.readFile(full, 'utf8');
            return {
                success: true,
                content: buffer,
                path: target,
                size: Buffer.byteLength(buffer, 'utf8')
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async writeFile(target: string, content: string): Promise<FileOperationResult> {
        try {
            const full = this.resolve(target);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.writeFile(full, content, 'utf8');
            return {
                success: true,
                message: `File written: ${target}`,
                path: target,
                size: Buffer.byteLength(content, 'utf8')
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async appendFile(target: string, content: string): Promise<FileOperationResult> {
        try {
            const full = this.resolve(target);
            await fs.mkdir(path.dirname(full), { recursive: true });
            await fs.appendFile(full, content, 'utf8');
            return {
                success: true,
                message: `Content appended to ${target}`,
                path: target,
                size: Buffer.byteLength(content, 'utf8')
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async editFile(
        target: string,
        edits: Array<{ find: string; replace?: string }>
    ): Promise<FileOperationResult> {
        if (!Array.isArray(edits) || edits.length === 0) {
            return {
                success: false,
                error: 'No edits provided.'
            };
        }

        try {
            const full = this.resolve(target);
            let content = await fs.readFile(full, 'utf8');
            let replacements = 0;

            const applyReplacement = (source: string, find: string, replaceWith: string) => {
                if (!find) {
                    return { updated: source, count: 0 };
                }
                const segments = source.split(find);
                if (segments.length === 1) {
                    return { updated: source, count: 0 };
                }
                const updated = segments.join(replaceWith);
                return { updated, count: segments.length - 1 };
            };

            for (const edit of edits) {
                const find = typeof edit.find === 'string' ? edit.find : '';
                const replaceWith = typeof edit.replace === 'string' ? edit.replace : '';
                const result = applyReplacement(content, find, replaceWith);
                content = result.updated;
                replacements += result.count;
            }

            await fs.writeFile(full, content, 'utf8');

            return {
                success: true,
                message: `Applied ${replacements} replacement(s) in ${target}.`,
                path: target
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async deleteFile(target: string): Promise<FileOperationResult> {
        try {
            const full = this.resolve(target);
            await fs.unlink(full);
            return {
                success: true,
                message: `File deleted: ${target}`,
                path: target
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async copyFile(source: string, destination: string): Promise<FileOperationResult> {
        try {
            const fullSource = this.resolve(source);
            const fullDestination = this.resolve(destination);
            await fs.mkdir(path.dirname(fullDestination), { recursive: true });
            await fs.copyFile(fullSource, fullDestination);
            return {
                success: true,
                message: `Copied ${source} → ${destination}`,
                path: destination
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async moveFile(source: string, destination: string): Promise<FileOperationResult> {
        try {
            const fullSource = this.resolve(source);
            const fullDestination = this.resolve(destination);
            await fs.mkdir(path.dirname(fullDestination), { recursive: true });
            await fs.rename(fullSource, fullDestination);
            return {
                success: true,
                message: `Moved ${source} → ${destination}`,
                path: destination
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    async listDirectory(target = '.'): Promise<FileOperationResult> {
        try {
            const full = this.resolve(target);
            const entries = await fs.readdir(full, { withFileTypes: true });
            const lines = entries
                .map((entry) => {
                    const suffix = entry.isDirectory() ? '/' : '';
                    return `${entry.name}${suffix}`;
                })
                .join('\n');
            return {
                success: true,
                content: lines,
                path: target
            };
        } catch (error: unknown) {
            return this.fail(error);
        }
    }

    private resolve(target: string): string {
        if (!this.workspaceRoot) {
            throw new Error('Workspace folder not set. Open a folder in VS Code to use IdSiberCoder file tools.');
        }
        const candidate = path.resolve(this.workspaceRoot, target);
        if (!candidate.startsWith(this.workspaceRoot)) {
            throw new Error(`Path outside workspace is not allowed: ${target}`);
        }
        return candidate;
    }

    private fail(error: unknown): FileOperationResult {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: message
        };
    }
}
