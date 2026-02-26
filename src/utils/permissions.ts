import { access, constants } from 'fs/promises';
import type { CleanableItem } from '../types.js';

/**
 * Patterns for files/folders that should never be deleted
 * Only include files that are ALWAYS locked or system-critical
 */
const BLACKLIST_PATTERNS = [
    // macOS system folders that are always locked
    'TemporaryItems',
    '.AddressBookLocks',
    'AudioComponentRegistrar',
    'WebKitCache',

    // Only specific Apple services that are always running
    /^com\.apple\.Safari$/,
    /^com\.apple\.bird$/,
    /^com\.apple\.cloudd$/,
    /^com\.apple\..+Service$/,  // All Apple services ending with "Service"
    /^com\.apple\..+Agent$/,     // All Apple agents
    /^com\.apple\..+Agent$/,     // All Apple agents
    /^com\.apple\..+Helper$/,    // All Apple helpers
    'com.apple.identityservicesd',
    'com.apple.tccd',
];

/**
 * Check if a path matches any blacklist pattern
 */
function isBlacklisted(path: string): boolean {
    const parts = path.split('/');

    // Check if any part of the path matches a blacklist pattern
    return parts.some(part => {
        return BLACKLIST_PATTERNS.some(pattern => {
            if (typeof pattern === 'string') {
                return part === pattern;
            } else {
                return pattern.test(part);
            }
        });
    });
}

/**
 * Check if a file/directory can actually be deleted
 */
export async function canDelete(path: string): Promise<boolean> {
    // First: check blacklist
    if (isBlacklisted(path)) {
        return false;
    }

    // Second: check write permission
    try {
        await access(path, constants.W_OK);
        return true;
    } catch (error: any) {
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return false;
        }
        // For other errors (ENOENT, etc.), assume we can't delete
        return false;
    }
}

/**
 * Filter out items that cannot be deleted due to permissions or being blacklisted
 */
export async function filterDeletableItems(items: CleanableItem[]): Promise<CleanableItem[]> {
    console.log(`[Permissions] Checking ${items.length} items for deletability...`);

    const results = await Promise.all(
        items.map(async (item) => {
            const deletable = await canDelete(item.path);
            if (!deletable) {
                console.log(`[Permissions] Filtered out: ${item.path}`);
            }
            return {
                item,
                canDelete: deletable
            };
        })
    );

    const deletableItems = results.filter(r => r.canDelete).map(r => r.item);
    console.log(`[Permissions] ${deletableItems.length}/${items.length} items are deletable`);

    return deletableItems;
}
