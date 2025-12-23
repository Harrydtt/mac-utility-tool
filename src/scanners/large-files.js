import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { PATHS, exists, SIZE_THRESHOLDS } from '../utils/index.js';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
export class LargeFilesScanner extends BaseScanner {
    category = CATEGORIES['large-files'];
    async scan(options) {
        const minSize = options?.minSize ?? SIZE_THRESHOLDS.LARGE_FILE;
        const items = [];
        const searchPaths = [PATHS.downloads, PATHS.documents];
        for (const searchPath of searchPaths) {
            if (await exists(searchPath)) {
                const found = await this.findLargeFiles(searchPath, minSize, 3);
                items.push(...found);
            }
        }
        items.sort((a, b) => b.size - a.size);
        return this.createResult(items);
    }
    async findLargeFiles(dirPath, minSize, maxDepth, currentDepth = 0) {
        const items = [];
        if (currentDepth > maxDepth)
            return items;
        try {
            const entries = await readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.'))
                    continue;
                const fullPath = join(dirPath, entry.name);
                try {
                    if (entry.isFile()) {
                        const stats = await stat(fullPath);
                        if (stats.size >= minSize) {
                            items.push({
                                path: fullPath,
                                size: stats.size,
                                name: entry.name,
                                isDirectory: false,
                                modifiedAt: stats.mtime,
                            });
                        }
                    }
                    else if (entry.isDirectory()) {
                        const subItems = await this.findLargeFiles(fullPath, minSize, maxDepth, currentDepth + 1);
                        items.push(...subItems);
                    }
                }
                catch {
                    continue;
                }
            }
        }
        catch {
            // Ignore errors
        }
        return items;
    }
}
//# sourceMappingURL=large-files.js.map