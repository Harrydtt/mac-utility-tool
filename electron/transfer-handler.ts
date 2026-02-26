
import { ipcMain, app, shell, BrowserWindow, net, Notification } from 'electron';

import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import { spawn, execSync, execFile } from 'child_process';
import * as TransferState from './transfer-state.js';

// ESM-compatible __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CONSTANTS ---
// Determine paths similar to main.ts
const isDev = !app.isPackaged;
const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

// CLI Binary Path
const CLI_BINARY_NAME = 'maccleaner_transfer';
const BUNDLED_CLI_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', CLI_BINARY_NAME)
    : path.join(__dirname, '../../bin', CLI_BINARY_NAME); // Dev path assumption

const TRANSFER_BASE = path.join(app.getPath('userData'), 'transfer');
const SENDER_CWD = path.join(TRANSFER_BASE, 'sender');
const RECEIVER_CWD = path.join(TRANSFER_BASE, 'receiver');
const DOWNLOADS_DIR = app.getPath('downloads');

// Ensure CWDs exist
fs.mkdir(SENDER_CWD, { recursive: true }).catch(err => console.error('[Transfer] Failed to create Sender CWD:', err));
fs.mkdir(RECEIVER_CWD, { recursive: true }).catch(err => console.error('[Transfer] Failed to create Receiver CWD:', err));


// --- TYPES ---
interface TransferSession {
    id: string;
    mode: 'send' | 'receive';
    status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
    ticket: string;
    filename: string | string[];
    originalFiles?: string | string[];
    progress: number;
    speed: string;
    transferred: string;
    connected: boolean;
    complete: boolean;
    isTransferring: boolean;
    error: string;
    outputDir?: string;
    process?: any; // ChildProcess
    stdoutBuf?: string;
    forceZip?: boolean;
    sourceFolderPath?: string | string[];
    batchSuffix?: string; // 3-digit unique suffix for no-zip batch folders
    activeReceivers?: { [nodeId: string]: { transferred: string, total: string, lastSeen: number } }; // Track concurrent receivers
}

// --- STATE ---
const sessions: TransferSession[] = [];
const MAX_CONCURRENT = 10;
const idleTimers: Map<string, NodeJS.Timeout> = new Map();
const receiverIdleTimers: Map<string, NodeJS.Timeout> = new Map(); // Per-receiver idle timers (sessionId:nodeId -> timer)
let progressBuffer = '';

// --- BATCH SUFFIX TRACKING (No-Zip Mode) ---
// Track used 3-digit suffixes to ensure uniqueness
const usedBatchSuffixes: Set<string> = new Set();

// Generate a unique 3-digit suffix (000-999) that's not already in use
function generateUniqueBatchSuffix(): string {
    // If all 1000 possibilities are used, fall back to timestamp
    if (usedBatchSuffixes.size >= 1000) {
        console.warn('[Transfer] All 1000 batch suffixes exhausted, using timestamp fallback');
        return Date.now().toString().slice(-6);
    }

    let suffix: string;
    let attempts = 0;
    do {
        const num = Math.floor(Math.random() * 1000);
        suffix = num.toString().padStart(3, '0');
        attempts++;
    } while (usedBatchSuffixes.has(suffix) && attempts < 2000);

    usedBatchSuffixes.add(suffix);
    console.log(`[Transfer] Generated batch suffix: ${suffix}, total used: ${usedBatchSuffixes.size}`);
    return suffix;
}

// Release a batch suffix when session is removed or reshared
function releaseBatchSuffix(suffix: string | undefined): void {
    if (suffix && usedBatchSuffixes.has(suffix)) {
        usedBatchSuffixes.delete(suffix);
        console.log(`[Transfer] Released batch suffix: ${suffix}, remaining: ${usedBatchSuffixes.size}`);
    }
}

// --- HELPER: Unique Zip Path ---
export const getUniqueZipPath = (baseDir: string, name: string, ts: string) => {
    // Generate Name: Name_Timestamp_Suffix.zip
    // Loop to ensure uniqueness
    let suffix = Math.floor(Math.random() * 1000);
    // Safety break
    let limit = 0;
    while (limit < 100) {
        const candidateName = `${name}_${ts}_${suffix}.zip`;
        const candidatePath = path.join(baseDir, candidateName);
        // Check if ZIP OR FOLDER exists (since we use folder for staging)
        if (!fsSync.existsSync(candidatePath) && !fsSync.existsSync(path.join(baseDir, name + '_' + ts + '_' + suffix))) {
            return { path: candidatePath, name: candidateName, suffix };
        }
        suffix = Math.floor(Math.random() * 10000);
        limit++;
    }
    // Fallback
    const finalSuffix = Date.now();
    return {
        path: path.join(baseDir, `${name}_${ts}_${finalSuffix}.zip`),
        name: `${name}_${ts}_${finalSuffix}.zip`,
        suffix: finalSuffix
    };
};

