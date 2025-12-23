import type { Scanner, CategoryId, ScanResult, ScannerOptions, ScanSummary } from '../types.js';
import { loadConfig } from '../utils/config.js';
import { filterDeletableItems } from '../utils/permissions.js';
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

export const ALL_SCANNERS: Record<CategoryId, Scanner> = {
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

export function getScanner(categoryId: CategoryId): Scanner {
  return ALL_SCANNERS[categoryId];
}

export function getAllScanners(): Scanner[] {
  return Object.values(ALL_SCANNERS);
}

export function getAvailableScanners(): { id: string; name: string; safetyLevel: string }[] {
  return Object.values(ALL_SCANNERS).map(s => ({
    id: s.category.id,
    name: s.category.name,
    safetyLevel: s.category.safetyLevel
  }));
}

export interface ParallelScanOptions extends ScannerOptions {
  parallel?: boolean;
  concurrency?: number;
  onProgress?: (completed: number, total: number, scanner: Scanner, result: ScanResult) => void;
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const task of tasks) {
    const p: Promise<void> = task().then((result) => {
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

async function filterIgnoredFiles(results: ScanResult[]): Promise<ScanResult[]> {
  const config = await loadConfig();
  const ignoredPaths = new Set(config.ignoredPaths || []);
  const ignoredFolders = config.ignoredFolders || [];
  const ignoredCategories = new Set(config.ignoredCategories || []);

  // Function to check if a path is under any ignored folder
  const isUnderIgnoredFolder = (itemPath: string): boolean => {
    return ignoredFolders.some(folder =>
      itemPath === folder || itemPath.startsWith(folder + '/')
    );
  };

  return results
    // First: filter out entire ignored categories
    .filter(result => !ignoredCategories.has(result.category.id))
    // Then: filter items within each category
    .map(result => {
      const filteredItems = result.items.filter(item => {
        // Check if exact path is ignored
        if (ignoredPaths.has(item.path)) return false;
        // Check if under an ignored folder
        if (isUnderIgnoredFolder(item.path)) return false;
        return true;
      });
      return {
        ...result,
        items: filteredItems,
        totalSize: filteredItems.reduce((sum, item) => sum + item.size, 0)
      };
    });
}

async function filterProtectedFiles(results: ScanResult[]): Promise<ScanResult[]> {
  console.log('[Scanner] Filtering out system-protected files...');

  const filtered = await Promise.all(
    results.map(async (result) => {
      const deletableItems = await filterDeletableItems(result.items);
      const removed = result.items.length - deletableItems.length;

      if (removed > 0) {
        console.log(`[Scanner] ${result.category.name}: Filtered out ${removed} protected files`);
      }

      return {
        ...result,
        items: deletableItems,
        totalSize: deletableItems.reduce((sum, item) => sum + item.size, 0)
      };
    })
  );

  return filtered;
}

export async function runAllScans(
  options?: ParallelScanOptions,
  onProgress?: (scanner: Scanner, result: ScanResult) => void
): Promise<ScanSummary> {
  const scanners = getAllScanners();
  const parallel = options?.parallel ?? true;
  const concurrency = options?.concurrency ?? 4;

  let completed = 0;
  const total = scanners.length;

  let results: ScanResult[] = [];

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
  } else {
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

  // Filter out system-protected files
  results = await filterProtectedFiles(results);

  const totalSize = results.reduce((sum, r) => sum + r.totalSize, 0);
  const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);

  return { results, totalSize, totalItems };
}

export async function runScans(
  categoryIds: CategoryId[],
  options?: ParallelScanOptions,
  onProgress?: (scanner: Scanner, result: ScanResult) => void
): Promise<ScanSummary> {
  const scanners = categoryIds.map((id) => getScanner(id));
  const parallel = options?.parallel ?? true;
  const concurrency = options?.concurrency ?? 4;

  let completed = 0;
  const total = scanners.length;

  let results: ScanResult[] = [];

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
  } else {
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

  // Filter out system-protected files
  results = await filterProtectedFiles(results);

  const totalSize = results.reduce((sum, r) => sum + r.totalSize, 0);
  const totalItems = results.reduce((sum, r) => sum + r.items.length, 0);

  return { results, totalSize, totalItems };
}

export {
  SystemCacheScanner,
  SystemLogsScanner,
  TempFilesScanner,
  TrashScanner,
  DownloadsScanner,
  BrowserCacheScanner,
  DevCacheScanner,
  HomebrewScanner,
  DockerScanner,
  IosBackupsScanner,
  MailAttachmentsScanner,
  LanguageFilesScanner,
  LargeFilesScanner,
  NodeModulesScanner,
  DuplicatesScanner,
};
