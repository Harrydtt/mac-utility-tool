import { BaseScanner } from './base-scanner.js';
import { type ScanResult, type ScannerOptions } from '../types.js';
export declare class MailAttachmentsScanner extends BaseScanner {
    category: import("../types.js").Category;
    scan(_options?: ScannerOptions): Promise<ScanResult>;
}
//# sourceMappingURL=mail-attachments.d.ts.map