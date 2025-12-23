/**
 * Threats Scanner - Frontend Logic
 */

let customPathCounter = 0;

// Global scan state
let threatIsScanning = false;
let threatScanStopped = false;
let threatScanQueue = []; // Paths added mid-scan
let threatAllResults = [];

// Item Manager - Path Monitoring
let itemMonitorInterval = null;
let monitoredItems = {}; // path → {exists: boolean, element: HTMLElement}
const MONITOR_INTERVAL = 2000; // 2 seconds

// System paths that don't need monitoring (always available)
const SYSTEM_PATHS = ['/Applications', '~/Library/LaunchAgents', '/Library', '~/Library'];

// Check if path is a custom (non-system) path
function isCustomPath(path) {
    return !SYSTEM_PATHS.some(sysPath => {
        // Handle comma-separated paths
        const paths = path.split(',').map(p => p.trim());
        return paths.some(p => sysPath === p || p.startsWith(sysPath + '/'));
    });
}

// Start Item Manager monitoring
function startItemMonitor() {
    if (itemMonitorInterval) return; // Already running

    console.log('[ItemManager] Starting path monitoring...');

    // Initial check
    checkAllItemsExistence();

    // Set interval for continuous monitoring
    itemMonitorInterval = setInterval(() => {
        checkAllItemsExistence();
    }, MONITOR_INTERVAL);
}

// Stop Item Manager monitoring
function stopItemMonitor() {
    if (itemMonitorInterval) {
        console.log('[ItemManager] Stopping path monitoring...');
        clearInterval(itemMonitorInterval);
        itemMonitorInterval = null;
    }
}

// Check existence of all custom paths
async function checkAllItemsExistence() {
    const checkboxes = document.querySelectorAll('.scan-target-checkbox');

    for (const cb of checkboxes) {
        const path = cb.dataset.path;
        if (!path || !isCustomPath(path)) continue; // Skip system paths

        // Check if path exists
        const mainPath = path.split(',')[0].trim();
        const existsResult = await window.electronAPI.pathExists(mainPath);

        await updateItemStatus(cb, path, existsResult.exists);
    }
}

// Update item status based on existence
async function updateItemStatus(checkbox, path, exists) {
    const wasExists = monitoredItems[path]?.exists ?? true;

    if (wasExists && !exists) {
        // Path just became unavailable
        console.log('[ItemManager] Path removed:', path);

        showNotFoundBadge(checkbox);
        checkbox.disabled = true;

        // Uncheck and save state
        if (checkbox.checked) {
            checkbox.checked = false;
            await saveCheckboxStates();
        }

        // If this item is being scanned, stop it
        if (threatIsScanning) {
            await stopScanForItem(path);
        }

    } else if (!wasExists && exists) {
        // Path just became available again
        console.log('[ItemManager] Path restored:', path);

        removeNotFoundBadge(checkbox);
        checkbox.disabled = false;
    }

    // Update monitored state
    monitoredItems[path] = { exists, element: checkbox };
}

// Show "Not found" badge next to item
function showNotFoundBadge(checkbox) {
    const label = checkbox.closest('label') || checkbox.closest('.scan-target-item');
    if (!label) return;

    // Check if badge already exists
    if (label.querySelector('.not-found-badge')) return;

    const badge = document.createElement('span');
    badge.className = 'not-found-badge';
    badge.style.cssText = 'color: var(--risky); font-size: 0.85em; margin-left: 8px;';
    badge.textContent = '⚠️ Not found';

    const nameElement = label.querySelector('.custom-path-name') || label.querySelector('.scan-target-info strong');
    if (nameElement) {
        nameElement.appendChild(badge);
    }
}

// Remove "Not found" badge
function removeNotFoundBadge(checkbox) {
    const label = checkbox.closest('label') || checkbox.closest('.scan-target-item');
    if (!label) return;

    const badge = label.querySelector('.not-found-badge');
    if (badge) {
        badge.remove();
    }
}

// Stop scan for specific item
async function stopScanForItem(path) {
    console.log('[ItemManager] Stopping scan for removed item:', path);

    // Find queue item being scanned
    const queueItems = document.querySelectorAll('.scan-queue-item.scanning');
    for (const item of queueItems) {
        const itemPath = item.querySelector('.scan-queue-path')?.title || '';
        if (itemPath === path || itemPath.startsWith(path)) {
            // Mark as failed
            item.className = 'scan-queue-item failed';
            item.querySelector('.scan-queue-status').textContent = 'Device removed';
            item.querySelector('.scan-queue-status').style.color = '#ef4444';
            item.querySelector('.scan-queue-progress-fill').style.width = '100%';
            item.querySelector('.scan-queue-progress-fill').style.background = '#ef4444';

            console.log('[ItemManager] Marked scanning item as failed');
            break;
        }
    }

    // Remove from queue if waiting
    const queueIndex = threatScanQueue.indexOf(path);
    if (queueIndex > -1) {
        threatScanQueue.splice(queueIndex, 1);
        console.log('[ItemManager] Removed from scan queue');
    }
}

