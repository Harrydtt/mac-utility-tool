import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions } from '../types.js';
export declare class DownloadsScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(options?: ScannerOptions): Promise<ScanResult>;
}
//# sourceMappingURL=downloads.d.ts.map