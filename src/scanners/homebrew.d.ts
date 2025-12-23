import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions, type CleanableItem, type CleanResult } from '../types.js';
export declare class HomebrewScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(_options?: ScannerOptions): Promise<ScanResult>;
    clean(items: CleanableItem[], dryRun?: boolean): Promise<CleanResult>;
}
//# sourceMappingURL=homebrew.d.ts.map