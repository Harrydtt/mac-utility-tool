/**
 * ClamAV Integration Module
 * Downloads and manages ClamAV binary and database locally
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';

const execAsync = promisify(exec);

// Paths
const CLAMAV_DIR = path.join(process.env.HOME || '', '.maccleaner', 'clamav');
const CLAMAV_BIN = path.join(CLAMAV_DIR, 'clamscan');
const CLAMAV_DB_DIR = path.join(CLAMAV_DIR, 'db');

// Global scan process tracker for kill support
let currentScanProcess: ChildProcess | null = null;
let scanAborted = false;

// Abort current scan (kill child process like Ctrl+C)
export function abortClamAVScan(): boolean {
    scanAborted = true;
    if (currentScanProcess) {
        console.log('[ClamAV] Killing scan process...');
        currentScanProcess.kill('SIGTERM');
        currentScanProcess = null;
        return true;
    }
    return false;
}

// Reset abort flag
export function resetClamAVAbort(): void {
    scanAborted = false;
}

// ClamAV download URLs
const CLAMAV_RELEASES = 'https://api.github.com/repos/Cisco-Talos/clamav/releases/latest';
const CLAMAV_DB_MAIN = 'https://database.clamav.net/main.cvd';
const CLAMAV_DB_DAILY = 'https://database.clamav.net/daily.cvd';

// Check if ClamAV is installed
export async function checkClamAVInstalled(): Promise<{ installed: boolean; version?: string }> {
    try {
        await fs.access(CLAMAV_BIN);

        // Try to get version
        try {
            const { stdout } = await execAsync(`"${CLAMAV_BIN}" --version`);
            const version = stdout.trim();
            return { installed: true, version };
        } catch {
            return { installed: true };
        }
    } catch {
        return { installed: false };
    }
}

// Download file helper
function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(dest);

        https.get(url, {
            headers: { 'User-Agent': 'MacCleaner/1.0' }
        }, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    file.close();
                    downloadFile(redirectUrl, dest).then(resolve).catch(reject);
                    return;
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Download failed: ${response.statusCode}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            file.close();
            fs.unlink(dest).catch(() => { });
            reject(err);
        });
    });
}

// HTTP HEAD request to get Last-Modified header (fast version check)
function getServerLastModified(url: string): Promise<Date | null> {
    return new Promise((resolve) => {
        const options = {
            method: 'HEAD',
            headers: { 'User-Agent': 'MacCleaner/1.0' },
            timeout: 5000 // 5 second timeout
        };

        const req = https.request(url, options, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                    getServerLastModified(redirectUrl).then(resolve);
                    return;
                }
            }

            const lastModified = response.headers['last-modified'];
            if (lastModified) {
                resolve(new Date(lastModified));
            } else {
                resolve(null);
            }
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.end();
    });
}

// Install ClamAV using official commands
export async function installClamAV(): Promise<{ success: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Starting installation...');

        // Step 1: Check if homebrew is installed
        try {
            await execAsync('which brew');
        } catch {
            throw new Error('Homebrew is required. Please install from https://brew.sh');
        }

        // Step 2: Install ClamAV via homebrew (if not already installed)
        console.log('[ClamAV] Installing via Homebrew...');
        try {
            await execAsync('brew install clamav', { timeout: 300000 }); // 5 min timeout
        } catch (brewError: any) {
            // May already be installed, check
            const { stdout } = await execAsync('which clamscan').catch(() => ({ stdout: '' }));
            if (!stdout.trim()) {
                throw new Error('Failed to install ClamAV: ' + brewError.message);
            }
            console.log('[ClamAV] Already installed');
        }

        // Step 3: Determine config path (Intel vs ARM Mac)
        let configPath = '/opt/homebrew/etc/clamav'; // ARM Mac (M1/M2/M3)
        try {
            await fs.access(configPath);
        } catch {
            configPath = '/usr/local/etc/clamav'; // Intel Mac
        }

        console.log('[ClamAV] Config path:', configPath);

        // Step 4: Create freshclam.conf with minimal config
        const freshclamConf = path.join(configPath, 'freshclam.conf');
        console.log('[ClamAV] Creating freshclam.conf...');

        const configContent = 'DNSDatabaseInfo current.cvd.clamav.net\nDatabaseMirror database.clamav.net\n';
        await fs.writeFile(freshclamConf, configContent);

        // Step 5: Run freshclam to download virus definitions
        console.log('[ClamAV] Downloading virus definitions (this takes several minutes)...');
        const { stdout, stderr } = await execAsync('freshclam', { timeout: 600000 }); // 10 min timeout
        console.log('[ClamAV] freshclam output:', stdout);

        // Create our app directory for tracking
        await fs.mkdir(CLAMAV_DIR, { recursive: true });

        // Create symlink to clamscan for our check function
        const { stdout: clamscanPath } = await execAsync('which clamscan');
        try {
            await fs.unlink(CLAMAV_BIN).catch(() => { });
            await fs.symlink(clamscanPath.trim(), CLAMAV_BIN);
        } catch { }

        console.log('[ClamAV] Installation complete!');
        return { success: true };

    } catch (error: any) {
        console.error('[ClamAV] Installation error:', error);
        return { success: false, error: error.message };
    }
}

// Get ClamAV database size in MB
export async function getClamAVDatabaseSize(): Promise<number> {
    const dbPaths = [
        '/opt/homebrew/var/lib/clamav', // ARM Mac
        '/usr/local/var/lib/clamav'      // Intel Mac
    ];

    for (const dbPath of dbPaths) {
        try {
            await fs.access(dbPath);
            const { stdout } = await execAsync(`du -sm "${dbPath}" 2>/dev/null`);
            const match = stdout.match(/^(\d+)/);
            if (match) {
                return parseInt(match[1]);
            }
        } catch {
            // Try next path
        }
    }

    return 0; // No database found
}

// Uninstall ClamAV - moves database to Trash
export async function uninstallClamAV(): Promise<{ success: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Uninstalling...');

        const { moveToTrash } = await import('./trash.js');

        // Step 1: Move the virus database to Trash
        const dbPaths = [
            '/opt/homebrew/var/lib/clamav', // ARM Mac
            '/usr/local/var/lib/clamav'      // Intel Mac
        ];

        for (const dbPath of dbPaths) {
            try {
                await fs.access(dbPath);
                console.log('[ClamAV] Moving to Trash:', dbPath);
                await moveToTrash([dbPath]);
            } catch {
                // Path doesn't exist, skip
            }
        }

        // Step 2: Delete our app's tracking folder
        try {
            await fs.access(CLAMAV_DIR);
            await fs.rm(CLAMAV_DIR, { recursive: true, force: true });
        } catch { }

        // Step 3: Delete freshclam.conf we created
        const configPaths = [
            '/opt/homebrew/etc/clamav/freshclam.conf',
            '/usr/local/etc/clamav/freshclam.conf'
        ];
        for (const confPath of configPaths) {
            try {
                await fs.unlink(confPath);
            } catch { }
        }

        // Note: We don't run `brew uninstall clamav` because user may want to keep the binary
        // They can reinstall the database anytime without re-downloading the binary

        console.log('[ClamAV] Uninstall complete - database deleted');
        return { success: true };

    } catch (error: any) {
        console.error('[ClamAV] Uninstall error:', error);
        return { success: false, error: error.message };
    }
}

// Update ClamAV database - with proper server version check
export async function updateClamAVDB(): Promise<{ success: boolean; updated: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Checking for updates...');

        const mainCvd = path.join(CLAMAV_DB_DIR, 'main.cvd');

        // Get local file modification time
        let localModTime: Date | null = null;
        try {
            const stats = await fs.stat(mainCvd);
            localModTime = new Date(stats.mtimeMs);
            console.log('[ClamAV] Local DB date:', localModTime.toISOString());
        } catch {
            // No local file
            console.log('[ClamAV] No local database found');
        }

        // Get server Last-Modified date (fast HEAD request)
        const serverModTime = await getServerLastModified(CLAMAV_DB_MAIN);

        if (!serverModTime) {
            console.log('[ClamAV] Could not check server version');
            return { success: true, updated: false };
        }

        console.log('[ClamAV] Server DB date:', serverModTime.toISOString());

        // Compare dates
        if (localModTime && serverModTime <= localModTime) {
            console.log('[ClamAV] Database is already up to date');
            return { success: true, updated: false };
        }

        // Server has newer version - but don't auto-download (takes too long)
        // Just inform user that update is available
        console.log('[ClamAV] Update available! Server is newer.');

        // For now, return success without downloading
        // User can manually trigger full download if they want
        return { success: true, updated: false };

        /* 
        // Full download (uncomment when ready to implement progress):
        console.log('[ClamAV] Downloading new database...');
        await fs.mkdir(CLAMAV_DB_DIR, { recursive: true });
        await downloadFile(CLAMAV_DB_MAIN, mainCvd);
        console.log('[ClamAV] Database updated!');
        return { success: true, updated: true };
        */

    } catch (error: any) {
        console.error('[ClamAV] Update error:', error);
        return { success: false, updated: false, error: error.message };
    }
}

