// ============================================
// APP UNINSTALLER - Completely separate module
// ============================================
// Removes apps and their leftover files (Library/Caches, Preferences, etc.)

let selectedApp = null;
let leftoverFiles = [];
let uninstallHistory = [];

// Format bytes to human readable
function formatSizeUninstaller(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Initialize drop zone
function initUninstaller() {
    const dropZone = document.getElementById('app-drop-zone');
    if (!dropZone) return;

    // Click to select
    dropZone.addEventListener('click', async () => {
        const result = await window.electronAPI.selectApp();
        if (result && result.path) {
            await scanAppForUninstall(result.path);
        }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const appPath = files[0].path;
            if (appPath.endsWith('.app')) {
                await scanAppForUninstall(appPath);
            } else {
                alert('Please drop an .app file');
            }
        }
    });

    // Load history
    loadUninstallHistory();
}

// Scan app and find leftover files
async function scanAppForUninstall(appPath) {
    const dropZone = document.getElementById('app-drop-zone');
    const preview = document.getElementById('uninstall-preview');

    dropZone.classList.add('scanning');
    dropZone.querySelector('.drop-text').textContent = 'Scanning...';

    try {
        const result = await window.electronAPI.scanAppLeftovers(appPath);

        if (!result || !result.app) {
            throw new Error(result?.error || 'Failed to scan app (Unknown error)');
        }

        selectedApp = result.app;
        leftoverFiles = result.leftovers || [];

        // Update UI
        // Update UI
        const nameEl = document.getElementById('selected-app-name');
        nameEl.innerHTML = selectedApp.name; // Use innerHTML to allow badge

        if (selectedApp.isRunning) {
            const badge = document.createElement('span');
            badge.className = 'status-badge error'; // Red background
            badge.textContent = 'Running';
            badge.style.marginLeft = '10px';
            badge.style.fontSize = '0.7em';
            nameEl.appendChild(badge);
        }

        document.getElementById('selected-app-size').textContent = formatSizeUninstaller(selectedApp.size);

        // Set app icon (if available)
        // Set app icon (if available)
        const iconEl = document.getElementById('selected-app-icon');
        const placeholderId = 'app-icon-placeholder-emoji';

        // Remove existing placeholder if any
        const existingPlaceholder = document.getElementById(placeholderId);
        if (existingPlaceholder) existingPlaceholder.remove();

        iconEl.onerror = () => {
            iconEl.style.display = 'none';
            // Show emoji placeholder
            const placeholder = document.createElement('div');
            placeholder.id = placeholderId;
            placeholder.textContent = '📦';
            placeholder.className = 'app-icon-placeholder';
            // Insert before the hidden img
            iconEl.parentNode.insertBefore(placeholder, iconEl);
        };

        if (selectedApp.icon) {
            iconEl.style.display = 'block';
            iconEl.src = selectedApp.icon;
        } else {
            iconEl.style.display = 'none';
            // Trigger placeholder manually
            iconEl.onerror();
        }

        // Add external libraries to leftover files (as regular items)
        const externalLibs = result.externalLibraries || [];
        for (const lib of externalLibs) {
            leftoverFiles.push({
                path: lib.path,
                size: lib.size,
                name: lib.note,
                type: 'external'
            });
        }

        // Render leftover files
        renderLeftoverFiles();

        // Check for MacCleaner (block) or Apple apps (warning)
        const appName = selectedApp.name.toLowerCase();
        const isMacCleaner = appName.includes('maccleaner') || appName.includes('mac cleaner');
        const isAppleApp = isAppleApplication(appName);

        // Handle MacCleaner - BLOCK
        if (isMacCleaner) {
            showMacCleanerWarning();
        }
        // Handle Apple apps - WARNING
        else if (isAppleApp) {
            showAppleAppWarning();
        }
        // Normal app - clear any warnings
        else {
            hideAppWarnings();
        }

        // Show preview, hide drop zone
        dropZone.style.display = 'none';
        preview.classList.remove('hidden');

    } catch (error) {
        console.error('Error scanning app:', error);
        alert('Error scanning app: ' + error.message);
    } finally {
        dropZone.classList.remove('scanning');
        dropZone.querySelector('.drop-text').textContent = 'Drop app here';
    }
}

