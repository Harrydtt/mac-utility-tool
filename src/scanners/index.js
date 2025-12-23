import { loadConfig } from '../utils/config.js';
import { SystemCacheScanner } from './system-cache.js';
import { SystemLogsScanner } from './system-logs.js';
import { TempFilesScanner } from './temp-files.js';
import { TrashScanner } from './trash.js';
import { DownloadsScanner } from './downloads.js';
import { BrowserCacheScanner } from './browser-cache.js';
import { DevCacheScanner } from './dev-cache.js';
import { HomebrewScanner } from './homebrew.js';
import { DockerScanner } from './docker.js';
import { IosBackupsScanner } from './ios-backups.js';
import { MailAttachmentsScanner } from './mail-attachments.js';
import { LanguageFilesScanner } from './language-files.js';
import { LargeFilesScanner } from './large-files.js';
import { NodeModulesScanner } from './node-modules.js';
import { DuplicatesScanner } from './duplicates.js';
export const ALL_SCANNERS = {
    'system-cache': new SystemCacheScanner(),
    'system-logs': new SystemLogsScanner(),
    'temp-files': new TempFilesScanner(),
    'trash': new TrashScanner(),
    'downloads': new DownloadsScanner(),
    'browser-cache': new BrowserCacheScanner(),
    'dev-cache': new DevCacheScanner(),
    'homebrew': new HomebrewScanner(),
    'docker': new DockerScanner(),
    'ios-backups': new IosBackupsScanner(),
    'mail-attachments': new MailAttachmentsScanner(),
    'language-files': new LanguageFilesScanner(),
    'large-files': new LargeFilesScanner(),
    'node-modules': new NodeModulesScanner(),
    'duplicates': new DuplicatesScanner(),
};
export function getScanner(categoryId) {
    return ALL_SCANNERS[categoryId];
}
export function getAllScanners() {
    return Object.values(ALL_SCANNERS);
}
export function getAvailableScanners() {
    return Object.values(ALL_SCANNERS).map(s => ({
        id: s.category.id,
        name: s.category.name,
        safetyLevel: s.category.safetyLevel
    }));
}
async function runWithConcurrency(tasks, concurrency) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = task().then((result) => {
            results.push(result);
            executing.delete(p);
        });
        executing.add(p);
        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);
    return results;
}
async function filterIgnoredFiles(results) {
    const config = await loadConfig();
    const ignoredPaths = new Set(config.ignoredPaths || []);
    if (ignoredPaths.size === 0) {
        return results;
    }
    return results.map(result => {
        const filteredItems = result.items.filter(item => !ignoredPaths.has(item.path));
        return {
            ...result,
            items: filteredItems,
            totalSize: filteredItems.reduce((sum, item) => sum + item.size, 0)
        };
    });
}
export async function runAllScans(options, onProgress) {
    const scanners = getAllScanners();
    const parallel = options?.parallel ?? true;
    const concurrency = options?.concurrency ?? 4;
    let completed = 0;
    const total = scanners.length;
    let results = [];
    if (parallel) {
        const tasks = scanners.map((scanner) => async () => {
            const result = await scanner.scan(options);
            completed++;
            options?.onProgress?.(completed, total, scanner, result);
            onProgress?.(scanner, result);
            return { scanner, result };
        });
        const scanResults = await runWithConcurrency(tasks, concurrency);
        results = scanResults.map((r) => r.result);
    }
    else {
        for (const scanner of scanners) {
            const result = await scanner.scan(options);
            results.push(result);
            completed++;
            options?.onProgress?.(completed, total, scanner, result);
            onProgress?.(scanner, result);
        }
    }
    // Filter ignored files
    results = await filterIgnoredFiles(results);
    const totalSize = results.reduce((sum, r) => sum + r.totalSize, 0);
    const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);
    return { results, totalSize, totalItems };
}
export async function runScans(categoryIds, options, onProgress) {
    const scanners = categoryIds.map((id) => getScanner(id));
    const parallel = options?.parallel ?? true;
    const concurrency = options?.concurrency ?? 4;
    let completed = 0;
    const total = scanners.length;
    let results = [];
    if (parallel) {
        const tasks = scanners.map((scanner) => async () => {
            const result = await scanner.scan(options);
            completed++;
            options?.onProgress?.(completed, total, scanner, result);
            onProgress?.(scanner, result);
            return { scanner, result };
        });
        const scanResults = await runWithConcurrency(tasks, concurrency);
        results = scanResults.map((r) => r.result);
    }
    else {
        for (const scanner of scanners) {
            const result = await scanner.scan(options);
            results.push(result);
            completed++;
            options?.onProgress?.(completed, total, scanner, result);
            onProgress?.(scanner, result);
        }
    }
    // Filter ignored files
    results = await filterIgnoredFiles(results);
    const totalSize = results.reduce((sum, r) => sum + r.totalSize, 0);
    const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);
    return { results, totalSize, totalItems };
}
export { SystemCacheScanner, SystemLogsScanner, TempFilesScanner, TrashScanner, DownloadsScanner, BrowserCacheScanner, DevCacheScanner, HomebrewScanner, DockerScanner, IosBackupsScanner, MailAttachmentsScanner, LanguageFilesScanner, LargeFilesScanner, NodeModulesScanner, DuplicatesScanner, };
//# sourceMappingURL=index.js.map