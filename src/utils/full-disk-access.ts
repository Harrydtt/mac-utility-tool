import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { shell } from 'electron';

/**
 * Check if app has Full Disk Access permission
 * Tests by trying to read ~/.Trash which requires FDA
 */
export async function hasFullDiskAccess(): Promise<boolean> {
    try {
        const trashPath = join(homedir(), '.Trash');
        await access(trashPath, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Open System Preferences to Full Disk Access pane
 */
export function openFullDiskAccessSettings(): void {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
}