// Render leftover files list with checkboxes
function renderLeftoverFiles() {
    const container = document.getElementById('leftover-files-list');

    // Add main app as first item
    const allFiles = [
        { path: selectedApp.path, size: selectedApp.size, type: 'app', checked: true },
        ...leftoverFiles.map(f => ({ ...f, checked: true }))
    ];

    const getIcon = (type) => {
        switch (type) {
            case 'app': return '📦';
            case 'external': return '💾';
            default: return '📄';
        }
    };

    container.innerHTML = allFiles.map((file, index) => `
        <div class="leftover-file-item ${file.type === 'external' ? 'external-item' : ''}">
            <label class="checkbox-label">
                <input type="checkbox" 
                       data-index="${index}" 
                       ${file.checked ? 'checked' : ''} 
                       onchange="updateUninstallTotal()">
                <span class="file-path" title="${file.path}">
                    ${getIcon(file.type)} 
                    ${file.path.replace(/^\/Users\/[^/]+/, '~')}
                    ${file.type === 'external' ? '<span class="ext-badge">External</span>' : ''}
                </span>
                <span class="file-size">${formatSizeUninstaller(file.size)}</span>
            </label>
        </div>
    `).join('');

    updateUninstallTotal();
}

// Toggle all checkboxes
function toggleAllLeftovers(checked) {
    const checkboxes = document.querySelectorAll('#leftover-files-list input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = checked);
    updateUninstallTotal();
}

// Update total size to be uninstalled
function updateUninstallTotal() {
    const checkboxes = document.querySelectorAll('#leftover-files-list input[type="checkbox"]:checked');

    const allFiles = [
        { path: selectedApp.path, size: selectedApp.size },
        ...leftoverFiles
    ];

    let totalSize = 0;
    checkboxes.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        if (allFiles[index]) {
            totalSize += allFiles[index].size;
        }
    });

    document.getElementById('uninstall-total-size').textContent = formatSizeUninstaller(totalSize);
}

// Cancel uninstall
function cancelUninstall() {
    selectedApp = null;
    leftoverFiles = [];

    const dropZone = document.getElementById('app-drop-zone');
    const preview = document.getElementById('uninstall-preview');

    dropZone.style.display = 'flex';
    preview.classList.add('hidden');
}

// Confirm and execute uninstall
async function confirmUninstall() {
    const checkboxes = document.querySelectorAll('#leftover-files-list input[type="checkbox"]:checked');

    const allFiles = [
        { path: selectedApp.path, size: selectedApp.size },
        ...leftoverFiles
    ];

    const pathsToDelete = [];
    checkboxes.forEach(cb => {
        const index = parseInt(cb.dataset.index);
        if (allFiles[index]) {
            pathsToDelete.push(allFiles[index].path);
        }
    });

    if (pathsToDelete.length === 0) {
        alert('No files selected');
        return;
    }

    const confirmMsg = `Are you sure you want to uninstall ${selectedApp.name}?\n\n${pathsToDelete.length} files will be moved to Trash.`;
    if (!confirm(confirmMsg)) {
        return;
    }

    try {
        const result = await window.electronAPI.uninstallApp(pathsToDelete, selectedApp);

        if (result.success) {
            // Add to history
            const historyEntry = {
                name: selectedApp.name,
                date: new Date().toISOString(),
                filesCount: pathsToDelete.length,
                totalSize: allFiles.reduce((sum, f, i) => {
                    return checkboxes[i]?.checked ? sum + f.size : sum;
                }, 0)
            };

            await window.electronAPI.addUninstallHistory(historyEntry);

            alert(`✅ ${selectedApp.name} has been uninstalled successfully!`);

            // Reset UI
            cancelUninstall();
            loadUninstallHistory();
        } else if (result.reason === 'app_running_cancel') {
            // Add to history as FAILURE
            const historyEntry = {
                name: selectedApp.name,
                date: new Date().toISOString(),
                filesCount: 0,
                totalSize: 0,
                status: 'Failed (App Open)'
            };
            await window.electronAPI.addUninstallHistory(historyEntry);

            // Don't alert error, just log
            console.log('Uninstall cancelled because app is running');
        } else {
            throw new Error(result.error || 'Uninstall failed');
        }
    } catch (error) {
        console.error('Uninstall error:', error);
        alert('Error uninstalling: ' + error.message);
    }
}

// Load uninstall history
async function loadUninstallHistory() {
    try {
        const history = await window.electronAPI.getUninstallHistory();
        uninstallHistory = history || [];
        renderUninstallHistory();
    } catch (error) {
        console.error('Error loading uninstall history:', error);
    }
}