// Toggle scan button (Start/Stop)
async function toggleThreatScan() {
    if (threatIsScanning) {
        // Stop scan immediately
        console.log('[Threats] Stopping scan...');
        threatScanStopped = true;

        // Call backend abort
        try {
            await window.electronAPI.abortThreatScan();
        } catch (e) {
            console.error('[Threats] Abort error:', e);
        }

        // Update UI immediately
        const btn = document.getElementById('scan-threats-btn');
        const btnText = document.getElementById('scan-btn-text');
        const btnIcon = document.getElementById('scan-btn-icon');

        // Show current results
        renderThreatResults(threatAllResults);

        const count = threatAllResults.length;
        if (btnText) btnText.textContent = count > 0 ? `Stopped (${count} found)` : 'Stopped';

        // Reset to Scan mode after delay
        setTimeout(() => {
            if (btnIcon) {
                btnIcon.innerHTML = '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>';
            }
            if (btnText) btnText.textContent = 'Scan Threats';
            btn.classList.remove('danger-btn');
            btn.classList.add('primary-btn');
            btn.disabled = false;

            const uninstallBtn = document.getElementById('install-clamav-btn');
            if (uninstallBtn) uninstallBtn.disabled = false;
        }, 2000);

        threatIsScanning = false;
        loadThreatHistory();
    } else {
        // Start scan
        startThreatScan();
    }
}

// Handler for checkbox changes - adds to queue if scanning + saves state
async function onScanCheckboxChange(checkbox) {
    if (!threatIsScanning) {
        // Not scanning, save state and update estimate
        await saveCheckboxStates();
        updateScanEstimate();
        return;
    }

    // Currently scanning - add/remove from queue
    const pathData = checkbox.dataset.path;
    const paths = pathData.includes(',')
        ? pathData.split(',').map(p => p.trim())
        : [pathData];

    if (checkbox.checked) {
        // Add to queue
        paths.forEach(p => {
            if (!threatScanQueue.includes(p)) {
                threatScanQueue.push(p);
                console.log('[Threats] Added to scan queue:', p);

                // Add to queue UI
                addToQueueUI(p);
            }
        });
    } else {
        // Remove from queue (if not already being scanned)
        paths.forEach(p => {
            const idx = threatScanQueue.indexOf(p);
            if (idx > -1) {
                threatScanQueue.splice(idx, 1);
                console.log('[Threats] Removed from scan queue:', p);
            }
        });
    }

    await saveCheckboxStates();
    updateScanEstimate();
}

// Save all checkbox states to config
async function saveCheckboxStates() {
    const allCheckboxes = document.querySelectorAll('.scan-target-checkbox');
    const states = {};

    allCheckboxes.forEach(cb => {
        const path = cb.dataset.path;
        if (path) {
            states[path] = cb.checked;
        }
    });

    console.log('[Threats] Saving checkbox states:', states);

    try {
        const config = await window.electronAPI.getSettings();
        await window.electronAPI.saveSettings({ ...config, threatCheckboxStates: states });
        console.log('[Threats] Checkbox states saved successfully');
    } catch (e) {
        console.error('[Threats] Error saving checkbox states:', e);
    }
}

// Load and apply checkbox states from config
async function loadCheckboxStates() {
    try {
        const config = await window.electronAPI.getSettings();
        const states = config.threatCheckboxStates || {};

        console.log('[Threats] Loading checkbox states:', states);

        const allCheckboxes = document.querySelectorAll('.scan-target-checkbox');
        console.log('[Threats] Found', allCheckboxes.length, 'checkboxes');

        allCheckboxes.forEach(cb => {
            const path = cb.dataset.path;
            console.log('[Threats] Checkbox path:', path, 'saved state:', states[path]);

            if (path && states.hasOwnProperty(path)) {
                cb.checked = states[path];
                console.log('[Threats] Set checkbox', path, 'to', states[path]);
            }
        });

        console.log('[Threats] Loaded checkbox states complete');
    } catch (e) {
        console.error('[Threats] Error loading checkbox states:', e);
    }
}

// Add path to queue UI during scan
function addToQueueUI(path) {
    const queueItems = document.getElementById('scan-queue-items');
    if (!queueItems) return;

    const pathBasename = path.split('/').pop() || path;
    const queueIndex = queueItems.children.length;

    const queueItem = document.createElement('div');
    queueItem.className = 'scan-queue-item waiting';
    queueItem.id = `scan-queue-${queueIndex}`;
    queueItem.innerHTML = `
        <div class="scan-queue-header">
            <span class="scan-queue-path" title="${path}">${pathBasename}</span>
            <span class="scan-queue-status">Queued</span>
        </div>
        <div class="scan-queue-progress">
            <div class="scan-queue-progress-fill" style="width: 0%"></div>
        </div>
    `;
    queueItems.appendChild(queueItem);
}

