// Transfer State Persistence Utility
// Saves and loads transfer state to/from disk

import * as fs from 'fs';
import * as path from 'path';

import { app } from 'electron';


interface ShareItem {
    id: string;
    files: string[];
    oldTicket: string;
    createdAt: string;
    forceZip?: boolean; // Persist zip mode (true=zip, false=no-zip)
    generatedName?: string; // Persist generated zip filename (e.g. MyFolder.zip)
    sourceFolderPath?: string | string[]; // Original folder path(s) for folder shares
    batchSuffix?: string; // 3-digit unique suffix for no-zip batch folders
}

interface ReceiveItem {
    id: string;
    ticket: string;
    status: 'pending' | 'active' | 'completed' | 'failed';
    filename?: string;
    progress: number;
    createdAt: string;
}

const SHARE_STATE_FILE = 'transfer-state-share.json';
const RECEIVE_STATE_FILE = 'transfer-state-receive.json';

function getShareStatePath(): string {
    return path.join(app.getPath('userData'), SHARE_STATE_FILE);
}

function getReceiveStatePath(): string {
    return path.join(app.getPath('userData'), RECEIVE_STATE_FILE);
}

// Separated default states
function getDefaultShareState(): ShareState {
    return { sharing: [] };
}

function getDefaultReceiveState(): ReceiveState {
    return {
        receiving: [],
        settings: {
            receiveFolder: app.getPath('downloads')
        }
    };
}

interface ShareState {
    sharing: ShareItem[];
}

interface ReceiveState {
    receiving: ReceiveItem[];
    settings: {
        receiveFolder: string;
    };
}

// ===== SHARING STATE OPERATIONS =====
export function loadShareState(): ShareState {
    try {
        const statePath = getShareStatePath();
        if (fs.existsSync(statePath)) {
            const data = fs.readFileSync(statePath, 'utf-8');
            const state = JSON.parse(data);
            return { sharing: state.sharing || [] };
        }
    } catch (e) {
        console.error('[TransferState] Failed to load share state:', e);
    }
    return getDefaultShareState();
}

export function saveShareState(state: ShareState): boolean {
    try {
        const statePath = getShareStatePath();
        const stateDir = path.dirname(statePath);
        if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
        // console.log('[TransferState] Share state saved');
        return true;
    } catch (e) {
        console.error('[TransferState] Failed to save share state:', e);
        return false;
    }
}

// ===== RECEIVING STATE OPERATIONS =====
export function loadReceiveState(): ReceiveState {
    try {
        const statePath = getReceiveStatePath();
        if (fs.existsSync(statePath)) {
            const data = fs.readFileSync(statePath, 'utf-8');
            const state = JSON.parse(data);
            return {
                receiving: state.receiving || [],
                settings: state.settings || { receiveFolder: app.getPath('downloads') }
            };
        }
    } catch (e) {
        console.error('[TransferState] Failed to load receive state:', e);
    }
    return getDefaultReceiveState();
}

export function saveReceiveState(state: ReceiveState): boolean {
    try {
        const statePath = getReceiveStatePath();
        const stateDir = path.dirname(statePath);
        if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
        // console.log('[TransferState] Receive state saved');
        return true;
    } catch (e) {
        console.error('[TransferState] Failed to save receive state:', e);
        return false;
    }
}

// Convenience functions for partial updates
// Convenience update functions
export function saveSharing(items: ShareItem[]): boolean {
    return saveShareState({ sharing: items });
}

export function saveReceiving(items: ReceiveItem[]): boolean {
    const currentState = loadReceiveState();
    currentState.receiving = items;
    return saveReceiveState(currentState);
}

export function saveReceiveFolder(folder: string): boolean {
    const currentState = loadReceiveState();
    currentState.settings.receiveFolder = folder;
    return saveReceiveState(currentState);
}

export function getReceiveFolder(): string {
    return loadReceiveState().settings.receiveFolder;
}

// Helper functions for specific item updates
export function clearShareItem(id: string): boolean {
    const state = loadShareState();
    state.sharing = state.sharing.filter(s => s.id !== id);
    return saveShareState(state);
}

export function clearReceiveItem(id: string): boolean {
    const state = loadReceiveState();
    state.receiving = state.receiving.filter(r => r.id !== id);
    return saveReceiveState(state);
}

export function addShareItem(item: ShareItem): boolean {
    const state = loadShareState();
    // Remove existing with same id
    state.sharing = state.sharing.filter(s => s.id !== item.id);
    state.sharing.push(item);
    return saveShareState(state);
}

export function addReceiveItem(item: ReceiveItem): boolean {
    const state = loadReceiveState();
    // Remove existing with same id
    state.receiving = state.receiving.filter(r => r.id !== item.id);
    state.receiving.push(item);
    return saveReceiveState(state);
}

export function updateReceiveItemStatus(id: string, status: ReceiveItem['status'], progress?: number): boolean {
    const state = loadReceiveState();
    const item = state.receiving.find(r => r.id === id);
    if (item) {
        item.status = status;
        if (progress !== undefined) {
            item.progress = progress;
        }
        return saveReceiveState(state);
    }
    return false;
}
