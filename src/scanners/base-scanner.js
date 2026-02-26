import { removeItems } from '../utils/fs.js';
export class BaseScanner {
    async clean(items, dryRun = false) {
        const result = await removeItems(items, dryRun);
        return {
            category: this.category,
            cleanedItems: result.success,
            freedSpace: result.freedSpace,
            errors: result.failed > 0 ? [`Failed to remove ${result.failed} items`] : [],
        };
    }
    createResult(items, error) {
        const totalSize = items.reduce((sum, item) => sum + item.size, 0);
        return {
            category: this.category,
            items,
            totalSize,
            error,
        };
    }
}
//# sourceMappingURL=base-scanner.js.map