import { BaseScanner } from './base-scanner.js';
import { CATEGORIES } from '../types.js';
import { PATHS, exists, getSize } from '../utils/index.js';
import { stat } from 'fs/promises';
export class BrowserCacheScanner extends BaseScanner {
    category = CATEGORIES['browser-cache'];
    async scan(_options) {
        const items = [];
        const browserPaths = [
            { name: 'Google Chrome', path: PATHS.chromeCache },
            { name: 'Safari', path: PATHS.safariCache },
            { name: 'Firefox', path: PATHS.firefoxProfiles },
            { name: 'Arc', path: PATHS.arcCache },
        ];
        for (const browser of browserPaths) {
            if (await exists(browser.path)) {
                try {
                    const size = await getSize(browser.path);
                    const stats = await stat(browser.path);
                    items.push({
                        path: browser.path,
                        size,
                        name: `${browser.name} Cache`,
                        isDirectory: true,
                        modifiedAt: stats.mtime,
                    });
                }
                catch {
                    continue;
                }
            }
        }
        return this.createResult(items);
    }
}
//# sourceMappingURL=browser-cache.js.map