export function setupTransferHandlers() {
    console.log('[Transfer] Setting up handlers...');
    console.log('[Transfer] Binary:', BUNDLED_CLI_PATH);

    // ZIP FOLDER HANDLER
    ipcMain.handle('transfer:zipFolder', async (_event, folderPath: string | string[]) => {
        try {
            const items = Array.isArray(folderPath) ? folderPath : [folderPath];
            if (items.length === 0) throw new Error('No items to zip');

            const isSingleItem = items.length === 1;
            const now = new Date();
            const timestamp = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

            let sourceDir = '';
            let targetName = '';

            // Optimization: Zip directly if single valid folder
            if (isSingleItem) {
                const itemPath = items[0];
                const stats = await fs.stat(itemPath);

                if (stats.isDirectory()) {
                    sourceDir = path.dirname(itemPath);
                    targetName = path.basename(itemPath);

                    const unique = getUniqueZipPath(SENDER_CWD, targetName, timestamp);
                    const archivePath = unique.path;

                    // Zip directly
                    execSync(`cd "${sourceDir}" && zip -r -q "${archivePath}" "${targetName}"`);
                    return { success: true, zipPath: archivePath, originalPath: itemPath };
                }
            }

            // Multi-item or Single File logic: Create Staging Folder
            // Use same unique logic
            const firstItemName = 'Transfer_Bundle';
            const unique = getUniqueZipPath(SENDER_CWD, firstItemName, timestamp);
            // We use the name WITHOUT .zip for the folder
            const bundleName = unique.name.replace('.zip', '');
            const stagingDir = path.join(SENDER_CWD, bundleName);

            await fs.mkdir(stagingDir, { recursive: true });

            // Copy/Link items
            for (const item of items) {
                const baseName = path.basename(item);
                const destPath = path.join(stagingDir, baseName);
                try {
                    const stats = await fs.stat(item);
                    if (stats.isDirectory()) {
                        await fs.cp(item, destPath, { recursive: true });
                    } else {
                        try {
                            await fs.link(item, destPath);
                        } catch (e) {
                            await fs.copyFile(item, destPath);
                        }
                    }
                } catch (e) {
                    console.warn('[Transfer] Failed to stage item:', item, e);
                }
            }

            // Zip the staging folder
            const archivePath = path.join(SENDER_CWD, unique.name);
            execSync(`cd "${SENDER_CWD}" && zip -r -q "${archivePath}" "${bundleName}"`);

            // Cleanup staging
            await fs.rm(stagingDir, { recursive: true, force: true });

            return { success: true, zipPath: archivePath, originalPath: items };

        } catch (e: any) {
            console.error('[Transfer] Zip failed:', e);
            return { success: false, error: e.message };
        }
    });

    // START SEND HANDLER
    ipcMain.handle('transfer:send', async (_event, filePath: string | string[], options: { forceZip?: boolean; sourceFolderPath?: string | string[] } = {}) => {
        let cleanPath: string | string[] = filePath;
        if (Array.isArray(filePath)) {
            // Filter and clean
            cleanPath = filePath.map((f: any) => (typeof f === 'string' ? f : (f.path || ''))).filter(f => f);
        } else if (typeof filePath === 'object' && filePath !== null && (filePath as any).path) {
            cleanPath = (filePath as any).path;
        } else {
            cleanPath = filePath;
        }

        // AUTO-DETECT FOLDERS: If sourceFolderPath not provided, check if items are folders
        let sourceFolderPath = options.sourceFolderPath;
        if (!sourceFolderPath) {
            const paths = Array.isArray(cleanPath) ? cleanPath : [cleanPath];
            const folderPaths: string[] = [];
            for (const p of paths) {
                try {
                    const stat = await fs.stat(p);
                    if (stat.isDirectory()) {
                        folderPaths.push(p);
                    }
                } catch (e) {
                    // Ignore stat errors
                }
            }
            // If all items are folders, set sourceFolderPath
            if (folderPaths.length > 0 && folderPaths.length === paths.length) {
                sourceFolderPath = folderPaths.length === 1 ? folderPaths[0] : folderPaths;
                console.log('[Transfer] Auto-detected folder share, sourceFolderPath:', sourceFolderPath);
            }
        }

        const id = Date.now().toString() + Math.floor(Math.random() * 1000);
        const session: TransferSession = {
            id, mode: 'send', status: 'pending', ticket: '',
            filename: Array.isArray(cleanPath) ? (cleanPath.length === 1 && !options.forceZip ? cleanPath[0] : cleanPath) : cleanPath,
            originalFiles: cleanPath,
            progress: 0, speed: '0 MB/s', transferred: '', connected: false, complete: false, isTransferring: false, error: '',
            forceZip: options.forceZip,
            sourceFolderPath: sourceFolderPath
        };
        sessions.push(session);
        queueLoop();
        return { success: true, id };
    });

    // RECEIVE HANDLER
    ipcMain.handle('transfer:receive', async (_event, ticket: string, outputDir?: string) => {
        const id = Date.now().toString() + Math.floor(Math.random() * 1000);
        const session: TransferSession = {
            id, mode: 'receive', status: 'pending', ticket,
            filename: '',
            originalFiles: '',
            progress: 0, speed: '0 MB/s', transferred: '', connected: false, complete: false, isTransferring: false, error: '',
            outputDir
        };
        sessions.push(session);
        queueLoop();
        return { success: true, id };
    });

    // STATUS HANDLER
    ipcMain.handle('transfer:status', async () => {
        return sessions.map(({ process, ...rest }) => ({
            ...rest,
            active: rest.status === 'active'
        }));
    });

    // CANCEL HANDLER
    ipcMain.handle('transfer:cancel', async (_ev, id?: string) => {
        if (id) {
            const s = sessions.find(x => x.id === id);
            if (s) {
                killSession(s);
                s.status = 'cancelled';
                s.error = 'Cancelled';
                queueLoop();
                // Update State
                if (s.mode === 'send') updateShareState(s);
            }
        } else {
            sessions.filter(s => s.status === 'active' || s.status === 'pending').forEach(s => {
                killSession(s);
                s.status = 'cancelled';
                // Update State
                if (s.mode === 'send') updateShareState(s);
            });
            queueLoop();
        }
        return { success: true };
    });

    // REMOVE HANDLER
    ipcMain.handle('transfer:remove', async (_ev, id: string) => {
        const index = sessions.findIndex(s => s.id === id);
        if (index !== -1) {
            const s = sessions[index];
            killSession(s);

            // Release batch suffix if this was a no-zip batch
            if (s.batchSuffix) {
                releaseBatchSuffix(s.batchSuffix);

                // Also cleanup the batch folder from disk if it exists
                if (s.filename && typeof s.filename === 'string' && s.filename.startsWith('Batch_')) {
                    const batchPath = path.join(SENDER_CWD, s.filename);
                    try {
                        await fs.rm(batchPath, { recursive: true, force: true });
                        console.log(`[Transfer] Cleaned up batch folder: ${s.filename}`);
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                }
            }

            sessions.splice(index, 1);
            queueLoop();

            // Remove from Disk
            if (s.mode === 'send') TransferState.clearShareItem(id);
            else TransferState.clearReceiveItem(id);
        }
        return { success: true };
    });

    // STATE HANDLERS
    ipcMain.handle('transfer:loadSharing', () => TransferState.loadShareState());
    ipcMain.handle('transfer:loadReceiving', () => TransferState.loadReceiveState());
    ipcMain.handle('transfer:saveSharing', (_ev, items) => TransferState.saveSharing(items));
    ipcMain.handle('transfer:saveReceiving', (_ev, items) => TransferState.saveReceiving(items));
    ipcMain.handle('transfer:getReceiveFolder', () => TransferState.getReceiveFolder());
    ipcMain.handle('transfer:setReceiveFolder', (_ev, folder) => TransferState.saveReceiveFolder(folder));


    // --- NOTE: Share restore is handled by Frontend (send-manager.ts restoreState) ---
    // Frontend creates new sessions with new tickets via transferSend
    // Backend only provides loadSharing/loadReceiving APIs for frontend to read state

    // Load used batch suffixes from existing share state to prevent duplicates
    const shareState = TransferState.loadShareState();
    shareState.sharing.forEach(item => {
        if (item.batchSuffix) {
            usedBatchSuffixes.add(item.batchSuffix);
            console.log(`[Transfer] Restored batch suffix: ${item.batchSuffix}`);
        }
    });
    console.log(`[Transfer] Total restored batch suffixes: ${usedBatchSuffixes.size}`);

    // Receive restore can stay here as receivers don't need new tickets
    const receiveState = TransferState.loadReceiveState();
    receiveState.receiving.forEach(item => {
        if (!sessions.find(s => s.id === item.id)) {
            sessions.push({
                id: item.id,
                mode: 'receive',
                status: item.status !== 'failed' ? item.status : 'failed',
                ticket: item.ticket,
                filename: item.filename || '',
                originalFiles: '',
                progress: item.progress || 0,
                speed: '',
                transferred: '',
                connected: false,
                complete: item.status === 'completed',
                isTransferring: false,
                error: ''
            });
        }
    });


    // NUKE STATE
    ipcMain.handle('transfer:nukeState', async () => {
        try {
            const userData = app.getPath('userData');
            ['transfer-state-share.json', 'transfer-state-receive.json', 'transfer-state.json'].forEach(file => {
                const p = path.join(userData, file);
                if (fsSync.existsSync(p)) fsSync.unlinkSync(p);
            });
            return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
    });
    // DIALOG HANDLER
    ipcMain.handle('dialog:pickFilesOrFolders', async () => {
        const { dialog } = await import('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            title: 'Select Files or Folders to Share',
            buttonLabel: 'Select'
        });
        return result.canceled ? [] : result.filePaths;
    });

    // IS DIRECTORY CHECK
    ipcMain.handle('transfer:isDirectory', async (_ev, itemPath: string) => {
        try {
            const stats = await fs.stat(itemPath);
            return stats.isDirectory(); // Returns boolean directly
        } catch (e: any) {
            // console.error('[Transfer] isDirectory check failed:', e);
            return false;
        }
    });

    // FREE SPACE CHECK (Mac) - Matching logic in main.ts
    ipcMain.handle('transfer:getFreeSpace', async () => {
        try {
            // Use execSync for simpler synchronous execution matching main.ts
            const dfOutput = execSync('df -k / | tail -1').toString();
            // Expected: /dev/disk3s1s1  494384000 24200000 450414000 ...
            // Columns: Filesystem, 1k-blocks, Used, Available, Use%, Mounted on
            const parts = dfOutput.trim().split(/\s+/);

            // Available is usually index 3 (4th column)
            // parts[0]=Filesystem, parts[1]=Total, parts[2]=Used, parts[3]=Available
            if (parts.length < 4) throw new Error('Invalid df output columns');

            const availableKb = parseInt(parts[3], 10);
            if (isNaN(availableKb)) throw new Error('Failed to parse available space');

            return { success: true, freeBytes: availableKb * 1024 };
        } catch (e: any) {
            console.error('[Transfer] getFreeSpace failed:', e);
            return { success: false, error: e.message };
        }
    });

    // GET PATH SIZE (du -sk)
    ipcMain.handle('transfer:getPathSize', async (_ev, targetPath: string) => {
        try {
            const output = execSync(`du -sk "${targetPath}"`).toString();
            const parts = output.trim().split(/\s+/);
            const sizeKb = parseInt(parts[0], 10);
            if (isNaN(sizeKb)) throw new Error('Failed to parse size');

            return { success: true, sizeBytes: sizeKb * 1024 };
        } catch (e: any) {
            console.error('[Transfer] getPathSize failed:', e);
            return { success: false, error: e.message };
        }
    });

}

// ... (Helper functions remain) ...

function killSession(s: TransferSession) {
    if (s.process) {
        try { s.process.kill('SIGKILL'); } catch (e) { }
        s.process = undefined;
    }
}

function queueLoop() {
    let activeCount = sessions.filter(s => s.status === 'active').length;
    while (activeCount < MAX_CONCURRENT) {
        const next = sessions.find(s => s.status === 'pending');
        if (!next) break;
        startSessionProcess(next);
        activeCount++;
    }
}

async function startSessionProcess(session: TransferSession) {
    session.status = 'active';
    console.log(`[Transfer] Starting session ${session.id} (${session.mode})`);

    if (session.mode === 'send') {
        await startSendProps(session);
    } else {
        await startReceiveProps(session);
    }
}

async function startSendProps(session: TransferSession) {
    // Clear old ticket on restart so we can capture the new one from CLI output
    session.ticket = '';

    let fileToSend = session.originalFiles;

    const isArray = Array.isArray(session.originalFiles);
    let items = isArray ? session.originalFiles : [session.originalFiles];

    // Filter to only existing files/folders
    const existingItems: string[] = [];
    for (const item of items) {
        if (typeof item === 'string') {
            try {
                await fs.access(item);
                existingItems.push(item);
            } catch {
                console.log(`[Transfer] Skipping non-existent file: ${item}`);
            }
        }
    }

    // If no files exist, fail gracefully
    if (existingItems.length === 0) {
        console.log(`[Transfer] No files exist for session ${session.id}, marking as failed`);
        session.status = 'failed';
        session.error = 'Files no longer exist';
        queueLoop();
        return;
    }

    // Update items to only existing ones
    items = existingItems;

    // Check forceZip
    // Logic: Only Zip if explicitly requested (forceZip === true).
    // If forceZip is undefined (legacy items), we conform to previous behavior:
    // Multi-files -> Zip. Single File -> No Zip.
    // If forceZip is FALSE -> Explicit No Zip.

    let shouldZip = session.forceZip === true;
    if (session.forceZip === undefined && items.length > 1) {
        shouldZip = true;
    }

    // PREVENT DOUBLE-ZIP: If input is already a .zip file, don't zip again!
    // This happens when autoReShare creates a zip and calls transferSend with the zip path
    if (shouldZip && items.length === 1 && typeof items[0] === 'string' && items[0].endsWith('.zip')) {
        console.log('[Transfer] Input is already a zip file, skipping re-zip:', items[0]);
        shouldZip = false;
    }

    if (shouldZip) {
        // ZIP LOGIC
        const now = new Date();
        const timestamp = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

        // Naming
        let baseNameForZip = 'Transfer_Bundle';
        if (items.length === 1 && typeof items[0] === 'string') {
            baseNameForZip = path.basename(items[0]);
        } else if (items.length > 1 && typeof items[0] === 'string') {
            const first = path.basename(items[0]);
            baseNameForZip = `${first}_and_${items.length - 1}_others`;
        }

        const unique = getUniqueZipPath(SENDER_CWD, baseNameForZip, timestamp);
        const bundleName = unique.name.replace('.zip', '');
        const stagingDir = path.join(SENDER_CWD, bundleName);
        const archivePath = path.join(SENDER_CWD, unique.name);

        try {
            await fs.mkdir(stagingDir, { recursive: true });
            // @ts-ignore
            for (const itemPath of items) {
                if (typeof itemPath === 'string') {
                    const baseName = path.basename(itemPath);
                    await fs.cp(itemPath, path.join(stagingDir, baseName), { recursive: true, force: true, dereference: false });
                }
            }
            execSync(`cd "${SENDER_CWD}" && zip -r -q "${unique.name}" "${bundleName}"`);

            fileToSend = archivePath;
            session.filename = unique.name;

            await fs.rm(stagingDir, { recursive: true, force: true });
        } catch (err: any) {
            session.status = 'failed';
            session.error = 'Packing failed: ' + err.message;
            return;
        }
    } else {
        // RAW MODE (No-Zip)
        if (items.length > 1) {
            // Multi-files -> Batch Folder with unique 3-digit suffix
            const now = new Date();
            const timestamp = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
            const uniqueSuffix = generateUniqueBatchSuffix();
            const folderName = `Batch_${timestamp}_${uniqueSuffix}`;
            const stagingDir = path.join(SENDER_CWD, folderName);

            // Store suffix in session for cleanup later
            session.batchSuffix = uniqueSuffix;

            try {
                await fs.mkdir(stagingDir, { recursive: true });
                // @ts-ignore
                for (const itemPath of items) {
                    if (typeof itemPath === 'string') {
                        const baseName = path.basename(itemPath);
                        await fs.cp(itemPath, path.join(stagingDir, baseName), { recursive: true, force: true, dereference: false });
                    }
                }
                fileToSend = stagingDir;
                session.filename = folderName;
            } catch (err: any) {
                // Release suffix on failure
                releaseBatchSuffix(uniqueSuffix);
                session.status = 'failed';
                session.error = 'Layout failed: ' + err.message;
                return;
            }
        } else {
            // Single Item (File or Folder)
            fileToSend = items[0];
            if (typeof fileToSend === 'string') {
                session.filename = path.basename(fileToSend);
            }
        }
    }

    // SPAWN LOGIC
    try {
        console.log(`[Transfer] Spawning CLI for session ${session.id}:`, BUNDLED_CLI_PATH, 'send', fileToSend);

        // SOLUTION FOR NO-ZIP CRASH/HANG:
        // Direct Spawn -> Panic (Reader not set).
        // Script Pipe -> Hang (Buffer overflow).
        // NEW STRATEGY: Script -> File Log.
        // We let 'script' write to a temp file, avoiding pipe backpressure.
        // We then tail this file to get the Ticket.

        const isDirectoryTransfer = !session.filename.toString().endsWith('.zip');
        const logFile = path.join(os.tmpdir(), `maccleaner_${session.id}.log`);

        // Ensure log doesn't exist
        try { fsSync.unlinkSync(logFile); } catch { }

        if (isDirectoryTransfer) {
            console.log(`[Transfer] Mode: Script File-Log (Folder/Raw) + No-Progress for ${session.id} -> ${logFile}`);

            // KEY COMBINATION:
            // 1. 'script' command: Provides TTY, preventing "Reader source not set" Panic.
            // 2. '--no-progress': Suppresses the massive progress bar updates, preventing Log bloating and parsing issues.
            // 3. File Log: Safest IO method.

            // CRITICAL: -F flag forces script to flush output to file immediately
            // Without it, log file stays empty until process terminates
            // stdio 'ignore' because script writes to file, not stdout
            // Note: We removed --no-progress to get transfer progress info. File-based logging handles large output.
            session.process = spawn('script', ['-q', '-F', logFile, BUNDLED_CLI_PATH, 'send', fileToSend as string, '-v'], {
                cwd: SENDER_CWD,
                stdio: 'ignore', // Fully detached - script writes to log file
                env: { ...process.env, HOME: os.homedir(), TERM: 'xterm' }
            });

            console.log(`[Transfer] Spawned script process, PID: ${session.process.pid}`);

            // Read the log file to capture Ticket
            setupLogTail(session, logFile);

        } else {
            console.log(`[Transfer] Mode: Script PTY (Zip) for ${session.id}`);
            session.process = spawn('script', ['-q', '/dev/null', BUNDLED_CLI_PATH, 'send', fileToSend as string, '-v'], {
                cwd: SENDER_CWD,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, HOME: os.homedir(), TERM: 'dumb' }
            });
            setupProcessListeners(session);
        }

    } catch (e: any) {
        console.error(`[Transfer] Spawn failed for session ${session.id}:`, e);
        session.status = 'failed';
        session.error = e.message;
    }
}

