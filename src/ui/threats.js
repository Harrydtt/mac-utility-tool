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
    const uninstallBtn = document.getElementById('uninstall-db-btn');
    btn.disabled = true;
    btn.classList.add('updating');

    // Disable Uninstall button during download
    if (uninstallBtn) uninstallBtn.disabled = true;

    const sources = ['objective-see', 'malwarebytes'];

    // Check if ClamAV engine is installed
    let clamavInstalled = false;
    try {
        const result = await window.electronAPI.checkClamAV();
        clamavInstalled = result.installed;
    } catch { }

    try {
        // Show "Checking for updates..." first
        for (const source of sources) {
            const statusEl = document.getElementById(`status-${source}`);
            const progressEl = document.getElementById(`progress-${source}`);
            const progressFill = progressEl?.querySelector('.source-progress-fill');

            if (statusEl) {
                statusEl.textContent = 'Checking for updates...';
                statusEl.style.color = 'var(--accent)';
            }

            if (progressEl && progressFill) {
                progressEl.classList.remove('hidden');
                progressFill.style.width = '10%';
            }
        }

        // Small delay to show "Checking" state
        await new Promise(r => setTimeout(r, 500));

        // Update status to "Downloading..."
        for (const source of sources) {
            const statusEl = document.getElementById(`status-${source}`);
            const progressEl = document.getElementById(`progress-${source}`);
            const progressFill = progressEl?.querySelector('.source-progress-fill');

            if (statusEl) {
                statusEl.textContent = 'Downloading...';
            }
            if (progressFill) {
                progressFill.style.width = '30%';
            }
        }

        // Call actual download API
        const result = await window.electronAPI.downloadDatabases();

        // Update card statuses based on result
        for (const source of sources) {
            const statusEl = document.getElementById(`status-${source}`);
            const progressEl = document.getElementById(`progress-${source}`);
            const progressFill = progressEl?.querySelector('.source-progress-fill');

            if (progressFill) progressFill.style.width = '100%';
            await new Promise(r => setTimeout(r, 150));

            if (result.success) {
                if (statusEl) {
                    statusEl.textContent = '✓ Downloaded';
                    statusEl.style.color = 'var(--safe)';
                }
            } else {
                if (statusEl) {
                    statusEl.textContent = '✗ Failed';
                    statusEl.style.color = 'var(--danger)';
                }
            }

            if (progressEl && progressFill) {
                progressEl.classList.add('hidden');
                progressFill.style.width = '0%';
            }
        }

        // ClamAV Engine - Install if not installed, Update if installed
        const statusEl = document.getElementById('status-clamav-engine');
        const progressEl = document.getElementById('clamav-progress');
        const progressFill = progressEl?.querySelector('.source-progress-fill');

        if (statusEl) {
            statusEl.textContent = clamavInstalled ? 'Checking for updates...' : 'Preparing...';
            statusEl.style.color = 'var(--accent)';
        }

        if (progressEl && progressFill) {
            progressEl.classList.remove('hidden');
            progressFill.style.width = '0%';
        }

        // Listen for real-time progress updates
        window.electronAPI.onClamAVInstallProgress((progress, status) => {
            if (progressFill) progressFill.style.width = progress + '%';
            if (statusEl) statusEl.textContent = status;
        });

        try {
            let clamResult;
            if (clamavInstalled) {
                // Update existing ClamAV
                const updatePromise = window.electronAPI.updateClamAV();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), 120000)
                );
                clamResult = await Promise.race([updatePromise, timeoutPromise]);
            } else {
                // Install ClamAV from GDrive manifest (with progress)
                clamResult = await window.electronAPI.installClamAV();
            }

            if (progressFill) progressFill.style.width = '100%';

            if (clamResult.success && statusEl) {
                statusEl.textContent = '✓ Downloaded';
                statusEl.style.color = 'var(--safe)';
            } else {
                if (statusEl) {
                    statusEl.textContent = clamResult.error || '✗ Failed';
                    statusEl.style.color = 'var(--danger)';
                }
            }
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = '✗ ' + e.message;
                statusEl.style.color = 'var(--danger)';
            }
            console.log('[Threats] ClamAV error:', e.message);
        }

        if (progressEl) progressEl.classList.add('hidden');
        if (progressFill) progressFill.style.width = '0%';

        if (!result.success) {
            alert('Database download failed:\n' + (result.errors?.join('\n') || 'Unknown error'));
        }

        // Refresh status to show/hide Uninstall button
        await checkDatabaseStatus();

    } catch (error) {
        console.error('[Threats] Update error:', error);
        alert('Database update failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.classList.remove('updating');
        // Re-enable Uninstall button
        if (uninstallBtn) uninstallBtn.disabled = false;
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
    initWorkerSelector();
});

