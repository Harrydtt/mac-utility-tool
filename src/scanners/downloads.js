import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { PATHS, exists, getItems } from '../utils/index.js';
export class DownloadsScanner extends BaseScanner {
    category = CATEGORIES['downloads'];
    async scan(options) {
        const daysOld = options?.daysOld ?? 30;
        const items = [];
        if (await exists(PATHS.downloads)) {
            const downloadItems = await getItems(PATHS.downloads, {
                minAge: daysOld,
                recursive: false,
            });
            items.push(...downloadItems);
        }
        return this.createResult(items);
    }
}
//# sourceMappingURL=downloads.js.map