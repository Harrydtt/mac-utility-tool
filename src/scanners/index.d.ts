import type { Scanner, CategoryId, ScanResult, ScannerOptions, ScanSummary } from '../types.js';
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
export declare const ALL_SCANNERS: Record<CategoryId, Scanner>;
export declare function getScanner(categoryId: CategoryId): Scanner;
export declare function getAllScanners(): Scanner[];
export declare function getAvailableScanners(): {
    id: string;
    name: string;
    safetyLevel: string;
}[];
export interface ParallelScanOptions extends ScannerOptions {
    parallel?: boolean;
    concurrency?: number;
    onProgress?: (completed: number, total: number, scanner: Scanner, result: ScanResult) => void;
}
export declare function runAllScans(options?: ParallelScanOptions, onProgress?: (scanner: Scanner, result: ScanResult) => void): Promise<ScanSummary>;
export declare function runScans(categoryIds: CategoryId[], options?: ParallelScanOptions, onProgress?: (scanner: Scanner, result: ScanResult) => void): Promise<ScanSummary>;
export { SystemCacheScanner, SystemLogsScanner, TempFilesScanner, TrashScanner, DownloadsScanner, BrowserCacheScanner, DevCacheScanner, HomebrewScanner, DockerScanner, IosBackupsScanner, MailAttachmentsScanner, LanguageFilesScanner, LargeFilesScanner, NodeModulesScanner, DuplicatesScanner, };
//# sourceMappingURL=index.d.ts.map