// Initialize worker count selector based on system resources
async function initWorkerSelector() {
    const select = document.getElementById('worker-count-select');
    const info = document.getElementById('worker-info');
    if (!select || !info) return;

    // RAM and CPU per worker
    const ramPerWorker = 400; // MB
    const cpuPerWorker = 1;

    try {
        const resources = await window.electronAPI.getSystemResources();
        console.log('[Threats] System resources:', resources);

        const maxWorkers = resources.recommendedWorkers;

        // Update options with resource requirements
        for (let i = 1; i <= 4; i++) {
            const option = select.querySelector(`option[value="${i}"]`);
            if (option) {
                const requiredRam = i * ramPerWorker;
                const requiredCpu = i * cpuPerWorker;

                if (i > maxWorkers) {
                    option.disabled = true;
                    option.textContent = `${i} Workers (${requiredRam}MB, ${requiredCpu} cores) - insufficient`;
                } else {
                    option.disabled = false;
                    option.textContent = `${i} Worker${i > 1 ? 's' : ''} (${requiredRam}MB, ${requiredCpu} core${requiredCpu > 1 ? 's' : ''})`;
                }
            }
        }

        // Set default to recommended (max 2)
        select.value = Math.min(2, maxWorkers);

        // Update info when selection changes
        const updateInfo = () => {
            const count = parseInt(select.value) || 1;
            info.textContent = `Uses ${count * ramPerWorker}MB RAM, ${count} CPU core${count > 1 ? 's' : ''}`;
        };
        updateInfo();

        select.addEventListener('change', updateInfo);

    } catch (e) {
        console.error('[Threats] Failed to get system resources:', e);
        info.textContent = '(could not detect resources)';
    }
}

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

    const multiplier = clamavInstalled ? 15 : 1; // ClamAV scan is 15x slower than pattern matching
    const baseLoadTime = clamavInstalled ? 30 : 0; // ClamAV database loading takes ~30s extra

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

    // Add base loading time for ClamAV
    if (clamavInstalled && totalSeconds > 0) {
        totalSeconds += baseLoadTime;
    }

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

    // Check if databases are downloaded
    const dbStatus = await window.electronAPI.checkDatabaseStatus();
    if (!dbStatus.downloaded) {
        alert('Threat databases not downloaded!\n\nPlease download the threat databases first before scanning.');
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

    // Lock worker selector during scan
    const workerCountSelect = document.getElementById('worker-count-select');
    if (workerCountSelect) workerCountSelect.disabled = true;

    // Build queue UI
    queueContainer.classList.remove('hidden');
    queueItems.innerHTML = '';

    // Get selected worker count
    const workerCount = workerCountSelect ? parseInt(workerCountSelect.value) || 2 : 2;

    queueUIItems.forEach((item, idx) => {
        const basename = item.displayPath.split('/').pop() || item.displayPath;

        // Generate worker display divs based on selected count
        let workerDivs = '';
        for (let w = 0; w < workerCount; w++) {
            workerDivs += `<div class="worker-${w}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>`;
        }

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
            <div class="scan-queue-workers" style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                ${workerDivs}
            </div>
        `;
        queueItems.appendChild(div);
    });

    // Set up ClamAV progress listener for parallel workers
    if (window.electronAPI.onClamAVProgress) {
        window.electronAPI.onClamAVProgress((data) => {
            // Find the currently scanning item and update worker display
            const scanningItem = document.querySelector('.scan-queue-item.scanning');
            if (scanningItem && data.file) {
                // Update worker display
                const workerId = data.workerId ?? 0;
                const workerDisplay = scanningItem.querySelector(`.worker-${workerId}`);
                if (workerDisplay) {
                    // Show just the filename, not full path
                    const filename = data.file.split('/').pop() || data.file;
                    workerDisplay.textContent = `⚡${workerId + 1} → ${filename}`;
                    workerDisplay.title = data.file; // Full path on hover
                }

                // Update progress bar based on file count (not animation)
                if (data.scanned && data.total > 0) {
                    const progressFill = scanningItem.querySelector('.scan-queue-progress-fill');
                    if (progressFill) {
                        const percent = Math.round((data.scanned / data.total) * 100);
                        progressFill.style.width = `${percent}%`;
                    }

                    // Update status to show count
                    const status = scanningItem.querySelector('.scan-queue-status');
                    if (status) {
                        status.textContent = `${data.scanned}/${data.total} files`;
                    }
                }
            }
        });
    }

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
                // Show which folder with ClamAV indicator if applicable
                const folderName = mainPath.split('/').pop() || mainPath;
                uiItem.querySelector('.scan-queue-status').textContent = 'Enumerating files...';

                // Reset progress bar (will be updated by file-count callback)
                const progressFill = uiItem.querySelector('.scan-queue-progress-fill');
                progressFill.style.width = '0%';

                // Get paths for this item
                const itemPaths = item.pathData.includes(',')
                    ? item.pathData.split(',').map(p => p.trim())
                    : [item.pathData];

                try {
                    // Scan this item with selected worker count
                    const result = await window.electronAPI.scanThreats(itemPaths, workerCount);

                    // Ensure 100% on complete
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
                        // Clear worker displays
                        const workersContainer = uiItem.querySelector('.scan-queue-workers');
                        if (workersContainer) workersContainer.innerHTML = '';
                    } else if (result.error) {
                        // Scan failed - likely device removed
                        throw new Error(result.error);
                    }
                } catch (scanError) {
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

            // Unlock worker selector
            const workerSelect = document.getElementById('worker-count-select');
            if (workerSelect) workerSelect.disabled = false;
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

    // Check database status
    await checkDatabaseStatus();

    // Start Item Manager monitoring
    startItemMonitor();
});

// ===== Database Management =====

// Check database status and update UI
async function checkDatabaseStatus() {
    try {
        const status = await window.electronAPI.checkDatabaseStatus();

        // Update card statuses
        const objStatus = document.getElementById('status-objective-see');
        const mbStatus = document.getElementById('status-malwarebytes');
        const clamStatus = document.getElementById('status-clamav-engine');
        const uninstallBtn = document.getElementById('uninstall-db-btn');

        let anyInstalled = false;

        // Objective-See status (with integrity check)
        if (objStatus) {
            if (status.objectiveSee === 'valid') {
                objStatus.textContent = '✓ Downloaded';
                objStatus.style.color = 'var(--safe)';
                anyInstalled = true;
            } else if (status.objectiveSee === 'invalid') {
                objStatus.textContent = '⚠ Corrupted (re-download)';
                objStatus.style.color = 'var(--warning)';
            } else {
                objStatus.textContent = 'Not downloaded';
                objStatus.style.color = 'var(--text-secondary)';
            }
        }

        // MalwareBytes status (with integrity check)
        if (mbStatus) {
            if (status.malwareBytes === 'valid') {
                mbStatus.textContent = '✓ Downloaded';
                mbStatus.style.color = 'var(--safe)';
                anyInstalled = true;
            } else if (status.malwareBytes === 'invalid') {
                mbStatus.textContent = '⚠ Corrupted (re-download)';
                mbStatus.style.color = 'var(--warning)';
            } else {
                mbStatus.textContent = 'Not downloaded';
                mbStatus.style.color = 'var(--text-secondary)';
            }
        }

        // Check ClamAV status with integrity check
        try {
            const clamResult = await window.electronAPI.checkClamAV();
            if (clamStatus) {
                if (clamResult.installed && clamResult.valid) {
                    clamStatus.textContent = '✓ Downloaded';
                    clamStatus.style.color = 'var(--safe)';
                    anyInstalled = true;
                } else if (clamResult.installed && !clamResult.valid) {
                    clamStatus.textContent = '⚠ Corrupted (re-download)';
                    clamStatus.style.color = 'var(--warning)';
                } else {
                    clamStatus.textContent = 'Not downloaded';
                    clamStatus.style.color = 'var(--text-secondary)';
                }
            }
        } catch { }

        // Show/hide Uninstall button
        if (uninstallBtn) {
            if (anyInstalled) {
                uninstallBtn.classList.remove('hidden');
            } else {
                uninstallBtn.classList.add('hidden');
            }
        }
    } catch (err) {
        console.error('[Threats] Failed to check database status:', err);
    }
}

// Update databases (used by Update Database button in header)
async function updateThreatDatabases() {
    const updateBtn = document.querySelector('.btn-update-db');
    if (!updateBtn) return;

    updateBtn.disabled = true;
    const originalText = updateBtn.textContent;
    updateBtn.textContent = 'Updating...';

    try {
        const result = await window.electronAPI.downloadDatabases();

        if (result.success) {
            updateBtn.textContent = '✓ Updated';
            setTimeout(() => {
                updateBtn.textContent = originalText;
                updateBtn.disabled = false;
                checkDatabaseStatus(); // Refresh status
            }, 2000);
        } else {
            alert('Database update failed:\n' + (result.errors?.join('\n') || 'Unknown error'));
            updateBtn.textContent = originalText;
            updateBtn.disabled = false;
        }
    } catch (err) {
        console.error('[Threats] Update error:', err);
        alert('Database update failed: ' + err.message);
        updateBtn.textContent = originalText;
        updateBtn.disabled = false;
    }
}

// Download databases (deprecated - keeping for compatibility)
async function downloadDatabases() {
    await updateThreatDatabases();
}

// Toggle auto-update
async function toggleAutoUpdateDatabases(enabled) {
    try {
        await window.electronAPI.setAutoUpdateDatabases(enabled);
        console.log('[Threats] Auto-update set to:', enabled);
    } catch (err) {
        console.error('[Threats] Failed to set auto-update:', err);
    }
}

// Uninstall all databases
async function uninstallDatabases() {
    if (!confirm('Uninstall all threat databases?\n\nThis will remove:\n• Objective-See signatures\n• MalwareBytes YARA rules\n• ClamAV Engine & definitions\n\nYou will need to download again to scan.')) {
        return;
    }

    const btn = document.getElementById('uninstall-db-btn');
    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
        const result = await window.electronAPI.uninstallDatabases();

        if (result.success) {
            // Update all card statuses
            const objStatus = document.getElementById('status-objective-see');
            const mbStatus = document.getElementById('status-malwarebytes');
            const clamStatus = document.getElementById('status-clamav-engine');

            if (objStatus) {
                objStatus.textContent = 'Not downloaded';
                objStatus.style.color = 'var(--text-secondary)';
            }
            if (mbStatus) {
                mbStatus.textContent = 'Not downloaded';
                mbStatus.style.color = 'var(--text-secondary)';
            }
            if (clamStatus) {
                clamStatus.textContent = 'Not downloaded';
                clamStatus.style.color = 'var(--text-secondary)';
            }

            // Hide Uninstall button since nothing is installed now
            btn.classList.add('hidden');
            btn.disabled = false;
            btn.textContent = 'Uninstall';

            alert(`Databases ${result.useTrash ? 'moved to Trash' : 'deleted'}.\n\nRestore from Trash if needed.`);
        } else {
            alert('Failed to uninstall: ' + result.error);
            btn.disabled = false;
            btn.textContent = 'Uninstall';
        }
    } catch (err) {
        console.error('[Threats] Uninstall error:', err);
        alert('Uninstall failed: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Uninstall';
    }
}

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