// Helper to tail log file for No-Zip mode
function setupLogTail(session: TransferSession, logPath: string) {
    console.log(`[Transfer] setupLogTail started for ${session.id}, watching: ${logPath}`);

    let lastReadPosition = 0; // Track where we last read to

    const tailInterval = setInterval(() => {
        if (!session.process || session.status === 'failed' || session.status === 'completed' || session.status === 'cancelled') {
            console.log(`[Transfer] Stopping log tail for ${session.id}, status: ${session.status}`);
            clearInterval(tailInterval);
            return;
        }

        try {
            const exists = fsSync.existsSync(logPath);
            if (exists) {
                const stat = fsSync.statSync(logPath);

                // Only read if file has grown since last read
                if (stat.size > lastReadPosition) {
                    const fd = fsSync.openSync(logPath, 'r');
                    const newDataSize = stat.size - lastReadPosition;
                    const buffer = Buffer.alloc(newDataSize);
                    fsSync.readSync(fd, buffer, 0, newDataSize, lastReadPosition);
                    fsSync.closeSync(fd);

                    const newText = buffer.toString('utf-8');
                    lastReadPosition = stat.size; // Update position

                    if (newText.trim()) {
                        console.log(`[Transfer] Log NEW content for ${session.id} (${newDataSize} bytes)`);
                        parseProgress(session, newText);
                    }
                }
                // If file hasn't grown, do nothing - debounce timer can fire
            } else {
                console.log(`[Transfer] Log file ${session.id}: does not exist yet`);
            }
        } catch (e: any) {
            console.log(`[Transfer] Error reading log for ${session.id}: ${e.message}`);
        }
    }, 500);

    session.process.on('close', (code: number) => {
        clearInterval(tailInterval);

        // Final read to ensure we didn't miss ticket at exit
        try {
            if (fsSync.existsSync(logPath)) {
                const text = fsSync.readFileSync(logPath, 'utf-8');
                parseProgress(session, text);
            }
        } catch { }

        // If we extracted ticket (session.ticket is set), then Success.
        if (session.ticket) {
            session.status = 'active'; // Keep active
            session.progress = 100;
            session.complete = true;
        } else {
            // If closed without ticket -> Failed
            session.status = (code === 0) ? 'completed' : 'failed';
            if (!session.ticket) session.error = `Process exited code ${code} without ticket`;
        }

        // CRITICAL: Reset transfer state to return to "Sharing" mode
        session.isTransferring = false;
        session.transferred = ''; // Clear the "41.61 MiB / 41.61 MiB" text
        session.speed = '';

        // Clear any debounce timers
        if (idleTimers.has(session.id)) {
            clearTimeout(idleTimers.get(session.id)!);
            idleTimers.delete(session.id);
        }

        // Cleanup log (delay slightly to ensure last read?)
        setTimeout(() => { try { fsSync.unlinkSync(logPath); } catch { } }, 1000);
        queueLoop();
    });

    session.process.on('error', (err: any) => {
        clearInterval(tailInterval);
        session.status = 'failed';
        session.error = err.message;
        queueLoop();
    });
}