// Check ClamAV status on page load
async function checkClamAVStatus() {
    try {
        const result = await window.electronAPI.checkClamAV();
        const statusText = document.getElementById('status-clamav-engine');
        const installBtn = document.getElementById('install-clamav-btn');

        if (result.installed) {
            statusText.textContent = '✓ Installed';
            statusText.style.color = 'var(--safe)';
            installBtn.textContent = 'Uninstall';
            installBtn.onclick = uninstallClamAV;
        } else {
            statusText.textContent = 'Not installed';
            statusText.style.color = 'var(--text-secondary)';
            installBtn.textContent = 'Install';
            installBtn.onclick = installClamAV;
        }
    } catch (error) {
        console.error('[Threats] Failed to check ClamAV status:', error);
    }
}

// Update threat database
async function updateThreatDatabase() {
    const btn = document.getElementById('update-db-btn');
    btn.disabled = true;
    btn.classList.add('updating');

    const sources = ['objective-see', 'malwarebytes', 'clamav-db'];

    // Check if ClamAV engine is installed
    let clamavInstalled = false;
    try {
        const result = await window.electronAPI.checkClamAV();
        clamavInstalled = result.installed;
    } catch { }

    try {
        // Update each source with progress
        for (const source of sources) {
            const statusEl = document.getElementById(`status-${source}`);
            const progressEl = document.getElementById(`progress-${source}`);
            const progressFill = progressEl?.querySelector('.source-progress-fill');

            if (statusEl) {
                statusEl.textContent = 'Updating...';
                statusEl.style.color = 'var(--accent)';
            }

            if (progressEl && progressFill) {
                progressEl.classList.remove('hidden');
                progressFill.style.width = '50%';
            }

            // TODO: Replace with real API call when available
            // const result = await window.electronAPI.updateSource(source);
            // For now, just mark as complete instantly (no real API yet)
            await new Promise(r => setTimeout(r, 100)); // Minimal delay for animation

            if (progressFill) {
                progressFill.style.width = '100%';
            }

            await new Promise(r => setTimeout(r, 150)); // Brief pause to show 100%

            if (statusEl) {
                statusEl.textContent = '✓ Built-in';
                statusEl.style.color = 'var(--safe)';
            }

            if (progressEl && progressFill) {
                progressEl.classList.add('hidden');
                progressFill.style.width = '0%';
            }
        }

        // Update ClamAV engine ONLY if installed
        if (clamavInstalled) {
            const statusEl = document.getElementById('status-clamav-engine');
            const progressEl = document.getElementById('clamav-progress');
            const progressFill = progressEl?.querySelector('.source-progress-fill');

            if (statusEl) {
                statusEl.textContent = 'Checking for updates...';
                statusEl.style.color = 'var(--accent)';
            }

            if (progressEl && progressFill) {
                progressEl.classList.remove('hidden');
                progressFill.style.width = '30%';
            }

            try {
                // Set timeout to avoid hanging forever (5 seconds max)
                const updatePromise = window.electronAPI.updateClamAV();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), 5000)
                );

                const result = await Promise.race([updatePromise, timeoutPromise]);

                if (progressFill) progressFill.style.width = '100%';

                if (result.success && statusEl) {
                    statusEl.textContent = '✓ Updated';
                    statusEl.style.color = 'var(--safe)';
                } else {
                    // No update available or check failed - just show installed
                    if (statusEl) {
                        statusEl.textContent = '✓ Installed';
                        statusEl.style.color = 'var(--safe)';
                    }
                }
            } catch (e) {
                // Timeout or error - just show as installed, don't block
                if (statusEl) {
                    statusEl.textContent = '✓ Installed';
                    statusEl.style.color = 'var(--safe)';
                }
                console.log('[Threats] ClamAV update skipped:', e.message);
            }

            if (progressEl) progressEl.classList.add('hidden');
            if (progressFill) progressFill.style.width = '0%';
        }

        // Backend patterns are embedded, no real update needed
        // await window.electronAPI.updateThreatDB();

    } catch (error) {
        console.error('[Threats] Update error:', error);
        // Don't show alert for minor errors
    } finally {
        btn.disabled = false;
        btn.classList.remove('updating');
    }
}

