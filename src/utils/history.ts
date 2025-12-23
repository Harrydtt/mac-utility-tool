import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';


const HISTORY_FILE = join(homedir(), '.maccleaner_history.json');

export interface CleanupLog {
    id: string;
    timestamp: string;
    totalFreed: number;
    itemsCount: number;
    mode: 'trash' | 'permanent' | 'ui-trash' | 'ui-permanent';
    categories?: string[]; // Category names that were cleaned
}

export async function getHistory(): Promise<CleanupLog[]> {
    try {
        await access(HISTORY_FILE);
        const content = await readFile(HISTORY_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        return [];
    }
}

export async function saveHistory(log: CleanupLog): Promise<void> {
    const history = await getHistory();
    // Keep last 50 entries
    history.unshift(log);
    if (history.length > 50) {
        history.pop();
    }
    await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export async function clearHistory(): Promise<void> {
    await writeFile(HISTORY_FILE, '[]');
}
