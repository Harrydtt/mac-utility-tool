import { ipcMain, app, shell } from 'electron';
import { copyFile, mkdir, rm, readdir, rename, stat } from 'fs/promises';
import { join, basename, extname, dirname } from 'path';
import { loadConfig } from '../src/utils/config.js';
import * as crypto from 'crypto';

export function setupGameHandlers() {
    console.log('[GameHandlers] Registering IPC handlers...');
    // ==========================================
    // GAME STORAGE & MANAGEMENT
    // ==========================================

    // Import Game (Copy to UserData/Games/<platform>)
    ipcMain.handle('games:import', async (_event, { sourcePath, platform }) => {
        try {
            const userDataPath = app.getPath('userData');
            const gamesDir = join(userDataPath, 'Games', platform ? platform.toString() : 'Unknown');

            // Ensure dir exists
            await mkdir(gamesDir, { recursive: true });

            const fileName = basename(sourcePath);
            const destPath = join(gamesDir, fileName);

            // Check if source and dest are the same (already in library folder)
            if (sourcePath === destPath) {
                return { success: true, newPath: destPath };
            }

            // Copy file
            await copyFile(sourcePath, destPath);

            return { success: true, newPath: destPath };
        } catch (error: any) {
            console.error('[IPC] Game import error:', error);
            return { success: false, error: error.message };
        }
    });

    // Delete Game (Respect deleteMode)
    ipcMain.handle('games:delete', async (_event, { filePath }) => {
        try {
            const config = await loadConfig();
            const useTrash = config.deleteMode !== 'permanent';

            // Derive thumbnail path
            const thumbnailPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.jpg';

            if (useTrash) {
                await shell.trashItem(filePath);
                try { await shell.trashItem(thumbnailPath); } catch (e) { }
            } else {
                await rm(filePath, { force: true });
                await rm(thumbnailPath, { force: true }).catch(() => { });
            }

            return { success: true };
        } catch (error: any) {
            console.error('[IPC] Game delete error:', error);
            // Even if file doesn't exist, return success so UI can clean up
            if (error.code === 'ENOENT') return { success: true };
            return { success: false, error: error.message };
        }
    });

    // Open Game Folder
    ipcMain.handle('games:openFolder', async (_event, { filePath }) => {
        try {
            if (filePath) {
                shell.showItemInFolder(filePath);
                return { success: true };
            }
            return { success: false, error: 'No file path provided' };
        } catch (error: any) {
            console.error('[IPC] Open folder error:', error);
            return { success: false, error: error.message };
        }
    });

    // Auto-Sync and Sort Game Library
    ipcMain.handle('games:syncFolder', async () => {
        try {
            const userDataPath = app.getPath('userData');
            const gamesBaseDir = join(userDataPath, 'Games');
            await mkdir(gamesBaseDir, { recursive: true });

            // Define known platforms
            const platformExts: Record<string, string> = {
                'nes': 'nes',
                'sfc': 'snes', 'smc': 'snes',
                'gba': 'gba',
                'gb': 'gb', 'gbc': 'gb',
                'md': 'sega', 'bin': 'sega'
            };

            const allValidGames: any[] = [];

            // Helper to recursively scan directories
            async function scanDir(currentDir: string) {
                const entries = await readdir(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = join(currentDir, entry.name);

                    if (entry.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (entry.isFile() && !entry.name.startsWith('.')) {
                        const ext = extname(entry.name).toLowerCase().replace('.', '');
                        const targetPlatform = platformExts[ext];

                        if (targetPlatform) {
                            const expectedDir = join(gamesBaseDir, targetPlatform);
                            await mkdir(expectedDir, { recursive: true });

                            let finalPath = fullPath;

                            // If file is misplaced, move it
                            if (currentDir !== expectedDir) {
                                finalPath = join(expectedDir, entry.name);

                                // Avoid overwriting if file already exists in target
                                let counter = 1;
                                while (true) {
                                    try {
                                        await stat(finalPath);
                                        const nameWithoutExt = basename(entry.name, `.${ext}`);
                                        finalPath = join(expectedDir, `${nameWithoutExt}_${counter}.${ext}`);
                                        counter++;
                                    } catch {
                                        break; // File doesn't exist, safe to move
                                    }
                                }

                                await rename(fullPath, finalPath);
                                console.log(`[Games Sync] Moved misplaced file: ${entry.name} -> ${targetPlatform}`);
                            }

                            // Generate a stable ID based on path
                            const id = crypto.createHash('md5').update(finalPath).digest('hex');

                            // Check for associated thumbnail (adjacent to ROM)
                            const nameWithoutExt = basename(finalPath, `.${ext}`);
                            const parentDir = dirname(finalPath);

                            let thumbnailPath = null;
                            const possibleThumbnails = [
                                join(parentDir, `${nameWithoutExt}.jpg`),
                                join(parentDir, `${nameWithoutExt}.png`),
                                join(parentDir, `${nameWithoutExt}.jpeg`)
                            ];

                            for (const p of possibleThumbnails) {
                                try {
                                    await stat(p);
                                    thumbnailPath = p;
                                    break;
                                } catch {
                                    // Not found, check next
                                }
                            }

                            allValidGames.push({
                                id,
                                name: basename(finalPath, `.${ext}`),
                                ext,
                                filePath: finalPath,
                                thumbnail: thumbnailPath,
                                isFavorite: false // Default, frontend will merge this
                            });
                        }
                    }
                }
            }

            await scanDir(gamesBaseDir);

            return { success: true, games: allValidGames };
        } catch (error: any) {
            console.error('[IPC] Sync folder error:', error);
            return { success: false, error: error.message };
        }
    });

    // Save Game Thumbnail
    ipcMain.handle('games:saveThumbnail', async (_event, { gameId, dataUrl }) => {
        try {
            const userDataPath = app.getPath('userData');
            const thumbnailsDir = join(userDataPath, 'Games', 'thumbnails');
            await mkdir(thumbnailsDir, { recursive: true });

            const thumbnailPath = join(thumbnailsDir, `${gameId}.jpg`);

            // Convert exact base64 format
            const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
            const fs = await import('fs/promises');
            await fs.writeFile(thumbnailPath, base64Data, 'base64');

            return { success: true, path: thumbnailPath };
        } catch (error: any) {
            console.error('[IPC] Save thumbnail error:', error);
            return { success: false, error: error.message };
        }
    });

}