// Install ClamAV engine
async function installClamAV() {
    const btn = document.getElementById('install-clamav-btn');
    const statusEl = document.getElementById('status-clamav-engine');
    const progressEl = document.getElementById('clamav-progress');
    const progressFill = progressEl.querySelector('.source-progress-fill');

    // Estimated download size (actual is ~100-150MB for virus definitions)
    const estimatedMB = 120;
    btn.disabled = true;
    btn.classList.add('hidden'); // Hide button during install
    progressEl.classList.remove('hidden');

    try {
        // Simulate progress while installing with MB display
        let downloadedMB = 0;
        const progressInterval = setInterval(() => {
            downloadedMB = Math.min(downloadedMB + 5, estimatedMB - 10);
            const percent = (downloadedMB / estimatedMB) * 100;
            progressFill.style.width = percent + '%';
            statusEl.textContent = `Downloading ~${downloadedMB}MB...`;
            statusEl.style.color = 'var(--accent)';
        }, 500);

        const result = await window.electronAPI.installClamAV();

        clearInterval(progressInterval);
        progressFill.style.width = '100%';

        if (result.success) {
            // Get actual database size and update badge
            const realSize = await window.electronAPI.getClamAVDBSize();
            const sizeBadge = document.getElementById('clamav-size-badge');
            if (sizeBadge && realSize > 0) {
                sizeBadge.textContent = `${realSize}MB`;
            }

            statusEl.textContent = `✓ Installed (${realSize || estimatedMB}MB)`;
            statusEl.style.color = 'var(--safe)';
            await new Promise(r => setTimeout(r, 500));
            statusEl.textContent = '✓ Installed';

            // Keep button hidden, show only uninstall option
            btn.textContent = 'Uninstall';
            btn.onclick = uninstallClamAV;
            btn.classList.remove('hidden');
            btn.classList.add('btn-uninstall');
            // Refresh time estimate since we now have 4th source
            updateScanEstimate();
        } else {
            throw new Error(result.error || 'Installation failed');
        }
    } catch (error) {
        console.error('[Threats] Install ClamAV error:', error);
        alert('Failed to install ClamAV: ' + error.message);
        statusEl.textContent = 'Install failed';
        statusEl.style.color = 'var(--danger)';
        btn.textContent = 'Retry';
        btn.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        progressEl.classList.add('hidden');
        progressFill.style.width = '0%';
    }
}

// Uninstall ClamAV engine
async function uninstallClamAV() {
    // Get real database size
    let dbSizeMB = 0;
    try {
        dbSizeMB = await window.electronAPI.getClamAVDBSize();
    } catch (e) { }

    const sizeText = dbSizeMB > 0 ? `${dbSizeMB}MB` : 'virus database';
    if (!confirm(`Uninstall ClamAV Engine? This will remove ${sizeText} of data.`)) {
        return;
    }

    const btn = document.getElementById('install-clamav-btn');
    const statusEl = document.getElementById('status-clamav-engine');

    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
        const result = await window.electronAPI.uninstallClamAV();

        if (result.success) {
            statusEl.textContent = 'Not installed';
            statusEl.style.color = 'var(--text-secondary)';
            btn.textContent = 'Install';
            btn.onclick = installClamAV;
            btn.classList.remove('btn-uninstall');
            // Refresh time estimate since now only 3 sources
            updateScanEstimate();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        alert('Failed to uninstall: ' + error.message);
    } finally {
        btn.disabled = false;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    checkClamAVStatus();
    loadThreatHistory();
});

// Add custom scan path
async function addCustomScanPath() {
    const folders = await window.electronAPI.pickFolders();
    if (!folders || folders.length === 0) return;

    const path = folders[0]; // Get first selected folder

    // Check if path is in blacklist
    const config = await window.electronAPI.getSettings();
    const isIgnoredFolder = config.ignoredFolders?.some(f => path === f || path.startsWith(f + '/'));
    const isIgnoredPath = config.ignoredPaths?.some(p => path === p || path.startsWith(p + '/'));

    if (isIgnoredFolder || isIgnoredPath) {
        alert(`⚠️ This path is in your Blacklist!\n\n"${path}"\n\nPlease go to the Blacklist section and un-ignore this path before adding it to threat scan.`);
        return;
    }

    customPathCounter++;
    const id = `custom-path-${customPathCounter}`;

    // Get just the folder name from path
    const folderName = path.split('/').pop() || path;

    const container = document.getElementById('custom-scan-paths');
    const pathItem = document.createElement('div');
    pathItem.className = 'scan-target-item';
    pathItem.id = id;
    pathItem.innerHTML = `
        <label class="scan-target-label">
            <input type="checkbox" 
                   class="scan-target-checkbox" 
                   data-path="${path}" 
                   data-estimate="60" 
                   checked 
                   onchange="onScanCheckboxChange(this)">
            <button class="remove-custom-btn" onclick="event.preventDefault(); removeCustomPath('${id}')" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            <div class="scan-target-info">
                <strong class="custom-path-name" title="${path}">${folderName}</strong>
                <span class="scan-target-desc custom-path-full">${path}</span>
            </div>
            <span class="scan-estimate">~1m</span>
        </label>
    `;

    container.appendChild(pathItem);

    // Save custom path to config
    await saveCustomPathsToConfig();

    updateScanEstimate();
}

