import type { Scanner, Category, ScanResult, CleanResult, CleanableItem, ScannerOptions } from '../types.js';
export declare abstract class BaseScanner implements Scanner {
    abstract category: Category;
    abstract scan(options?: ScannerOptions): Promise<ScanResult>;
    clean(items: CleanableItem[], dryRun?: boolean): Promise<CleanResult>;
    protected createResult(items: CleanableItem[], error?: string): ScanResult;
}
//# sourceMappingURL=base-scanner.d.ts.map