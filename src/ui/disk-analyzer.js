// ============================================
// Disk Analyzer Module - Split View Support
// ============================================
// Visualize disk usage with interactive bar display
// Supports dual panel view for file management

// Panel State Management
const panelState = {
    left: {
        path: null,
        data: [],
        totalSize: 0,
        filter: 'all'
    },
    right: {
        path: null,
        data: [],
        totalSize: 0,
        filter: 'all'
    }
};

let isSplitView = false;
let isDeleteLocked = true;
let hideHiddenFiles = true; // Hide hidden files by default

// Clipboard for copy/paste
let clipboard = null; // { path, name, operation: 'copy' }

// Undo History (session only - cleared when app closes)
let undoHistory = []; // { type: 'move'|'copy', originalPath, currentPath, destFolder }

// Recently moved/copied items (for highlighting) - stores full paths and dest folders
// Format: { itemPath: string, destFolder: string }
let recentlyModified = new Set(); // paths of recently moved/copied items

// Native icon cache - maps file path to base64 icon data URL
const iconCache = new Map();
let iconLoadQueue = [];

// Safe Handling
const PROTECTED_PATHS = [
    '/System', '/Library', '/bin', '/sbin', '/usr', '/var', '/private', '/etc', '/dev',
    '/Volumes', '/Network', '/cores', '/opt', '/Applications', '/Users'
];

function isProtectedPath(path) {
    if (path === '/') return true;
    if (PROTECTED_PATHS.includes(path)) return true;
    const systemPrefixes = ['/System', '/bin', '/sbin', '/usr', '/var', '/private', '/etc', '/dev', '/Library'];
    if (systemPrefixes.some(prefix => path.startsWith(prefix))) return true;
    return false;
}

// Toggle Delete Lock
function toggleDeleteLock() {
    isDeleteLocked = !isDeleteLocked;
    const btn = document.getElementById('analyzer-lock-btn');

    if (btn) {
        if (isDeleteLocked) {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
            `;
            btn.title = "Unlock to allow deletion";
        } else {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                </svg>
            `;
            btn.title = "Click to lock deletion";
        }
    }

    renderAnalyzerItems('left');
    if (isSplitView) renderAnalyzerItems('right');
}

// Toggle Hidden Files Filter
function toggleHiddenFiles() {
    hideHiddenFiles = !hideHiddenFiles;

    const btn = document.getElementById('analyzer-hidden-btn');
    if (btn) {
        if (hideHiddenFiles) {
            // Hidden files are filtered out - show eye-off icon
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                    <line x1="3" y1="3" x2="21" y2="21" stroke-width="2"></line>
                </svg>
            `;
            btn.setAttribute('data-tooltip', 'Hide Hidden Files: Filters out system files (starting with .)');
            btn.classList.remove('active');
        } else {
            // Showing all files including hidden - show eye icon
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
            `;
            btn.setAttribute('data-tooltip', 'Show Hidden Files: Currently showing all files including system files');
            btn.classList.add('active');
        }
    }

    renderAnalyzerItems('left');
    if (isSplitView) renderAnalyzerItems('right');
}

// Format bytes to human readable
function formatAnalyzerSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1000;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get file type based on extension
function getFileType(extension) {
    const ext = (extension || '').toLowerCase();

    // Video
    if (['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) return 'video';
    // Image
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'heic', 'heif'].includes(ext)) return 'image';
    // Audio
    if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff'].includes(ext)) return 'audio';

    // Adobe Creative Suite
    if (ext === 'psd') return 'photoshop';
    if (ext === 'ai') return 'illustrator';
    if (ext === 'aep' || ext === 'aepx') return 'aftereffects';
    if (ext === 'prproj') return 'premiere';
    if (ext === 'indd') return 'indesign';
    if (ext === 'xd') return 'adobexd';

    // Other Creative Apps
    if (ext === 'sketch') return 'sketch';
    if (ext === 'fig') return 'figma';
    if (ext === 'blend') return 'blender';
    if (ext === 'c4d') return 'cinema4d';
    if (ext === 'ma' || ext === 'mb') return 'maya';
    if (ext === 'fbx' || ext === '3ds' || ext === 'obj') return '3dmodel';

    // Code
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'vue', 'svelte', 'html', 'css', 'scss'].includes(ext)) return 'code';
    // Config
    if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg'].includes(ext)) return 'config';

    // Documents
    if (ext === 'pdf') return 'pdf';
    if (['doc', 'docx'].includes(ext)) return 'word';
    if (['xls', 'xlsx'].includes(ext)) return 'excel';
    if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
    if (['txt', 'rtf', 'md', 'odt'].includes(ext)) return 'document';

    // Archive
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso'].includes(ext)) return 'archive';
    // App
    if (['app', 'exe', 'pkg', 'deb', 'rpm', 'msi'].includes(ext)) return 'app';
    // Font
    if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext)) return 'font';

    return 'file';
}