// Remove custom path
async function removeCustomPath(id) {
    document.getElementById(id).remove();

    // Save updated paths to config
    await saveCustomPathsToConfig();

    updateScanEstimate();
}

// Save all current custom paths to config
async function saveCustomPathsToConfig() {
    const customPathCheckboxes = document.querySelectorAll('#custom-scan-paths .scan-target-checkbox');
    const paths = [];
    customPathCheckboxes.forEach(cb => {
        if (cb.dataset.path) {
            paths.push(cb.dataset.path);
        }
    });
    await window.electronAPI.saveCustomPaths(paths);
    console.log('[Threats] Saved custom paths:', paths);
}

// Load saved custom paths from config on page load
async function loadSavedCustomPaths() {
    try {
        const result = await window.electronAPI.getCustomPaths();
        if (!result.success || !result.paths?.length) return;

        const container = document.getElementById('custom-scan-paths');

        for (const path of result.paths) {
            // Check if path still exists
            const exists = await window.electronAPI.pathExists(path);

            customPathCounter++;
            const id = `custom-path-${customPathCounter}`;
            const folderName = path.split('/').pop() || path;

            const pathItem = document.createElement('div');
            pathItem.className = 'scan-target-item';
            pathItem.id = id;

            if (exists.exists) {
                pathItem.innerHTML = `
                    <label class="scan-target-label">
                        <input type="checkbox" 
                               class="scan-target-checkbox" 
                               data-path="${path}" 
                               data-estimate="60" 
                               onchange="onScanCheckboxChange(this)">
                        <button class="remove-custom-btn" onclick="event.preventDefault(); removeCustomPath('${id}')" title="Remove">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                        <div class="scan-target-info">
                            <strong class="custom-path-name" title="${path}">${folderName}</strong>
                            <span class="scan-target-desc custom-path-full">${path}</span>
                        </div>
                        <span class="scan-estimate">~1m</span>
                    </label>
                `;
            } else {
                // Path doesn't exist - show as unavailable
                pathItem.innerHTML = `
                    <label class="scan-target-label" style="opacity: 0.5;">
                        <input type="checkbox" 
                               class="scan-target-checkbox" 
                               data-path="${path}" 
                               data-estimate="0" 
                               disabled>
                        <button class="remove-custom-btn" onclick="event.preventDefault(); removeCustomPath('${id}')" title="Remove">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                        <div class="scan-target-info">
                            <strong class="custom-path-name" title="${path}">${folderName}</strong>
                            <span class="scan-target-desc custom-path-full" style="color: var(--risky);">⚠️ Not found: ${path}</span>
                        </div>
                        <span class="scan-estimate" style="color: var(--risky);">N/A</span>
                    </label>
                `;
            }

            container.appendChild(pathItem);
        }

        updateScanEstimate();
        console.log('[Threats] Loaded saved custom paths:', result.paths);
    } catch (e) {
        console.error('[Threats] Error loading custom paths:', e);
    }
}

// Update total scan time estimate
async function updateScanEstimate() {
    const checkboxes = document.querySelectorAll('.scan-target-checkbox');
    let totalSeconds = 0;

    // Check if ClamAV is installed - deep scanning takes much longer
    let clamavInstalled = false;
    try {
        const clamStatus = await window.electronAPI.checkClamAV();
        clamavInstalled = clamStatus.installed;
    } catch (e) { }

    const multiplier = clamavInstalled ? 5 : 1;

    // Update each row's estimate display AND calculate total
    checkboxes.forEach(cb => {
        const baseEstimate = parseInt(cb.dataset.estimate || 0);
        const adjustedEstimate = Math.round(baseEstimate * multiplier);

        // Find the estimate span in this row
        const label = cb.closest('label') || cb.closest('.scan-target-item');
        if (label) {
            const estimateSpan = label.querySelector('.scan-estimate');
            if (estimateSpan) {
                estimateSpan.textContent = formatTime(adjustedEstimate);
            }
        }

        // Add to total only if checked
        if (cb.checked) {
            totalSeconds += adjustedEstimate;
        }
    });

    const display = document.getElementById('total-scan-time');
    if (totalSeconds === 0) {
        display.textContent = 'No targets selected';
        display.style.color = 'var(--text-secondary)';
    } else {
        display.textContent = formatTime(totalSeconds);
        display.style.color = 'var(--accent)';
    }
}