// Render uninstall history
function renderUninstallHistory() {
    const container = document.getElementById('uninstall-history-list');

    if (uninstallHistory.length === 0) {
        container.innerHTML = '<p class="empty-message">No apps uninstalled yet</p>';
        return;
    }

    container.innerHTML = uninstallHistory.slice(0, 10).map(entry => {
        const date = new Date(entry.date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="history-item ${entry.status ? 'failed' : ''}">
                <span class="history-app-name">
                    ${entry.name}
                    ${entry.status ? `<span class="status-badge error">${entry.status}</span>` : ''}
                </span>
                <span class="history-date">${dateStr} ${timeStr}</span>
                <span class="history-size">${entry.totalSize ? formatSizeUninstaller(entry.totalSize) : '-'}</span>
            </div>
        `;
    }).join('');
}

// List of known Apple app names
const APPLE_APPS = [
    'xcode', 'pages', 'numbers', 'keynote', 'garageband', 'imovie',
    'final cut', 'logic pro', 'motion', 'compressor', 'mainstage',
    'safari', 'mail', 'messages', 'facetime', 'notes', 'reminders',
    'calendar', 'contacts', 'photos', 'music', 'tv', 'podcasts',
    'books', 'news', 'stocks', 'home', 'voice memos', 'finder',
    'app store', 'system preferences', 'system settings', 'preview',
    'textedit', 'quicktime', 'automator', 'font book', 'calculator',
    'dictionary', 'siri', 'maps', 'weather', 'clock', 'freeform'
];

// Check if app is an Apple app
function isAppleApplication(appName) {
    const lowerName = appName.toLowerCase();
    return APPLE_APPS.some(appleApp => lowerName.includes(appleApp));
}

// Show MacCleaner block warning (can't uninstall itself)
function showMacCleanerWarning() {
    const uninstallBtn = document.querySelector('.uninstall-actions .danger-btn');
    const warningContainer = getOrCreateWarningContainer();

    // Disable uninstall button
    if (uninstallBtn) {
        uninstallBtn.disabled = true;
        uninstallBtn.style.opacity = '0.5';
        uninstallBtn.style.cursor = 'not-allowed';
        uninstallBtn.title = 'Cannot uninstall running application';
    }

    // Show warning banner
    warningContainer.innerHTML = `
        <div class="uninstall-warning block-warning" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">🚫</span>
                <div>
                    <strong style="color: #ef4444;">Cannot Uninstall MacCleaner</strong>
                    <p style="color: var(--text-secondary); margin: 0.25rem 0 0 0; font-size: 0.85rem;">
                        MacCleaner cannot be used to clean itself.<br>
                        Please use Finder or another app to uninstall MacCleaner.
                    </p>
                </div>
            </div>
        </div>
    `;
    warningContainer.classList.remove('hidden');
}

// Show Apple app warning
function showAppleAppWarning() {
    const uninstallBtn = document.querySelector('.uninstall-actions .danger-btn');
    const warningContainer = getOrCreateWarningContainer();

    // Keep uninstall button enabled but show warning
    if (uninstallBtn) {
        uninstallBtn.disabled = false;
        uninstallBtn.style.opacity = '1';
        uninstallBtn.style.cursor = 'pointer';
        uninstallBtn.title = '';
    }

    // Show warning banner
    warningContainer.innerHTML = `
        <div class="uninstall-warning apple-warning" style="background: rgba(251, 191, 36, 0.15); border: 1px solid #f59e0b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">⚠️</span>
                <div>
                    <strong style="color: #f59e0b;">Apple Application</strong>
                    <p style="color: var(--text-secondary); margin: 0.25rem 0 0 0; font-size: 0.85rem;">
                        This is an Apple app. Removing it may affect system functionality.<br>
                        You can reinstall it from the App Store if needed.
                    </p>
                </div>
            </div>
        </div>
    `;
    warningContainer.classList.remove('hidden');
}

// Hide all warnings
function hideAppWarnings() {
    const warningContainer = document.getElementById('uninstall-warning-container');
    if (warningContainer) {
        warningContainer.classList.add('hidden');
        warningContainer.innerHTML = '';
    }

    // Re-enable uninstall button
    const uninstallBtn = document.querySelector('.uninstall-actions .danger-btn');
    if (uninstallBtn) {
        uninstallBtn.disabled = false;
        uninstallBtn.style.opacity = '1';
        uninstallBtn.style.cursor = 'pointer';
        uninstallBtn.title = '';
    }
}

// Get or create warning container
function getOrCreateWarningContainer() {
    let container = document.getElementById('uninstall-warning-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'uninstall-warning-container';
        container.className = 'hidden';

        // Insert before the files list
        const filesList = document.getElementById('leftover-files-list');
        if (filesList && filesList.parentNode) {
            filesList.parentNode.insertBefore(container, filesList);
        }
    }
    return container;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initUninstaller);
