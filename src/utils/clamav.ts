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
let currentProgressCallback: ((file: string, workerId?: number, scanned?: number, total?: number) => void) | null = null;
let parallelScanProcesses: ChildProcess[] = [];

// Set progress callback for streaming file names
export function setScanProgressCallback(callback: ((file: string, workerId?: number, scanned?: number, total?: number) => void) | null): void {
    currentProgressCallback = callback;
}

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

// ClamAV Manifest URL (contains dynamic file IDs - update this file to change database versions)
const CLAMAV_MANIFEST_URL = 'https://drive.usercontent.google.com/download?id=1qglmioEQg2NPsG3_Wj71ctEEQqn31QeK&export=download&confirm=t';

// Build GDrive download URL from file ID
function getGDriveUrl(fileId: string): string {
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

// Fetch manifest to get current file IDs
async function fetchManifest(): Promise<{ clamscan_arm64: string; main_cvd: string; daily_cvd: string }> {
    console.log('[ClamAV] Fetching manifest...');
    const manifestPath = path.join(CLAMAV_DIR, 'manifest.json');

    // Download manifest
    await execAsync(`curl -L -o "${manifestPath}" "${CLAMAV_MANIFEST_URL}"`);

    // Read and parse
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    console.log('[ClamAV] Manifest version:', manifest.version);
    return manifest.files;
}

// Check if ClamAV is installed (via config flag, not file check)
export async function checkClamAVInstalled(): Promise<{ installed: boolean; version?: string; valid?: boolean }> {
    try {
        const { loadConfig, saveConfig } = await import('./config.js');
        const config = await loadConfig();

        // Use config flag as source of truth
        if (!config.clamavInstalled) {
            return { installed: false, valid: false };
        }

        // If config says installed, verify files actually exist and are valid
        let binaryValid = false;
        let dbValid = false;
        let version: string | undefined;

        // Check binary exists and works
        try {
            await fs.access(CLAMAV_BIN);
            const stats = await fs.stat(CLAMAV_BIN);
            if (stats.size > 100000) { // > 100KB
                const { stdout } = await execAsync(`"${CLAMAV_BIN}" --version`);
                version = stdout.trim();
                binaryValid = true;
            }
        } catch { }

        // Check database files exist with minimum sizes
        try {
            const mainCvdPath = path.join(CLAMAV_DB_DIR, 'main.cvd');
            const dailyCvdPath = path.join(CLAMAV_DB_DIR, 'daily.cvd');

            const mainStats = await fs.stat(mainCvdPath);
            const dailyStats = await fs.stat(dailyCvdPath);

            // main.cvd should be > 10MB, daily.cvd should be > 1MB
            if (mainStats.size > 10 * 1024 * 1024 && dailyStats.size > 1 * 1024 * 1024) {
                dbValid = true;
            }
        } catch { }

        const valid = binaryValid && dbValid;

        // If files are corrupted/missing, update config
        if (!valid && config.clamavInstalled) {
            // Don't auto-reset, just report as invalid
            console.log('[ClamAV] Installation detected as corrupted');
        }

        return { installed: config.clamavInstalled, version, valid };
    } catch {
        return { installed: false, valid: false };
    }
}

// Download file helper
async function downloadFile(url: string, dest: string): Promise<void> {
    const fs = await import('fs/promises');
    const fsSync = await import('fs');

    return new Promise((resolve, reject) => {
        const file = fsSync.default.createWriteStream(dest);

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

// Install ClamAV - Direct download approach (no Homebrew required)
export async function installClamAV(): Promise<{ success: boolean; error?: string }> {
    return installClamAVWithProgress();
}

// Install ClamAV with progress callback
export async function installClamAVWithProgress(
    onProgress?: (progress: number, status: string) => void
): Promise<{ success: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Starting installation (no Homebrew required)...');
        onProgress?.(5, 'Preparing installation...');

        // Create directory
        await fs.mkdir(CLAMAV_DIR, { recursive: true });
        await fs.mkdir(CLAMAV_DB_DIR, { recursive: true });

        // Fetch manifest to get current file IDs
        onProgress?.(10, 'Fetching manifest...');
        const manifest = await fetchManifest();
        let needBinaryDownload = true;
        try {
            await fs.access(CLAMAV_BIN);
            const stats = await fs.stat(CLAMAV_BIN);
            if (stats.size > 100000) { // > 100KB means valid binary
                console.log('[ClamAV] Existing binary found, skipping download');
                needBinaryDownload = false;
            }
        } catch { }

        // Step 2: Download clamscan binary from GitHub if needed
        if (needBinaryDownload) {
            onProgress?.(15, 'Downloading ClamAV engine...');
            console.log('[ClamAV] Downloading clamscan binary from Google Drive...');
            try {
                // Use curl for reliable download with redirect handling
                await execAsync(`curl -L -o "${CLAMAV_BIN}" "${getGDriveUrl(manifest.clamscan_arm64)}"`);
                // Make executable
                await fs.chmod(CLAMAV_BIN, 0o755);
                console.log('[ClamAV] Binary downloaded and made executable');
            } catch (downloadError: any) {
                console.error('[ClamAV] Failed to download binary:', downloadError);

                // Fallback: check if brew version exists
                const brewPaths = ['/opt/homebrew/bin/clamscan', '/usr/local/bin/clamscan'];
                let foundBrew = false;
                for (const p of brewPaths) {
                    try {
                        await fs.access(p);
                        await fs.copyFile(p, CLAMAV_BIN);
                        await fs.chmod(CLAMAV_BIN, 0o755);
                        console.log('[ClamAV] Using Homebrew binary as fallback');
                        foundBrew = true;
                        break;
                    } catch { }
                }

                if (!foundBrew) {
                    throw new Error('Failed to download ClamAV binary. Check your internet connection.');
                }
            }
        }

        // Step 3: Download virus database
        onProgress?.(25, 'Downloading main.cvd (~23MB)...');
        console.log('[ClamAV] Downloading virus database...');

        const mainCvd = path.join(CLAMAV_DB_DIR, 'main.cvd');
        const dailyCvd = path.join(CLAMAV_DB_DIR, 'daily.cvd');

        // Check if database already exists
        let needDownload = true;
        try {
            await fs.access(mainCvd);
            const stats = await fs.stat(mainCvd);
            if (stats.size > 10 * 1024 * 1024) {
                console.log('[ClamAV] Existing database found, skipping download');
                needDownload = false;
            }
        } catch { }

        if (needDownload) {
            // Download main.cvd with progress simulation
            console.log('[ClamAV] Downloading main.cvd (~23MB)...');
            onProgress?.(30, 'Downloading main.cvd (23MB)...');
            await execAsync(`curl -L -o "${mainCvd}" "${getGDriveUrl(manifest.main_cvd)}"`);
            onProgress?.(55, 'Verifying main.cvd...');

            // Verify main.cvd download - should be > 10MB
            const mainStats = await fs.stat(mainCvd);
            if (mainStats.size < 10 * 1024 * 1024) {
                console.error('[ClamAV] main.cvd download failed - file too small:', mainStats.size);
                throw new Error('Failed to download virus database. ClamAV CDN may be blocking. Try again later.');
            }

            // Download daily.cvd
            console.log('[ClamAV] Downloading daily.cvd (~89MB)...');
            onProgress?.(60, 'Downloading daily.cvd (89MB)...');
            await execAsync(`curl -L -o "${dailyCvd}" "${getGDriveUrl(manifest.daily_cvd)}"`);
            onProgress?.(90, 'Verifying daily.cvd...');

            // Verify daily.cvd
            const dailyStats = await fs.stat(dailyCvd);
            if (dailyStats.size < 1 * 1024 * 1024) {
                console.error('[ClamAV] daily.cvd download failed - file too small:', dailyStats.size);
                throw new Error('Failed to download daily virus database.');
            }

            console.log('[ClamAV] Database downloaded successfully!');
        }

        onProgress?.(95, 'Finalizing...');
        console.log('[ClamAV] Installation complete!');

        // Update config to mark as installed
        const { loadConfig, saveConfig } = await import('./config.js');
        const config = await loadConfig();
        await saveConfig({ ...config, clamavInstalled: true });

        onProgress?.(100, 'Complete!');
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

// Uninstall ClamAV - respects user's deleteMode setting
export async function uninstallClamAV(): Promise<{ success: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Uninstalling...');

        const { loadConfig, saveConfig } = await import('./config.js');
        const config = await loadConfig();
        const useTrash = config.deleteMode === 'trash';
        const { moveToTrash } = await import('./trash.js');

        // Step 1: Delete virus database according to user preference
        const dbPaths = [
            '/opt/homebrew/var/lib/clamav',
            '/usr/local/var/lib/clamav'
        ];

        for (const dbPath of dbPaths) {
            try {
                await fs.access(dbPath);
                if (useTrash) {
                    console.log('[ClamAV] Moving to Trash:', dbPath);
                    await moveToTrash([dbPath]);
                } else {
                    console.log('[ClamAV] Permanently deleting:', dbPath);
                    await fs.rm(dbPath, { recursive: true, force: true });
                }
            } catch { }
        }

        // Step 2: Delete app tracking folder
        try {
            await fs.access(CLAMAV_DIR);
            if (useTrash) {
                await moveToTrash([CLAMAV_DIR]);
            } else {
                await fs.rm(CLAMAV_DIR, { recursive: true, force: true });
            }
        } catch { }

        // Step 3: Delete freshclam.conf
        const configPaths = [
            '/opt/homebrew/etc/clamav/freshclam.conf',
            '/usr/local/etc/clamav/freshclam.conf'
        ];
        for (const confPath of configPaths) {
            try {
                await fs.unlink(confPath);
            } catch { }
        }

        console.log('[ClamAV] Uninstall complete');

        // Update config to mark as uninstalled
        await saveConfig({ ...config, clamavInstalled: false });

        return { success: true };

    } catch (error: any) {
        console.error('[ClamAV] Uninstall error:', error);
        return { success: false, error: error.message };
    }
}

// Update ClamAV database - compare manifest version with local
export async function updateClamAVDB(): Promise<{ success: boolean; updated: boolean; error?: string }> {
    try {
        console.log('[ClamAV] Checking for updates...');

        // Get current manifest from GDrive
        const manifestPath = path.join(CLAMAV_DIR, 'manifest.json');
        let localVersion = '';

        try {
            const localManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
            localVersion = localManifest.version;
            console.log('[ClamAV] Local manifest version:', localVersion);
        } catch {
            console.log('[ClamAV] No local manifest found');
        }

        // Fetch latest manifest
        const manifest = await fetchManifest();
        const serverVersion = (await fs.readFile(manifestPath, 'utf-8')).match(/"version":\s*"([^"]+)"/)?.[1] || '';
        console.log('[ClamAV] Server manifest version:', serverVersion);

        // Compare versions
        if (localVersion && localVersion === serverVersion) {
            console.log('[ClamAV] Database is already up to date');
            return { success: true, updated: false };
        }

        if (localVersion !== serverVersion) {
            console.log('[ClamAV] Update available! Version:', serverVersion);
            // Trigger full reinstall to get new database
            // Return success=true so UI can prompt user to reinstall
        }

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
        // Check if our local clamscan binary exists
        try {
            await fs.access(CLAMAV_BIN);
        } catch {
            console.log('[ClamAV] Local clamscan not found');
            return { threats: [], error: 'ClamAV not installed. Click Install ClamAV first.' };
        }

        // Check if database exists
        const mainCvd = path.join(CLAMAV_DB_DIR, 'main.cvd');
        try {
            await fs.access(mainCvd);
        } catch {
            return { threats: [], error: 'Virus database not found. Reinstall ClamAV.' };
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

                // Use spawn for killable process - use our local binary and database
                const stdout = await new Promise<string>((resolve, reject) => {
                    let output = '';

                    currentScanProcess = spawn(CLAMAV_BIN, [
                        '--infected',
                        '--recursive',
                        '--verbose',  // Show each file being scanned
                        '--database=' + CLAMAV_DB_DIR,
                        scanPath
                    ], {
                        stdio: ['ignore', 'pipe', 'pipe']
                    });

                    currentScanProcess.stdout?.on('data', (data) => {
                        const lines = data.toString().split('\n');
                        for (const line of lines) {
                            if (line.includes('Scanning ')) {
                                // Extract file path from "Scanning /path/to/file"
                                const match = line.match(/Scanning (.+)/);
                                if (match && currentProgressCallback) {
                                    currentProgressCallback(match[1]);
                                }
                            }
                        }
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

// Enumerate all files in a directory recursively
async function enumerateFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(dir: string): Promise<void> {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (scanAborted) break;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        } catch (e) {
            // Permission denied or other error, skip
        }
    }

    await walk(dirPath);
    return files;
}

// Scan a single file with ClamAV
async function scanSingleFile(filePath: string, workerId: number): Promise<{ path: string; threat?: string }> {
    return new Promise((resolve) => {
        const proc = spawn(CLAMAV_BIN, [
            '--infected',
            '--database=' + CLAMAV_DB_DIR,
            filePath
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        parallelScanProcesses[workerId] = proc;
        let output = '';

        proc.stdout?.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr?.on('data', (data) => {
            output += data.toString();
        });

        proc.on('close', () => {
            parallelScanProcesses[workerId] = null as any;
            // Check for FOUND
            if (output.includes('FOUND')) {
                const match = output.match(/^(.+): (.+) FOUND$/m);
                if (match) {
                    resolve({ path: filePath, threat: match[2] });
                    return;
                }
            }
            resolve({ path: filePath });
        });

        proc.on('error', () => {
            parallelScanProcesses[workerId] = null as any;
            resolve({ path: filePath });
        });
    });
}

// Parallel scan with worker pool
export async function scanWithClamAVParallel(paths: string[], workerCount: number = 2): Promise<{ threats: any[]; error?: string }> {
    scanAborted = false;
    parallelScanProcesses = [];

    try {
        // Check prerequisites
        try {
            await fs.access(CLAMAV_BIN);
        } catch {
            return { threats: [], error: 'ClamAV not installed.' };
        }

        const mainCvd = path.join(CLAMAV_DB_DIR, 'main.cvd');
        try {
            await fs.access(mainCvd);
        } catch {
            return { threats: [], error: 'Virus database not found.' };
        }

        // Enumerate all files first
        console.log('[ClamAV] Enumerating files in', paths.length, 'paths...');
        let allFiles: string[] = [];

        for (const scanPath of paths) {
            try {
                const stat = await fs.stat(scanPath);
                if (stat.isDirectory()) {
                    const files = await enumerateFiles(scanPath);
                    allFiles = allFiles.concat(files);
                } else {
                    allFiles.push(scanPath);
                }
            } catch { }
        }

        console.log('[ClamAV] Found', allFiles.length, 'files to scan with', workerCount, 'workers');

        const threats: any[] = [];
        let fileIndex = 0;
        let scannedCount = 0;
        let totalFiles = allFiles.length;

        // Start periodic file tracking (every 2 seconds)
        const trackingInterval = setInterval(async () => {
            if (scanAborted) {
                clearInterval(trackingInterval);
                return;
            }

            // Re-enumerate files to detect changes
            let updatedFiles: string[] = [];
            for (const scanPath of paths) {
                try {
                    const stat = await fs.stat(scanPath);
                    if (stat.isDirectory()) {
                        const files = await enumerateFiles(scanPath);
                        updatedFiles = updatedFiles.concat(files);
                    } else {
                        updatedFiles.push(scanPath);
                    }
                } catch { }
            }

            // Update total if changed
            if (updatedFiles.length !== totalFiles) {
                console.log(`[ClamAV] File count changed: ${totalFiles} → ${updatedFiles.length}`);
                totalFiles = updatedFiles.length;
                allFiles = updatedFiles; // Update the list
            }
        }, 2000);

        // Worker function
        async function worker(workerId: number): Promise<void> {
            while (fileIndex < allFiles.length && !scanAborted) {
                const currentIndex = fileIndex++;
                if (currentIndex >= allFiles.length) break;

                const file = allFiles[currentIndex];

                // Report progress with count
                scannedCount++;
                if (currentProgressCallback) {
                    currentProgressCallback(file, workerId, scannedCount, totalFiles);
                }

                const result = await scanSingleFile(file, workerId);

                if (result.threat) {
                    console.log('[ClamAV] Worker', workerId, 'FOUND:', result.threat);
                    threats.push({
                        path: result.path,
                        name: result.threat,
                        type: 'malware',
                        severity: 'high',
                        source: 'ClamAV'
                    });
                }
            }
        }

        // Start workers
        const workers: Promise<void>[] = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker(i));
        }

        await Promise.all(workers);

        // Stop file tracking
        clearInterval(trackingInterval);

        console.log('[ClamAV] Parallel scan complete, found', threats.length, 'threats');
        return { threats };

    } catch (error: any) {
        console.error('[ClamAV] Parallel scan error:', error);
        return { threats: [], error: error.message };
    }
}

// Abort parallel scan
export function abortParallelScan(): void {
    scanAborted = true;
    for (const proc of parallelScanProcesses) {
        if (proc) {
            try { proc.kill('SIGTERM'); } catch { }
        }
    }
    parallelScanProcesses = [];
}