// Format seconds to readable time
function formatTime(seconds) {
    if (seconds < 60) {
        return `~${seconds} seconds`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `~${minutes}m ${secs}s` : `~${minutes} minutes`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours} hours`;
    }
}

// Start threat scan with per-path progress
async function startThreatScan() {
    const checkboxes = document.querySelectorAll('.scan-target-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('Please select at least one scan target');
        return;
    }

    // Collect paths from checked boxes only
    const scanPaths = [];
    const queueUIItems = [];
    checkboxes.forEach((cb, idx) => {
        const pathData = cb.dataset.path;
        const displayPath = pathData.split(',')[0].trim();
        queueUIItems.push({ index: idx, displayPath, pathData });

        if (pathData.includes(',')) {
            pathData.split(',').forEach(p => scanPaths.push(p.trim()));
        } else {
            scanPaths.push(pathData);
        }
    });

    console.log('[Threats] Scanning paths:', scanPaths);

    // Set state
    threatIsScanning = true;
    threatScanStopped = false;
    threatScanQueue = [];
    threatAllResults = [];

    // Get UI elements
    const scanBtn = document.getElementById('scan-threats-btn');
    const btnIcon = document.getElementById('scan-btn-icon');
    const btnText = document.getElementById('scan-btn-text');
    const uninstallBtn = document.getElementById('install-clamav-btn');
    const queueContainer = document.getElementById('scan-queue-container');
    const queueItems = document.getElementById('scan-queue-items');
    const resultsSection = document.getElementById('threats-results');

    // Hide old results
    if (resultsSection) resultsSection.classList.add('hidden');

    // Update button to Stop mode
    if (btnIcon) {
        btnIcon.innerHTML = '<rect x="6" y="6" width="12" height="12"></rect>'; // Stop icon
    }
    if (btnText) btnText.textContent = 'Stop Scan';
    scanBtn.classList.remove('primary-btn');
    scanBtn.classList.add('danger-btn');
    if (uninstallBtn) uninstallBtn.disabled = true;

    // Build queue UI
    queueContainer.classList.remove('hidden');
    queueItems.innerHTML = '';

    queueUIItems.forEach((item, idx) => {
        const basename = item.displayPath.split('/').pop() || item.displayPath;
        const div = document.createElement('div');
        div.className = 'scan-queue-item waiting';
        div.id = `scan-queue-${idx}`;
        div.innerHTML = `
            <div class="scan-queue-header">
                <span class="scan-queue-path" title="${item.displayPath}">${basename}</span>
                <span class="scan-queue-status">Waiting</span>
            </div>
            <div class="scan-queue-progress">
                <div class="scan-queue-progress-fill" style="width: 0%"></div>
            </div>
        `;
        queueItems.appendChild(div);
    });

    try {

        // Scan each checkbox item one by one for visible progress
        for (let i = 0; i < queueUIItems.length; i++) {
            if (threatScanStopped) break;

            const item = queueUIItems[i];
            const uiItem = document.getElementById(`scan-queue-${i}`);

            // Check if path exists BEFORE scanning
            const mainPath = item.pathData.split(',')[0].trim();
            const pathCheck = await window.electronAPI.pathExists(mainPath);

            if (!pathCheck.exists) {
                // Path doesn't exist - mark as Failed
                if (uiItem) {
                    uiItem.className = 'scan-queue-item failed';
                    uiItem.querySelector('.scan-queue-status').textContent = 'Not found';
                    uiItem.querySelector('.scan-queue-status').style.color = 'var(--risky)';
                    uiItem.querySelector('.scan-queue-progress-fill').style.width = '100%';
                    uiItem.querySelector('.scan-queue-progress-fill').style.background = '#ef4444';
                }
                console.log('[Threats] Path not found, skipping:', mainPath);
                continue; // Skip to next item
            }

            // Update UI: scanning
            if (uiItem) {
                uiItem.className = 'scan-queue-item scanning';
                uiItem.querySelector('.scan-queue-status').textContent = 'Scanning...';

                // Animate progress bar
                const progressFill = uiItem.querySelector('.scan-queue-progress-fill');
                let progress = 0;
                const progressInterval = setInterval(() => {
                    if (progress < 90) {
                        progress += 5;
                        progressFill.style.width = progress + '%';
                    }
                }, 200);

                // Get paths for this item
                const itemPaths = item.pathData.includes(',')
                    ? item.pathData.split(',').map(p => p.trim())
                    : [item.pathData];

                try {
                    // Scan this item
                    const result = await window.electronAPI.scanThreats(itemPaths);

                    clearInterval(progressInterval);
                    progressFill.style.width = '100%';

                    if (result.success && result.threats) {
                        // Save to global for stop function access
                        threatAllResults.push(...result.threats);

                        // Update UI: complete
                        if (result.threats.length > 0) {
                            uiItem.querySelector('.scan-queue-status').textContent = `${result.threats.length} found`;
                            uiItem.querySelector('.scan-queue-status').style.color = 'var(--risky)';
                        } else {
                            uiItem.querySelector('.scan-queue-status').textContent = 'Clean';
                            uiItem.querySelector('.scan-queue-status').style.color = 'var(--safe)';
                        }
                        uiItem.className = 'scan-queue-item completed';
                    } else if (result.error) {
                        // Scan failed - likely device removed
                        throw new Error(result.error);
                    }
                } catch (scanError) {
                    clearInterval(progressInterval);
                    console.error('[Threats] Scan error for item:', mainPath, scanError);

                    // Check if path still exists
                    const stillExists = await window.electronAPI.pathExists(mainPath);

                    if (!stillExists.exists) {
                        // Device was removed during scan
                        uiItem.className = 'scan-queue-item failed';
                        uiItem.querySelector('.scan-queue-status').textContent = 'Device removed';
                        uiItem.querySelector('.scan-queue-status').style.color = 'var(--risky)';
                        uiItem.querySelector('.scan-queue-progress-fill').style.width = '100%';
                        uiItem.querySelector('.scan-queue-progress-fill').style.background = '#ef4444';
                    } else {
                        // Other scan error
                        uiItem.className = 'scan-queue-item failed';
                        uiItem.querySelector('.scan-queue-status').textContent = 'Scan failed';
                        uiItem.querySelector('.scan-queue-status').style.color = 'var(--risky)';
                        uiItem.querySelector('.scan-queue-progress-fill').style.width = '100%';
                        uiItem.querySelector('.scan-queue-progress-fill').style.background = '#ef4444';
                    }
                }
            }
        }

        // Check if queue has new items added during scan
        while (threatScanQueue.length > 0 && !threatScanStopped) {
            const newPaths = [...threatScanQueue];
            threatScanQueue = [];

            for (const path of newPaths) {
                if (threatScanStopped) break;

                // Find the waiting queue item and animate it
                const queueItemUI = document.querySelector(`#scan-queue-items .scan-queue-item.waiting`);
                if (queueItemUI) {
                    queueItemUI.className = 'scan-queue-item scanning';
                    queueItemUI.querySelector('.scan-queue-status').textContent = 'Scanning...';

                    // Animate progress bar
                    const progressFill = queueItemUI.querySelector('.scan-queue-progress-fill');
                    let progress = 0;
                    const progressInterval = setInterval(() => {
                        if (progress < 90) {
                            progress += 5;
                            progressFill.style.width = progress + '%';
                        }
                    }, 200);

                    // Scan new path
                    const result = await window.electronAPI.scanThreats([path]);

                    clearInterval(progressInterval);
                    progressFill.style.width = '100%';

                    if (result.success && result.threats) {
                        threatAllResults.push(...result.threats);
                        queueItemUI.querySelector('.scan-queue-status').textContent = result.threats.length > 0
                            ? `${result.threats.length} found` : 'Clean';
                        queueItemUI.querySelector('.scan-queue-status').style.color = result.threats.length > 0
                            ? 'var(--risky)' : 'var(--safe)';
                    }
                    queueItemUI.className = 'scan-queue-item completed';
                }
            }
        }

        // Show results
        renderThreatResults(threatAllResults);

        const count = threatAllResults.length;
        const stopped = threatScanStopped;

        if (stopped) {
            if (btnText) btnText.textContent = count > 0 ? `Stopped (${count} found)` : 'Stopped';
        } else {
            if (btnText) btnText.textContent = count > 0 ? `${count} threat${count > 1 ? 's' : ''} found` : 'No threats';
        }

        loadThreatHistory();

    } catch (error) {
        console.error('[Threats] Scan error:', error);
        alert('Scan failed: ' + error.message);
    } finally {
        // Reset button to Scan mode after delay
        setTimeout(() => {
            if (btnIcon) {
                btnIcon.innerHTML = '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>';
            }
            if (btnText) btnText.textContent = 'Scan Threats';
            scanBtn.classList.remove('danger-btn');
            scanBtn.classList.add('primary-btn');
            scanBtn.disabled = false;
            if (uninstallBtn) uninstallBtn.disabled = false;
        }, 2000);

        threatIsScanning = false;
        threatScanQueue = [];
        threatScanStopped = false;
    }
}

