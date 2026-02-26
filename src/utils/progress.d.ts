export interface ProgressOptions {
    total: number;
    label?: string;
    showPercentage?: boolean;
    showCount?: boolean;
    barWidth?: number;
}
export declare class ProgressBar {
    private current;
    private total;
    private label;
    private showPercentage;
    private showCount;
    private barWidth;
    private startTime;
    private lastRender;
    constructor(options: ProgressOptions);
    update(current: number, label?: string): void;
    increment(label?: string): void;
    private render;
    finish(message?: string): void;
}
export declare function createScanProgress(total: number): ProgressBar;
export declare function createCleanProgress(total: number): ProgressBar;
//# sourceMappingURL=progress.d.ts.map