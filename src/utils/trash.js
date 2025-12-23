import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
const execAsync = promisify(exec);
export async function moveToTrash(paths) {
    if (platform() !== 'darwin') {
        return { success: false, error: 'Move to trash is only supported on macOS' };
    }
    if (paths.length === 0) {
        return { success: true };
    }
    try {
        // AppleScript to move files to trash using POSIX file paths
        const appleScript = `
      set posixPaths to {${paths.map(p => `"${p}"`).join(', ')}}
      tell application "Finder"
        repeat with p in posixPaths
          try
            move (POSIX file p) to trash
          end try
        end repeat
      end tell
    `;
        await execAsync(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`);
        return { success: true };
    }
    catch (error) {
        return { success: false, error: error.message };
    }
}
export async function emptyTrash() {
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
    }
    catch (error) {
        return { success: false, error: error.message };
    }
}
//# sourceMappingURL=trash.js.map