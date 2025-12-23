import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, dialog, shell, safeStorage } from 'electron';
import { join, dirname, basename } from 'path';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAllScans, getAvailableScanners } from '../src/scanners/index.js';
import { moveToTrash, loadConfig, saveConfig, getHistory, saveHistory, addIgnoredPaths, clearConfigCache } from '../src/utils/index.js';
import { randomUUID } from 'crypto';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Type for schedule config
interface Schedule {
    enabled?: boolean;
    frequency?: 'daily' | 'weekly' | 'monthly';
    time?: string;
    day?: number;
    categories?: string[];
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let cleanTimer: NodeJS.Timeout | null = null;
let warningShown = false;
let isCleaning = false;
let originalIcon: Electron.NativeImage | null = null;
let iconAnimationTimer: NodeJS.Timeout | null = null;
let isQuitting = false;

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
    tray.setToolTip('MacCleaner');
    originalIcon = icon; // Save for animation restore
    console.log('[Tray] Tray created');

    updateTrayMenu();

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
        } else {
            createWindow();
        }
        // Show dock icon when window is visible
        if (process.platform === 'darwin') {
            app.dock?.show();
        }
    });
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
    if (!tray) return;

    clearConfigCache(); // Always get fresh config
    const config = await loadConfig();
    const schedule: Schedule = config.autoCleanSchedule || {};
    const scanners = getAvailableScanners();

    // Build menu items
    const menuItems: Electron.MenuItemConstructorOptions[] = [
        { label: 'MacCleaner', enabled: false },
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

        menuItems.push({ label: `📅 ${scheduleText}`, enabled: false });

        // Show categories
        const catNames = (schedule.categories || [])
            .map(id => scanners.find(s => s.id === id)?.name || id)
            .slice(0, 3);
        if (catNames.length > 0) {
            const more = (schedule.categories?.length || 0) > 3 ? ` +${(schedule.categories?.length || 0) - 3} more` : '';
            menuItems.push({ label: `📁 ${catNames.join(', ')}${more}`, enabled: false });
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
            menuItems.push({ label: '🧹 Cleaning ━━━━━━━━', enabled: false });
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
            menuItems.push({ label: countdownText, enabled: false });
        }
    } else {
        if (isCleaning) {
            menuItems.push({ label: '🧹 Cleaning ━━━━━━━━', enabled: false });
        } else {
            menuItems.push({ label: '⏸ Schedule: Off', enabled: false });
        }
    }

    menuItems.push({ type: 'separator' });
    menuItems.push({
        label: 'Open MacCleaner',
        click: () => {
            if (mainWindow) {
                mainWindow.show();
            } else {
                createWindow();
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
            title: 'MacCleaner',
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
            title: 'MacCleaner',
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
        title: 'MacCleaner - Auto Clean Complete',
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
                title: 'MacCleaner',
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
    createWindow();
    createTray();
    registerIPCHandlers();
    startScheduleTimer();

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

    ipcMain.handle('uninstaller:addHistory', async (_event, { entry }) => {
        try {
            const fs = require('fs/promises');
            let history = [];
            try {
                const data = await fs.readFile(UNINSTALL_HISTORY_PATH, 'utf8');
                history = JSON.parse(data);
            } catch (e) { }

            history.unshift(entry);
            await fs.writeFile(UNINSTALL_HISTORY_PATH, JSON.stringify(history, null, 2));
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
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

    ipcMain.handle('threats:scan', async (_event, { paths }) => {
        try {
            const { scanThreats } = await import('../src/scanners/threats.js');
            const threats = await scanThreats(paths);
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
            console.error('[IPC] Threat delete error:', error);
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

    ipcMain.handle('clamav:install', async () => {
        try {
            const { installClamAV } = await import('../src/utils/clamav.js');
            return await installClamAV();
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
        const checkDiskSpace = (await import('check-disk-space')).default;
        const space = await checkDiskSpace('/');
        return {
            total: space.size,
            free: space.free,
            used: space.size - space.free,
        };
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
                { parallel: true },
                (scanner: any, result: any) => {
                    mainWindow?.webContents.send('scan:progress', {
                        scanner: scanner.category.id,
                        result
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
                (scanner: any, result: any) => {
                    mainWindow?.webContents.send('scan:progress', {
                        scanner: scanner.category.id,
                        result
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

            // Check if any items are in Trash - if so, use permanent delete
            const hasTrashItems = options.items.some(item => item.startsWith(trashPath + '/'));
            const mode = hasTrashItems ? 'permanent' : (options.mode || 'trash');

            console.log('[IPC] Using delete mode:', mode, 'hasTrashItems:', hasTrashItems);

            if (mode === 'permanent') {
                const { rm } = await import('fs/promises');
                let successCount = 0;
                let failedCount = 0;
                const errors: string[] = [];

                for (const item of options.items) {
                    try {
                        await rm(item, { recursive: true, force: true });
                        successCount++;
                        console.log('[IPC] Permanently deleted:', item);
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
        const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
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
                        const { response } = await dialog.showMessageBox(mainWindow as BrowserWindow, {
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
                    await moveToTrash([p]);
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
}
