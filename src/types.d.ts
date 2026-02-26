export type CategoryId = 'system-cache' | 'system-logs' | 'temp-files' | 'trash' | 'downloads' | 'browser-cache' | 'dev-cache' | 'homebrew' | 'docker' | 'ios-backups' | 'mail-attachments' | 'language-files' | 'large-files' | 'node-modules' | 'duplicates';
export type CategoryGroup = 'System Junk' | 'Development' | 'Storage' | 'Browsers' | 'Large Files';
export type SafetyLevel = 'safe' | 'moderate' | 'risky';
export interface Category {
    id: CategoryId;
    name: string;
    group: CategoryGroup;
    description: string;
    safetyLevel: SafetyLevel;
    safetyNote?: string;
}
export interface CleanableItem {
    path: string;
    size: number;
    name: string;
    isDirectory: boolean;
    modifiedAt?: Date;
}
export interface ScanResult {
    category: Category;
    items: CleanableItem[];
    totalSize: number;
    error?: string;
}
export interface ScanSummary {
    results: ScanResult[];
    totalSize: number;
    totalItems: number;
}
export interface CleanResult {
    category: Category;
    cleanedItems: number;
    freedSpace: number;
    errors: string[];
}
export interface CleanSummary {
    results: CleanResult[];
    totalFreedSpace: number;
    totalCleanedItems: number;
    totalErrors: number;
}
export interface ScannerOptions {
    verbose?: boolean;
    daysOld?: number;
    minSize?: number;
}
export interface Scanner {
    category: Category;
    scan(options?: ScannerOptions): Promise<ScanResult>;
    clean(items: CleanableItem[], dryRun?: boolean): Promise<CleanResult>;
}
export declare const CATEGORIES: Record<CategoryId, Category>;
//# sourceMappingURL=types.d.ts.map