import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig, saveConfig, type Config } from '../utils/config.js';
import { moveToTrash } from '../utils/trash.js';

export interface ThreatPattern {
    name: string;
    paths: string[];
    severity: 'low' | 'medium' | 'high';
    description?: string;
}

export interface ThreatDatabase {
    sources: Array<{
        name: string;
        url: string;
        description: string;
    }>;
    adware: ThreatPattern[];
    malware: ThreatPattern[];
    suspiciousKeywords: string[];
}

export interface DetectedThreat {
    name: string;
    path: string;
    severity: 'low' | 'medium' | 'high';
    size: number;
    type: 'adware' | 'malware' | 'suspicious';
}

export interface ThreatHistoryEntry {
    timestamp: number;
    count: number;
}

// Embedded threat database (to avoid file path issues in packaged app)
const THREAT_DB: ThreatDatabase = {
    sources: [
        {
            name: "Objective-See",
            description: "Created by Patrick Wardle (ex-NSA), open-source macOS malware database",
            url: "https://objective-see.org"
        },
        {
            name: "MalwareBytes Hashes",
            description: "Public malware hash database",
            url: "https://www.malwarebytes.com"
        },
        {
            name: "ClamAV",
            description: "Open-source antivirus database (primarily Windows, some macOS)",
            url: "https://www.clamav.net"
        }
    ],
    adware: [
        {
            name: "MacKeeper",
            paths: [
                "/Applications/MacKeeper.app",
                "~/Library/Application Support/MacKeeper"
            ],
            severity: "medium"
        },
        {
            name: "Advanced Mac Cleaner",
            paths: [
                "/Applications/Advanced Mac Cleaner.app",
                "~/Library/Application Support/Advanced Mac Cleaner"
            ],
            severity: "medium"
        },
        {
            name: "Mac Auto Fixer",
            paths: ["/Applications/Mac Auto Fixer.app"],
            severity: "medium"
        },
        {
            name: "MacBooster",
            paths: ["/Applications/MacBooster.app"],
            severity: "low"
        }
    ],
    malware: [],
    suspiciousKeywords: [
        "miner",
        "crypto",
        "adware",
        "updater",
        "searchBaron",
        "pcvark",
        "MacKeeper"
    ]
};

// Load threat database
export async function loadThreatDatabase(): Promise<ThreatDatabase> {
    console.log('[Threats] Using embedded threat database');
    return THREAT_DB;
}

// Check if path should be ignored based on blacklist
function isPathIgnored(targetPath: string, config: Config): boolean {
    const ignoredPaths = config.ignoredPaths || [];
    const ignoredFolders = config.ignoredFolders || [];

    // Check exact path match
    if (ignoredPaths.includes(targetPath)) {
        return true;
    }

    // Check if path is within ignored folder
    return ignoredFolders.some((folder: string) => {
        return targetPath === folder || targetPath.startsWith(folder + '/');
    });
}

// Get file size
async function getFileSize(filePath: string): Promise<number> {
    try {
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) {
            // Recursively calculate directory size
            let totalSize = 0;
            const items = await fs.readdir(filePath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(filePath, item.name);
                totalSize += await getFileSize(itemPath);
            }

            return totalSize;
        }
        return stats.size;
    } catch {
        return 0;
    }
}

// Expand tilde in paths
function expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
        return path.join(process.env.HOME || '', filePath.slice(2));
    }
    return filePath;
}

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Global abort flag for scan
let threatScanAborted = false;

// Abort threat scan
export function abortThreatScan(): void {
    threatScanAborted = true;
    console.log('[Threats] Scan abort requested');
}

// Reset abort flag
export function resetThreatAbort(): void {
    threatScanAborted = false;
}

// Get folder size in MB (for dynamic time estimation)
export async function getFolderSizeMB(folderPath: string): Promise<number> {
    const expanded = expandPath(folderPath);
    try {
        const stats = await fs.stat(expanded);
        if (!stats.isDirectory()) {
            return stats.size / (1024 * 1024);
        }

        // Quick estimate - count files and assume average size
        let totalSize = 0;
        const entries = await fs.readdir(expanded, { withFileTypes: true });

        for (const entry of entries) {
            if (threatScanAborted) break;
            try {
                const entryPath = path.join(expanded, entry.name);
                const entryStat = await fs.stat(entryPath);
                totalSize += entryStat.size;
            } catch { }
        }

        return totalSize / (1024 * 1024);
    } catch {
        return 0;
    }
}