async function startReceiveProps(session: TransferSession) {
    const targetDir = session.outputDir || DOWNLOADS_DIR;
    session.transferred = 'Connecting...';
    try {
        const sessionCwd = path.join(RECEIVER_CWD, session.id);
        await fs.mkdir(sessionCwd, { recursive: true });

        // Receivers also benefit from no-progress if script fails? 
        // But let's keep script for receive as it seems less prone to huge output panic yet.
        // Or actually, receive can have same issue. But ticket is input.
        session.process = spawn('script', ['-q', '/dev/null', BUNDLED_CLI_PATH, 'receive', session.ticket, '-v'], {
            cwd: sessionCwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, HOME: os.homedir() }
        });
        setupProcessListeners(session, targetDir, sessionCwd);
    } catch (e: any) {
        session.status = 'failed';
        session.error = e.message;
    }
}

function setupProcessListeners(session: TransferSession, targetDir?: string, sessionCwd?: string) {
    session.process?.stdout?.on('data', (d: any) => parseProgress(session, d.toString(), targetDir, sessionCwd));
    session.process?.stderr?.on('data', (d: any) => parseProgress(session, d.toString(), targetDir, sessionCwd));
    session.process?.on('close', async (code: number) => {
        session.status = (code === 0) ? 'completed' : 'failed';
        session.isTransferring = false;
        if (code === 0) {
            session.progress = 100;
            session.complete = true;
            if (session.mode === 'receive' && targetDir && sessionCwd) {
                try {
                    const files = await fs.readdir(sessionCwd);
                    if (files.length > 0) {
                        const dlFile = files[0];
                        const src = path.join(sessionCwd, dlFile);
                        const dst = path.join(targetDir, dlFile);
                        await fs.cp(src, dst, { recursive: true, force: true });
                        session.filename = dst;
                        session.originalFiles = dst;
                        shell.showItemInFolder(dst);
                        await fs.rm(sessionCwd, { recursive: true, force: true });
                    }
                } catch { }
            }
        } else {
            session.error = `Exited with code ${code}`;
        }
        queueLoop();
    });
    session.process?.on('error', (err: Error) => {
        session.status = 'failed';
        session.error = err.message;
        queueLoop();
    });
}


