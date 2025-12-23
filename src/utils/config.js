import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
const CONFIG_PATHS = [
    join(homedir(), '.maccleanerrc'),
    join(homedir(), '.config', 'mac-cleaner-cli', 'config.json'),
];
const DEFAULT_CONFIG = {
    downloadsDaysOld: 30,
    largeFilesMinSize: 500 * 1024 * 1024,
    backupEnabled: false,
    backupRetentionDays: 7,
    parallelScans: true,
    concurrency: 4,
    ignoredPaths: [],
    language: 'en',
    categoryOverrides: {},
    deleteMode: 'trash', // Default safe
    autoCleanSchedule: {
        enabled: false,
        frequency: 'daily',
        time: '09:00',
        categories: []
    }
};
let cachedConfig = null;
export async function loadConfig(configPath) {
    if (cachedConfig && !configPath) {
        return cachedConfig;
    }
    const paths = configPath ? [configPath] : CONFIG_PATHS;
    for (const path of paths) {
        try {
            await access(path);
            const content = await readFile(path, 'utf-8');
            const parsed = JSON.parse(content);
            cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
            // Ensure ignoredPaths is initialized if missing in file
            if (!cachedConfig.ignoredPaths)
                cachedConfig.ignoredPaths = [];
            return cachedConfig;
        }
        catch {
            continue;
        }
    }
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
}
export async function saveConfig(config, configPath) {
    const path = configPath ?? CONFIG_PATHS[0];
    await writeFile(path, JSON.stringify(config, null, 2));
    cachedConfig = config;
}
export async function addIgnoredPaths(paths) {
    const config = await loadConfig();
    if (!config.ignoredPaths) {
        config.ignoredPaths = [];
    }
    // Add unique paths
    for (const p of paths) {
        if (!config.ignoredPaths.includes(p)) {
            config.ignoredPaths.push(p);
        }
    }
    // Persist
    // We need to check if config file exists to update it, or create if not exists
    // but loadConfig splits logic. if used default config (no file), saveConfig uses default path.
    // We should verify if config file needs init? 
    // initConfig does that. if config exists, saveConfig overwrites.
    // Let's ensure we save to the first available path or default.
    // But wait, if the user doesn't have a config file, should avoiding a file create a config file?
    // Ideally yes, to persist the ignore preference.
    if (!(await configExists())) {
        await initConfig();
    }
    await saveConfig(config);
}
export function getDefaultConfig() {
    return { ...DEFAULT_CONFIG };
}
export async function configExists() {
    for (const path of CONFIG_PATHS) {
        try {
            await access(path);
            return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
export function clearConfigCache() {
    cachedConfig = null;
}
export async function initConfig() {
    const configPath = CONFIG_PATHS[0];
    const defaultConfig = {
        downloadsDaysOld: 30,
        largeFilesMinSize: 500 * 1024 * 1024,
        backupEnabled: false,
        backupRetentionDays: 7,
        parallelScans: true,
        concurrency: 4,
        extraPaths: {
            nodeModules: ['~/Projects', '~/Developer', '~/Code'],
            projects: ['~/Projects', '~/Developer', '~/Code'],
        },
    };
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    return configPath;
}
//# sourceMappingURL=config.js.map