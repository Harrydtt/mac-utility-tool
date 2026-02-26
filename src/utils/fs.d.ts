import type { CleanableItem } from '../types.js';
export declare function exists(path: string): Promise<boolean>;
export declare function getSize(path: string): Promise<number>;
export declare function getDirectorySize(dirPath: string): Promise<number>;
export declare function getItems(dirPath: string, options?: {
    recursive?: boolean;
    minAge?: number;
    minSize?: number;
    maxDepth?: number;
}): Promise<CleanableItem[]>;
export declare function getDirectoryItems(dirPath: string): Promise<CleanableItem[]>;
export declare function removeItem(path: string, dryRun?: boolean): Promise<boolean>;
export declare function removeItems(items: CleanableItem[], dryRun?: boolean, onProgress?: (current: number, total: number, item: CleanableItem) => void): Promise<{
    success: number;
    failed: number;
    freedSpace: number;
}>;
//# sourceMappingURL=fs.d.ts.map