// Helper to update Share State
function updateShareState(session: TransferSession) {
    if (session.mode !== 'send') return;

    // Construct ShareItem
    const item = {
        id: session.id,
        files: Array.isArray(session.originalFiles) ? session.originalFiles : (session.originalFiles ? [session.originalFiles] : []),
        oldTicket: session.ticket,
        createdAt: new Date().toISOString(),
        forceZip: session.forceZip,
        sourceFolderPath: session.sourceFolderPath, // Persist folder info
        batchSuffix: session.batchSuffix // Persist batch suffix for no-zip mode
    };

    // Add/Update in Store
    TransferState.addShareItem(item);
}

function parseProgress(session: TransferSession, chunk: string, targetDir?: string, sessionCwd?: string) {
    session.stdoutBuf = (session.stdoutBuf || '') + chunk;
    if (session.stdoutBuf.length > 10000) session.stdoutBuf = session.stdoutBuf.slice(-5000);

    const lines = chunk.split(/[\r\n]+/);
    for (const line of lines) {
        // Log raw line for debugging
        if (line.trim()) console.log(`[Transfer] CLI OUT (${session.id}):`, line.trim());

        const clean = line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
        if (!clean) continue;

        if (session.mode === 'send' && !session.ticket) {
            const m = clean.match(/(blob[a-z0-9]{40,})/i);
            if (m) {
                session.ticket = m[1];
                console.log(`[Transfer] TICKET CAPTURED for ${session.id}:`, session.ticket);
                // Save ticket immediately
                updateShareState(session);
            }
        }



        if (clean.toLowerCase().includes('connected')) session.connected = true;

        const speedMatch = clean.match(/(\d+(?:\.\d+)?\s*[KMG]i?B\/s)/i);
        if (speedMatch) { session.speed = speedMatch[1]; session.connected = true; }

        const broadMatch = clean.match(/(\d[\d.]+\s*[A-Za-z]+)\s*\/\s*(\d[\d.]+\s*[A-Za-z]+)/);
        if (broadMatch) {
            const currentStr = broadMatch[1];
            const totalStr = broadMatch[2];
            const newTransferred = `${currentStr} / ${totalStr}`;

            // ONLY reset debounce if progress VALUE actually changed (not just spinner)
            const progressChanged = (session.transferred !== newTransferred);

            if (progressChanged) {
                session.transferred = newTransferred;
                session.isTransferring = true;

                // FIX: Calculate Percentage
                try {
                    const currentVal = parseFloat(currentStr);
                    const totalVal = parseFloat(totalStr);
                    if (!isNaN(currentVal) && !isNaN(totalVal) && totalVal > 0) {
                        session.progress = (currentVal / totalVal) * 100;
                        if (session.progress > 100) session.progress = 100;
                    }
                } catch { }

                // Reset debounce timer ONLY when progress actually changes
                if (idleTimers.has(session.id)) clearTimeout(idleTimers.get(session.id)!);
                idleTimers.set(session.id, setTimeout(() => {
                    session.isTransferring = false;
                    session.transferred = '';
                    session.speed = '';
                    console.log(`[Transfer] Transfer idle for ${session.id}, resetting to Sharing state`);
                    idleTimers.delete(session.id);
                }, 2000));
            }
        }

        // === MULTI-RECEIVER TRACKING (NEW - for concurrent downloads display) ===
        // Parse Node ID from progress lines: "n XXXXXXXXXX r ..." format
        // This is ADDITIVE logic - does not modify existing behavior
        if (session.mode === 'send') {
            const receiverMatch = clean.match(/^n\s+([a-f0-9]{10})\s+r\s+/i);
            if (receiverMatch && broadMatch) {
                const nodeId = receiverMatch[1];
                const currentStr = broadMatch[1];
                const totalStr = broadMatch[2];

                // Initialize activeReceivers if not exists
                if (!session.activeReceivers) {
                    session.activeReceivers = {};
                }

                // Update receiver progress
                session.activeReceivers[nodeId] = {
                    transferred: currentStr,
                    total: totalStr,
                    lastSeen: Date.now()
                };

                // Set per-receiver idle timer (remove after 3s of no updates)
                const timerKey = `${session.id}:${nodeId}`;
                if (receiverIdleTimers.has(timerKey)) {
                    clearTimeout(receiverIdleTimers.get(timerKey)!);
                }
                receiverIdleTimers.set(timerKey, setTimeout(() => {
                    if (session.activeReceivers && session.activeReceivers[nodeId]) {
                        delete session.activeReceivers[nodeId];
                        console.log(`[Transfer] Receiver ${nodeId} idle, removed from ${session.id}`);
                    }
                    receiverIdleTimers.delete(timerKey);
                }, 3000));
            }
        }

        if (clean.includes('100%') || clean.includes('Done')) {
            // session.complete = true; // Handled by close event
        }
    }
}

