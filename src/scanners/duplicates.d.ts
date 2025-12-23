import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions } from '../types.js';
export declare class DuplicatesScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(options?: ScannerOptions): Promise<ScanResult>;
    private collectFiles;
    private findDuplicates;
    private convertToCleanableItems;
    private getFileName;
}
//# sourceMappingURL=duplicates.d.ts.map