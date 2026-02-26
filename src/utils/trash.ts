import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { loadConfig } from './config.js';

const execAsync = promisify(exec);

export async function moveToTrash(paths: string[]): Promise<{ success: boolean; error?: string; successCount?: number; failedCount?: number }> {
  if (platform() !== 'darwin') {
    return { success: false, error: 'Move to trash is only supported on macOS' };
  }

  if (paths.length === 0) {
    return { success: true, successCount: 0, failedCount: 0 };
  }

  try {
    console.log(`[moveToTrash] Processing ${paths.length} items...`);

    const { rename, mkdir, access, rm } = await import('fs/promises');
    const { constants } = await import('fs');
    const { basename } = await import('path');
    const { homedir } = await import('os');

    // Check setting for permanent delete
    const config = await loadConfig();
    const deletePermanently = (config as any).deletePermanently === true;
    console.log(`[moveToTrash] Delete mode: ${deletePermanently ? 'PERMANENT' : 'TRASH'}`);

    // macOS Trash location
    const trashPath = `${homedir()}/.Trash`;

    // Ensure trash directory exists (only needed for trash mode)
    if (!deletePermanently) {
      await mkdir(trashPath, { recursive: true });
    }

    let successCount = 0;
    let failedItems: string[] = [];
    let permissionDenied = 0;

    // Move files one by one
    for (const filePath of paths) {
      try {
        // Special case: if file is already in Trash, delete it permanently
        if (filePath.startsWith(trashPath + '/')) {
          console.log(`[moveToTrash] File is in Trash, deleting permanently: ${filePath}`);
          await rm(filePath, { recursive: true, force: true });
          successCount++;
          continue;
        }

        // If permanent delete is enabled, use rm() directly
        if (deletePermanently) {
          console.log(`[moveToTrash] Permanently deleting: ${filePath}`);
          await rm(filePath, { recursive: true, force: true });
          successCount++;
          continue;
        }

        // Check if we have permission to access the file
        try {
          await access(filePath, constants.W_OK);
        } catch (accessErr: any) {
          if (accessErr.code === 'EACCES' || accessErr.code === 'EPERM') {
            console.error(`[moveToTrash] Permission denied for ${filePath}`);
            failedItems.push(filePath); // Treat as failure
            continue;
          }
        }

        const fileName = basename(filePath);
        let destPath = `${trashPath}/${fileName}`;

        // Handle name conflicts by appending counter
        let counter = 1;
        while (true) {
          try {
            await rename(filePath, destPath);
            successCount++;
            console.log(`[moveToTrash] Moved: ${filePath} → ${destPath}`);
            break;
          } catch (err: any) {
            if (err.code === 'EEXIST') {
              // File exists in trash, add counter
              const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
              const base = ext ? fileName.slice(0, -ext.length) : fileName;
              destPath = `${trashPath}/${base}_${counter}${ext}`;
              counter++;
            } else if (err.code === 'ENOTEMPTY') {
              // Directory not empty - remove existing trash folder and retry
              try {
                await rm(destPath, { recursive: true, force: true });
                await rename(filePath, destPath);
                successCount++;
                console.log(`[moveToTrash] Moved (after clearing): ${filePath} → ${destPath}`);
                break;
              } catch (retryErr: any) {
                console.error(`[moveToTrash] Failed to move after clearing: ${filePath}`, retryErr.message);
                failedItems.push(filePath);
                break;
              }
            } else if (err.code === 'EACCES' || err.code === 'EPERM') {
              // Permission denied during rename
              console.error(`[moveToTrash] Permission denied during rename for ${filePath}`);
              failedItems.push(filePath); // Treat as failure
              break;
            } else {
              throw err;
            }
          }
        }
      } catch (error: any) {
        console.error(`[moveToTrash] Failed to move ${filePath}:`, error.message);
        failedItems.push(filePath);
      }
    }

    const failedCount = failedItems.length;
    console.log(`[moveToTrash] Complete: ${successCount} moved, ${failedItems.length} failed`);

    // Return success only if we moved at least some files and didn't fail on everything
    // Ideally for uninstall we want complete success, but let's keep the logic:
    // Success if at least one worked? Or success if NO failures? 
    // New logic: Success if we processed everything successfully.
    // But to match previous behavior (allow partial):

    return {
      success: failedCount === 0 && successCount > 0, // Strict success
      successCount,
      failedCount,
      error: failedItems.length > 0 ? `${failedItems.length} items failed: ${failedItems.slice(0, 2).map(p => basename(p)).join(', ')}${failedItems.length > 2 ? '...' : ''}` : undefined
    };
  } catch (error: any) {
    console.error('[moveToTrash] Unexpected error:', error);
    return { success: false, error: error.message, successCount: 0, failedCount: paths.length };
  }
}

export async function emptyTrash(): Promise<{ success: boolean; error?: string }> {
  if (platform() !== 'darwin') {
    return { success: false, error: 'Empty trash is only supported on macOS' };
  }

  try {
    // osascript -e 'tell application "Finder" to empty trash' 
    // This often pops up a dialog or fails if Finder is busy.
    // Force empty might be better but risky. Standard verification is good.
    // Let's stick to standard behavior.
    await execAsync(`osascript -e 'tell application "Finder" to empty trash'`);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