// --- EXPORTED GETTER FOR TRAY POPUP ---
// Returns simplified transfer status for display in tray status popup
export function getTransferStatusForTray() {
    // Filter sharing items that are actively being downloaded (isTransferring = true)
    const activeSharing = sessions
        .filter(s => s.mode === 'send' && s.isTransferring)
        .map(s => ({
            id: s.id,
            filename: Array.isArray(s.filename) ? s.filename[0] : s.filename,
            displayName: getDisplayName(s),
            receiverCount: s.activeReceivers ? Object.keys(s.activeReceivers).length : 1
        }));

    // Filter receiving items that are active
    const activeReceiving = sessions
        .filter(s => s.mode === 'receive' && (s.status === 'active' || s.status === 'pending'))
        .map(s => {
            let displayName = '';
            if (s.filename) {
                displayName = Array.isArray(s.filename) ? s.filename[0] : s.filename;
                // If full path, get basename
                if (displayName.includes('/')) displayName = displayName.split('/').pop() || displayName;
            } else if (s.ticket) {
                // Determine format based on ticket length
                if (s.ticket.length > 20) {
                    // Long ticket (blob) -> Show "Receiving: start..." 
                    displayName = `Receiving: ${s.ticket.substring(0, 10)}...`;
                } else {
                    // Short code -> Show "Receiving: code"
                    displayName = `Receiving: ${s.ticket}`;
                }
            } else {
                displayName = 'Connecting...';
            }

            return {
                id: s.id,
                filename: displayName,
                progress: s.progress || 0,
                speed: s.speed || '',
                transferred: s.transferred || ''
            };
        });

    return {
        sharing: activeSharing,
        receiving: activeReceiving
    };
}

// Helper to get display name for a session
function getDisplayName(session: TransferSession): string {
    if (session.sourceFolderPath) {
        // Folder share - show folder name
        const folderPath = Array.isArray(session.sourceFolderPath)
            ? session.sourceFolderPath[0]
            : session.sourceFolderPath;
        return folderPath.split('/').pop() || 'Folder';
    }
    // File share
    const filename = Array.isArray(session.filename) ? session.filename[0] : session.filename;
    return typeof filename === 'string' ? filename.split('/').pop() || 'File' : 'File';
}

