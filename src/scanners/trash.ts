import { BaseScanner } from './base-scanner.js';
import { CATEGORIES, type ScanResult, type ScannerOptions } from '../types.js';
import { PATHS, exists, getDirectoryItems } from '../utils/index.js';

export class TrashScanner extends BaseScanner {
  category = CATEGORIES['trash'];

  async scan(_options?: ScannerOptions): Promise<ScanResult> {
    const items = [];

    console.log('[TrashScanner] Checking trash at:', PATHS.trash);

    if (await exists(PATHS.trash)) {
      try {
        console.log('[TrashScanner] Trash exists, scanning...');
        const trashItems = await getDirectoryItems(PATHS.trash);
        console.log(`[TrashScanner] Found ${trashItems.length} items in trash`);
        items.push(...trashItems);
      } catch (error: any) {
        console.error('[TrashScanner] Permission denied or error reading trash:', error.message);
        // Trash requires Full Disk Access permission
        // Return empty result instead of failing
      }
    } else {
      console.log('[TrashScanner] Trash does not exist');
    }

    return this.createResult(items);
  }
}







