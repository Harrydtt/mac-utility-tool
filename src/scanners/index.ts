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
import { ProjectArtifactsScanner, NodeModulesScanner } from './node-modules.js';
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
  onProgress?: (completed: number, total: number, scanner: Scanner, result: ScanResult, duration: number) => void;
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
  const ignoredPaths = new Set((config.ignoredPaths || []).map(p => p.toLowerCase())); // Normalize
  const ignoredFolders = (config.ignoredFolders || []).map(f => f.toLowerCase());
  const ignoredCategories = new Set(config.ignoredCategories || []);

  // Function to check if a path is under any ignored folder
  const isIgnored = (itemPath: string): boolean => {
    const normalizedPath = itemPath.toLowerCase();

    // Exact file match
    if (ignoredPaths.has(normalizedPath)) return true;

    // Folder match (check if path starts with any ignored folder + /)
    return ignoredFolders.some(folder =>
      normalizedPath === folder || normalizedPath.startsWith(folder + '/')
    );
  };

  return results
    // First: filter out entire ignored categories STRICTLY
    .filter(result => !ignoredCategories.has(result.category.id))
    // Then: filter items within each category
    .map(result => {
      const filteredItems = result.items.filter(item => {
        return !isIgnored(item.path);
      });

      const newTotalSize = filteredItems.reduce((sum, item) => sum + item.size, 0);

      return {
        ...result,
        items: filteredItems,
        totalSize: newTotalSize
      };
    })
    // Filter out categories that became empty? No, keep them to show they were scanned but clean.
    ;
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
  onProgress?: (scanner: Scanner, result: ScanResult, duration: number) => void
): Promise<ScanSummary> {
  const config = await loadConfig();
  const ignoredCategories = new Set(config.ignoredCategories || []);
  const allScanners = getAllScanners();
  const scanners = allScanners.filter(s => !ignoredCategories.has(s.category.id));
  const ignoredPaths = new Set((config.ignoredPaths || []).map(p => p.toLowerCase()));
  const ignoredFolders = (config.ignoredFolders || []).map(f => f.toLowerCase());

  // Merge options with ignore settings
  const scanOptions: ParallelScanOptions = {
    ...options,
    ignoredPaths,
    ignoredFolders
  };

  const parallel = options?.parallel ?? true;
  const concurrency = options?.concurrency ?? 4;

  let completed = 0;
  const total = scanners.length;

  let results: ScanResult[] = [];

  if (parallel) {
    const tasks = scanners.map((scanner) => async () => {
      const start = Date.now();
      console.log(`[Scan] Starting ${scanner.category.name}...`);
      const result = await scanner.scan(scanOptions);
      const elapsed = Date.now() - start;
      console.log(`[Scan] Finished ${scanner.category.name} in ${elapsed}ms`);
      completed++;
      options?.onProgress?.(completed, total, scanner, result, elapsed);
      onProgress?.(scanner, result, elapsed);
      return { scanner, result };
    });

    const scanResults = await runWithConcurrency(tasks, concurrency);
    results = scanResults.map((r) => r.result);
  } else {
    for (const scanner of scanners) {
      const start = Date.now();
      const result = await scanner.scan(scanOptions);
      const elapsed = Date.now() - start;
      results.push(result);
      completed++;
      options?.onProgress?.(completed, total, scanner, result, elapsed);
      onProgress?.(scanner, result, elapsed);
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
  onProgress?: (scanner: Scanner, result: ScanResult, duration: number) => void
): Promise<ScanSummary> {
  const config = await loadConfig();
  const ignoredCategories = new Set(config.ignoredCategories || []);

  // Filter out ignored categories immediately
  const validCategoryIds = categoryIds.filter(id => !ignoredCategories.has(id));
  const scanners = validCategoryIds.map((id) => getScanner(id));
  const ignoredPaths = new Set((config.ignoredPaths || []).map(p => p.toLowerCase()));
  const ignoredFolders = (config.ignoredFolders || []).map(f => f.toLowerCase());

  // Merge options with ignore settings
  const scanOptions: ParallelScanOptions = {
    ...options,
    ignoredPaths,
    ignoredFolders
  };

  const parallel = options?.parallel ?? true;
  const concurrency = options?.concurrency ?? 4;

  let completed = 0;
  const total = scanners.length;

  let results: ScanResult[] = [];

  if (parallel) {
    const tasks = scanners.map((scanner) => async () => {
      const start = Date.now();
      const result = await scanner.scan(scanOptions);
      const elapsed = Date.now() - start;
      completed++;
      options?.onProgress?.(completed, total, scanner, result, elapsed);
      onProgress?.(scanner, result, elapsed);
      return { scanner, result };
    });

    const scanResults = await runWithConcurrency(tasks, concurrency);
    results = scanResults.map((r) => r.result);
  } else {
    for (const scanner of scanners) {
      const start = Date.now();
      const result = await scanner.scan(scanOptions);
      const elapsed = Date.now() - start;
      results.push(result);
      completed++;
      options?.onProgress?.(completed, total, scanner, result, elapsed);
      onProgress?.(scanner, result, elapsed);
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
  ProjectArtifactsScanner,
  NodeModulesScanner,
  DuplicatesScanner,
};
