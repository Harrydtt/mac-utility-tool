import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
const HISTORY_FILE = join(homedir(), '.maccleaner_history.json');
export async function getHistory() {
    try {
        await access(HISTORY_FILE);
        const content = await readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return [];
    }
}
export async function saveHistory(log) {
    const history = await getHistory();
    // Keep last 50 entries
    history.unshift(log);
    if (history.length > 50) {
        history.pop();
    }
    await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}
export async function clearHistory() {
    await writeFile(HISTORY_FILE, '[]');
}
//# sourceMappingURL=history.js.map