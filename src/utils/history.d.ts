export interface CleanupLog {
    id: string;
    timestamp: string;
    totalFreed: number;
    itemsCount: number;
    mode: 'trash' | 'permanent' | 'ui-trash' | 'ui-permanent';
    categories?: string[];
}
export declare function getHistory(): Promise<CleanupLog[]>;
export declare function saveHistory(log: CleanupLog): Promise<void>;
export declare function clearHistory(): Promise<void>;
//# sourceMappingURL=history.d.ts.map