import type { CategoryId } from '../types.js';
export interface Config {
    defaultCategories?: CategoryId[];
    excludeCategories?: CategoryId[];
    downloadsDaysOld?: number;
    largeFilesMinSize?: number;
    backupEnabled?: boolean;
    backupRetentionDays?: number;
    parallelScans?: boolean;
    concurrency?: number;
    extraPaths?: {
        nodeModules?: string[];
        projects?: string[];
    };
    ignoredPaths?: string[];
    language?: 'en' | 'vn';
    categoryOverrides?: Record<string, 'safe' | 'risky'>;
    autoCleanSchedule?: {
        enabled: boolean;
        frequency: 'daily' | 'weekly' | 'monthly';
        time: string;
        day?: number;
        categories: CategoryId[];
    };
    deleteMode?: 'trash' | 'permanent';
}
export declare function loadConfig(configPath?: string): Promise<Config>;
export declare function saveConfig(config: Config, configPath?: string): Promise<void>;
export declare function addIgnoredPaths(paths: string[]): Promise<void>;
export declare function getDefaultConfig(): Config;
export declare function configExists(): Promise<boolean>;
export declare function clearConfigCache(): void;
export declare function initConfig(): Promise<string>;
//# sourceMappingURL=config.d.ts.map