// Scan for threats
export async function scanThreats(scanPaths: string[]): Promise<DetectedThreat[]> {
    threatScanAborted = false; // Reset at start
    const threats: DetectedThreat[] = [];
    const config = await loadConfig();
    const db = await loadThreatDatabase();

    console.log('[Threats] Starting scan...', scanPaths);

    // Expand and normalize scan paths
    const expandedPaths = scanPaths.map(p => expandPath(p));

    // Validate all paths exist BEFORE scanning
    for (const scanPath of expandedPaths) {
        try {
            await fs.access(scanPath);
        } catch (accessError) {
            console.error('[Threats] Path does not exist:', scanPath);
            throw new Error(`Path not found: ${scanPath}`);
        }
    }

    // Check known adware
    for (const adware of db.adware) {
        if (threatScanAborted) break;
        for (const pattern of adware.paths) {
            if (threatScanAborted) break;
            const expandedPattern = expandPath(pattern);

            // Check if pattern matches any of the scan paths
            const shouldScan = expandedPaths.some(scanPath => {
                // If scanning /Applications, check apps in /Applications
                if (scanPath === '/Applications' && expandedPattern.startsWith('/Applications/')) {
                    return true;
                }
                // If scanning library paths
                if (expandedPattern.startsWith(scanPath)) {
                    return true;
                }
                return false;
            });

            if (!shouldScan) continue;

            // Check if path is ignored
            if (isPathIgnored(expandedPattern, config)) {
                console.log('[Threats] Skipping (blacklisted):', expandedPattern);
                continue;
            }

            // Check if exists
            if (await fileExists(expandedPattern)) {
                const size = await getFileSize(expandedPattern);
                threats.push({
                    name: adware.name,
                    path: expandedPattern,
                    severity: adware.severity,
                    size,
                    type: 'adware'
                });

                console.log('[Threats] Found adware:', adware.name);
            }
        }
    }

    // Check known malware
    for (const malware of db.malware) {
        if (threatScanAborted) break;
        for (const pattern of malware.paths) {
            if (threatScanAborted) break;
            const expandedPattern = expandPath(pattern);

            const shouldScan = expandedPaths.some(scanPath => {
                return expandedPattern.startsWith(scanPath);
            });

            if (!shouldScan) continue;

            if (isPathIgnored(expandedPattern, config)) {
                console.log('[Threats] Skipping (blacklisted):', expandedPattern);
                continue;
            }

            if (await fileExists(expandedPattern)) {
                const size = await getFileSize(expandedPattern);
                threats.push({
                    name: malware.name,
                    path: expandedPattern,
                    severity: malware.severity,
                    size,
                    type: 'malware'
                });

                console.log('[Threats] Found malware:', malware.name);
            }
        }
    }

    // Check LaunchAgents for suspicious keywords
    const launchAgentsPath = expandPath('~/Library/LaunchAgents');
    if (expandedPaths.includes(launchAgentsPath)) {
        if (!isPathIgnored(launchAgentsPath, config)) {
            try {
                const agents = await fs.readdir(launchAgentsPath);

                for (const agent of agents) {
                    const agentName = agent.toLowerCase();
                    const hasSuspiciousKeyword = db.suspiciousKeywords.some(keyword =>
                        agentName.includes(keyword.toLowerCase())
                    );

                    if (hasSuspiciousKeyword) {
                        const agentPath = path.join(launchAgentsPath, agent);

                        if (!isPathIgnored(agentPath, config)) {
                            const size = await getFileSize(agentPath);
                            threats.push({
                                name: `Suspicious LaunchAgent: ${agent}`,
                                path: agentPath,
                                severity: 'medium',
                                size,
                                type: 'suspicious'
                            });

                            console.log('[Threats] Found suspicious agent:', agent);
                        }
                    }
                }
            } catch (error) {
                console.warn('[Threats] Could not scan LaunchAgents:', error);
            }
        }
    }

    // ClamAV Deep Scan (if installed)
    try {
        const { checkClamAVInstalled, scanWithClamAV } = await import('../utils/clamav.js');
        const { installed } = await checkClamAVInstalled();

        if (installed) {
            console.log('[Threats] Running ClamAV deep scan...');

            // Filter paths that still exist (may have been cleaned)
            const existingPaths: string[] = [];
            for (const p of expandedPaths) {
                try {
                    await fs.access(p);
                    existingPaths.push(p);
                } catch {
                    console.log('[Threats] Path no longer exists, skipping:', p);
                }
            }

            if (existingPaths.length > 0) {
                const clamResult = await scanWithClamAV(existingPaths);

                if (clamResult.threats && clamResult.threats.length > 0) {
                    for (const threat of clamResult.threats) {
                        // Check if path is ignored
                        if (!isPathIgnored(threat.path, config)) {
                            const size = await getFileSize(threat.path).catch(() => 0);
                            threats.push({
                                name: threat.name,
                                path: threat.path,
                                severity: threat.severity || 'high',
                                size,
                                type: threat.type || 'malware'
                            });
                        }
                    }
                    console.log('[Threats] ClamAV found', clamResult.threats.length, 'additional threats');
                }
            }
        } else {
            console.log('[Threats] ClamAV not installed, using pattern matching only');
        }
    } catch (clamError) {
        console.warn('[Threats] ClamAV scan error:', clamError);
    }

    console.log('[Threats] Scan complete. Found', threats.length, 'threats');
    return threats;
}

// Delete threats
export async function deleteThreats(threatPaths: string[]): Promise<number> {
    console.log('[Threats] Deleting threats:', threatPaths);

    // Use moveToTrash which respects settings
    const result = await moveToTrash(threatPaths);

    if (!result.success) {
        throw new Error(result.error || 'Failed to delete threats');
    }

    // Add to history
    await addThreatHistory(threatPaths.length);

    console.log('[Threats] Deleted', threatPaths.length, 'threats');
    return threatPaths.length;
}

// Get threat deletion history
export async function getThreatHistory(): Promise<ThreatHistoryEntry[]> {
    try {
        const config = await loadConfig();
        return (config as any).threatHistory || [];
    } catch {
        return [];
    }
}

// Add threat deletion to history (max 3 entries)
async function addThreatHistory(count: number): Promise<void> {
    try {
        const config = await loadConfig();
        const history: ThreatHistoryEntry[] = (config as any).threatHistory || [];

        // Add new entry
        history.unshift({
            timestamp: Date.now(),
            count
        });

        // Keep only last 3
        const updatedHistory = history.slice(0, 3);

        // Update config
        await saveConfig({ ...config, threatHistory: updatedHistory } as any);

        console.log('[Threats] Updated history, total entries:', updatedHistory.length);
    } catch (error) {
        console.error('[Threats] Failed to update history:', error);
    }
}
