import { BaseScanner } from './base-scanner.js';
import { CATEGORIES, type ScanResult, type ScannerOptions } from '../types.js';
import { PATHS, exists, getDirectoryItems } from '../utils/index.js';

// Protected cache directories that should not be cleaned (apps currently running or critical system caches)
const PROTECTED_CACHE_DIRS = [
  'com.apple.Safari',
  'com.google.Chrome',
  'com.google.Chrome.helper',
  'com.microsoft.VSCode',
  'com.apple.bird',  // iCloud
  'com.apple.cloudkit',
  'CloudKit',
  'com.apple.nsurlsessiond',
  'com.apple.WebKit',
];

export class SystemCacheScanner extends BaseScanner {
  category = CATEGORIES['system-cache'];

  async scan(_options?: ScannerOptions): Promise<ScanResult> {
    const items = [];

    if (await exists(PATHS.userCaches)) {
      const allItems = await getDirectoryItems(PATHS.userCaches);

      // Filter out protected caches to prevent incomplete cleaning
      const filteredItems = allItems.filter(item => {
        const pathParts = item.path.split('/');
        const itemName = pathParts[pathParts.length - 1] || '';
        return !PROTECTED_CACHE_DIRS.some(dir => itemName.includes(dir));
      });

      items.push(...filteredItems);
    }

    return this.createResult(items);
  }
}







