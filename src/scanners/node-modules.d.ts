import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions } from '../types.js';
export declare class NodeModulesScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(options?: ScannerOptions): Promise<ScanResult>;
    private findNodeModules;
    private getProjectName;
}
//# sourceMappingURL=node-modules.d.ts.map