// Get icon SVG for file type - with brand colors
function getFileTypeIcon(type, isDirectory, isVolume) {
    if (isVolume) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
            <path d="M12 18h.01"/>
            <path d="M12 6h.01"/>
        </svg>`;
    }
    if (isDirectory) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>`;
    }

    const icons = {
        // Media
        video: `<svg viewBox="0 0 24 24" fill="none" stroke="#E53935" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
        image: `<svg viewBox="0 0 24 24" fill="none" stroke="#43A047" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        audio: `<svg viewBox="0 0 24 24" fill="none" stroke="#FB8C00" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,

        // Adobe Creative Suite - Purple/Magenta tones
        photoshop: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#31A8FF"/><text x="7" y="16" font-size="10" font-weight="bold" fill="white">Ps</text></svg>`,
        illustrator: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#FF9A00"/><text x="7" y="16" font-size="10" font-weight="bold" fill="white">Ai</text></svg>`,
        aftereffects: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#9999FF"/><text x="6" y="16" font-size="10" font-weight="bold" fill="white">Ae</text></svg>`,
        premiere: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#9999FF"/><text x="7" y="16" font-size="10" font-weight="bold" fill="white">Pr</text></svg>`,
        indesign: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#FF3366"/><text x="8" y="16" font-size="10" font-weight="bold" fill="white">Id</text></svg>`,
        adobexd: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#FF61F6"/><text x="6" y="16" font-size="10" font-weight="bold" fill="white">Xd</text></svg>`,

        // Other Creative Apps
        sketch: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#F7B500"/><path d="M12 7L7 11L12 19L17 11L12 7Z" fill="white"/></svg>`,
        figma: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#1E1E1E"/><circle cx="12" cy="12" r="4" fill="#A259FF"/></svg>`,
        blender: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#F5792A"/><text x="7" y="16" font-size="9" font-weight="bold" fill="white">3D</text></svg>`,
        cinema4d: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#011A6A"/><text x="5" y="16" font-size="9" font-weight="bold" fill="white">C4D</text></svg>`,
        maya: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" fill="#37A5CC"/><text x="7" y="16" font-size="9" font-weight="bold" fill="white">Ma</text></svg>`,
        '3dmodel': `<svg viewBox="0 0 24 24" fill="none" stroke="#7C4DFF" stroke-width="2"><path d="M12 2L2 7L12 12L22 7L12 2Z"/><path d="M2 17L12 22L22 17"/><path d="M2 12L12 17L22 12"/></svg>`,

        // Documents
        pdf: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="18" height="20" rx="2" fill="#E53935"/><text x="5" y="15" font-size="7" font-weight="bold" fill="white">PDF</text></svg>`,
        word: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="18" height="20" rx="2" fill="#2B579A"/><text x="8" y="15" font-size="9" font-weight="bold" fill="white">W</text></svg>`,
        excel: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="18" height="20" rx="2" fill="#217346"/><text x="8" y="15" font-size="9" font-weight="bold" fill="white">X</text></svg>`,
        powerpoint: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="2" width="18" height="20" rx="2" fill="#D24726"/><text x="8" y="15" font-size="9" font-weight="bold" fill="white">P</text></svg>`,

        // Code & Config
        code: `<svg viewBox="0 0 24 24" fill="none" stroke="#00BCD4" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
        config: `<svg viewBox="0 0 24 24" fill="none" stroke="#78909C" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,

        // Other
        document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        archive: `<svg viewBox="0 0 24 24" fill="none" stroke="#8D6E63" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
        app: `<svg viewBox="0 0 24 24" fill="none" stroke="#7C4DFF" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
        font: `<svg viewBox="0 0 24 24" fill="none" stroke="#607D8B" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
        file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    };
    return icons[type] || icons.file;
}

// Get delete mode from settings
function getDeleteMode() {
    return document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
}

// Update Undo Button State
function updateUndoButton() {
    const btn = document.getElementById('analyzer-undo-btn');
    if (btn) {
        if (undoHistory.length > 0) {
            btn.classList.remove('hidden');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M3 7v6h6"/>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/>
                </svg>
                Undo (${undoHistory.length})
            `;
            btn.title = `Undo last action (${undoHistory.length} remaining)`;
        } else {
            btn.classList.add('hidden');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M3 7v6h6"/>
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/>
                </svg>
                Undo
            `;
        }
    }
}

// Undo Last Action
async function undoLastAction() {
    if (undoHistory.length === 0) return;

    const lastAction = undoHistory.pop();
    updateUndoButton();

    try {
        let result;
        if (lastAction.type === 'move') {
            result = await window.electronAPI.undoMove(lastAction.currentPath, lastAction.originalPath);
        } else if (lastAction.type === 'copy') {
            result = await window.electronAPI.undoCopy(lastAction.currentPath);
        }

        if (result.success) {
            // Always remove the specific item from recently modified
            recentlyModified.delete(lastAction.currentPath);

            // Only remove destFolder highlight if NO MORE undo actions reference it
            if (lastAction.destFolder) {
                const folderStillHasChanges = undoHistory.some(
                    action => action.destFolder === lastAction.destFolder ||
                        action.currentPath.startsWith(lastAction.destFolder + '/')
                );
                if (!folderStillHasChanges) {
                    recentlyModified.delete(lastAction.destFolder);
                }
            }

            // Refresh both panels
            await analyzeFolder(panelState.left.path, 'left');
            if (isSplitView && panelState.right.path) {
                await analyzeFolder(panelState.right.path, 'right');
            }
        } else {
            alert('Undo failed: ' + (result.error || 'Unknown error'));
            // Put back in history if failed
            undoHistory.push(lastAction);
            updateUndoButton();
        }
    } catch (err) {
        console.error('Undo error:', err);
        alert('Undo failed: ' + err.message);
        undoHistory.push(lastAction);
        updateUndoButton();
    }
}

// Toggle Split View
function toggleSplitView() {
    isSplitView = !isSplitView;
    const container = document.getElementById('analyzer-panels-container');
    const rightPanel = document.getElementById('analyzer-panel-right');
    const splitBtn = document.getElementById('split-view-btn');

    if (isSplitView) {
        container?.classList.add('split-view');
        rightPanel?.classList.remove('hidden');
        if (splitBtn) {
            splitBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                Single View
            `;
        }
        if (panelState.left.path && !panelState.right.path) {
            analyzeFolder(panelState.left.path, 'right');
        }
    } else {
        container?.classList.remove('split-view');
        rightPanel?.classList.add('hidden');
        if (splitBtn) {
            splitBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <rect x="3" y="3" width="8" height="18" rx="1"/>
                    <rect x="13" y="3" width="8" height="18" rx="1"/>
                </svg>
                Split View
            `;
        }
    }
}

// Close a specific panel
function closePanel(panelId) {
    if (!isSplitView) return;

    if (panelId === 'left') {
        panelState.left = { ...panelState.right };
        panelState.right = { path: null, data: [], totalSize: 0, filter: 'all' };
        updateBreadcrumb(panelState.left.path, 'left');
        updateSummary(panelState.left, 'left');
        renderAnalyzerItems('left');
    }

    isSplitView = false;
    const container = document.getElementById('analyzer-panels-container');
    const rightPanel = document.getElementById('analyzer-panel-right');
    const splitBtn = document.getElementById('split-view-btn');

    container?.classList.remove('split-view');
    rightPanel?.classList.add('hidden');
    if (splitBtn) {
        splitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="3" y="3" width="8" height="18" rx="1"/>
                <rect x="13" y="3" width="8" height="18" rx="1"/>
            </svg>
            Split View
        `;
    }
}

