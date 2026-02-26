import type { BrowserWindow as BrowserWindowType, Tray as TrayType, WebPreferences } from 'electron';


import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, dialog, shell, safeStorage, protocol, net, session } from 'electron';

import { join, dirname, basename } from 'path';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAllScans, getAvailableScanners } from '../src/scanners/index.js';
import { moveToTrash, loadConfig, saveConfig, getHistory, saveHistory, addIgnoredPaths, clearConfigCache } from '../src/utils/index.js';
import { randomUUID, createHash } from 'crypto';
import { execSync, spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import * as fsSync from 'fs'; // Use fsSync for synchronous operations
import os from 'os';
import * as TransferState from './transfer-state.js';
import { setupTransferHandlers, getTransferStatusForTray } from './transfer-handler.js';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;

// Configure autoUpdater settings
autoUpdater.autoDownload = false; // We want to ask the user first
autoUpdater.autoInstallOnAppQuit = true;


const __dirname = dirname(fileURLToPath(import.meta.url));

// Type for schedule config
interface Schedule {
    enabled?: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
    time?: string;
    day?: number;
    categories?: string[];
}

// Simple logger to debug transfer issues in production
const LOG_FILE = path.join(app.getPath('downloads'), 'maccleaner_transfer_debug.log');
function logToFile(msg: string) {
    try {
        const timestamp = new Date().toISOString();
        // Use fs (promises) but without await for fire-and-forget
        fs.appendFile(LOG_FILE, `[${timestamp}] ${msg}\n`).catch(() => { });
    } catch (e) {
        // ignore
    }
}

let mainWindow: BrowserWindowType | null = null;
let tray: TrayType | null = null;
let cleanTimer: NodeJS.Timeout | null = null;
let warningShown = false;
let isCleaning = false;
let originalIcon: Electron.NativeImage | null = null;
let iconAnimationTimer: NodeJS.Timeout | null = null;
let isQuitting = false;

// Register custom protocol privileges (MUST be before app.whenReady)
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    { scheme: 'local', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
]);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0a',
    });

    // Load the UI - HTML files are not compiled, they stay in src/
    mainWindow.loadFile(join(__dirname, '../../src/ui/index.html'));

    // Hide to tray instead of closing when clicking X button
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
            // Hide from dock when window is hidden
            if (process.platform === 'darwin') {
                app.dock?.hide();
            }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTray() {
    // Create a simple tray icon (will use template image on macOS)
    // In packaged app: use process.resourcesPath
    // In dev: use relative path from __dirname
    let iconPath: string;
    if (app.isPackaged) {
        iconPath = join(process.resourcesPath, 'assets/tray-icon.png');
    } else {
        iconPath = join(__dirname, '../../assets/tray-icon.png');
    }
    console.log('[Tray] Icon path:', iconPath, 'isPackaged:', app.isPackaged);

    let icon;
    try {
        icon = nativeImage.createFromPath(iconPath);
        console.log('[Tray] Icon loaded, empty:', icon.isEmpty(), 'size:', icon.getSize());

        if (icon.isEmpty()) {
            // Try alternative path
            const altPath = join(app.getAppPath(), 'assets/tray-icon.png');
            console.log('[Tray] Trying alt path:', altPath);
            icon = nativeImage.createFromPath(altPath);
        }

        if (icon.isEmpty()) {
            console.log('[Tray] Icon still empty, using fallback');
            // Create a simple colored icon as fallback
            icon = nativeImage.createEmpty();
        }
    } catch (e) {
        console.error('[Tray] Error loading icon:', e);
        icon = nativeImage.createEmpty();
    }

    // For macOS, use template image (must be 16x16 or 22x22)
    if (process.platform === 'darwin' && !icon.isEmpty()) {
        icon = icon.resize({ width: 16, height: 16 });
        icon.setTemplateImage(true);
    }

    tray = new Tray(icon);
    tray.setToolTip('Mac Ultility Tool');
    originalIcon = icon; // Save for animation restore
    console.log('[Tray] Tray created');

    // No context menu - only popup window on click
    tray.on('click', () => {
        toggleStatusWindow();
    });
}

// Status Dashboard Popup Window
let statusWindow: BrowserWindowType | null = null;

function toggleStatusWindow() {
    if (statusWindow && !statusWindow.isDestroyed()) {
        if (statusWindow.isVisible()) {
            statusWindow.hide();
        } else {
            positionStatusWindow();
            statusWindow.show();
        }
    } else {
        createStatusWindow();
    }
}

function createStatusWindow() {
    if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.show();
        return;
    }

    statusWindow = new BrowserWindow({
        width: 320,
        height: 560,
        show: false,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: {
            preload: join(__dirname, 'preload-status.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        backgroundColor: '#1a1d23',
    });

    statusWindow.loadFile(join(__dirname, '../../src/ui/status-dashboard.html'));

    positionStatusWindow();
    statusWindow.show();
    statusWindow.focus(); // Focus so blur event works

    // Hide when clicking outside
    statusWindow.on('blur', () => {
        if (statusWindow && !statusWindow.isDestroyed()) {
            statusWindow.hide();
        }
    });

    statusWindow.on('closed', () => {
        statusWindow = null;
    });
}

function positionStatusWindow() {
    if (!statusWindow || !tray) return;

    const trayBounds = tray.getBounds();
    const windowBounds = statusWindow.getBounds();

    // Position below tray icon on macOS
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);

    statusWindow.setPosition(x, y);
}

// Animated tray icon during cleaning
function startIconAnimation() {
    if (!tray || !originalIcon) return;

    let frame = 0;
    const spinChars = ['◐', '◓', '◑', '◒']; // Spinning circle animation

    // For macOS, we can change the title to show animation next to icon
    iconAnimationTimer = setInterval(() => {
        if (tray) {
            tray.setTitle(` ${spinChars[frame % spinChars.length]}`);
            frame++;
        }
    }, 150);
}

function stopIconAnimation() {
    if (iconAnimationTimer) {
        clearInterval(iconAnimationTimer);
        iconAnimationTimer = null;
    }
    if (tray) {
        tray.setTitle(''); // Clear the animated title
    }
}

async function updateTrayMenu() {
    // DISABLED - No context menu, only popup window on click
    // This function is called from many places so we just return early
    return;

    if (!tray) return;

    clearConfigCache(); // Always get fresh config
    const config = await loadConfig();
    const schedule: Schedule = config.autoCleanSchedule || {};
    const scanners = getAvailableScanners();

    // Build menu items
    const menuItems: Electron.MenuItemConstructorOptions[] = [
        { label: 'Mac Ultility Tool', enabled: false },
        { type: 'separator' }
    ];

    if (schedule.enabled && schedule.time) {
        // Build detailed schedule text
        let scheduleText = '';
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        if (schedule.frequency === 'monthly' && schedule.day) {
            scheduleText = `Monthly: Day ${schedule.day} at ${schedule.time}`;
        } else if (schedule.frequency === 'weekly' && schedule.day !== undefined) {
            scheduleText = `Weekly: ${dayNames[schedule.day]} at ${schedule.time}`;
        } else {
            scheduleText = `Daily at ${schedule.time}`;
        }

        menuItems.push({ label: `📅 ${scheduleText}` });

        // Show categories
        const catNames = (schedule.categories || [])
            .map(id => scanners.find(s => s.id === id)?.name || id)
            .slice(0, 3);
        if (catNames.length > 0) {
            const more = (schedule.categories?.length || 0) > 3 ? ` +${(schedule.categories?.length || 0) - 3} more` : '';
            menuItems.push({ label: `📁 ${catNames.join(', ')}${more}` });
        }

        // Calculate time until next run
        const now = new Date();
        const [schedHour, schedMin] = schedule.time.split(':').map(Number);

        // Calculate next run date based on frequency
        const getNextRunDate = (): Date => {
            const next = new Date();
            next.setHours(schedHour, schedMin, 0, 0);

            if (schedule.frequency === 'daily') {
                // Daily: if time passed today, next is tomorrow
                if (next <= now) {
                    next.setDate(next.getDate() + 1);
                }
            } else if (schedule.frequency === 'weekly' && schedule.day !== undefined) {
                // Weekly: find next occurrence of the day
                const targetDay = schedule.day; // 0 = Sunday, 6 = Saturday
                const currentDay = now.getDay();
                let daysUntil = targetDay - currentDay;

                if (daysUntil < 0) {
                    daysUntil += 7; // Next week
                } else if (daysUntil === 0 && next <= now) {
                    daysUntil = 7; // Same day but time passed
                }

                next.setDate(now.getDate() + daysUntil);
            } else if (schedule.frequency === 'monthly' && schedule.day !== undefined) {
                // Monthly: find next occurrence of the day
                let targetDay = Math.min(schedule.day, 28); // Cap at 28 to be safe for all months
                next.setDate(targetDay);

                // If this month's date passed, go to next month
                if (next <= now) {
                    next.setMonth(next.getMonth() + 1);
                    // Re-adjust day in case next month has fewer days
                    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
                    next.setDate(Math.min(schedule.day, daysInMonth));
                }
            } else {
                // Fallback to daily
                if (next <= now) {
                    next.setDate(next.getDate() + 1);
                }
            }

            return next;
        };

        const nextRun = getNextRunDate();
        const diffMs = nextRun.getTime() - now.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        // Show cleaning progress or countdown
        if (isCleaning) {
            menuItems.push({ label: '🧹 Cleaning ━━━━━━━━' });
        } else {
            let countdownText = '';
            if (diffDays > 0) {
                countdownText = `⏱ In ${diffDays}d ${diffHours}h`;
            } else if (diffHours > 0) {
                countdownText = `⏱ In ${diffHours}h ${diffMins}m`;
            } else if (diffMins > 0) {
                countdownText = `⏱ In ${diffMins} minutes`;
            } else {
                countdownText = `⏱ Starting soon...`;
            }
            menuItems.push({ label: countdownText });
        }
    } else {
        if (isCleaning) {
            menuItems.push({ label: '🧹 Cleaning ━━━━━━━━' });
        } else {
            menuItems.push({ label: '⏸ Schedule: Off' });
        }
    }

    menuItems.push({ type: 'separator' });

    // System Status Section
    try {
        const cpus = os.cpus();
        let idle = 0, total = 0;
        for (const cpu of cpus) {
            idle += cpu.times.idle;
            total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
        }
        const cpuUsage = Math.round((1 - idle / total) * 100);

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

        let diskUsage = 0;
        try {
            const dfOutput = execSync('df -k / | tail -1').toString();
            const parts = dfOutput.trim().split(/\s+/);
            const diskTotal = parseInt(parts[1]) * 1024;
            const diskUsed = parseInt(parts[2]) * 1024;
            diskUsage = Math.round((diskUsed / diskTotal) * 100);
        } catch (e) { }

        menuItems.push({ label: `💻 CPU: ${cpuUsage}%` });
        menuItems.push({ label: `🧠 RAM: ${memUsage}%` });
        menuItems.push({ label: `💾 Disk: ${diskUsage}%` });
    } catch (e) { }

    menuItems.push({ type: 'separator' });
    menuItems.push({
        label: 'Open Mac Ultility Tool',
        click: () => {
            if (mainWindow) {
                mainWindow.show();
            } else {
                createWindow();
            }
            // Show dock when opening main window
            if (process.platform === 'darwin') {
                app.dock?.show();
            }
        }
    });
    menuItems.push({ label: 'Run Clean Now', click: () => runScheduledClean() });
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Quit', click: () => { isQuitting = true; app.quit(); } });

    const contextMenu = Menu.buildFromTemplate(menuItems);
    tray.setContextMenu(contextMenu);
}

