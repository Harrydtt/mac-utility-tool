import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { PATHS, exists, getDirectoryItems } from '../utils/index.js';
export class MailAttachmentsScanner extends BaseScanner {
    category = CATEGORIES['mail-attachments'];
    async scan(_options) {
        const items = [];
        if (await exists(PATHS.mailDownloads)) {
            const mailItems = await getDirectoryItems(PATHS.mailDownloads);
            items.push(...mailItems);
        }
        return this.createResult(items);
    }
}
//# sourceMappingURL=mail-attachments.js.map