// Select folder to analyze
async function selectAnalyzerFolder(panelId = 'left') {
    try {
        const result = await window.electronAPI.selectFolder();
        if (result && result.path) {
            await analyzeFolder(result.path, panelId);
        }
    } catch (err) {
        console.error('[DiskAnalyzer] Error selecting folder:', err);
    }
}

// Check if path is a volume root
function isVolumeRoot(path) {
    if (path === '/' || path === '/Volumes') return true;
    if (path.startsWith('/Volumes/') && path.split('/').length === 3) return true;
    return false;
}

// Analyze a folder
async function analyzeFolder(folderPath, panelId = 'left') {
    const state = panelState[panelId];
    state.path = folderPath;
    updateBreadcrumb(folderPath, panelId);

    const loadingEl = document.getElementById(`analyzer-loading-${panelId}`);
    const itemsEl = document.getElementById(`analyzer-items-${panelId}`);
    loadingEl?.classList.remove('hidden');
    if (itemsEl) itemsEl.innerHTML = '';

    try {
        const result = await window.electronAPI.analyzeDirectory(folderPath);

        if (result.success) {
            state.data = result.items || [];
            state.totalSize = result.totalSize || 0;
            state.result = result;

            updateSummary(state, panelId);
            renderAnalyzerItems(panelId);
        } else {
            showAnalyzerError(result.error || 'Failed to analyze folder', panelId);
        }
    } catch (err) {
        console.error('[DiskAnalyzer] Error:', err);
        showAnalyzerError(err.message || 'Failed to analyze folder', panelId);
    }

    loadingEl?.classList.add('hidden');
}

