import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function setupDiagnosticHandlers() {
    console.log('[Diagnostics] Setting up IPC handlers...');

    ipcMain.handle('diagnostics:getLogs', async () => {
        const logs: any[] = [];
        const directories = [
            path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports'),
            '/Library/Logs/DiagnosticReports'
        ];

        for (const dir of directories) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file.startsWith('.')) continue; // skip hidden

                    const filePath = path.join(dir, file);
                    try {
                        const stats = await fs.stat(filePath);
                        if (!stats.isFile()) continue;

                        let severity = 'normal';
                        let badge = 'green';
                        const ext = path.extname(file).toLowerCase();

                        if (ext === '.panic' || file.toLowerCase().includes('panic')) {
                            severity = 'critical';
                            badge = 'red';
                        } else if (ext === '.crash' || ext === '.ips') {
                            severity = 'dangerous';
                            badge = 'orange';
                        } else if (ext === '.spin' || ext === '.diag') {
                            severity = 'concern';
                            badge = 'yellow';
                        }

                        // Read snippet to find process name or exception
                        let errorSnippet = '';
                        let appName = '';
                        try {
                            const fd = await fs.open(filePath, 'r');
                            const buffer = Buffer.alloc(4096);
                            const { bytesRead } = await fd.read(buffer, 0, 4096, 0);
                            await fd.close();

                            const content = buffer.toString('utf8', 0, bytesRead);

                            // Try structured fields first
                            const processMatch = content.match(/Process:\s+(?:\[\d+\]\s+)?([^\n\[]+)/);
                            const exceptionMatch = content.match(/Exception Type:\s+([^\n]+)/);
                            const bugTypeMatch = content.match(/"bug_type"\s*:\s*"([^"]+)"/);
                            const procNameMatch = content.match(/"procName"\s*:\s*"([^"]+)"/);
                            const coalitionMatch = content.match(/"coalitionName"\s*:\s*"([^"]+)"/);
                            const appNameMatch = content.match(/"app_name"\s*:\s*"([^"]+)"/);
                            const terminationMatch = content.match(/Termination Reason:\s+([^\n]+)/);

                            // Priority: procName/Process > coalitionName > app_name > filename
                            if (processMatch) {
                                appName = processMatch[1].trim();
                            } else if (procNameMatch) {
                                appName = procNameMatch[1].trim();
                            } else if (coalitionMatch) {
                                // coalitionName is like "com.apple.Safari" — extract last part
                                const parts = coalitionMatch[1].trim().split('.');
                                appName = parts[parts.length - 1];
                            } else if (appNameMatch) {
                                appName = appNameMatch[1].trim();
                            }

                            // Build a meaningful snippet from available data
                            if (appName) {
                                errorSnippet = appName;
                                if (exceptionMatch) {
                                    errorSnippet += ` — ${exceptionMatch[1].trim()}`;
                                } else if (terminationMatch) {
                                    errorSnippet += ` — ${terminationMatch[1].trim().substring(0, 60)}`;
                                } else if (bugTypeMatch) {
                                    errorSnippet += ` (type ${bugTypeMatch[1].trim()})`;
                                }
                            } else if (bugTypeMatch) {
                                errorSnippet = `System event (type ${bugTypeMatch[1].trim()})`;
                            } else {
                                errorSnippet = '';
                            }

                            // If we still don't have an appName, extract from filename
                            if (!appName) {
                                // e.g. "Safari_2026-02-24-123456.ips" → "Safari"
                                // e.g. "com.apple.Safari-2026-02-24.crash" → "Safari"
                                const baseName = file.replace(/\.[^/.]+$/, ''); // remove extension
                                const cleaned = baseName
                                    .replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/, '') // remove date suffix
                                    .replace(/[-_]\d{6,}.*$/, ''); // remove timestamp suffix
                                const parts = cleaned.split('.');
                                appName = parts[parts.length - 1].replace(/[-_]/g, ' ');
                            }

                            // Override severity based on bug_type if found
                            if (bugTypeMatch && bugTypeMatch[1]) {
                                const typeStr = bugTypeMatch[1].trim();
                                if (['210', '115'].includes(typeStr)) {
                                    severity = 'critical';
                                    badge = 'red';
                                } else if (['309', '288', '109'].includes(typeStr)) {
                                    severity = 'dangerous';
                                    badge = 'orange';
                                }
                            }
                        } catch (e) { /* ignore read error for snippet */ }

                        logs.push({
                            path: filePath,
                            name: file,
                            size: stats.size,
                            modifiedAt: stats.mtime,
                            severity,
                            badge,
                            errorSnippet,
                            appName
                        });
                    } catch (e) {
                        // ignore unreadable files
                    }
                }
            } catch (dirErr) {
                console.error(`[Diagnostics] Unreadable directory: ${dir}`, dirErr);
            }
        }

        logs.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
        return { success: true, logs };
    });

    ipcMain.handle('diagnostics:readLog', async (_event, { filePath }) => {
        const allowedDirs = [
            path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports'),
            '/Library/Logs/DiagnosticReports'
        ];

        const isAllowed = allowedDirs.some(dir => filePath.startsWith(dir));
        if (!isAllowed) {
            return { success: false, error: 'Unauthorized path' };
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            return { success: true, content };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('diagnostics:deleteLogs', async (event, { paths }: { paths: string[] }) => {
        const allowedDirs = [
            path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports'),
            '/Library/Logs/DiagnosticReports'
        ];

        let deletedCount = 0;
        let failedCount = 0;

        for (const filePath of paths) {
            const isAllowed = allowedDirs.some(dir => filePath.startsWith(dir));
            if (!isAllowed) {
                console.warn(`[Diagnostics] Attempted to delete unauth path: ${filePath}`);
                failedCount++;
                continue;
            }

            try {
                // Permanently delete the file (or use move to trash if preferred, but unlink is simple for logs)
                await fs.unlink(filePath);
                deletedCount++;
            } catch (e) {
                console.error(`[Diagnostics] Failed to delete file ${filePath}:`, e);
                failedCount++;
            }
        }

        return { success: true, deletedCount, failedCount };
    });

    ipcMain.handle('diagnostics:getRealtimeRAM', async () => {
        try {
            const totalMemBytes = os.totalmem();
            const totalMemGB = totalMemBytes / (1024 * 1024 * 1024);

            const { stdout: vmStatOut } = await execAsync('vm_stat');

            // Extract page counts
            const extractPageCount = (regex: RegExp) => {
                const match = vmStatOut.match(regex);
                return match ? parseInt(match[1], 10) : 0;
            };

            const wiredPages = extractPageCount(/Pages wired down:\s+(\d+)\./);
            const compressorPages = extractPageCount(/Pages occupied by compressor:\s+(\d+)\./);
            const anonPages = extractPageCount(/Anonymous pages:\s+(\d+)\./);
            const purgeablePages = extractPageCount(/Pages purgeable:\s+(\d+)\./);

            // Mac Apple Silicon typically uses 16384 (16KB) page size. Let's dynamically get it or default to 16384
            let pageSize = 16384;
            try {
                const { stdout: pageSizeOut } = await execAsync('sysctl -n hw.pagesize');
                if (pageSizeOut.trim()) {
                    pageSize = parseInt(pageSizeOut.trim(), 10);
                }
            } catch (e) {
                // Ignore, use default
            }

            // Activity Monitor Memory Used Formula:
            // App Memory = (Anonymous Pages - Purgeable Pages) * Page Size
            // Wired = Wired Pages * Page Size
            // Compressed = Compressor Pages * Page Size
            // Total Used = App Memory + Wired + Compressed

            const appMemoryBytes = (anonPages - purgeablePages) * pageSize;
            const wiredMemoryBytes = wiredPages * pageSize;
            const compressedMemoryBytes = compressorPages * pageSize;

            const usedMemBytes = appMemoryBytes + wiredMemoryBytes + compressedMemoryBytes;
            const usedMemGB = (usedMemBytes / (1024 * 1024 * 1024)).toFixed(2);

            // Calculate percentage for color coding UI
            const usedPercent = (usedMemBytes / totalMemBytes) * 100;
            const freePercent = Math.max(0, 100 - usedPercent);

            return {
                success: true,
                text: `${usedMemGB} / ${Math.round(totalMemGB)} GB`,
                freePercent
            };

        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('diagnostics:getSystemHealth', async () => {
        let diskSmartStatus = 'Unknown';
        try {
            const { stdout: diskOut } = await execAsync('diskutil info / | grep SMART');
            const diskMatch = diskOut.match(/SMART Status:\s*([^\n]+)/);
            if (diskMatch) {
                diskSmartStatus = diskMatch[1].trim();
            }
            return {
                success: true,
                diskSmartStatus
            };
        } catch (error: any) {
            console.error('[Diagnostics] General error in getSystemHealth:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('diagnostics:getShutdownCause', async () => {
        let shutdownCause = 'Unknown';
        try {
            // 3. Get Last Shutdown Cause (SLOW COMMAND)
            const { stdout: logOut } = await execAsync('/usr/bin/log show --predicate \'eventMessage contains "previous shutdown cause"\' --last 24h | tail -n 5');
            const causeMatch = logOut.match(/previous shutdown cause:\s*(-?\d+)/);
            if (causeMatch) {
                const code = parseInt(causeMatch[1], 10);
                // Map common MacOS shutdown codes
                if (code === 5) shutdownCause = 'Normal (5)';
                else if (code === 3) shutdownCause = 'Hard Power Button (3)';
                else if (code === 0) shutdownCause = 'Power Loss (0)';
                else if (code === -60) shutdownCause = 'Bad Battery (-60)';
                else if (code === -62) shutdownCause = 'Watchdog Timeout (-62)';
                else if (code === -128) shutdownCause = 'Hardware Reset (-128)';
                else shutdownCause = `Code: ${code}`;
            } else {
                shutdownCause = 'No recent shutdown';
            }
            return { success: true, shutdownCause };
        } catch (error: any) {
            console.error('[Diagnostics] Failed log show shutdown check:', error);
            return { success: false, error: error.message, shutdownCause: 'Log check failed' };
        }
    });
}
