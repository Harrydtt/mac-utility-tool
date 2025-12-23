import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { PATHS, exists, getDirectoryItems } from '../utils/index.js';
export class SystemCacheScanner extends BaseScanner {
    category = CATEGORIES['system-cache'];
    async scan(_options) {
        const items = [];
        if (await exists(PATHS.userCaches)) {
            const userCacheItems = await getDirectoryItems(PATHS.userCaches);
            items.push(...userCacheItems);
        }
        return this.createResult(items);
    }
}
//# sourceMappingURL=system-cache.js.map