// Update summary display
function updateSummary(state, panelId) {
    const totalContainer = document.querySelector(`#analyzer-panel-${panelId} .summary-total`);
    const freeContainer = document.querySelector(`#analyzer-panel-${panelId} .summary-free`);

    if (totalContainer) {
        const sizeStr = formatAnalyzerSize(state.totalSize || 0);
        let percentStr = '';

        if (state.result?.diskCapacity && state.result.diskCapacity > 0) {
            const percent = ((state.totalSize || 0) / state.result.diskCapacity) * 100;
            percentStr = `${percent.toFixed(1)}% Disk`;
        }

        if (isVolumeRoot(state.path)) {
            const used = state.result?.volumeUsed !== undefined ? state.result.volumeUsed : (state.totalSize || 0);
            const usedStr = formatAnalyzerSize(used);
            if (state.result?.diskCapacity && state.result.diskCapacity > 0) {
                const p = (used / state.result.diskCapacity) * 100;
                percentStr = `${p.toFixed(1)}% Disk`;
            }
            totalContainer.innerHTML = `Used: <strong>${usedStr}</strong> - <strong>${percentStr}</strong>`;
        } else {
            totalContainer.innerHTML = `Size: <strong>${sizeStr}</strong> - <strong>${percentStr}</strong>`;
        }
    }

    if (freeContainer) freeContainer.style.display = 'none';
}

// Update breadcrumb navigation
function updateBreadcrumb(path, panelId) {
    const breadcrumb = document.getElementById(`analyzer-breadcrumb-${panelId}`);
    if (!breadcrumb) return;

    let html = '';

    if (path === '/Volumes') {
        html = `<span class="breadcrumb-item current" data-path="/Volumes" data-panel="${panelId}">My Mac</span>`;
        breadcrumb.innerHTML = html;
        addBreadcrumbHandlers(breadcrumb, panelId);
        return;
    }

    const realParts = path.split('/').filter(Boolean);
    let displayParts = [];
    let pathAccumulator = '';

    if (path === '/') {
        displayParts.push({ name: '/', realPath: '/' });
    } else {
        let isVolumesPath = false;
        if (realParts[0] === 'Volumes') {
            isVolumesPath = true;
            pathAccumulator = '/Volumes';
        } else if (realParts[0] === 'Users' && realParts.length > 1) {
            const userPath = `/${realParts[0]}/${realParts[1]}`;
            if (path.startsWith(userPath)) {
                displayParts.push({ name: '~', realPath: userPath });
                pathAccumulator = userPath;
                for (let i = 2; i < realParts.length; i++) {
                    pathAccumulator += '/' + realParts[i];
                    displayParts.push({ name: realParts[i], realPath: pathAccumulator });
                }
            }
        }

        if (!isVolumesPath && !(realParts[0] === 'Users' && realParts.length > 1 && path.startsWith(`/${realParts[0]}/${realParts[1]}`))) {
            pathAccumulator = '';
            for (const part of realParts) {
                pathAccumulator += '/' + part;
                displayParts.push({ name: part, realPath: pathAccumulator });
            }
        } else if (isVolumesPath) {
            for (let i = 1; i < realParts.length; i++) {
                pathAccumulator += '/' + realParts[i];
                displayParts.push({ name: realParts[i], realPath: pathAccumulator });
            }
        }
    }

    displayParts.forEach((item, i) => {
        if (i > 0) html += '<span class="breadcrumb-separator">/</span>';
        html += `<span class="breadcrumb-item ${item.realPath === path ? 'current' : ''}" data-path="${item.realPath}" data-panel="${panelId}">${item.name}</span>`;
    });

    breadcrumb.innerHTML = html;
    addBreadcrumbHandlers(breadcrumb, panelId);
}