// Render threat scan results
async function renderThreatResults(threats) {
    const resultsDiv = document.getElementById('threats-results');
    const listDiv = document.getElementById('threats-list');
    const countSpan = document.getElementById('threats-count');
    const sizeSpan = document.getElementById('threats-size');

    if (threats.length === 0) {
        listDiv.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No threats detected! Your system is clean.</p>';
        resultsDiv.classList.remove('hidden');
        countSpan.textContent = '0 threats detected';
        sizeSpan.textContent = '';
        return;
    }

    // Calculate total size
    const totalSize = threats.reduce((sum, t) => sum + (t.size || 0), 0);

    // Check path existence for each threat
    const threatsWithStatus = await Promise.all(threats.map(async (threat, index) => {
        const exists = await window.electronAPI.pathExists(threat.path);
        return { ...threat, exists: exists.exists, index };
    }));

    // Render threat items
    listDiv.innerHTML = threatsWithStatus.map(threat => {
        const warningBadge = !threat.exists
            ? '<span style="color: var(--risky); font-size: 0.85em; margin-left: 8px;">⚠️ Cannot delete - device not found</span>'
            : '';

        return `
        <div class="threat-item" data-index="${threat.index}">
            <input type="checkbox" ${threat.exists ? 'checked' : 'disabled'} data-path="${threat.path}" data-exists="${threat.exists}">
            <div class="threat-info">
                <div class="threat-name">${threat.name}${warningBadge}</div>
                <div class="threat-path">${threat.path}</div>
            </div>
            <span class="threat-severity ${threat.severity}">${threat.severity}</span>
        </div>
    `;
    }).join('');

    countSpan.textContent = `${threats.length} threat${threats.length > 1 ? 's' : ''} detected`;
    sizeSpan.textContent = formatSize(totalSize);
    resultsDiv.classList.remove('hidden');

    // Store threats data for deletion
    window.currentThreats = threats;

    // Setup AI Cat for threat items
    if (window.setupThreatsAICat) {
        setTimeout(() => window.setupThreatsAICat(), 200);
    }
}

