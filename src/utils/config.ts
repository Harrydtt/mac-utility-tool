import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { CategoryId } from '../types.js';

const CONFIG_PATHS = [
  join(homedir(), '.maccleanerrc'),
  join(homedir(), '.config', 'mac-cleaner-cli', 'config.json'),
];

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
  ignoredPaths?: string[];        // Ignored files
  ignoredFolders?: string[];      // Ignored folders (entire directory trees)
  ignoredCategories?: string[];   // Ignored category IDs (skip entire category)
  // V3 Settings
  language?: 'en' | 'vn';
  categoryOverrides?: Record<string, 'safe' | 'moderate' | 'risky'>;
  autoCleanSchedule?: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'monthly';
    time: string; // "HH:MM"
    day?: number; // Day of week (0-6) or Day of month (1-31)
    categories: CategoryId[];
  };
  deleteMode?: 'trash' | 'permanent';
  alwaysScanTrash?: boolean;
  // Threat Scanner Settings
  threatCheckboxStates?: Record<string, boolean>;  // Checkbox states for threat scan items
  customThreatPaths?: string[];                    // Custom folders/USB paths added by user
  deletePermanently?: boolean;                     // Legacy - prefer deleteMode, but keep for backward compat
  aiCatEnabled?: boolean;                          // AI Cat Helper activation state
  aiCatModel?: string;                             // Gemini model to use (gemini-2.0-flash, gemini-1.5-flash, etc.)
}

const DEFAULT_CONFIG: Config = {
  downloadsDaysOld: 30,
  largeFilesMinSize: 500 * 1024 * 1024,
  backupEnabled: false,
  backupRetentionDays: 7,
  parallelScans: true,
  concurrency: 4,
  ignoredPaths: [],
  ignoredFolders: [],
  ignoredCategories: [],
  language: 'en',
  categoryOverrides: {},
  deleteMode: 'trash', // Default safe
  alwaysScanTrash: true, // Auto-scan trash when cleaning
  autoCleanSchedule: {
    enabled: false,
    frequency: 'daily',
    time: '09:00',
    categories: []
  }
};

let cachedConfig: Config | null = null;

export function clearConfigCache(): void {
  cachedConfig = null;
}

export async function loadConfig(configPath?: string): Promise<Config> {
  if (cachedConfig && !configPath) {
    return cachedConfig;
  }

  const paths = configPath ? [configPath] : CONFIG_PATHS;

  for (const path of paths) {
    try {
      await access(path);
      const content = await readFile(path, 'utf-8');
      const parsed = JSON.parse(content) as Partial<Config>;
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
      // Ensure ignoredPaths is initialized if missing in file
      if (!cachedConfig.ignoredPaths) cachedConfig.ignoredPaths = [];
      return cachedConfig;
    } catch {
      continue;
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const path = configPath ?? CONFIG_PATHS[0];
  await writeFile(path, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

export async function addIgnoredPaths(paths: string[]): Promise<void> {
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

export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

export async function configExists(): Promise<boolean> {
  for (const path of CONFIG_PATHS) {
    try {
      await access(path);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function initConfig(): Promise<string> {
  const configPath = CONFIG_PATHS[0];
  const defaultConfig: Config = {
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



