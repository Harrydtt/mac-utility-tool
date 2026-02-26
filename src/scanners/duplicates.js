import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { exists, getFileHash } from '../utils/index.js';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
const DEFAULT_SEARCH_PATHS = [
    join(homedir(), 'Downloads'),
    join(homedir(), 'Documents'),
    join(homedir(), 'Desktop'),
];
const MIN_FILE_SIZE = 1024 * 1024;
const MAX_DEPTH = 5;
export class DuplicatesScanner extends BaseScanner {
    category = CATEGORIES['duplicates'];
    async scan(options) {
        const minSize = options?.minSize ?? MIN_FILE_SIZE;
        const filesBySize = new Map();
        for (const searchPath of DEFAULT_SEARCH_PATHS) {
            if (await exists(searchPath)) {
                await this.collectFiles(searchPath, filesBySize, minSize, MAX_DEPTH);
            }
        }
        const duplicates = await this.findDuplicates(filesBySize);
        const items = this.convertToCleanableItems(duplicates);
        return this.createResult(items);
    }
    async collectFiles(dir, filesBySize, minSize, maxDepth, currentDepth = 0) {
        if (currentDepth > maxDepth)
            return;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.'))
                    continue;
                const fullPath = join(dir, entry.name);
                try {
                    if (entry.isFile()) {
                        const stats = await stat(fullPath);
                        if (stats.size >= minSize) {
                            const files = filesBySize.get(stats.size) ?? [];
                            files.push({
                                path: fullPath,
                                size: stats.size,
                                modifiedAt: stats.mtime,
                            });
                            filesBySize.set(stats.size, files);
                        }
                    }
                    else if (entry.isDirectory()) {
                        await this.collectFiles(fullPath, filesBySize, minSize, maxDepth, currentDepth + 1);
                    }
                }
                catch {
                    continue;
                }
            }
        }
        catch {
            // Ignore permission errors
        }
    }
    async findDuplicates(filesBySize) {
        const duplicates = new Map();
        for (const [, files] of filesBySize) {
            if (files.length < 2)
                continue;
            const filesByHash = new Map();
            for (const file of files) {
                try {
                    const hash = await getFileHash(file.path);
                    const hashFiles = filesByHash.get(hash) ?? [];
                    hashFiles.push(file);
                    filesByHash.set(hash, hashFiles);
                }
                catch {
                    continue;
                }
            }
            for (const [hash, hashFiles] of filesByHash) {
                if (hashFiles.length >= 2) {
                    duplicates.set(hash, hashFiles);
                }
            }
        }
        return duplicates;
    }
    convertToCleanableItems(duplicates) {
        const items = [];
        for (const [, files] of duplicates) {
            files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
            const [newest, ...older] = files;
            for (const file of older) {
                items.push({
                    path: file.path,
                    size: file.size,
                    name: `${this.getFileName(file.path)} (dup of ${this.getFileName(newest.path)})`,
                    isDirectory: false,
                    modifiedAt: file.modifiedAt,
                });
            }
        }
        items.sort((a, b) => b.size - a.size);
        return items;
    }
    getFileName(path) {
        const parts = path.split('/');
        return parts[parts.length - 1] || path;
    }
}
//# sourceMappingURL=duplicates.js.map