// Toggle all threats checkboxes
function toggleAllThreats(checked) {
    document.querySelectorAll('#threats-list input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
    });
}

// Delete selected threats
async function deleteSelectedThreats() {
    const checkboxes = document.querySelectorAll('#threats-list input[type="checkbox"]:checked');
    if (checkboxes.length === 0) {
        alert('Please select threats to delete');
        return;
    }

    const paths = Array.from(checkboxes).map(cb => cb.dataset.path);
    const count = paths.length;

    if (!confirm(`Delete ${count} threat${count > 1 ? 's' : ''}?`)) {
        return;
    }

    try {
        const deleteBtn = document.getElementById('delete-threats-btn');
        deleteBtn.disabled = true;
        deleteBtn.textContent = '⏳ Deleting...';

        // Call backend delete
        const result = await window.electronAPI.deleteThreats(paths);

        if (!result.success) {
            throw new Error(result.error || 'Delete failed');
        }

        deleteBtn.textContent = '✓ Deleted';

        // Reload history
        await loadThreatHistory();

        // Clear results
        document.getElementById('threats-results').classList.add('hidden');

        alert(`Successfully deleted ${count} threat${count > 1 ? 's' : ''}!`);

        // Reset button
        setTimeout(() => {
            deleteBtn.disabled = false;
            deleteBtn.textContent = 'Delete Selected';
        }, 2000);
    } catch (error) {
        console.error('[Threats] Delete error:', error);
        alert('Delete failed: ' + error.message);

        const deleteBtn = document.getElementById('delete-threats-btn');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete Selected';
    }
}

// Load threat deletion history
async function loadThreatHistory() {
    try {
        const result = await window.electronAPI.getThreatHistory();

        if (!result.success || !result.history || result.history.length === 0) {
            return; // No history to display
        }

        const historyDiv = document.getElementById('threats-history');
        const listDiv = document.getElementById('threats-history-list');

        // Clear existing
        listDiv.innerHTML = '';

        // Render history items (max 3)
        result.history.slice(0, 3).forEach(entry => {
            const date = new Date(entry.timestamp).toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            const item = document.createElement('div');
            item.className = 'history-item-threats';
            item.innerHTML = `
                <span class="history-date">${date}</span>
                <span class="history-count">Removed ${entry.count} threat${entry.count > 1 ? 's' : ''}</span>
            `;

            listDiv.appendChild(item);
        });

        historyDiv.classList.remove('hidden');
    } catch (error) {
        console.error('[Threats] Load history error:', error);
    }
}

// formatSize already defined in app.js, reusing that

// Initialize on section show
window.addEventListener('DOMContentLoaded', async () => {
    await loadSavedCustomPaths();
    await loadCheckboxStates();
    updateScanEstimate();

    // Start Item Manager monitoring
    startItemMonitor();
});

// Handle tab visibility - restart monitor when tab becomes visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Tab hidden - stop monitoring to save resources
        stopItemMonitor();
    } else {
        // Tab visible - restart monitoring
        startItemMonitor();
    }
});