function addBreadcrumbHandlers(breadcrumb, panelId) {
    breadcrumb.querySelectorAll('.breadcrumb-item').forEach(item => {
        item.onclick = () => {
            if (!item.classList.contains('current')) {
                analyzeFolder(item.dataset.path, panelId);
            }
        };
    });
}

// Filter Handler
function setAnalyzerFilter(type, panelId = 'left') {
    panelState[panelId].filter = type;

    document.querySelectorAll(`#analyzer-filters-${panelId} .filter-btn`).forEach(btn => {
        if (btn.dataset.type === type || (type === 'all' && !btn.dataset.type)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderAnalyzerItems(panelId);
}

// Render analyzer items
function renderAnalyzerItems(panelId) {
    const state = panelState[panelId];
    const container = document.getElementById(`analyzer-items-${panelId}`);
    if (!container) return;

    let filteredItems = state.data;

    // Filter by type (all, video, image, etc.)
    if (state.filter !== 'all') {
        filteredItems = filteredItems.filter(item => {
            if (item.isDirectory) return false;
            const type = getFileType(item.extension);
            if (state.filter === 'other') return type === 'file';
            return type === state.filter;
        });
    }

    // Filter out hidden files if enabled
    if (hideHiddenFiles) {
        filteredItems = filteredItems.filter(item => {
            // Keep if not hidden (doesn't start with .)
            return !item.name.startsWith('.');
        });
    }

    if (!filteredItems || filteredItems.length === 0) {
        container.innerHTML = `
            <div class="analyzer-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <p>No items found inside this folder</p>
                ${state.filter !== 'all' ? `<p style="font-size: 0.9em; opacity: 0.7;">Filter: ${state.filter}</p>` : ''}
            </div>
        `;
        return;
    }

    const displayItems = [...filteredItems].sort((a, b) => b.size - a.size);
    const maxDisplaySize = displayItems[0]?.size || 1;

    container.innerHTML = displayItems.map(item => {
        let percent = (item.size / maxDisplaySize) * 100;
        let barStyle = `width: ${percent}%`;
        let barClass = percent > 70 ? 'huge' : percent > 40 ? 'large' : '';
        let extraBarHtml = '';

        if (item.isVolume && item.capacity) {
            percent = (item.size / item.capacity) * 100;
            barStyle = `width: ${percent}%; background-color: #F56565;`;
            barClass = '';
            extraBarHtml = 'background-color: #48BB78;';
        }

        const fileType = getFileType(item.extension);
        const iconHtml = getFileTypeIcon(fileType, item.isDirectory, item.isVolume);
        const isProtected = isProtectedPath(item.path);

        let deleteBtnHtml = '';
        if (item.isVolume || isProtected) {
            deleteBtnHtml = isProtected ? `<span title="Protected System Folder" style="opacity: 0.5;">🔒</span>` : `<span style="width: 32px;"></span>`;
        } else {
            const disabledAttr = isDeleteLocked ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : '';
            deleteBtnHtml = `
                <button class="analyzer-delete-btn" onclick="event.stopPropagation(); deleteAnalyzerItem(event, '${item.path.replace(/'/g, "\\'")}', '${panelId}')" title="${isDeleteLocked ? 'Unlock to delete' : 'Delete'}" ${disabledAttr}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            `;
        }

        let sizeDisplay = formatAnalyzerSize(item.size);
        if (item.isVolume && item.capacity) {
            const freeSize = item.capacity - item.size;
            sizeDisplay = `
                <div style="display: flex; flex-direction: column; align-items: flex-end; font-size: 0.85em;">
                    <span style="color: #F56565;">Used: ${formatAnalyzerSize(item.size)}</span>
                    <span style="color: #48BB78;">Free: ${formatAnalyzerSize(freeSize)}</span>
                </div>
            `;
        }

        const safePath = item.path.replace(/'/g, "\\'");
        const safeName = item.name.replace(/'/g, "\\'");
        const clickAction = item.isDirectory
            ? `analyzeFolder('${safePath}', '${panelId}')`
            : `showFileOptions(event, '${safePath}', '${safeName}', '${panelId}')`;

        // Allow dragging for both files AND folders (but not volumes or protected)
        const canDrag = !item.isVolume && !isProtected;
        const dragAttrs = canDrag
            ? `draggable="true" ondragstart="handleDragStart(event, '${safePath}', '${panelId}')"`
            : '';

        // Check if recently modified (for highlighting)
        const isRecent = recentlyModified.has(item.path);
        const highlightClass = isRecent ? 'recently-modified' : '';

        // Allow dropping onto folders (but not volumes or protected)
        const canDrop = item.isDirectory && !item.isVolume && !isProtected;
        const dropAttrs = canDrop
            ? `ondragover="handleFolderDragOver(event)" ondragleave="handleFolderDragLeave(event)" ondrop="handleFolderDrop(event, '${safePath}', '${panelId}')"`
            : '';

        return `
            <div class="analyzer-item ${highlightClass}" data-path="${item.path}" data-panel="${panelId}" onclick="${clickAction}" ${dragAttrs} ${dropAttrs}>
                <div class="analyzer-item-icon ${item.isDirectory ? 'folder' : fileType}" data-icon-path="${item.path}">
                    ${iconCache.has(item.path)
                ? `<img src="${iconCache.get(item.path)}" width="24" height="24" style="object-fit: contain;"/>`
                : iconHtml}
                </div>
                <div class="analyzer-item-info">
                    <div class="analyzer-item-name">${item.name}</div>
                    <div class="analyzer-item-bar" style="${extraBarHtml}">
                        <div class="analyzer-item-bar-fill ${barClass}" style="${barStyle}"></div>
                    </div>
                </div>
                <div class="analyzer-item-size">${sizeDisplay}</div>
                <div class="analyzer-item-actions">
                    ${deleteBtnHtml}
                </div>
            </div>
        `;
    }).join('');

    setupDropZone(container, panelId);

    // Load native macOS icons asynchronously
    loadNativeIcons(container);
}

// Load native macOS icons for items in container
async function loadNativeIcons(container) {
    const iconElements = container.querySelectorAll('.analyzer-item-icon[data-icon-path]');
    const batchSize = 15;

    for (let i = 0; i < iconElements.length; i += batchSize) {
        const batch = Array.from(iconElements).slice(i, i + batchSize);

        await Promise.all(batch.map(async (el) => {
            const path = el.dataset.iconPath;
            if (!path) return;

            // Skip if already cached
            if (iconCache.has(path)) {
                el.innerHTML = `<img src="${iconCache.get(path)}" width="24" height="24" style="object-fit: contain;"/>`;
                return;
            }

            try {
                const result = await window.electronAPI.getFileIcon(path, 'normal');
                if (result.success && result.icon) {
                    iconCache.set(path, result.icon);
                    el.innerHTML = `<img src="${result.icon}" width="24" height="24" style="object-fit: contain;"/>`;
                }
            } catch (err) {
                console.error('Failed to load icon for:', path, err);
            }
        }));
    }
}

// Drag and Drop
function handleDragStart(event, path, panelId) {
    event.dataTransfer.setData('text/plain', JSON.stringify({ path, panelId }));
    event.dataTransfer.effectAllowed = 'move';
    event.target.classList.add('dragging');
}

// Folder drag handlers
function handleFolderDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('folder-drop-target');
}

function handleFolderDragLeave(event) {
    event.currentTarget.classList.remove('folder-drop-target');
}

async function handleFolderDrop(event, folderPath, panelId) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('folder-drop-target');

    try {
        const data = JSON.parse(event.dataTransfer.getData('text/plain'));

        // Can't move folder into itself or its children
        if (folderPath.startsWith(data.path)) {
            alert('Cannot move folder into itself or its subfolder');
            return;
        }

        // Don't allow moving same item
        if (data.path === folderPath) return;

        const fileName = data.path.split('/').pop();
        if (!confirm(`Move "${fileName}" into folder "${folderPath.split('/').pop()}"?`)) return;

        const result = await window.electronAPI.moveFile(data.path, folderPath);
        if (result.success) {
            undoHistory.push({
                type: 'move',
                originalPath: data.path,
                currentPath: result.newPath,
                destFolder: folderPath
            });
            updateUndoButton();

            recentlyModified.add(result.newPath);
            recentlyModified.add(folderPath);

            await analyzeFolder(panelState.left.path, 'left');
            if (isSplitView && panelState.right.path) {
                await analyzeFolder(panelState.right.path, 'right');
            }
        } else {
            alert('Move failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Folder drop error:', err);
    }
}

function setupDropZone(container, panelId) {
    container.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.classList.add('drag-over');
    };

    container.ondragleave = (e) => {
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('drag-over');
        }
    };

    container.ondrop = async (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.panelId === panelId) return;

            const targetPath = panelState[panelId].path;
            if (!targetPath) return;

            const fileName = data.path.split('/').pop();
            if (!confirm(`Move "${fileName}" to ${targetPath}?`)) return;

            const result = await window.electronAPI.moveFile(data.path, targetPath);
            if (result.success) {
                // Add to undo history with destFolder
                undoHistory.push({
                    type: 'move',
                    originalPath: data.path,
                    currentPath: result.newPath,
                    destFolder: targetPath
                });
                updateUndoButton();

                // Mark both new item AND destination folder as recently modified
                recentlyModified.add(result.newPath);
                recentlyModified.add(targetPath);

                await analyzeFolder(panelState.left.path, 'left');
                if (isSplitView && panelState.right.path) {
                    await analyzeFolder(panelState.right.path, 'right');
                }
            } else {
                alert('Move failed: ' + (result.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('Drop error:', err);
        }
    };
}

// --- File Options Popup ---
function showFileOptions(event, path, name, panelId) {
    closeFileOptions();
    event.stopPropagation();

    const popup = document.createElement('div');
    popup.className = 'file-options-popup';
    popup.style.top = `${event.pageY}px`;
    popup.style.left = `${event.pageX}px`;

    const safePath = path.replace(/'/g, "\\'");
    const otherPanelId = panelId === 'left' ? 'right' : 'left';
    const otherPanelPath = panelState[otherPanelId].path;

    let pasteOptions = '';
    if (clipboard) {
        pasteOptions = `
            <div class="file-options-separator"></div>
            <div class="file-options-item" onclick="pasteFromClipboard('${panelId}')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                Paste Here
            </div>
            ${isSplitView && otherPanelPath ? `
            <div class="file-options-item" onclick="pasteFromClipboard('${otherPanelId}')">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                Paste to Other Panel
            </div>
            ` : ''}
        `;
    }

    popup.innerHTML = `
        <div class="file-options-item" onclick="handleFileAction('open', '${safePath}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open
        </div>
        <div class="file-options-item" onclick="handleFileAction('reveal', '${safePath}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            Reveal in Finder
        </div>
        <div class="file-options-item" onclick="handleFileAction('props', '${safePath}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Properties
        </div>
        <div class="file-options-separator"></div>
        <div class="file-options-item" onclick="copyToClipboard('${safePath}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
        </div>
        ${pasteOptions}
    `;

    document.body.appendChild(popup);

    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        popup.style.left = `${window.innerWidth - rect.width - 20}px`;
    }
    if (rect.bottom > window.innerHeight) {
        popup.style.top = `${event.pageY - rect.height}px`;
    }

    setTimeout(() => {
        document.addEventListener('click', closeFileOptions);
    }, 0);
}

function closeFileOptions() {
    const existing = document.querySelector('.file-options-popup');
    if (existing) existing.remove();
    document.removeEventListener('click', closeFileOptions);
}

// Copy/Paste functions
function copyToClipboard(path) {
    closeFileOptions();
    clipboard = { path, name: path.split('/').pop() };
    console.log('[DiskAnalyzer] Copied to clipboard:', clipboard);
}

async function pasteFromClipboard(targetPanelId) {
    closeFileOptions();
    if (!clipboard) return;

    const targetPath = panelState[targetPanelId].path;
    if (!targetPath) return;

    try {
        const result = await window.electronAPI.copyFile(clipboard.path, targetPath);
        if (result.success) {
            // Add to undo history with destFolder
            undoHistory.push({
                type: 'copy',
                originalPath: clipboard.path,
                currentPath: result.newPath,
                destFolder: targetPath
            });
            updateUndoButton();

            // Mark both new item AND destination folder as recently modified
            recentlyModified.add(result.newPath);
            recentlyModified.add(targetPath);

            clipboard = null;

            await analyzeFolder(panelState.left.path, 'left');
            if (isSplitView && panelState.right.path) {
                await analyzeFolder(panelState.right.path, 'right');
            }
        } else {
            alert('Copy failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('Paste error:', err);
        alert('Copy failed: ' + err.message);
    }
}

async function handleFileAction(action, path) {
    closeFileOptions();
    try {
        if (action === 'open') {
            await window.electronAPI.openPath(path);
        } else if (action === 'reveal') {
            await window.electronAPI.showItemInFolder(path);
        } else if (action === 'props') {
            const props = await window.electronAPI.getFileProperties(path);
            if (props.success) {
                showPropertiesModal(path, props);
            }
        }
    } catch (e) {
        console.error('File action error:', e);
    }
}

function showPropertiesModal(path, props) {
    document.querySelector('.properties-modal')?.remove();
    document.querySelector('.properties-overlay')?.remove();

    const name = path.split('/').pop();
    const created = new Date(props.created).toLocaleString();
    const modified = new Date(props.modified).toLocaleString();

    const overlay = document.createElement('div');
    overlay.className = 'properties-overlay';
    overlay.onclick = () => { overlay.remove(); modal.remove(); };

    const modal = document.createElement('div');
    modal.className = 'properties-modal';
    modal.innerHTML = `
        <h3 style="margin-top: 0; margin-bottom: 20px; font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 10px;">File Properties</h3>
        
        <div class="prop-row">
            <span class="prop-label">Name:</span>
            <span class="prop-value">${name}</span>
        </div>
        <div class="prop-row">
            <span class="prop-label">Size:</span>
            <span class="prop-value">${formatAnalyzerSize(props.size)}</span>
        </div>
        <div class="prop-row">
            <span class="prop-label">Created:</span>
            <span class="prop-value">${created}</span>
        </div>
        <div class="prop-row">
            <span class="prop-label">Modified:</span>
            <span class="prop-value">${modified}</span>
        </div>
        <div class="prop-row">
            <span class="prop-label">Type:</span>
            <span class="prop-value">${props.isDirectory ? 'Folder' : getFileType(name.split('.').pop())}</span>
        </div>

        <button onclick="document.querySelector('.properties-overlay').click()" style="width: 100%; margin-top: 20px; padding: 8px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer;">Close</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

// Delete item
async function deleteAnalyzerItem(event, path, panelId) {
    event.stopPropagation();

    if (isDeleteLocked) return;

    const deleteMode = getDeleteMode();

    const confirmMsg = deleteMode === 'permanent'
        ? 'Permanently delete this item? This cannot be undone.'
        : 'Move this item to Trash?';

    if (!confirm(confirmMsg)) return;

    try {
        let result;
        if (deleteMode === 'permanent') {
            result = await window.electronAPI.deleteFile(path);
        } else {
            result = await window.electronAPI.moveToTrash([path]);
        }

        if (result.success) {
            const state = panelState[panelId];
            if (state.path) {
                await analyzeFolder(state.path, panelId);
            }
        } else {
            alert('Failed to delete: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('[DiskAnalyzer] Delete error:', err);
        alert('Failed to delete: ' + err.message);
    }
}

// Show error
function showAnalyzerError(message, panelId = 'left') {
    const container = document.getElementById(`analyzer-items-${panelId}`);
    if (container) {
        container.innerHTML = `
            <div class="analyzer-empty" style="color: var(--danger)">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <p>${message}</p>
            </div>
        `;
    }
}

// Initialize when section shown
function initDiskAnalyzer() {
    isDeleteLocked = true;
    recentlyModified.clear();

    const btn = document.getElementById('analyzer-lock-btn');
    if (btn) {
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
        `;
        btn.title = "Unlock to allow deletion";
    }

    updateUndoButton();

    if (panelState.left.data.length > 0) {
        renderAnalyzerItems('left');
    }
    if (isSplitView && panelState.right.data.length > 0) {
        renderAnalyzerItems('right');
    }
}

// Expose to global scope
window.initDiskAnalyzer = initDiskAnalyzer;
window.analyzeFolder = analyzeFolder;
window.deleteAnalyzerItem = deleteAnalyzerItem;
window.setAnalyzerFilter = setAnalyzerFilter;
window.toggleDeleteLock = toggleDeleteLock;
window.toggleHiddenFiles = toggleHiddenFiles;
window.showFileOptions = showFileOptions;
window.handleFileAction = handleFileAction;
window.closeFileOptions = closeFileOptions;
window.toggleSplitView = toggleSplitView;
window.closePanel = closePanel;
window.selectAnalyzerFolder = selectAnalyzerFolder;
window.handleDragStart = handleDragStart;
window.handleFolderDragOver = handleFolderDragOver;
window.handleFolderDragLeave = handleFolderDragLeave;
window.handleFolderDrop = handleFolderDrop;
window.copyToClipboard = copyToClipboard;
window.pasteFromClipboard = pasteFromClipboard;
window.undoLastAction = undoLastAction;