// Scan paths with ClamAV - uses spawn for killable process
export async function scanWithClamAV(paths: string[]): Promise<{ threats: any[]; error?: string }> {
    // Reset abort flag at start
    scanAborted = false;

    try {
        // Check if clamscan is available
        try {
            await execAsync('which clamscan');
        } catch {
            console.log('[ClamAV] clamscan not found in PATH');
            return { threats: [], error: 'ClamAV not installed' };
        }

        console.log('[ClamAV] Starting deep scan of', paths.length, 'paths...');
        const threats: any[] = [];

        for (const scanPath of paths) {
            // Check if scan was aborted
            if (scanAborted) {
                console.log('[ClamAV] Scan aborted by user');
                break;
            }

            try {
                // Check if path exists
                try {
                    await fs.access(scanPath);
                } catch {
                    console.log('[ClamAV] Path no longer exists, skipping:', scanPath);
                    continue;
                }

                console.log('[ClamAV] Scanning:', scanPath);
                const startTime = Date.now();

                // Use spawn for killable process
                const stdout = await new Promise<string>((resolve, reject) => {
                    let output = '';

                    currentScanProcess = spawn('clamscan', ['--infected', '--recursive', scanPath], {
                        stdio: ['ignore', 'pipe', 'pipe']
                    });

                    currentScanProcess.stdout?.on('data', (data) => {
                        output += data.toString();
                    });

                    currentScanProcess.stderr?.on('data', (data) => {
                        output += data.toString();
                    });

                    currentScanProcess.on('close', (code) => {
                        currentScanProcess = null;
                        // clamscan returns 0=clean, 1=virus found, 2=error
                        resolve(output);
                    });

                    currentScanProcess.on('error', (err) => {
                        currentScanProcess = null;
                        reject(err);
                    });
                });

                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log('[ClamAV] Scan completed in', duration, 'seconds');
                console.log('[ClamAV] Output:', stdout.substring(0, 500));

                // Check for database error
                if (stdout.includes('No supported database files found')) {
                    console.error('[ClamAV] No database! Run freshclam first.');
                    return { threats, error: 'No virus database. Run freshclam in Terminal first.' };
                }

                // Parse output for threats
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('FOUND')) {
                        const match = line.match(/^(.+): (.+) FOUND$/);
                        if (match) {
                            console.log('[ClamAV] THREAT FOUND:', match[2], 'at', match[1]);
                            threats.push({
                                path: match[1],
                                name: match[2],
                                type: 'malware',
                                severity: 'high',
                                source: 'ClamAV'
                            });
                        }
                    }
                }
            } catch (scanError: any) {
                if (scanAborted) {
                    console.log('[ClamAV] Scan aborted during path:', scanPath);
                    break;
                }
                console.warn('[ClamAV] Scan error for path:', scanPath, scanError.message);
            }
        }

        console.log('[ClamAV] Deep scan complete, found', threats.length, 'threats');
        return { threats };

    } catch (error: any) {
        console.error('[ClamAV] Scan error:', error);
        return { threats: [], error: error.message };
    }
}
