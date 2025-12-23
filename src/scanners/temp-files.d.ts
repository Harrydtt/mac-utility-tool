import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions } from '../types.js';
export declare class TempFilesScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(_options?: ScannerOptions): Promise<ScanResult>;
    private scanVarFolders;
}
//# sourceMappingURL=temp-files.d.ts.map