async function runScheduledClean() {
    const config = await loadConfig();
    const schedule: Schedule = config.autoCleanSchedule || {};
    const categories = schedule.categories || [];

    if (categories.length === 0) {
        new Notification({
            title: 'Mac Ultility Tool',
            body: 'No categories selected for auto-clean'
        }).show();
        return;
    }

    // Set cleaning state and update tray
    isCleaning = true;
    startIconAnimation();
    updateTrayMenu();

    // Run scan and clean
    const { runScans } = await import('../src/scanners/index.js');
    const scanResult = await runScans(categories as any);

    // Get all items from scanned categories
    const allItems: string[] = [];



    for (const result of scanResult.results) {
        for (const item of result.items) {
            allItems.push(item.path);
        }
    }

    if (allItems.length === 0) {
        new Notification({
            title: 'Mac Ultility Tool',
            body: 'Nothing to clean!'
        }).show();
        isCleaning = false;
        stopIconAnimation();
        updateTrayMenu();
        return;
    }

    // Clean based on delete mode
    const deleteMode = config.deleteMode || 'trash';
    let cleanedCount = 0;

    for (const path of allItems) {
        try {
            if (deleteMode === 'permanent') {
                const fs = await import('fs/promises');
                await fs.rm(path, { recursive: true, force: true });
            } else {
                await moveToTrash([path]);
            }
            cleanedCount++;
        } catch (e) {
            console.error(`Failed to clean ${path}:`, e);
        }
    }

    new Notification({
        title: 'Mac Ultility Tool - Auto Clean Complete',
        body: `Cleaned ${cleanedCount} items from ${categories.length} categories`
    }).show();

    // Save to history
    const totalSize = scanResult.totalSize || 0;
    const historyEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        totalFreed: totalSize,
        itemsCount: cleanedCount,
        mode: 'trash' as const, // Scheduled clean uses configured delete mode
        categories: categories
    };
    await saveHistory(historyEntry);

    // Reset cleaning state and update tray to show next schedule
    isCleaning = false;
    stopIconAnimation();
    warningShown = false;
    updateTrayMenu();
}

function startScheduleTimer() {
    // Check every minute
    if (cleanTimer) clearInterval(cleanTimer);

    cleanTimer = setInterval(async () => {
        const config = await loadConfig();
        const schedule: Schedule = config.autoCleanSchedule || {};

        if (!schedule.enabled || !schedule.time) return;

        const now = new Date();
        const [schedHour, schedMin] = schedule.time.split(':').map(Number);

        // Check if it's the right day
        let shouldRun = false;

        if (schedule.frequency === 'daily') {
            shouldRun = true;
        } else if (schedule.frequency === 'weekly' && schedule.day !== undefined) {
            shouldRun = now.getDay() === schedule.day;
        } else if (schedule.frequency === 'monthly' && schedule.day !== undefined) {
            shouldRun = now.getDate() === schedule.day;
        }

        if (!shouldRun) return;

        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const schedMinutes = schedHour * 60 + schedMin;

        // 1 minute warning
        if (nowMinutes === schedMinutes - 1 && !warningShown) {
            warningShown = true;
            const cats = schedule.categories || [];
            new Notification({
                title: 'Mac Ultility Tool',
                body: `Auto-clean starting in 1 minute\nCategories: ${cats.join(', ')}`
            }).show();
        }

        // Time to clean
        if (nowMinutes === schedMinutes) {
            runScheduledClean();
        }

        // Reset warning flag after scheduled time
        if (nowMinutes > schedMinutes) {
            warningShown = false;
        }

        // Update tray menu
        updateTrayMenu();

    }, 60000); // Check every minute
}

app.whenReady().then(() => {
    // [CLEANUP] Force kill any lingering altsendme processes
    try {
        execSync('pkill -f altsendme');
        fsSync.appendFileSync('/Users/harry/Desktop/transfer_debug.log', `[Startup] Killed background altsendme processes\n`);
    } catch (e) {
        // Ignore "no process found" errors (exit code 1)
    }

    // Set headers for SharedArrayBuffer (Required for EmulatorJS / WASM)
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Cross-Origin-Opener-Policy': ['same-origin'],
                'Cross-Origin-Embedder-Policy': ['require-corp'],
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: local: blob: app: https://cdn.emulatorjs.org https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' app: blob: data: https://cdn.emulatorjs.org; img-src 'self' data: local: blob: app:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com blob: https://cdn.emulatorjs.org;"
                ]
            }
        });
    });

    // Custom Protocol for serving absolute local files (like Game Thumbnails)
    protocol.handle('local', async (request) => {
        try {
            // local:///Users/harry/... -> /Users/harry/...
            let rawPath = request.url.replace(/^local:\/\//i, '');
            rawPath = decodeURIComponent(rawPath);

            // Remove cache buster query params if present e.g. ?t=123
            const questionMarkIdx = rawPath.indexOf('?');
            if (questionMarkIdx !== -1) {
                rawPath = rawPath.substring(0, questionMarkIdx);
            }

            let filePath = rawPath;
            if (process.platform === 'win32') {
                // Windows paths like /C:/Users...
                filePath = filePath.replace(/^\/+/, '');
            }

            const fs = await import('fs/promises');
            const data = await fs.readFile(filePath);

            return new Response(data, {
                headers: {
                    'content-type': 'image/jpeg', // We only use it for thumbnails right now
                    'Access-Control-Allow-Origin': '*',
                    'Cross-Origin-Resource-Policy': 'cross-origin'
                }
            });
        } catch (e: any) {
            console.error('[Protocol] Failed to load local file:', request.url, e.message);
            return new Response('Not Found', { status: 404 });
        }
    });

    // Custom Protocol for serving games and UI
    protocol.handle('app', async (request) => {
        try {
            const url = new URL(request.url);
            let pathname = url.pathname;
            const hostname = url.hostname;

            if (pathname === '/' || pathname === '') pathname = '/index.html';
            if (pathname.startsWith('//')) pathname = pathname.substring(1);

            let filePath;

            // Handle /temp/ for game ROMs
            if (hostname === 'temp' || pathname.startsWith('/temp/')) {
                const tempDir = join(app.getPath('userData'), 'temp');
                const filename = basename(pathname);
                filePath = join(tempDir, filename);
            }
            // Handle /games/ for library ROMs
            else if (hostname === 'games' || pathname.startsWith('/games/')) {
                const gamesDir = join(app.getPath('userData'), 'games');
                const filename = basename(pathname);
                filePath = join(gamesDir, filename);
            }
            else if (pathname.startsWith('/assets/')) {
                filePath = join(__dirname, '../../src/ui', pathname);
            } else {
                // UI files
                filePath = join(__dirname, '../../src/ui', pathname);
            }

            const data = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            let mimeType = 'text/html';

            const mimeMap: Record<string, string> = {
                '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
                '.wasm': 'application/wasm', '.html': 'text/html', '.rom': 'application/octet-stream',
                '.gba': 'application/octet-stream', '.nes': 'application/octet-stream'
            };

            if (mimeMap[ext]) mimeType = mimeMap[ext];

            return new Response(data, {
                headers: {
                    'content-type': mimeType,
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'require-corp',
                    'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: local: app: https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.emulatorjs.org; connect-src 'self' app: blob: data: https://cdn.emulatorjs.org; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com blob: https://cdn.emulatorjs.org; img-src 'self' data: local: blob:;"

                }
            });
        } catch (e: any) {
            console.error('[Protocol] Failed to load:', request.url, e);
            return new Response('Not Found', { status: 404 });
        }
    });

    createWindow();
    createTray();
    registerIPCHandlers();
    startScheduleTimer();

    // Dock icon stays visible - app is primary, tray is just indicator

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            mainWindow?.show();
        }
        // Show dock when activating
        if (process.platform === 'darwin') {
            app.dock?.show();
        }
    });
});

// Handle Cmd+Q and other quit methods
app.on('before-quit', () => {
    isQuitting = true;
});

