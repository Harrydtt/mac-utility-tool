import type { CleanableItem } from '../types.js';
export declare function ensureBackupDir(): Promise<string>;
export declare function backupItem(item: CleanableItem, backupDir: string): Promise<boolean>;
export declare function backupItems(items: CleanableItem[], onProgress?: (current: number, total: number, item: CleanableItem) => void): Promise<{
    backupDir: string;
    success: number;
    failed: number;
}>;
export declare function cleanOldBackups(): Promise<number>;
export declare function listBackups(): Promise<{
    path: string;
    date: Date;
    size: number;
}[]>;
export declare function restoreBackup(backupDir: string): Promise<{
    success: number;
    failed: number;
}>;
export declare function getBackupDir(): string;
//# sourceMappingURL=backup.d.ts.map