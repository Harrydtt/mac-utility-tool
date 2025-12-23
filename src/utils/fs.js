import { lstat, readdir, rm, access } from 'fs/promises';
import { join } from 'path';
export async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
export async function getSize(path) {
    try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink()) {
            return stats.size;
        }
        if (stats.isFile()) {
            return stats.size;
        }
        if (stats.isDirectory()) {
            return await getDirectorySize(path);
        }
        return 0;
    }
    catch {
        return 0;
    }
}
export async function getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            try {
                if (entry.isSymbolicLink()) {
                    const stats = await lstat(fullPath);
                    totalSize += stats.size;
                }
                else if (entry.isFile()) {
                    const stats = await lstat(fullPath);
                    totalSize += stats.size;
                }
                else if (entry.isDirectory()) {
                    totalSize += await getDirectorySize(fullPath);
                }
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return 0;
    }
    return totalSize;
}
export async function getItems(dirPath, options = {}) {
    const items = [];
    const { recursive = false, minAge, minSize, maxDepth = 10 } = options;
    async function processDir(currentPath, depth) {
        if (depth > maxDepth)
            return;
        try {
            const entries = await readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(currentPath, entry.name);
                try {
                    const stats = await lstat(fullPath);
                    if (minAge) {
                        const daysOld = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
                        if (daysOld < minAge)
                            continue;
                    }
                    let size;
                    if (stats.isSymbolicLink()) {
                        size = stats.size;
                    }
                    else if (entry.isDirectory()) {
                        size = await getDirectorySize(fullPath);
                    }
                    else {
                        size = stats.size;
                    }
                    if (minSize && size < minSize)
                        continue;
                    items.push({
                        path: fullPath,
                        size,
                        name: entry.name,
                        isDirectory: entry.isDirectory(),
                        modifiedAt: stats.mtime,
                    });
                    if (recursive && entry.isDirectory() && !stats.isSymbolicLink()) {
                        await processDir(fullPath, depth + 1);
                    }
                }
                catch {
                    continue;
                }
            }
        }
        catch {
            return;
        }
    }
    await processDir(dirPath, 0);
    return items;
}
export async function getDirectoryItems(dirPath) {
    const items = [];
    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            try {
                const stats = await lstat(fullPath);
                let size;
                if (stats.isSymbolicLink()) {
                    size = stats.size;
                }
                else if (entry.isDirectory()) {
                    size = await getDirectorySize(fullPath);
                }
                else {
                    size = stats.size;
                }
                items.push({
                    path: fullPath,
                    size,
                    name: entry.name,
                    isDirectory: entry.isDirectory(),
                    modifiedAt: stats.mtime,
                });
            }
            catch {
                continue;
            }
        }
    }
    catch {
        return [];
    }
    return items;
}
export async function removeItem(path, dryRun = false) {
    if (dryRun) {
        return true;
    }
    try {
        await rm(path, { recursive: true, force: true });
        return true;
    }
    catch {
        return false;
    }
}
export async function removeItems(items, dryRun = false, onProgress) {
    let success = 0;
    let failed = 0;
    let freedSpace = 0;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        onProgress?.(i + 1, items.length, item);
        const removed = await removeItem(item.path, dryRun);
        if (removed) {
            success++;
            freedSpace += item.size;
        }
        else {
            failed++;
        }
    }
    return { success, failed, freedSpace };
}
//# sourceMappingURL=fs.js.map