// Keep app running in tray when window closed (macOS behavior)
app.on('window-all-closed', () => {
    // Don't quit on macOS - keep running in tray
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ===== IPC Handlers =====

function registerIPCHandlers() {
    console.log('[IPC] Registering IPC handlers...');
    const debugLog = (msg: string) => {
        try {
            const logPath = join(app.getPath('userData'), 'debug.log');
            require('fs').appendFileSync(logPath, `${new Date().toISOString()} - ${msg}\n`);
        } catch (e) { }
    };
    debugLog('Starting registerIPCHandlers');
    // Full Disk Access
    ipcMain.handle('fda:check', async () => {
        const { hasFullDiskAccess } = await import('../src/utils/full-disk-access.js');
        return await hasFullDiskAccess();
    });

    ipcMain.handle('fda:openSettings', async () => {
        // Open System Settings to Privacy & Security > Full Disk Access
        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"');
        return { success: true };
    });

    // Fix quarantine flag (run xattr -cr on the app)
    ipcMain.handle('fda:fixQuarantine', async () => {
        try {
            const appPath = app.isPackaged
                ? app.getPath('exe').replace('/Contents/MacOS/Mac Ultility Tool', '')
                : '/Applications/Mac Ultility Tool.app';

            console.log('[FDA] Fixing quarantine for:', appPath);
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            await execAsync(`xattr -cr "${appPath}"`);
            console.log('[FDA] Quarantine fix successful');
            return { success: true };
        } catch (error: any) {
            console.error('[FDA] Quarantine fix failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Check FDA status (for polling)
    ipcMain.handle('fda:checkStatus', async () => {
        try {
            const { hasFullDiskAccess } = await import('../src/utils/full-disk-access.js');
            const hasAccess = await hasFullDiskAccess();
            return { hasAccess };
        } catch (error: any) {
            return { hasAccess: false, error: error.message };
        }
    });

    // ===== AI Cat Helper IPC Handlers =====

    const AI_CAT_KEY_PATH = join(app.getPath('userData'), '.aicat-key');

    // Save API key (encrypted)
    ipcMain.handle('aicat:saveApiKey', async (_event, { apiKey }) => {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                return { success: false, error: 'Encryption not available on this system' };
            }

            if (!apiKey || apiKey.trim() === '') {
                // Remove key if empty
                try { await fs.unlink(AI_CAT_KEY_PATH); } catch { }
                return { success: true };
            }

            const encrypted = safeStorage.encryptString(apiKey);
            await fs.writeFile(AI_CAT_KEY_PATH, encrypted);
            return { success: true };
        } catch (error: any) {
            console.error('[AICat] Save API key error:', error);
            return { success: false, error: error.message };
        }
    });

    // Get API key (decrypted)
    ipcMain.handle('aicat:getApiKey', async () => {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                return { success: false, error: 'Encryption not available' };
            }

            const encrypted = await fs.readFile(AI_CAT_KEY_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            return { success: true, apiKey: decrypted };
        } catch (error: any) {
            // File doesn't exist = no key saved
            return { success: true, apiKey: '' };
        }
    });

    // Test API key - multi-provider support
    ipcMain.handle('aicat:testApiKey', async (_event, { apiKey, model, provider }) => {
        try {
            console.log(`[AICat] Testing ${provider} API with model: ${model}`);

            if (provider === 'gemini') {
                const { GoogleGenerativeAI } = await import('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);
                const modelName = model || 'gemini-2.0-flash';
                const genModel = genAI.getGenerativeModel({ model: modelName });
                const result = await genModel.generateContent('Say "OK" in one word.');
                const response = await result.response;
                if (response.text()) return { success: true, message: 'Connected!' };
                return { success: false, error: 'Empty response' };

            } else if (provider === 'openai') {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model || 'gpt-4o-mini',
                        messages: [{ role: 'user', content: 'Say OK' }],
                        max_tokens: 10
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'Invalid API key' };
                }
                return { success: true, message: 'Connected!' };

            } else if (provider === 'grok') {
                const response = await fetch('https://api.x.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model || 'grok-2-mini',
                        messages: [{ role: 'user', content: 'Say OK' }],
                        max_tokens: 10
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'Invalid API key' };
                }
                return { success: true, message: 'Connected!' };

            } else if (provider === 'openrouter') {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': 'https://github.com/yourusername/mac-cleaner',
                        'X-Title': 'MacCleaner'
                    },
                    body: JSON.stringify({
                        model: model || 'google/gemini-2.0-flash-exp:free',
                        messages: [{ role: 'user', content: 'Say OK' }],
                        max_tokens: 10
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'Invalid API key' };
                }
                return { success: true, message: 'Connected!' };
            }

            return { success: false, error: 'Unsupported provider' };
        } catch (error: any) {
            console.error('[AICat] Test API key error:', error);
            return { success: false, error: error.message || 'API test failed' };
        }
    });

    // Explain file/threat - multi-provider support
    ipcMain.handle('aicat:explain', async (_event, { apiKey, prompt, model, provider }) => {
        try {
            console.log(`[AICat] Calling ${provider} API with model: ${model}`);

            if (provider === 'gemini') {
                const { GoogleGenerativeAI } = await import('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);
                const modelName = model || 'gemini-2.0-flash';
                const genModel = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: { maxOutputTokens: 150, temperature: 0.7 }
                });
                const result = await genModel.generateContent(prompt);
                const response = await result.response;
                return { success: true, response: response.text() || 'No response' };

            } else if (provider === 'openai') {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model || 'gpt-4o-mini',
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 150,
                        temperature: 0.7
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'API error' };
                }
                const data = await response.json();
                return { success: true, response: data.choices?.[0]?.message?.content || 'No response' };

            } else if (provider === 'grok') {
                const response = await fetch('https://api.x.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model || 'grok-2-mini',
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 150,
                        temperature: 0.7
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'API error' };
                }
                const data = await response.json();
                return { success: true, response: data.choices?.[0]?.message?.content || 'No response' };

            } else if (provider === 'openrouter') {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': 'https://github.com/yourusername/mac-cleaner',
                        'X-Title': 'MacCleaner'
                    },
                    body: JSON.stringify({
                        model: model || 'google/gemini-2.0-flash-exp:free',
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 150,
                        temperature: 0.7
                    })
                });
                if (!response.ok) {
                    const err = await response.json();
                    return { success: false, error: err.error?.message || 'API error' };
                }
                const data = await response.json();
                return { success: true, response: data.choices?.[0]?.message?.content || 'No response' };
            }

            return { success: false, error: 'Unsupported provider' };
        } catch (error: any) {
            console.error('[AICat] Explain error:', error);
            return { success: false, error: error.message || 'API call failed' };
        }
    });

    // Open Google AI Studio page
    ipcMain.handle('aicat:openApiPage', async () => {
        shell.openExternal('https://aistudio.google.com/apikey');
        return { success: true };
    });

    // ============================================
    // Threats Scanner IPC Handlers
    // ============================================

    // Abort current scan - kills child process AND pattern matching
    ipcMain.handle('threats:abort', async () => {
        console.log('[IPC] Aborting threat scan...');
        // Abort ClamAV child process
        try {
            const { abortClamAVScan } = await import('../src/utils/clamav.js');
            abortClamAVScan();
        } catch (e) { }
        // Abort pattern matching scan
        try {
            const { abortThreatScan } = await import('../src/scanners/threats.js');
            abortThreatScan();
        } catch (e) { }
        return { success: true };
    });

    // Reset abort flags
    ipcMain.handle('threats:resetAbort', async () => {
        try {
            const { resetClamAVAbort } = await import('../src/utils/clamav.js');
            resetClamAVAbort();
        } catch (e) { }
        try {
            const { resetThreatAbort } = await import('../src/scanners/threats.js');
            resetThreatAbort();
        } catch (e) { }
        return { success: true };
    });

    // Get folder size for dynamic time estimation
    ipcMain.handle('threats:getFolderSize', async (_event, { path }) => {
        try {
            const { getFolderSizeMB } = await import('../src/scanners/threats.js');
            const sizeMB = await getFolderSizeMB(path);
            return { success: true, sizeMB };
        } catch (e) {
            return { success: false, sizeMB: 0 };
        }
    });

    // Check if path exists (for USB/folder removal detection)
    ipcMain.handle('threats:pathExists', async (_event, { path }) => {
        try {
            const fs = await import('fs/promises');
            const expandedPath = path.startsWith('~')
                ? path.replace('~', process.env.HOME || '')
                : path;
            await fs.access(expandedPath);
            return { exists: true };
        } catch {
            return { exists: false };
        }
    });

    // Save custom threat scan paths
    ipcMain.handle('threats:saveCustomPaths', async (_event, { paths }) => {
        try {
            const { loadConfig, saveConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            await saveConfig({ ...config, customThreatPaths: paths } as any);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Get custom threat scan paths
    ipcMain.handle('threats:getCustomPaths', async () => {
        try {
            const { loadConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            return { success: true, paths: (config as any).customThreatPaths || [] };
        } catch (e: any) {
            return { success: false, paths: [], error: e.message };
        }
    });

    // Save scan state for resume on restart
    ipcMain.handle('threats:saveScanState', async (_event, { state }) => {
        try {
            const { loadConfig, saveConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            await saveConfig({ ...config, scanState: state } as any);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Get scan state
    ipcMain.handle('threats:getScanState', async () => {
        try {
            const { loadConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            return { success: true, state: (config as any).scanState || null };
        } catch (e: any) {
            return { success: false, state: null, error: e.message };
        }
    });

    // Clear scan state
    ipcMain.handle('threats:clearScanState', async () => {
        try {
            const { loadConfig, saveConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            const { scanState, ...rest } = config as any;
            await saveConfig(rest);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('threats:scan', async (_event, { paths, workerCount = 2 }) => {
        try {
            // Set up ClamAV progress callback to stream file names with worker IDs and progress
            const { setScanProgressCallback } = await import('../src/utils/clamav.js');
            setScanProgressCallback((file: string, workerId?: number, scanned?: number, total?: number) => {
                if (mainWindow) {
                    mainWindow.webContents.send('clamav:scanProgress', {
                        file,
                        workerId: workerId ?? 0,
                        scanned: scanned ?? 0,
                        total: total ?? 0
                    });
                }
            });

            // Pass workerCount to scanThreats
            const { scanThreats } = await import('../src/scanners/threats.js');
            const threats = await scanThreats(paths, workerCount);

            // Clear callback after scan
            setScanProgressCallback(null);

            return { success: true, threats };
        } catch (error: any) {
            console.error('[IPC] Threat scan error:', error);
            return { success: false, error: error.message };
        }
    });

    // Scan with per-path progress events
    ipcMain.handle('threats:scanWithProgress', async (_event, { paths }) => {
        const allThreats: any[] = [];
        const totalPaths = paths.length;

        console.log('[IPC] Starting scan with progress for', totalPaths, 'paths');

        // Emit start event
        if (mainWindow) {
            mainWindow.webContents.send('threats:scanProgress', {
                type: 'start',
                totalPaths,
                paths
            });
        }

        for (let i = 0; i < paths.length; i++) {
            const currentPath = paths[i];

            // Emit path start with next path info
            const nextPath = i + 1 < paths.length ? paths[i + 1] : null;
            if (mainWindow) {
                mainWindow.webContents.send('threats:scanProgress', {
                    type: 'pathStart',
                    pathIndex: i,
                    path: currentPath,
                    nextPath: nextPath,
                    progress: Math.round((i / totalPaths) * 100)
                });
            }

            try {
                // Scan single path
                const { scanThreats } = await import('../src/scanners/threats.js');
                const threats = await scanThreats([currentPath]);
                allThreats.push(...threats);

                // Emit path complete
                if (mainWindow) {
                    mainWindow.webContents.send('threats:scanProgress', {
                        type: 'pathComplete',
                        pathIndex: i,
                        path: currentPath,
                        threatsFound: threats.length,
                        progress: Math.round(((i + 1) / totalPaths) * 100)
                    });
                }
            } catch (pathError: any) {
                console.error('[IPC] Error scanning path:', currentPath, pathError);
                if (mainWindow) {
                    mainWindow.webContents.send('threats:scanProgress', {
                        type: 'pathError',
                        pathIndex: i,
                        path: currentPath,
                        error: pathError.message
                    });
                }
            }
        }

        // Emit complete
        if (mainWindow) {
            mainWindow.webContents.send('threats:scanProgress', {
                type: 'complete',
                totalThreats: allThreats.length,
                progress: 100
            });
        }

        return { success: true, threats: allThreats };
    });

    // Background scan - runs even if window is closed, sends notification when done
    ipcMain.handle('threats:scanBackground', async (_event, { paths }) => {
        console.log('[IPC] Starting background threat scan...');

        // Run scan in background (don't await in handler response)
        (async () => {
            try {
                const { scanThreats } = await import('../src/scanners/threats.js');
                const threats = await scanThreats(paths);

                // Send notification when done
                const n = new Notification({
                    title: 'MacCleaner - Threat Scan Complete',
                    body: threats.length > 0
                        ? `⚠️ Found ${threats.length} threat${threats.length > 1 ? 's' : ''}! Click to review.`
                        : '✓ No threats found. Your system is clean!',
                    silent: threats.length === 0
                });

                n.on('click', () => {
                    if (mainWindow) {
                        mainWindow.show();
                        mainWindow.webContents.send('show-threats-results', threats);
                    }
                });

                n.show();
                console.log('[IPC] Background scan complete, notification sent');

            } catch (error: any) {
                console.error('[IPC] Background scan error:', error);
                new Notification({
                    title: 'MacCleaner - Scan Error',
                    body: 'Threat scan failed: ' + error.message
                }).show();
            }
        })();

        // Return immediately so window can close
        return { success: true, message: 'Scan started in background' };
    });

    ipcMain.handle('threats:delete', async (_event, { paths }) => {
        try {
            const { deleteThreats } = await import('../src/scanners/threats.js');
            const deletedCount = await deleteThreats(paths);
            return { success: true, deletedCount };
        } catch (error: any) {
            console.error('[IPC] ClamAV uninstall error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('threats:getHistory', async () => {
        try {
            const { getThreatHistory } = await import('../src/scanners/threats.js');
            const history = await getThreatHistory();
            return { success: true, history };
        } catch (error: any) {
            console.error('[IPC] Get threat history error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('threats:updateDB', async () => {
        // Placeholder - patterns are embedded, no actual update needed for now
        console.log('[IPC] Update threat DB called');
        return { success: true };
    });

    // ============================================
    // ClamAV IPC Handlers
    // ============================================

    ipcMain.handle('clamav:check', async () => {
        try {
            const { checkClamAVInstalled } = await import('../src/utils/clamav.js');
            return await checkClamAVInstalled();
        } catch (error: any) {
            console.error('[IPC] ClamAV check error:', error);
            return { installed: false, error: error.message };
        }
    });

    // Get system resources for worker count calculation
    ipcMain.handle('system:getResources', async () => {
        const os = await import('os');
        const freeRam = os.freemem(); // bytes
        const totalRam = os.totalmem();
        const cpuCores = os.cpus().length;

        // Calculate max workers based on resources
        // macOS uses memory compression + swap, so use TOTAL RAM not free RAM
        // Rule: need at least 2GB total RAM per worker (conservative for Mac)
        const ramPerWorker = 2 * 1024 * 1024 * 1024; // 2GB total RAM per worker
        const maxByRam = Math.floor(totalRam / ramPerWorker);
        const maxByCpu = Math.floor(cpuCores / 2); // Use max 50% of cores

        return {
            freeRamMB: Math.round(freeRam / 1024 / 1024),
            totalRamMB: Math.round(totalRam / 1024 / 1024),
            cpuCores,
            maxWorkersByRam: Math.max(1, Math.min(4, maxByRam)),
            maxWorkersByCpu: Math.max(1, Math.min(4, maxByCpu)),
            recommendedWorkers: Math.max(1, Math.min(4, Math.min(maxByRam, maxByCpu)))
        };
    });

    ipcMain.handle('clamav:install', async () => {
        try {
            const { installClamAVWithProgress } = await import('../src/utils/clamav.js');
            return await installClamAVWithProgress((progress: number, status: string) => {
                if (mainWindow) {
                    mainWindow.webContents.send('clamav:progress', { progress, status });
                }
            });
        } catch (error: any) {
            console.error('[IPC] ClamAV install error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clamav:uninstall', async () => {
        try {
            const { uninstallClamAV } = await import('../src/utils/clamav.js');
            return await uninstallClamAV();
        } catch (error: any) {
            console.error('[IPC] ClamAV uninstall error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('clamav:getDBSize', async () => {
        try {
            const { getClamAVDatabaseSize } = await import('../src/utils/clamav.js');
            return await getClamAVDatabaseSize();
        } catch (error: any) {
            console.error('[IPC] ClamAV get DB size error:', error);
            return 0;
        }
    });

    ipcMain.handle('clamav:update', async () => {
        try {
            const { updateClamAVDB } = await import('../src/utils/clamav.js');
            return await updateClamAVDB();
        } catch (error: any) {
            console.error('[IPC] ClamAV update error:', error);
            return { success: false, error: error.message };
        }
    });

    // Threat Databases
    ipcMain.handle('databases:download', async () => {
        try {
            const { downloadAllDatabases } = await import('../src/utils/database-manager.js');
            const result = await downloadAllDatabases((status) => {
                if (mainWindow) {
                    mainWindow.webContents.send('databases:progress', status);
                }
            });

            // Update config
            if (result.success) {
                const { loadConfig, saveConfig } = await import('../src/utils/config.js');
                const config = await loadConfig();
                config.databasesDownloaded = true;
                config.lastDatabaseUpdate = new Date().toISOString();
                await saveConfig(config);
            }

            return result;
        } catch (error: any) {
            console.error('[IPC] Database download error:', error);
            return { success: false, errors: [error.message] };
        }
    });

    ipcMain.handle('databases:checkStatus', async () => {
        try {
            const { checkDatabaseStatus } = await import('../src/utils/database-manager.js');
            return await checkDatabaseStatus();
        } catch (error: any) {
            console.error('[IPC] Database status check error:', error);
            return { downloaded: false };
        }
    });

    ipcMain.handle('databases:setAutoUpdate', async (_event, enabled: boolean) => {
        try {
            const { loadConfig, saveConfig } = await import('../src/utils/config.js');
            const config = await loadConfig();
            config.autoUpdateDatabases = enabled;
            await saveConfig(config);
            return { success: true };
        } catch (error: any) {
            console.error('[IPC] Set auto-update error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('databases:uninstall', async () => {
        try {
            const { shell } = await import('electron');
            const { rm } = await import('fs/promises');
            const { join } = await import('path');
            const { homedir } = await import('os');
            const { loadConfig, saveConfig } = await import('../src/utils/config.js');

            const config = await loadConfig();
            const useTrash = config.deleteMode !== 'permanent';

            const paths = [
                join(homedir(), '.maccleaner', 'databases'),
                join(homedir(), '.maccleaner', 'clamav')
            ];

            for (const dbPath of paths) {
                try {
                    if (useTrash) {
                        await shell.trashItem(dbPath);
                    } else {
                        await rm(dbPath, { recursive: true, force: true });
                    }
                    console.log('[IPC] Removed:', dbPath);
                } catch (e) {
                    console.log('[IPC] Skip (not found):', dbPath);
                }
            }

            // Update config
            config.databasesDownloaded = false;
            config.clamavInstalled = false;
            await saveConfig(config);

            return { success: true, useTrash };
        } catch (error: any) {
            console.error('[IPC] Database uninstall error:', error);
            return { success: false, error: error.message };
        }
    });

    // ==========================================
    // GAME STORAGE & MANAGEMENT
    // ==========================================
    try {
        (async () => {
            try {
                console.log('[Main] Loading game handlers...');
                const { setupGameHandlers } = await import('./game-handlers.js');
                setupGameHandlers();
                console.log('[Main] Game handlers setup complete.');
            } catch (err) {
                console.error('[Main] Failed to import/setup game handlers:', err);
            }

            try {
                console.log('[Main] Loading diagnostic handlers...');
                const { setupDiagnosticHandlers } = await import('./diagnostic-handlers.js');
                setupDiagnosticHandlers();
                console.log('[Main] Diagnostic handlers setup complete.');
            } catch (err) {
                console.error('[Main] Failed to import/setup diagnostic handlers:', err);
            }
        })();
    } catch (e) {
        console.error('[Main] critical error in game/diagnostic handler setup block:', e);
    }

    ipcMain.handle('fda:requestPermission', async () => {
        // Trigger permission request by attempting to read Trash
        const { hasFullDiskAccess } = await import('../src/utils/full-disk-access.js');
        const { readdir } = await import('fs/promises');
        const { join } = await import('path');
        const { homedir } = await import('os');

        try {
            const trashPath = join(homedir(), '.Trash');
            // This will trigger macOS permission dialog
            await readdir(trashPath);
            return { success: true, hasAccess: true };
        } catch (error: any) {
            console.log('[FDA] Permission denied, will prompt user');
            return { success: true, hasAccess: false };
        }
    });

    // Disk Info
    ipcMain.handle('disk:info', async () => {
        try {
            // Simple df command - parse output manually
            const stdout = execSync('/bin/df -k /', { encoding: 'utf8' });
            const lines = stdout.trim().split('\n');
            if (lines.length >= 2) {
                const parts = lines[1].split(/\s+/);
                // parts: [Filesystem, 1024-blocks, Used, Available, Capacity, iused, ifree, %iused, Mounted]
                const totalKB = parseInt(parts[1]) * 1024;
                const freeKB = parseInt(parts[3]) * 1024;
                const used = totalKB - freeKB;
                return { total: totalKB, free: freeKB, used };
            }
            return { total: 0, free: 0, used: 0, error: 'lines < 2' };
        } catch (error: any) {
            return { total: 0, free: 0, used: 0, error: error.message || String(error) };
        }
    });

    // Handle game launch in separate window (Multi-window support)
    const gameWindows = new Map<string, BrowserWindowType>();

    ipcMain.handle('launch-game-window', async (event, { romData, romPath, core, keyMapping, gameId }) => {
        try {
            console.log('[Main] Launching game window for core:', core, 'ID:', gameId);

            // Create a unique ID if not provided
            const actualGameId = gameId || `game-${Date.now()}`;

            let gameUrlParam = '';
            const tempDir = join(app.getPath('userData'), 'temp');
            try { await fs.mkdir(tempDir, { recursive: true }); } catch (e) { }

            if (romPath && romPath.startsWith(join(app.getPath('userData'), 'games'))) {
                // Library game (already in app data)
                const filename = basename(romPath);
                gameUrlParam = `app://games/${filename}`;
            } else if (romPath) {
                // External file path - read and save to temp
                const data = await fs.readFile(romPath);
                const filename = `${actualGameId}.bin`;
                const tempPath = join(tempDir, filename);
                await fs.writeFile(tempPath, data);
                gameUrlParam = `app://temp/${filename}`;
            } else if (romData) {
                // ROM data passed directly (Drag & Drop)
                const filename = `${actualGameId}.bin`;
                const tempPath = join(tempDir, filename);
                await fs.writeFile(tempPath, Buffer.from(romData));
                gameUrlParam = `app://temp/${filename}`;
            } else {
                throw new Error('No valid ROM data provided');
            }

            // Create game window
            const gameWin = new BrowserWindow({
                width: 960,
                height: 640,
                title: `Game Player - ${core}`,
                backgroundColor: '#000000',
                webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    preload: join(__dirname, 'preload.js'),
                    devTools: true
                },
                autoHideMenuBar: true
            });

            // Store in map
            gameWindows.set(actualGameId, gameWin);

            // Construct URL
            const gameUrl = `app://ui/game.html?core=${core}&rom=${encodeURIComponent(gameUrlParam)}&keys=${encodeURIComponent(JSON.stringify(keyMapping || {}))}`;
            gameWin.loadURL(gameUrl);

            // Forward game internal console logs to main terminal for debugging
            gameWin.webContents.on('console-message', (event, level, message) => {
                console.log(`[GameDevTools] ${message}`);
            });

            let isClosingForReal = false;
            gameWin.on('close', async (event) => {
                if (!isClosingForReal) {
                    event.preventDefault(); // Pause the destruction
                    isClosingForReal = true;
                    console.log(`[Main] Intercepted close event for ${actualGameId}, native capturePage...`);

                    try {
                        // Capture the literal screen content using Chromium compositor (bypasses WebGL canvas blanks)
                        const image = await gameWin.webContents.capturePage();
                        const buffer = image.toJPEG(85);

                        const fs = await import('fs/promises');
                        const path = await import('path');

                        if (romPath) {
                            // User request: Save thumbnail exactly beside the ROM file with same name
                            const parentDir = path.dirname(romPath);
                            const nameWithoutExt = path.basename(romPath, path.extname(romPath));
                            const thumbnailPath = path.join(parentDir, `${nameWithoutExt}.jpg`);

                            await fs.writeFile(thumbnailPath, buffer);
                            console.log(`[Main] Native snapshot saved successfully beside ROM: ${thumbnailPath}`);
                        } else {
                            // Fallback if romPath is somehow missing
                            const userDataPath = app.getPath('userData');
                            const thumbnailsDir = path.join(userDataPath, 'Games', 'thumbnails');
                            await fs.mkdir(thumbnailsDir, { recursive: true });
                            const thumbnailPath = path.join(thumbnailsDir, `${actualGameId}.jpg`);
                            await fs.writeFile(thumbnailPath, buffer);

                            console.log(`[Main] Native snapshot saved successfully (Fallback): ${thumbnailPath}`);
                        }
                    } catch (e) {
                        console.error('[Main] Failed to capture native snapshot:', e);
                    }

                    // Resume destruction
                    if (!gameWin.isDestroyed()) {
                        gameWin.close();
                    }
                }
            });

            gameWin.on('closed', () => {
                gameWindows.delete(actualGameId);
                // Notify main window to update UI
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('game-window-closed', actualGameId);
                }
            });

            return { success: true, gameId: actualGameId };
        } catch (e: any) {
            console.error('[Main] Failed to open game window:', e);
            return { success: false, error: e.message };
        }
    });

    // Handle game control commands (Main -> Game Window)
    ipcMain.on('game-command', (event, command, args) => {
        const { gameId } = args || {};

        // 'stop' command
        if (command === 'stop') {
            if (gameId && gameWindows.has(gameId)) {
                const win = gameWindows.get(gameId);
                if (win && !win.isDestroyed()) win.close();
                gameWindows.delete(gameId);
            } else if (!gameId) {
                // Close all if no ID specific (fallback)
                for (const [id, win] of gameWindows.entries()) {
                    if (!win.isDestroyed()) win.close();
                }
                gameWindows.clear();
            }
            return;
        }

        // Forward other commands
        if (gameId && gameWindows.has(gameId)) {
            const win = gameWindows.get(gameId);
            if (win && !win.isDestroyed()) {
                console.log(`[Main] Forwarding game-command '${command}' to gameId: ${gameId}`);
                win.webContents.send('game-command', command, args);
            } else {
                console.log(`[Main] Cannot forward '${command}', window destroyed or missing for gameId: ${gameId}`);
            }
        }
    });

    // Disk Actions (Open, Reveal, Props)
    ipcMain.handle('disk:openPath', async (_event, { path }) => {
        const { shell } = await import('electron');
        const error = await shell.openPath(path);
        return { success: !error, error };
    });
    ipcMain.handle('disk:showInFinder', async (_event, { path }) => {
        const { shell } = await import('electron');
        shell.showItemInFolder(path);
        return { success: true };
    });

    ipcMain.handle('system:openExternal', async (_event, { url }) => {
        const { shell } = await import('electron');
        try {
            await shell.openExternal(url);
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('disk:getProperties', async (_event, { path }) => {
        const fs = await import('fs/promises');
        try {
            const stats = await fs.stat(path);
            return {
                success: true,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                mode: stats.mode
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Move file/folder to destination directory
    ipcMain.handle('disk:moveFile', async (_event, { sourcePath, destDir }) => {
        const fs = await import('fs/promises');
        const path = await import('path');
        try {
            const fileName = path.basename(sourcePath);
            let destPath = path.join(destDir, fileName);

            // Check if destination is the same directory
            const sourceDir = path.dirname(sourcePath);
            if (sourceDir === destDir) {
                return { success: false, error: 'Cannot move to the same folder' };
            }

            // Check if exists at destination, generate unique name
            try {
                await fs.access(destPath);
                const ext = path.extname(fileName);
                const baseName = path.basename(fileName, ext);
                let counter = 1;
                while (true) {
                    destPath = path.join(destDir, `${baseName} (${counter})${ext}`);
                    try {
                        await fs.access(destPath);
                        counter++;
                    } catch {
                        break;
                    }
                }
            } catch {
                // Doesn't exist, use original name
            }

            // Check if source is directory
            const stats = await fs.stat(sourcePath);
            if (stats.isDirectory()) {
                // Copy folder recursively then delete source
                await fs.cp(sourcePath, destPath, { recursive: true });
                await fs.rm(sourcePath, { recursive: true, force: true });
            } else {
                // Try rename first (faster for same filesystem)
                try {
                    await fs.rename(sourcePath, destPath);
                } catch {
                    // Different filesystem, copy then delete
                    await fs.copyFile(sourcePath, destPath);
                    await fs.rm(sourcePath, { force: true });
                }
            }

            return { success: true, newPath: destPath, fileName: path.basename(destPath) };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Copy file/folder to destination directory
    ipcMain.handle('disk:copyFile', async (_event, { sourcePath, destDir }) => {
        const fs = await import('fs/promises');
        const path = await import('path');
        try {
            const fileName = path.basename(sourcePath);
            let destPath = path.join(destDir, fileName);

            // Check if exists at destination, generate unique name
            try {
                await fs.access(destPath);
                const ext = path.extname(fileName);
                const baseName = path.basename(fileName, ext);
                let counter = 1;
                while (true) {
                    destPath = path.join(destDir, `${baseName} (${counter})${ext}`);
                    try {
                        await fs.access(destPath);
                        counter++;
                    } catch {
                        break;
                    }
                }
            } catch {
                // Doesn't exist, use original name
            }

            // Check if source is directory
            const stats = await fs.stat(sourcePath);
            if (stats.isDirectory()) {
                await fs.cp(sourcePath, destPath, { recursive: true });
            } else {
                await fs.copyFile(sourcePath, destPath);
            }

            return { success: true, newPath: destPath, fileName: path.basename(destPath) };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Undo move operation (move back)
    ipcMain.handle('disk:undoMove', async (_event, { currentPath, originalPath }) => {
        const fs = await import('fs/promises');
        const path = await import('path');
        try {
            const originalDir = path.dirname(originalPath);
            const stats = await fs.stat(currentPath);

            if (stats.isDirectory()) {
                await fs.cp(currentPath, originalPath, { recursive: true });
                await fs.rm(currentPath, { recursive: true, force: true });
            } else {
                try {
                    await fs.rename(currentPath, originalPath);
                } catch {
                    await fs.copyFile(currentPath, originalPath);
                    await fs.rm(currentPath, { force: true });
                }
            }

            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Undo copy operation (delete copied file)
    ipcMain.handle('disk:undoCopy', async (_event, { copiedPath }) => {
        const fs = await import('fs/promises');
        try {
            await fs.rm(copiedPath, { recursive: true, force: true });
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Get native macOS file icon
    ipcMain.handle('disk:getFileIcon', async (_event, { path, size }) => {
        try {
            const icon = await app.getFileIcon(path, { size: size || 'normal' });
            const dataUrl = icon.toDataURL();
            return { success: true, icon: dataUrl };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Scanners List
    ipcMain.handle('scanners:list', () => {
        return getAvailableScanners();
    });

    // Settings
    ipcMain.handle('settings:get', async () => {
        // Always return fresh config (clear cache first)
        clearConfigCache();
        return await loadConfig();
    });

    ipcMain.handle('settings:save', async (_event, settings) => {
        const config = await loadConfig();
        const newConfig = { ...config, ...settings };
        await saveConfig(newConfig);
        // Update tray menu to reflect new schedule
        updateTrayMenu();
        return { success: true };
    });

    ipcMain.handle('settings:layout', async (_event, { categoryOverrides }) => {
        const config = await loadConfig();
        config.categoryOverrides = categoryOverrides;
        await saveConfig(config);
        return { success: true };
    });

    // Login Item (Start at Login)
    ipcMain.handle('loginItem:get', () => {
        return app.getLoginItemSettings();
    });

    ipcMain.handle('loginItem:set', (_event, { openAtLogin }) => {
        app.setLoginItemSettings({
            openAtLogin,
            openAsHidden: true // Start minimized to tray
        });
        return { success: true };
    });

    // Open macOS System Settings > Login Items
    ipcMain.handle('loginItem:openSettings', async () => {
        const { exec } = await import('child_process');
        // Open System Settings > General > Login Items (macOS Ventura+)
        exec('open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"', (err) => {
            if (err) {
                // Fallback for older macOS
                exec('open "x-apple.systempreferences:com.apple.preference.users-groups?LoginItems"');
            }
        });
        return { success: true };
    });

    // History
    ipcMain.handle('history:get', async () => {
        return await getHistory();
    });

    // Scan
    ipcMain.handle('scan:start', async () => {
        console.log('[IPC] scan:start called');
        try {
            const { runAllScans } = await import('../src/scanners/index.js');

            const summary = await runAllScans(
                {
                    parallel: true,
                    // Logger callback to bridge logs to UI
                    logger: (msg: string) => {
                        mainWindow?.webContents.send('scan:log', msg);
                    }
                },
                (scanner: any, result: any, duration: number) => {
                    mainWindow?.webContents.send('scan:progress', {
                        scanner: scanner.category.id,
                        result,
                        duration
                    });
                }
            );

            console.log('[IPC] scan:start complete, summary:', summary);
            mainWindow?.webContents.send('scan:complete', summary);
            return summary;
        } catch (error: any) {
            console.error('[IPC] scan:start error:', error);
            mainWindow?.webContents.send('scan:error', error.message);
            throw error;
        }
    });

    // Scan specific categories
    ipcMain.handle('scan:categories', async (_event, categoryIds: string[]) => {
        console.log('[IPC] scan:categories called with:', categoryIds);
        try {
            const { runScans } = await import('../src/scanners/index.js');

            const summary = await runScans(
                categoryIds as any,
                { parallel: true },
                (scanner: any, result: any, duration: number) => {
                    mainWindow?.webContents.send('scan:progress', {
                        scanner: scanner.category.id,
                        result,
                        duration
                    });
                }
            );

            console.log('[IPC] scan:categories complete, summary:', summary);
            return summary;
        } catch (error: any) {
            console.error('[IPC] scan:categories error:', error);
            throw error;
        }
    });

    // Clean
    ipcMain.handle('clean', async (_event, options: { mode?: string; items: string[]; categories?: string[] }) => {
        console.log('[IPC] clean called with mode:', options.mode, 'items:', options.items.length);

        try {
            const { homedir } = await import('os');
            const trashPath = `${homedir()}/.Trash`;

            // Read deleteMode from config as fallback
            const { clearConfigCache: clearCache, loadConfig: loadCfg } = await import('../src/utils/config.js');
            clearCache();
            const cfg = await loadCfg();
            const configMode = cfg.deleteMode || 'trash';

            // Check if any items are in Trash - if so, use permanent delete
            const hasTrashItems = options.items.some(item => item.startsWith(trashPath + '/'));
            const mode = hasTrashItems ? 'permanent' : (options.mode || configMode);

            console.log('[IPC] Using delete mode:', mode, 'hasTrashItems:', hasTrashItems);

            if (mode === 'permanent') {
                const { rm, access: fsAccess } = await import('fs/promises');
                const { execSync } = await import('child_process');
                let successCount = 0;
                let failedCount = 0;
                const errors: string[] = [];

                for (const item of options.items) {
                    try {
                        // Try Node.js fs.rm first
                        await rm(item, { recursive: true, force: true });

                        // Verify the file is actually gone (fs.rm with force:true can silently skip)
                        let stillExists = false;
                        try {
                            await fsAccess(item);
                            stillExists = true;
                        } catch {
                            // Good - file is actually deleted
                        }

                        if (stillExists) {
                            // Fallback: use shell rm -rf (handles macOS .Trash APFS protections better)
                            console.log('[IPC] fs.rm did not delete, falling back to shell rm:', item);
                            try {
                                execSync(`rm -rf "${item.replace(/"/g, '\\"')}"`);
                                // Verify again
                                try {
                                    await fsAccess(item);
                                    // STILL exists - truly failed
                                    failedCount++;
                                    errors.push(item);
                                    console.error('[IPC] Shell rm also failed for:', item);
                                } catch {
                                    successCount++;
                                    console.log('[IPC] Shell rm succeeded:', item);
                                }
                            } catch (shellErr: any) {
                                failedCount++;
                                errors.push(item);
                                console.error('[IPC] Shell rm error:', item, shellErr.message);
                            }
                        } else {
                            successCount++;
                            console.log('[IPC] Permanently deleted:', item);
                        }
                    } catch (error: any) {
                        failedCount++;
                        errors.push(item);
                        console.error('[IPC] Failed to delete:', item, error.message);
                    }
                }

                console.log('[IPC] Permanent delete complete:', successCount, 'success,', failedCount, 'failed');
                return {
                    success: successCount > 0,
                    count: successCount,
                    errors: errors.length > 0 ? [`${errors.length} items failed: ${errors[0]}`] : undefined,
                    partial: failedCount > 0
                };
            } else {
                const { moveToTrash } = await import('../src/utils/trash.js');
                const result = await moveToTrash(options.items);

                console.log('[IPC] moveToTrash result:', result);

                return {
                    success: result.success,
                    count: result.successCount || 0,
                    errors: result.error ? [result.error] : undefined,
                    partial: (result.failedCount || 0) > 0
                };
            }
        } catch (error: any) {
            console.error('[IPC] clean error:', error);
            return { success: false, error: error.message };
        }
    });

    // Ignore
    ipcMain.handle('ignore', async (_event, { paths }) => {
        await addIgnoredPaths(paths);
        return { success: true };
    });

    ipcMain.handle('unignore', async (_event, { paths }) => {
        console.log('[IPC] unignore called with paths:', paths);
        const config = await loadConfig();
        console.log('[IPC] Current ignoredPaths:', config.ignoredPaths);
        if (config.ignoredPaths) {
            const before = config.ignoredPaths.length;
            config.ignoredPaths = config.ignoredPaths.filter((p: string) => !paths.includes(p));
            const after = config.ignoredPaths.length;
            console.log('[IPC] Removed', before - after, 'paths. Remaining:', after);
            await saveConfig(config);
        }
        return { success: true };
    });

    // Folder picker dialog
    ipcMain.handle('dialog:pickFolders', async () => {
        const { dialog } = await import('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'multiSelections'],
            title: 'Select Folders to Ignore'
        });
        return result.canceled ? [] : result.filePaths;
    });

    // File picker dialog
    ipcMain.handle('dialog:pickFiles', async () => {
        const { dialog } = await import('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            title: 'Select Files to Ignore'
        });
        return result.canceled ? [] : result.filePaths;
    });







    // Delete a file (for cleanup of old ZIP files)
    ipcMain.handle('transfer:deleteFile', async (_event, filePath: string) => {
        try {
            // Safety: Only allow deletion of files in transfer directory
            if (!filePath.includes('/transfer/') && !filePath.includes('Transfer_')) {
                return { success: false, error: 'Deletion not allowed for this path' };
            }
            await fs.unlink(filePath);
            console.log('[Transfer] Deleted file:', filePath);
            return { success: true };
        } catch (err: any) {
            console.error('[Transfer] Failed to delete file:', filePath, err.message);
            return { success: false, error: err.message };
        }
    });

    // Get file hash (MD5) for change detection
    ipcMain.handle('transfer:getFileHash', async (_event, filePath: string) => {
        try {
            const stats = await fs.stat(filePath);
            if (stats.isDirectory()) {
                // For directories, hash is based on mtime (modification time)
                return { success: true, hash: `dir-${stats.mtimeMs}`, size: 0, mtime: stats.mtimeMs };
            }
            // For files, calculate MD5 hash
            const content = await fs.readFile(filePath);
            const hash = createHash('md5').update(content).digest('hex');
            return { success: true, hash, size: stats.size, mtime: stats.mtimeMs };
        } catch (err: any) {
            return { success: false, error: err.message, hash: null };
        }
    });

    // Get all files in a folder with their hashes (for folder share monitoring)
    ipcMain.handle('transfer:getFolderContents', async (_event, folderPath: string) => {
        try {
            const stats = await fs.stat(folderPath);
            if (!stats.isDirectory()) {
                return { success: false, error: 'Not a directory', files: {} };
            }

            const files: Record<string, { hash: string; size: number; mtime: number }> = {};

            // Recursive function to scan folder
            const scanDir = async (dirPath: string) => {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    try {
                        if (entry.isDirectory()) {
                            // Recursively scan subdirectories
                            await scanDir(fullPath);
                        } else if (entry.isFile()) {
                            const fileStats = await fs.stat(fullPath);
                            // Use mtime + size as "hash" for change detection (MUCH faster than MD5)
                            // No need to read file content - just use stat info
                            const hash = `${fileStats.mtimeMs}-${fileStats.size}`;
                            files[fullPath] = { hash, size: fileStats.size, mtime: fileStats.mtimeMs };
                        }
                    } catch (e) {
                        // Skip files we can't read
                        console.log('[Transfer] Skip unreadable file:', fullPath);
                    }
                }
            };

            await scanDir(folderPath);
            return { success: true, files, folderPath };
        } catch (err: any) {
            console.error('[Transfer] getFolderContents error:', err);
            return { success: false, error: err.message, files: {} };
        }
    });

    // Ignore/Unignore Folders
    ipcMain.handle('ignore:folders', async (_event, { folders }) => {
        const config = await loadConfig();
        if (!config.ignoredFolders) config.ignoredFolders = [];

        for (const folder of folders) {
            if (!config.ignoredFolders.includes(folder)) {
                config.ignoredFolders.push(folder);
            }
        }
        await saveConfig(config);
        return { success: true };
    });

    ipcMain.handle('unignore:folder', async (_event, { folder }) => {
        const config = await loadConfig();
        if (config.ignoredFolders) {
            config.ignoredFolders = config.ignoredFolders.filter((f: string) => f !== folder);
            await saveConfig(config);
        }
        return { success: true };
    });

    // Ignore/Unignore Categories
    ipcMain.handle('ignore:category', async (_event, { categoryId }) => {
        const config = await loadConfig();
        if (!config.ignoredCategories) config.ignoredCategories = [];

        if (!config.ignoredCategories.includes(categoryId)) {
            config.ignoredCategories.push(categoryId);
        }

        // Also remove from auto-clean schedule categories
        if (config.autoCleanSchedule?.categories) {
            config.autoCleanSchedule.categories = config.autoCleanSchedule.categories.filter(
                (c: string) => c !== categoryId
            );
        }

        await saveConfig(config);
        updateTrayMenu(); // Refresh tray to reflect changes
        return { success: true };
    });

    ipcMain.handle('unignore:category', async (_event, { categoryId }) => {
        const config = await loadConfig();
        if (config.ignoredCategories) {
            config.ignoredCategories = config.ignoredCategories.filter((c: string) => c !== categoryId);
            await saveConfig(config);
        }
        return { success: true };
    });

    // ------------------------------------
    // APP UNINSTALLER HANDLERS
    // ------------------------------------

    ipcMain.handle('uninstaller:selectApp', async () => {
        const result = await dialog.showOpenDialog(mainWindow as BrowserWindowType, {
            properties: ['openFile'],
            filters: [{ name: 'Applications', extensions: ['app'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return { path: result.filePaths[0] };
    });

    ipcMain.handle('uninstaller:scanLeftovers', async (_event, { appPath }) => {
        try {
            const homedir = os.homedir();

            // Get App Info
            const appName = basename(appPath, '.app');
            const stats = await fs.stat(appPath);
            let icon = '';

            // Try extracting icon
            // Try extracting icon
            try {
                let iconImage = await app.getFileIcon(appPath, { size: 'large' });
                if (iconImage.isEmpty()) {
                    // Try without size specifier
                    iconImage = await app.getFileIcon(appPath);
                }
                if (!iconImage.isEmpty()) {
                    icon = iconImage.toDataURL();
                } else {
                    throw new Error('Empty icon');
                }
            } catch (e) {
                // SIPS Fallback for system apps/hard-to-read icons
                try {
                    const tmpDir = os.tmpdir();
                    const tmpIcon = path.join(tmpDir, `icon-${randomUUID()}.png`);
                    const toPng = promisify(execFile);
                    // Try to find .icns
                    const icnsPath = path.join(appPath, 'Contents', 'Resources', 'AppIcon.icns');

                    // Convert icns to png 64x64
                    await toPng('sips', ['-s', 'format', 'png', '--resampleHeightWidth', '64', '64', icnsPath, '--out', tmpIcon]);

                    // Read base64
                    const pngData = await fs.readFile(tmpIcon, 'base64');
                    icon = `data:image/png;base64,${pngData}`;

                    // Clean up
                    await fs.unlink(tmpIcon).catch(() => { });
                } catch (sipsErr) {
                    console.error(`[Uninstaller] Failed to get icon via sips for ${appName}:`, sipsErr);
                }
            }

            // Try reading Info.plist for Bundle ID
            let bundleId = '';
            try {
                const plistPath = path.join(appPath, 'Contents', 'Info.plist');
                const plistContent = await fs.readFile(plistPath, 'utf8');
                // Simple regex to find BundleIdentifier
                const match = plistContent.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
                if (match) bundleId = match[1];
            } catch (e) {
                console.log('Could not read bundle ID:', e);
            }

            // Check if app is running
            let isRunning = false;
            try {
                const execAsyncProcess = promisify(exec);
                const { stdout } = await execAsyncProcess(`pgrep -f "${appName}.app/Contents/MacOS"`);
                if (stdout && stdout.trim().length > 0) {
                    isRunning = true;
                }
            } catch (e) {
                // Not running
            }

            console.log(`[Uninstaller] Scanning for: ${appName} (${bundleId}) - Running: ${isRunning}`);

            // Locations to search
            const searchDirs = [
                join(homedir, 'Library/Application Support'),
                join(homedir, 'Library/Caches'),
                join(homedir, 'Library/Preferences'),
                join(homedir, 'Library/Saved Application State'),
                join(homedir, 'Library/Logs'),
                join(homedir, 'Library/Containers'),
                join(homedir, 'Library/WebKit'),
                join(homedir, 'Library/Cookies')
            ];

            const leftovers: any[] = [];
            const appResult: any = {
                name: appName,
                path: appPath,
                size: stats.size,
                icon: icon,
                bundleId: bundleId,
                isRunning: isRunning
            };

            // Helper to get size using du (much faster and safer)
            // Helper to get size using du (much faster and safer)
            const getFolderSize = async (targetPath: string): Promise<number> => {
                try {
                    const execFileAsync = promisify(execFile);
                    // -k for kilobytes, -d 0 for depth 0 (summary)
                    const { stdout } = await execFileAsync('/usr/bin/du', ['-k', '-d', '0', targetPath]);
                    const parts = stdout.trim().split(/\s+/);
                    if (parts.length > 0) {
                        const kb = parseInt(parts[0], 10);
                        return kb * 1024; // Convert to bytes
                    }
                } catch (e) {
                    // Fallback to simple stat if du fails
                    try {
                        const s = await fs.stat(targetPath);
                        return s.size;
                    } catch (err) { }
                }
                return 0;
            };

            appResult.size = await getFolderSize(appPath);


            for (const dir of searchDirs) {
                try {
                    const files = await fs.readdir(dir);
                    for (const file of files) {
                        let match = false;

                        // Check by Bundle ID
                        if (bundleId && file.toLowerCase().includes(bundleId.toLowerCase())) match = true;

                        // Check by App Name (be stricter to avoid false positives)
                        if (!match && file.toLowerCase() === appName.toLowerCase()) match = true;
                        if (!match && file.toLowerCase().startsWith('com.' + appName.toLowerCase())) match = true;

                        if (match) {
                            const fullPath = path.join(dir, file);
                            const size = await getFolderSize(fullPath);
                            // Only add if it exists (size > 0 or verify existence)
                            leftovers.push({
                                path: fullPath,
                                size: size,
                                name: file
                            });
                        }
                    }
                } catch (e) {
                    // Directory might not exist
                }
            }

            // Detect external libraries for gaming platforms
            const externalLibraries: { path: string; size: number; note: string }[] = [];

            // Steam external libraries detection
            if (appName.toLowerCase() === 'steam') {
                try {
                    const libraryFoldersPath = join(homedir, 'Library/Application Support/Steam/steamapps/libraryfolders.vdf');
                    const vdfContent = await fs.readFile(libraryFoldersPath, 'utf8');

                    // Parse VDF for paths (simple regex parsing)
                    const pathMatches = vdfContent.matchAll(/"path"\s+"([^"]+)"/g);
                    for (const match of pathMatches) {
                        const libPath = match[1];
                        // Skip internal paths, only report external volumes
                        if (libPath.startsWith('/Volumes/') || (!libPath.startsWith(homedir) && !libPath.startsWith('/Users'))) {
                            try {
                                const libSize = await getFolderSize(libPath);
                                externalLibraries.push({
                                    path: libPath,
                                    size: libSize,
                                    note: 'Steam Library (external drive)'
                                });
                            } catch {
                                // Can't access this path
                            }
                        }
                    }
                } catch (e) {
                    // No libraryfolders.vdf or can't read
                }
            }

            // Epic Games external libraries detection  
            if (appName.toLowerCase().includes('epic')) {
                try {
                    const epicConfigPath = join(homedir, 'Library/Application Support/Epic/UnrealEngineLauncher/LauncherInstalled.dat');
                    const epicContent = await fs.readFile(epicConfigPath, 'utf8');
                    const data = JSON.parse(epicContent);

                    if (data.InstallationList) {
                        for (const install of data.InstallationList) {
                            if (install.InstallLocation && install.InstallLocation.startsWith('/Volumes/')) {
                                try {
                                    const size = await getFolderSize(install.InstallLocation);
                                    externalLibraries.push({
                                        path: install.InstallLocation,
                                        size: size,
                                        note: `Epic Games: ${install.AppName || 'Game'}`
                                    });
                                } catch {
                                    // Can't access
                                }
                            }
                        }
                    }
                } catch (e) {
                    // No Epic config or can't read
                }
            }

            // GOG Galaxy external libraries detection
            if (appName.toLowerCase().includes('gog')) {
                try {
                    const gogConfigPath = join(homedir, 'Library/Application Support/GOG.com/Galaxy/config.json');
                    const gogContent = await fs.readFile(gogConfigPath, 'utf8');
                    const data = JSON.parse(gogContent);

                    // Check libraryPath or installPath
                    const paths = [data.libraryPath, data.installPath, data.gamesInstallPath].filter(Boolean);
                    for (const libPath of paths) {
                        if (libPath && libPath.startsWith('/Volumes/')) {
                            try {
                                const size = await getFolderSize(libPath);
                                externalLibraries.push({
                                    path: libPath,
                                    size: size,
                                    note: 'GOG Galaxy Library (external)'
                                });
                            } catch {
                                // Can't access
                            }
                        }
                    }
                } catch (e) {
                    // No GOG config
                }
            }

            // Battle.net external libraries detection
            if (appName.toLowerCase().includes('battle.net') || appName.toLowerCase().includes('blizzard')) {
                try {
                    const bnetConfigPath = join(homedir, 'Library/Application Support/Battle.net/Battle.net.config');
                    const bnetContent = await fs.readFile(bnetConfigPath, 'utf8');
                    const data = JSON.parse(bnetContent);

                    // Check Games install paths
                    if (data.Games) {
                        for (const gameKey of Object.keys(data.Games)) {
                            const game = data.Games[gameKey];
                            if (game.InstallPath && game.InstallPath.startsWith('/Volumes/')) {
                                try {
                                    const size = await getFolderSize(game.InstallPath);
                                    externalLibraries.push({
                                        path: game.InstallPath,
                                        size: size,
                                        note: `Battle.net: ${gameKey}`
                                    });
                                } catch {
                                    // Can't access
                                }
                            }
                        }
                    }

                    // Also check DefaultInstallPath
                    if (data.Client?.DefaultInstallPath && data.Client.DefaultInstallPath.startsWith('/Volumes/')) {
                        try {
                            const size = await getFolderSize(data.Client.DefaultInstallPath);
                            externalLibraries.push({
                                path: data.Client.DefaultInstallPath,
                                size: size,
                                note: 'Battle.net Default Install Path'
                            });
                        } catch {
                            // Can't access
                        }
                    }
                } catch (e) {
                    // No Battle.net config
                }
            }

            // Origin/EA App external libraries detection
            if (appName.toLowerCase().includes('origin') || appName.toLowerCase().includes('ea app')) {
                try {
                    const originConfigPath = join(homedir, 'Library/Application Support/Origin/local.xml');
                    const originContent = await fs.readFile(originConfigPath, 'utf8');

                    // Parse XML to find DownloadInPlaceDir
                    const downloadMatch = originContent.match(/<Setting key="DownloadInPlaceDir" value="([^"]+)"/);
                    if (downloadMatch && downloadMatch[1] && downloadMatch[1].startsWith('/Volumes/')) {
                        try {
                            const size = await getFolderSize(downloadMatch[1]);
                            externalLibraries.push({
                                path: downloadMatch[1],
                                size: size,
                                note: 'Origin/EA Games Library'
                            });
                        } catch {
                            // Can't access
                        }
                    }
                } catch (e) {
                    // No Origin config
                }
            }

            // Ubisoft Connect external libraries detection
            if (appName.toLowerCase().includes('ubisoft') || appName.toLowerCase().includes('uplay')) {
                try {
                    const ubiConfigPath = join(homedir, 'Library/Application Support/Ubisoft/Ubisoft Game Launcher/settings.yml');
                    const ubiContent = await fs.readFile(ubiConfigPath, 'utf8');

                    // Parse YAML-like format for game_installation_path
                    const pathMatch = ubiContent.match(/game_installation_path:\s*(.+)/);
                    if (pathMatch && pathMatch[1] && pathMatch[1].trim().startsWith('/Volumes/')) {
                        const libPath = pathMatch[1].trim();
                        try {
                            const size = await getFolderSize(libPath);
                            externalLibraries.push({
                                path: libPath,
                                size: size,
                                note: 'Ubisoft Connect Library'
                            });
                        } catch {
                            // Can't access
                        }
                    }
                } catch (e) {
                    // No Ubisoft config
                }
            }

            return { app: appResult, leftovers, externalLibraries };

        } catch (error: any) {
            console.error('Scan leftovers error:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('uninstaller:uninstall', async (_event, { paths, appInfo }) => {
        try {
            // Check if app is running
            if (appInfo && appInfo.name) {
                const execAsync = promisify(exec);

                try {
                    // Check if process exists using pgrep
                    // Note: This is a basic check. For more robust check we might need 'ps -ax'
                    // Using "pgrep -f" to match full command line (e.g. /Applications/Spotify.app/Contents/MacOS/Spotify)
                    // We search for the executable name which usually matches app name
                    const { stdout } = await execAsync(`pgrep -f "${appInfo.name}.app/Contents/MacOS"`);

                    if (stdout && stdout.trim().length > 0) {
                        // App is running! Ask user
                        const { response } = await dialog.showMessageBox(mainWindow as BrowserWindowType, {
                            type: 'warning',
                            buttons: ['Force Quit & Uninstall', 'Cancel'],
                            defaultId: 0,
                            cancelId: 1,
                            title: 'App is Running',
                            message: `${appInfo.name} is currently running.`,
                            detail: 'Do you want to force quit the application and continue with uninstallation?',
                            icon: appInfo.icon ? nativeImage.createFromDataURL(appInfo.icon) : undefined
                        });

                        if (response === 1) {
                            // User cancelled
                            return { success: false, reason: 'app_running_cancel' };
                        }

                        // Force Quit
                        try {
                            // Kill by PIDs found
                            const pids = stdout.trim().replace(/\n/g, ' ');
                            await execAsync(`kill -9 ${pids}`);
                            // Wait a bit for process to die
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (killErr) {
                            console.error('Failed to force quit:', killErr);
                            // Only throw if strictly necessary, otherwise try to uninstall anyway
                        }
                    }
                } catch (e) {
                    // pgrep returns exit code 1 if no process found, so this is fine
                }
            }

            for (const p of paths) {
                // Use shell.trashItem (Electron) which moves to Trash
                try {
                    await shell.trashItem(p);
                } catch (e) {
                    // Fallback using import
                    const result = await moveToTrash([p]);
                    if (!result.success) {
                        throw new Error(result.error || `Failed to modify ${basename(p)}`);
                    }
                }

                // Double check: Verify file is actually gone
                const existsAfter = await fs.access(p).then(() => true).catch(() => false);
                if (existsAfter) {
                    throw new Error(`Permission denied: Cannot delete ${basename(p)}. It may be a protected system app.`);
                }
            }
            return { success: true };
        } catch (error: any) {
            console.error('Uninstall error:', error);
            return { success: false, error: error.message };
        }
    });

    const UNINSTALL_HISTORY_PATH = join(app.getPath('userData'), 'uninstall-history.json');

    ipcMain.handle('uninstaller:getHistory', async () => {
        try {
            const fs = require('fs/promises');
            const data = await fs.readFile(UNINSTALL_HISTORY_PATH, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    });

    ipcMain.handle('uninstaller:addHistory', async (_event, { entry }) => {
        try {
            const fs = require('fs/promises');
            let history = [];
            try {
                const data = await fs.readFile(UNINSTALL_HISTORY_PATH, 'utf8');
                history = JSON.parse(data);
            } catch (e) { }

            history.unshift(entry); // Add to top
            await fs.writeFile(UNINSTALL_HISTORY_PATH, JSON.stringify(history, null, 2));
            return { success: true };
        } catch (e) {
            return { success: false };
        }
    });

    // ============================================
    // System Optimizer IPC Handlers
    // ============================================

    debugLog('About to register system:runCommand');
    // Implement sudo handling via osascript
    ipcMain.handle('system:runCommand', async (_event, { command, requiresSudo }) => {
        try {
            console.log('[System] Running command:', command, 'sudo:', requiresSudo);
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            let stdout = '';

            if (requiresSudo) {
                // Use osascript for admin privileges
                // Escape double quotes and backslashes for AppleScript
                const escapedCmd = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const sudoCmd = `/usr/bin/osascript -e 'do shell script "${escapedCmd}" with administrator privileges'`;
                const result = await execAsync(sudoCmd);
                stdout = result.stdout;
            } else {
                const result = await execAsync(command, { timeout: 30000 });
                stdout = result.stdout;
            }

            console.log('[System] Command output:', stdout || '(no output)');
            return { success: true, output: stdout };
        } catch (error: any) {
            console.error('[System] Command error:', error);
            // Some commands (like killall) may return error but still work
            // If user cancels password prompt (error 1), we should show specific error
            if (error.message.includes('User canceled')) {
                return { success: false, error: 'Password required' };
            }
            if (error.code === 1 && command.includes('killall')) {
                return { success: true, output: 'Process restarted' };
            }
            return { success: false, error: error.message };
        }
    });

    // ============================================
    // Disk Analyzer IPC Handlers
    // ============================================

    ipcMain.handle('dialog:selectFolder', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow!, {
                properties: ['openDirectory'],
                title: 'Select folder to analyze'
            });

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }

            return { success: true, path: result.filePaths[0] };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('disk:analyzeDirectory', async (_event, { dirPath }) => {
        try {
            console.log('[Disk] Analyzing directory:', dirPath);
            const { execSync } = await import('child_process');

            const expandedPath = dirPath.startsWith('~')
                ? dirPath.replace('~', os.homedir())
                : dirPath;

            const entries = await fs.readdir(expandedPath, { withFileTypes: true });
            const items = [];
            let totalSize = 0;

            const isVolumesDir = expandedPath === '/Volumes';

            for (const entry of entries) {
                const fullPath = path.join(expandedPath, entry.name);
                try {
                    let size = 0;
                    let capacity = 0;
                    let isVolume = false;

                    // Handle Volumes specially
                    if (isVolumesDir || (expandedPath === '/' && entry.name === 'Volumes')) {
                        // Attempt to get volume stats using df
                        try {
                            const dfOutput = execSync(`df -k "${fullPath}"`).toString();
                            const lines = dfOutput.trim().split('\n');
                            if (lines.length >= 2) {
                                const parts = lines[1].split(/\s+/);
                                // df output: Filesystem 1024-blocks Used Available Capacity ...
                                // 1024-blocks = capacity in KB
                                // Used = used in KB (often specific volume usage)
                                // Available = free in KB

                                const totalKB = parseInt(parts[1]);
                                const availKB = parseInt(parts[3]);

                                // For APFS containers/volumes, "Used" is best represented as Capacity - Available
                                // to match user expectation of "How full is this drive?"
                                size = (totalKB - availKB) * 1024;
                                capacity = totalKB * 1024;
                                isVolume = true;
                            }
                        } catch (e) {
                            // Fallback if df fails
                        }
                    }

                    if (!isVolume) {
                        if (entry.isDirectory()) {
                            // Calculate directory size recursively (with limit)
                            size = await getDirSize(fullPath, 0, 3);
                        } else {
                            const stats = await fs.stat(fullPath);
                            size = stats.size;
                        }
                    }

                    totalSize += size;
                    const ext = entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase().replace('.', '');

                    items.push({
                        name: entry.name,
                        path: fullPath,
                        size,
                        capacity,
                        isVolume,
                        // Force isDirectory=true for volumes so they are clickable/navigable
                        isDirectory: isVolume || entry.isDirectory(),
                        extension: ext
                    });
                } catch (e) {
                    // Skip items we can't read
                }
            }

            // Get free space and capacity for current listing context
            let freeSpace = 0;
            let diskCapacity = 0;
            let volumeUsed = undefined;

            try {
                const dfOutput = execSync(`df -k "${expandedPath}"`).toString();
                const lines = dfOutput.trim().split('\n');
                if (lines.length >= 2) {
                    // Split by space but handle mount point being last
                    const parts = lines[1].split(/\s+/);
                    // macOS df: Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on
                    // Index 0: Filesystem
                    // Index 1: Total (1024-blocks)
                    // Index 2: Used (often volume specific)
                    // Index 3: Avail
                    // ...
                    // Index 8+: Mount point

                    diskCapacity = parseInt(parts[1]) * 1024;
                    freeSpace = parseInt(parts[3]) * 1024;

                    // Reconstruct mount point
                    const mountPoint = parts.slice(8).join(' ');

                    // If we are scanning the root of the volume, we should report TRUE disk usage
                    // which is Capacity - Free (for APFS/Containers) or just Used
                    if (mountPoint === expandedPath || (mountPoint === '/' && expandedPath === '/')) {
                        volumeUsed = diskCapacity - freeSpace;
                    }
                }
            } catch (e) { }

            return { success: true, items, totalSize, freeSpace, diskCapacity, volumeUsed };
        } catch (error: any) {
            console.error('[Disk] Analyze error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('disk:deleteFile', async (_event, { filePath }) => {
        try {
            console.log('[Disk] Deleting file permanently:', filePath);
            await fs.rm(filePath, { recursive: true, force: true });
            return { success: true };
        } catch (error: any) {
            console.error('[Disk] Delete error:', error);
            return { success: false, error: error.message };
        }
    });

    // ============================================
    // Status Dashboard IPC Handlers
    // ============================================

    let prevCpuInfo: { idle: number; total: number } | null = null;
    let prevNetworkStats: { rx: number; tx: number; time: number } | null = null;

    ipcMain.handle('status:getSystemStats', async () => {
        try {
            // CPU Usage
            const cpus = os.cpus();
            let idle = 0, total = 0;
            for (const cpu of cpus) {
                idle += cpu.times.idle;
                total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
            }

            let cpuUsage = 0;
            if (prevCpuInfo) {
                const idleDiff = idle - prevCpuInfo.idle;
                const totalDiff = total - prevCpuInfo.total;
                cpuUsage = Math.round((1 - idleDiff / totalDiff) * 100);
            }
            prevCpuInfo = { idle, total };

            // Memory - use vm_stat for accurate available memory (like macOS Stats app)
            const totalMem = os.totalmem();
            let usedMem = totalMem - os.freemem(); // fallback
            try {
                // Get page size and vm_stat for accurate memory calculation
                const vmOutput = execSync('vm_stat').toString();
                const pageSize = 16384; // Apple Silicon uses 16KB pages

                // Parse vm_stat output
                const getPages = (label: string): number => {
                    const match = vmOutput.match(new RegExp(`${label}:\\s+(\\d+)`));
                    return match ? parseInt(match[1]) : 0;
                };

                const freePages = getPages('Pages free');
                const inactivePages = getPages('Pages inactive');
                const purgablePages = getPages('Pages purgeable');
                const speculativePages = getPages('Pages speculative');

                // Available memory = free + inactive + purgeable + speculative (like Activity Monitor)
                const availableBytes = (freePages + inactivePages + purgablePages + speculativePages) * pageSize;
                usedMem = totalMem - availableBytes;
            } catch (e) {
                // Use fallback os.freemem() if vm_stat fails
            }
            const freeMem = totalMem - usedMem;

            // Disk - detect boot disk and external volumes
            interface DiskInfo {
                name: string;
                total: number;
                used: number;
                free: number;
                freePercent: number;
            }
            const disks: DiskInfo[] = [];
            try {
                // Get all mounted volumes
                const dfOutput = execSync('df -k').toString();
                const lines = dfOutput.trim().split('\n').slice(1); // Skip header

                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length < 9) continue;

                    const mountPoint = parts.slice(8).join(' ');

                    // Boot disk
                    if (mountPoint === '/') {
                        const total = parseInt(parts[1]) * 1024;
                        const used = parseInt(parts[2]) * 1024;
                        const free = parseInt(parts[3]) * 1024;
                        const freePercent = Math.round((free / total) * 100);
                        disks.push({ name: 'Macintosh HD', total, used, free, freePercent });
                    }
                    // External volumes in /Volumes (not hidden, not system)
                    else if (mountPoint.startsWith('/Volumes/') && !mountPoint.includes('com.apple')) {
                        const name = mountPoint.replace('/Volumes/', '');
                        const total = parseInt(parts[1]) * 1024;
                        const used = parseInt(parts[2]) * 1024;
                        const free = parseInt(parts[3]) * 1024;
                        const freePercent = Math.round((free / total) * 100);
                        if (total > 0) {
                            disks.push({ name, total, used, free, freePercent });
                        }
                    }
                }
            } catch (e) { }

            // Keep old format for compatibility (first disk = boot)
            const diskTotal = disks[0]?.total || 0;
            const diskUsed = disks[0]?.used || 0;
            const diskFree = disks[0]?.free || 0;

            // Network (auto-detect default interface and calculate rate)
            let rxRate = 0, txRate = 0;
            try {
                // Get default network interface (en0, en1, etc.)
                const iface = execSync("route get default 2>/dev/null | grep 'interface:' | awk '{print $2}'").toString().trim() || 'en0';
                // Get network bytes from netstat - look for the Link# line which has the byte counts
                const output = execSync(`netstat -ib | grep -E '^${iface} ' | head -1`).toString();
                const parts = output.trim().split(/\s+/);
                // Format: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
                // Index:   0    1    2       3      4     5     6      7     8     9      10
                const rxBytes = parseInt(parts[6]) || 0;
                const txBytes = parseInt(parts[9]) || 0;
                const now = Date.now();

                if (prevNetworkStats && (rxBytes > 0 || txBytes > 0)) {
                    const timeDiff = (now - prevNetworkStats.time) / 1000;
                    if (timeDiff > 0) {
                        rxRate = Math.max(0, (rxBytes - prevNetworkStats.rx) / timeDiff);
                        txRate = Math.max(0, (txBytes - prevNetworkStats.tx) / timeDiff);
                    }
                }
                prevNetworkStats = { rx: rxBytes, tx: txBytes, time: now };
            } catch (e) { }

            // Top processes
            let processes: { name: string; cpu: number }[] = [];
            try {
                const psOutput = execSync("ps -Aceo %cpu,comm | sort -nr | head -5").toString();
                const lines = psOutput.trim().split('\n');
                processes = lines.map(line => {
                    const parts = line.trim().split(/\s+/);
                    const cpu = parseFloat(parts[0]) || 0;
                    const name = parts.slice(1).join(' ');
                    return { name, cpu: Math.round(cpu) };
                }).filter(p => p.cpu > 0);
            } catch (e) { }

            // Uptime
            const uptimeSeconds = os.uptime();
            const uptimeDays = Math.floor(uptimeSeconds / 86400);
            const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
            const uptimeMins = Math.floor((uptimeSeconds % 3600) / 60);
            const uptime = uptimeDays > 0
                ? `${uptimeDays}d ${uptimeHours}h ${uptimeMins}m`
                : uptimeHours > 0
                    ? `${uptimeHours}h ${uptimeMins}m`
                    : `${uptimeMins}m`;

            return {
                cpu: {
                    usage: cpuUsage,
                    model: cpus[0]?.model || 'Unknown'
                },
                memory: {
                    total: totalMem,
                    used: usedMem,
                    free: freeMem
                },
                disk: {
                    total: diskTotal,
                    used: diskUsed,
                    free: diskFree
                },
                disks, // Array of all disks with name, total, used, free, freePercent
                network: {
                    rx: rxRate,
                    tx: txRate
                },
                processes,
                uptime
            };
        } catch (error: any) {
            console.error('[Status] Error getting stats:', error);
            return {
                cpu: { usage: 0, model: 'Unknown' },
                memory: { total: 0, used: 0, free: 0 },
                disk: { total: 0, used: 0, free: 0 },
                network: { rx: 0, tx: 0 },
                processes: [],
                uptime: '--'
            };
        }
    });

    ipcMain.handle('status:openMainWindow', async () => {
        if (mainWindow) {
            mainWindow.show();
        } else {
            createWindow();
        }
        if (process.platform === 'darwin') {
            app.dock?.show();
        }
        // Hide status popup after opening main window
        if (statusWindow && !statusWindow.isDestroyed()) {
            statusWindow.hide();
        }
        return { success: true };
    });

    ipcMain.handle('status:runClean', async () => {
        // Hide popup and run clean
        if (statusWindow && !statusWindow.isDestroyed()) {
            statusWindow.hide();
        }
        runScheduledClean();
        return { success: true };
    });

    ipcMain.handle('status:quitApp', async () => {
        isQuitting = true;
        app.quit();
        return { success: true };
    });

    ipcMain.handle('status:getScheduleInfo', async () => {
        try {
            clearConfigCache();
            const config = await loadConfig();
            const schedule: Schedule = config.autoCleanSchedule || {};
            const scanners = getAvailableScanners();

            if (!schedule.enabled) {
                return { enabled: false };
            }

            // Build schedule text
            let scheduleText = '';
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            if (schedule.frequency === 'monthly' && schedule.day) {
                scheduleText = `Monthly: Day ${schedule.day} at ${schedule.time}`;
            } else if (schedule.frequency === 'weekly' && schedule.day !== undefined) {
                scheduleText = `Weekly: ${dayNames[schedule.day]} at ${schedule.time}`;
            } else {
                scheduleText = `Daily at ${schedule.time}`;
            }

            // Get category names
            const catNames = (schedule.categories || [])
                .map(id => scanners.find(s => s.id === id)?.name || id)
                .slice(0, 3);
            const categoryText = catNames.length > 0
                ? catNames.join(', ') + ((schedule.categories?.length || 0) > 3 ? ` +${(schedule.categories?.length || 0) - 3} more` : '')
                : '';

            // Calculate countdown based on frequency
            const now = new Date();
            const [schedHour, schedMin] = (schedule.time || '00:00').split(':').map(Number);
            let next = new Date();
            next.setHours(schedHour, schedMin, 0, 0);

            if (schedule.frequency === 'monthly' && schedule.day) {
                // Find next occurrence of day X of month
                next.setDate(schedule.day);
                if (next <= now) {
                    // Move to next month
                    next.setMonth(next.getMonth() + 1);
                    next.setDate(schedule.day);
                }
            } else if (schedule.frequency === 'weekly' && schedule.day !== undefined) {
                // Find next occurrence of weekday (0=Sunday, 1=Monday, etc.)
                const currentDay = now.getDay();
                let daysUntil = schedule.day - currentDay;
                if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
                    daysUntil += 7;
                }
                next.setDate(now.getDate() + daysUntil);
            } else {
                // Daily
                if (next <= now) {
                    next.setDate(next.getDate() + 1);
                }
            }

            const diffMs = next.getTime() - now.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

            let countdownText = '';
            if (diffDays > 0) countdownText = `In ${diffDays}d ${diffHours}h`;
            else if (diffHours > 0) countdownText = `In ${diffHours}h ${diffMins}m`;
            else countdownText = `In ${diffMins} minutes`;

            return {
                enabled: true,
                scheduleText,
                categoryText,
                countdownText,
                isCleaning
            };
        } catch (e) {
            return { enabled: false };
        }
    });



    // Transfer Status for Tray Popup
    ipcMain.handle('status:getTransferStatus', async () => {
        try {
            return getTransferStatusForTray();
        } catch (e) {
            return { sharing: [], receiving: [] };
        }
    });

    // Transfer Logic Setup
    setupTransferHandlers();

    // ============================================
    // Auto Updater IPC Handlers
    // ============================================

    // Handle manual check for updates
    ipcMain.handle('updater:check', async () => {
        try {
            if (app.isPackaged) {
                console.log('[Updater] Checking for updates...');
                const result = await autoUpdater.checkForUpdates();
                return { success: true, result };
            } else {
                console.log('[Updater] Skipping update check in development mode');
                return { success: true, devMode: true };
            }
        } catch (error: any) {
            console.error('[Updater] Check failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle downloading the update
    ipcMain.handle('updater:download', async () => {
        try {
            console.log('[Updater] Downloading update...');
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error: any) {
            console.error('[Updater] Download failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle quit and install
    ipcMain.handle('updater:quitAndInstall', () => {
        console.log('[Updater] Quitting and installing update...');
        autoUpdater.quitAndInstall(false, true); // false = don't run silently, true = run after update
        return { success: true };
    });

    // Forward updater events to renderer
    autoUpdater.on('update-available', (info) => {
        console.log('[Updater] Update available:', info.version);
        if (mainWindow) {
            mainWindow.webContents.send('updater:update-available', info);
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('[Updater] Update not available');
        if (mainWindow) {
            mainWindow.webContents.send('updater:update-not-available', info);
        }
    });

    autoUpdater.on('download-progress', (progressObj) => {
        // progressObj contains: bytesPerSecond, percent, total, transferred
        if (mainWindow) {
            mainWindow.webContents.send('updater:download-progress', progressObj);
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('[Updater] Update downloaded');
        if (mainWindow) {
            mainWindow.webContents.send('updater:update-downloaded', info);
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err);
        if (mainWindow) {
            mainWindow.webContents.send('updater:error', err.message);
        }
    });

    console.log('[IPC] All IPC handlers registered successfully!');
}

// Helper: Calculate directory size recursively (with depth limit)
async function getDirSize(dirPath: string, currentDepth: number, maxDepth: number): Promise<number> {
    if (currentDepth > maxDepth) return 0;
    let size = 0;
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    size += await getDirSize(fullPath, currentDepth + 1, maxDepth);
                } else {
                    const stats = await fs.stat(fullPath);
                    size += stats.size;
                }
            } catch (e) {
                // Skip unreadable entries
            }
        }
    } catch (e) {
        // Ignore permission errors
    }
    return size;
}

