// @ts-nocheck
// Send Manager UI - Handles Sharing History/Queue
// COMPLETELY SEPARATE from Receive Manager
// DO NOT MODIFY THIS FILE FOR RECEIVE LOGIC
class SendManagerUI {
    constructor() {
        this.history = [];
        this.removedIds = new Set(); // Track removed IDs to prevent zombie items from polling
        this.hasRestored = false;  // Prevent saving before restore completes
        this.fileExistsCache = {}; // path -> boolean
        this.fileHashCache = {}; // path -> hash (for update detection)
        this.fileSnapshots = {}; // itemId -> { files: { path: hash }, isFolder, folderPath }
        this.fileChanges = {}; // itemId -> { deleted: [], updated: [], newFiles: [], hasChanges: bool }
        this.isNewTicket = {}; // itemId -> boolean (true if ticket just regenerated)
        this.isReSharing = {}; // itemId -> boolean (prevent re-share loop)
        this.intendedFilesMap = {}; // itemId -> string[] (Persisted original file list)
        this.ticketCopiedMap = {}; // itemId -> boolean
        this.rezipErrors = {}; // itemId -> { time: number, error: string } (Backoff tracker)
        this.fileMonitorInterval = null;
        // Wait for DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        }
        else {
            this.init();
        }
    }
    init() {
        // Poll for containers availability
        const checkContainer = setInterval(() => {
            const sendContent = document.getElementById('tf-send-content');
            if (sendContent) {
                // Determine if we need to inject our table
                this.renderManager(sendContent);
                // Start polling status
                if (!this.pollingStarted) {
                    this.pollingStarted = true;
                    // Restore saved state FIRST before any polling
                    this.restoreState();
                    // Then start polling loop
                    setInterval(() => this.poll(), 1000);
                    // Start file existence monitor (every 2 seconds)
                    this.startFileMonitor();
                }
            }
        }, 1000); // Check every second
    }
    renderManager(container) {
        const id = 'tf-manager-send';
        if (document.getElementById(id))
            return; // Already exists
        // Create container (Green Table)
        const historyDiv = document.createElement('div');
        historyDiv.id = id;
        historyDiv.style.marginTop = '2rem';
        historyDiv.style.border = '2px solid #10b981'; // Green border
        historyDiv.style.borderRadius = '8px';
        historyDiv.style.overflow = 'hidden'; // clip corners
        historyDiv.style.background = 'var(--bg-secondary)';
        // Title
        historyDiv.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-bottom: 2px solid #10b981; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="font-size: 0.95rem; color: #10b981; margin: 0; font-weight: 600;">Sharing History</h3>
                <span id="tf-status-send" style="font-size: 0.75rem; color: #10b981; font-weight: 500;">Idle</span>
            </div>
            <div style="width: 100%; max-height: 400px; overflow-y: auto; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;" id="tf-table-send">
                    <thead style="background: #1e1e1e; color: var(--text-secondary); text-align: left; position: sticky; top: 0; z-index: 10;">
                        <tr>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; width: 40%; background: #1e1e1e;">Items List</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; background: #1e1e1e;">Status</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; background: #1e1e1e;">Ticket + Info</th>
                            <th style="padding: 10px; border-bottom: 2px solid #10b981; text-align: center; background: #1e1e1e;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="tf-tbody-send">
                        <tr><td colspan="4" style="padding: 1rem; text-align: center; color: var(--text-muted);">No items</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(historyDiv);
    }
    async poll() {
        // Only poll if tab is potentially visible
        if (!document.getElementById('tf-send-content'))
            return;
        try {
            const statusList = await window.electronAPI.transferStatus();
            // Backend now returns array of sessions
            if (Array.isArray(statusList)) {
                this.update(statusList);
            }
            else {
                // Should not happen with new backend, but safety first
                this.update([statusList]);
            }
        }
        catch (e) {
            // console.error(e);
        }
    }
    update(statusList) {
        // STRICT SYNC: The backend is the source of truth.
        // But we must filter out items the user has actively removed (ignore backend zombie state)
        const activeItems = (statusList || []).filter(item => !this.removedIds.has(item.id) && item.mode === 'send');

        const newHistory = activeItems.map(item => {
            // Initialize intended files map if new
            if (!this.intendedFilesMap[item.id]) {
                const files = Array.isArray(item.originalFiles) ? item.originalFiles : [item.originalFiles || item.filename];
                this.intendedFilesMap[item.id] = files.filter(f => f && typeof f === 'string');
            }

            // Override with intended files (to keep missing files visible)
            item.originalFiles = this.intendedFilesMap[item.id];

            // Sync ticket copied state
            if (this.ticketCopiedMap[item.id] !== undefined) {
                item.ticketCopied = this.ticketCopiedMap[item.id];
            }

            return item;
        });

        // Only render if data actually changed
        const oldKey = JSON.stringify(this.history.map(h => ({ id: h.id, status: h.status, ticket: h.ticket, transferred: h.transferred, progress: h.progress })));
        const newKey = JSON.stringify(newHistory.map(h => ({ id: h.id, status: h.status, ticket: h.ticket, transferred: h.transferred, progress: h.progress })));

        this.history = newHistory;

        if (oldKey !== newKey) {
            this.renderTable();
        }

        // Save state after each update (only if restore has completed)
        if (this.hasRestored) {
            this.saveCurrentState();
        }
    }

    // ===== State Persistence =====
    async restoreState() {
        if (this.isRestoring) return;
        this.isRestoring = true;

        // Collect all folder paths from saved state for UI existence check
        const allFolderPathsFromState = [];

        try {
            const state = await window.electronAPI.transferLoadSharing();
            if (state && state.sharing && state.sharing.length > 0) {
                console.log('[SendManager] Restoring', state.sharing.length, 'shares from saved state');
                const restoredCount = state.sharing.length;

                // Re-queue each saved share session by calling backend
                for (const savedItem of state.sharing) {
                    // Collect folder paths for UI check
                    if (savedItem.sourceFolderPath) {
                        const paths = Array.isArray(savedItem.sourceFolderPath) ? savedItem.sourceFolderPath : [savedItem.sourceFolderPath];
                        allFolderPathsFromState.push(...paths);
                    }

                    if (savedItem.files && savedItem.files.length > 0) {
                        try {
                            const validFiles = savedItem.files.filter(f => f && typeof f === 'string' && f.trim() !== '');
                            if (validFiles.length > 0) {
                                // Filter only existing files for backend, but keep all for UI
                                const existingFiles = [];
                                for (const f of validFiles) {
                                    const check = await window.electronAPI.pathExists(f);
                                    // CRITICAL FIX: Populate cache immediately so UI shows badges for missing files
                                    this.fileExistsCache[f] = check && check.exists;
                                    if (check && check.exists) existingFiles.push(f);
                                }

                                // ALWAYS restore - even if no files exist currently
                                // This keeps item in UI with "don't exist" badges for tracking
                                // Use existingFiles if any, otherwise use validFiles (backend will handle)
                                const filesToSend = existingFiles.length > 0 ? existingFiles : validFiles;

                                // Call backend to re-share
                                // CRITICAL: Use saved forceZip from state, not recalculated!
                                const options = {
                                    forceZip: savedItem.forceZip,  // Use saved value!
                                    sourceFolderPath: savedItem.sourceFolderPath
                                };
                                const result = await window.electronAPI.transferSend(filesToSend, options);
                                console.log('[SendManager] Restored share, id:', result.id, 'existingFiles:', existingFiles.length, '/', validFiles.length);

                                // Map NEW ID to OLD metadata
                                // Critical: Store the FULL validFiles list as Intended Files
                                this.intendedFilesMap[result.id] = validFiles;

                                // NEW ticket created → reset ticketCopied to false (not copied yet)
                                // Don't inherit old value - this is a NEW ticket!
                                this.ticketCopiedMap[result.id] = false;

                                // Mark as new ticket until user copies
                                if (result.success) {
                                    this.isNewTicket[result.id] = true;
                                }
                            }
                        } catch (e) {
                            console.error('[SendManager] Failed to restore share:', e);
                        }
                    }
                }

                // DO NOT clear saved state here. 
                // Let the next update() cycle overwrite it with new active items naturally.
                // This ensures that if app crashes immediately, we still have the old state to retry.

                // Show popup about ticket update
                if (restoredCount > 0) {
                    setTimeout(() => {
                        alert(`${restoredCount} sharing session(s) restored.\n\n⚠️ NEW TICKETS have been generated.\nPlease share the new tickets with receivers.`);
                    }, 2000);
                }
            }
        } catch (e) {
            console.error('[SendManager] Failed to restore state:', e);
        }
        // Mark restore as complete - saveCurrentState can now run
        this.hasRestored = true;

        // Immediately check folder existence for UI badges using collected paths
        if (allFolderPathsFromState.length > 0) {
            this.checkFolderExistenceForUI(allFolderPathsFromState);
        }
    }

    // Quick check of folder existence for UI display (doesn't trigger changes, just populates cache)
    async checkFolderExistenceForUI(folderPaths = null) {
        const pathsToCheck = folderPaths || [];

        // If no paths provided, try to get from history
        if (pathsToCheck.length === 0) {
            for (const item of this.history) {
                if (item.mode !== 'send') continue;
                const sourceFolders = item.sourceFolderPath;
                if (!sourceFolders) continue;
                const paths = Array.isArray(sourceFolders) ? sourceFolders : [sourceFolders];
                pathsToCheck.push(...paths);
            }
        }

        for (const folderPath of pathsToCheck) {
            const check = await window.electronAPI.transferGetFolderContents(folderPath);
            this.fileExistsCache[folderPath] = check.success;
        }
        this.renderTable();
    }

    async saveCurrentState() {
        try {
            // Debug: Log all history items
            // console.log('[SendManager] saveCurrentState - history count:', this.history.length,
            //    'items:', this.history.map(h => ({ id: h.id, mode: h.mode, status: h.status })));

            // Filter: keep all shares EXCEPT cancelled
            // NOTE: Unlike Receive, Share should persist even after 'completed' (receiver downloaded)
            // User can continue sharing until they explicitly Cancel
            const sendItems = this.history.filter(h =>
                h.status !== 'cancelled'
            );

            // console.log('[SendManager] Filtered items:', sendItems.length);

            // State loading not needed for partial save
            // const state = await window.electronAPI.transferLoadState();

            // ALWAYS overwrite saved sharing state with current items (even if empty)
            const sharingToSave = sendItems.map(item => {
                const rawFiles = Array.isArray(item.originalFiles) ? item.originalFiles : [item.originalFiles];
                // Sanitize files
                const cleanFiles = rawFiles.filter(f => f && typeof f === 'string' && f.trim() !== '');

                return {
                    id: item.id,
                    files: cleanFiles,
                    oldTicket: item.ticket || '',
                    ticketCopied: item.ticketCopied || false, // Persist badge display state
                    sourceFolderPath: item.sourceFolderPath, // Persist folder monitoring info
                    forceZip: item.forceZip, // Persist Zip preference (true/false/undefined)
                    createdAt: new Date().toISOString()
                };
            }).filter(item => item.files.length > 0); // Only save items with valid files

            // Use PARTIAL update to avoid overwriting Receiving state
            // console.log('[SendManager] Saving', sharingToSave.length, 'items to state (Partial Update)');
            await window.electronAPI.transferSaveSharing(sharingToSave);
        } catch (e) {
            console.error('[SendManager] saveCurrentState error:', e);
        }
    }
    async removeTransfer(id) {
        // Optimistic UI update: Remove locally first for instant feel
        const index = this.history.findIndex(x => x.id === id);
        if (index !== -1) {
            this.history.splice(index, 1);
            this.renderTable();
        }

        // Update saved state to reflect removal immediately (BEFORE backend call)
        if (this.hasRestored) {
            this.saveCurrentState(); // Fire and forget (or await if critical, but we want speed)
        }

        // Add to removed blacklist so polling doesn't bring it back
        this.removedIds.add(id);

        // Call backend to actually remove (and stop if running)
        await window.electronAPI.transferRemove(id);
    }

    // ===== File Existence Monitoring =====
    startFileMonitor() {
        if (this.fileMonitorInterval) return; // Already running
        console.log('[SendManager] Starting file existence monitor...');

        // Initial check
        this.checkAllFilesExistence();

        // Check every 5 seconds (reduced from 2s to lower CPU usage)
        this.fileMonitorInterval = setInterval(() => {
            this.checkAllFilesExistence();
        }, 5000);
    }

    async checkAllFilesExistence() {
        let hasAnyChanges = false;

        for (const item of this.history) {
            if (item.mode !== 'send') continue;
            if (this.isReSharing[item.id]) continue; // Skip if already re-sharing

            const itemId = item.id;
            const rawFiles = Array.isArray(item.originalFiles) ? item.originalFiles : [item.originalFiles || item.filename];
            const files = rawFiles.filter(f => f && typeof f === 'string');

            // Detect if this is a folder share: Check sourceFolderPath (set by backend for pre-zipped folders)
            // sourceFolderPath can be string (single folder) or array (multi-folder)
            const rawSourceFolder = item.sourceFolderPath;
            const isFolder = !!rawSourceFolder;
            // Normalize to array of folder paths
            const folderPaths = isFolder
                ? (Array.isArray(rawSourceFolder) ? rawSourceFolder : [rawSourceFolder])
                : [];

            // DEBUG: Log to trace sourceFolderPath
            // console.log('[SendManager] Item:', itemId, 'sourceFolderPath:', rawSourceFolder, 'isFolder:', isFolder);

            // Initialize changes for this item
            if (!this.fileChanges[itemId]) {
                this.fileChanges[itemId] = { deleted: [], updated: [], newFiles: [], hasChanges: false };
            }

            // Initialize snapshot if not exists
            if (!this.fileSnapshots[itemId]) {
                // For folder share, pass the source folder paths for monitoring
                const snapshotFiles = isFolder ? folderPaths : files;
                // console.log('[SendManager] Capturing initial snapshot for:', itemId, 'files:', snapshotFiles.length);
                await this.captureSnapshot(itemId, snapshotFiles, isFolder);
                continue; // Skip change detection on first run
            }

            const snapshot = this.fileSnapshots[itemId];
            const changes = { deleted: [], updated: [], newFiles: [], hasChanges: false };

            if (isFolder && snapshot.folderPath) {
                // FOLDER SHARE: Scan folder contents
                // For now, only support single folder monitoring (first folder) for CHANGE DETECTION
                // But check ALL folders for UI badge display
                const monitorPath = Array.isArray(snapshot.folderPath) ? snapshot.folderPath[0] : snapshot.folderPath;
                const allFolderPaths = Array.isArray(snapshot.folderPath) ? snapshot.folderPath : [snapshot.folderPath];

                // Check existence of ALL folders for UI badge display (separate from change detection)
                for (const folderPath of allFolderPaths) {
                    const folderCheck = await window.electronAPI.transferGetFolderContents(folderPath);
                    this.fileExistsCache[folderPath] = folderCheck.success;
                }

                // Check if previously deleted folder is now restored
                if (this.folderDeletedMap && this.folderDeletedMap[itemId]) {
                    // Check if the monitored folder now exists
                    const monitorCheck = await window.electronAPI.transferGetFolderContents(monitorPath);
                    if (monitorCheck.success) {
                        // Folder restored! Clear the deleted flag and recapture snapshot
                        console.log('[SendManager] ✅ FOLDER RESTORED:', monitorPath);
                        delete this.folderDeletedMap[itemId];
                        // Recapture snapshot for the restored folder
                        await this.captureSnapshot(itemId, allFolderPaths, true);
                        // Trigger re-share to update ticket
                        changes.newFiles.push(monitorPath);
                    } else {
                        // Still deleted, skip further processing
                        continue;
                    }
                }

                const currentContents = await window.electronAPI.transferGetFolderContents(monitorPath);

                // If folder itself completely gone?
                if (!currentContents.success) {
                    // Only log ONCE for this deletion
                    if (!this.folderDeletedMap) this.folderDeletedMap = {};
                    if (!this.folderDeletedMap[itemId]) {
                        this.folderDeletedMap[itemId] = true;
                        console.log('[SendManager] ⚠️ FOLDER DELETED:', monitorPath);

                        // Mark ONLY the deleted folder path as not existing
                        // Other folders already have correct state from the check above
                        this.fileExistsCache[monitorPath] = false;

                        // Mark all files as deleted
                        for (const filePath of Object.keys(snapshot.files)) {
                            changes.deleted.push(filePath);
                            this.fileExistsCache[filePath] = false;
                        }
                    }
                } else {
                    const currentFiles = currentContents.files || {};
                    const savedFiles = snapshot.files || {};

                    // DEBUG SAFETY
                    console.log(`[SendManager] checkAllFilesExistence Item ${itemId}:`, {
                        monitorPath,
                        currentFilesKeys: Object.keys(currentFiles),
                        savedFilesKeys: Object.keys(savedFiles)
                    });

                    // Check for deleted and updated files (Compare Snapshot vs Current)
                    for (const [filePath, savedData] of Object.entries(savedFiles)) {
                        try {
                            // Explicit safety check for currentFiles
                            if (!currentFiles || !currentFiles[filePath]) {
                                changes.deleted.push(filePath);
                                if (this.fileExistsCache) this.fileExistsCache[filePath] = false;
                            } else if (currentFiles[filePath].hash !== savedData.hash) {
                                changes.updated.push(filePath);
                                if (this.fileHashCache) this.fileHashCache[filePath] = currentFiles[filePath].hash;
                            } else {
                                if (this.fileExistsCache) this.fileExistsCache[filePath] = true;
                            }
                        } catch (err) {
                            console.error('[SendManager] CRITICAL ERROR checking file:', filePath, err);
                        }
                    }

                    // Check for new files
                    for (const filePath of Object.keys(currentFiles)) {
                        // Explicit safety check for savedFiles
                        if (!savedFiles || !savedFiles[filePath]) {
                            changes.newFiles.push(filePath);
                            if (this.fileExistsCache) this.fileExistsCache[filePath] = true;
                        }
                    }
                }
            } else {
                // FILE SHARE: Check each file individually (Intended Files vs Snapshot)
                for (const filePath of files) {
                    const inSnapshot = !!snapshot.files[filePath];

                    try {
                        const hashResult = await window.electronAPI.transferGetFileHash(filePath);

                        if (hashResult.success) {
                            // File Exists
                            this.fileExistsCache[filePath] = true;

                            if (!inSnapshot) {
                                // Was missing/new -> RESTORED/NEW
                                changes.newFiles.push(filePath);
                                // Update cache for next snapshot capture
                                this.fileHashCache[filePath] = hashResult.hash;
                            } else if (hashResult.hash !== snapshot.files[filePath].hash) {
                                // Exists in snapshot, hash changed -> UPDATED
                                changes.updated.push(filePath);
                                this.fileHashCache[filePath] = hashResult.hash;
                            }
                        } else {
                            // File Missing
                            this.fileExistsCache[filePath] = false;

                            if (inSnapshot) {
                                // Existed in snapshot, now gone -> DELETED
                                changes.deleted.push(filePath);
                            }
                            // If !inSnapshot (was missing), and still missing -> NO CHANGE
                        }
                    } catch (e) {
                        // Error checking? Assume no change to be safe
                        this.fileExistsCache[filePath] = inSnapshot;
                    }
                }
            }

            changes.hasChanges = changes.deleted.length > 0 || changes.updated.length > 0 || changes.newFiles.length > 0;
            this.fileChanges[itemId] = changes;

            if (changes.hasChanges) {
                hasAnyChanges = true;
                // Clean, readable change log
                const parts = [];
                if (changes.deleted.length > 0) parts.push(`🗑️ ${changes.deleted.length} deleted`);
                if (changes.updated.length > 0) parts.push(`✏️ ${changes.updated.length} updated`);
                if (changes.newFiles.length > 0) parts.push(`➕ ${changes.newFiles.length} new`);
                console.log(`[SendManager] 🔄 Item ${itemId}: ${parts.join(', ')}`);

                // Trigger auto re-share
                await this.autoReShare(itemId, changes);
            }
        }

        // Re-render if any changes
        if (hasAnyChanges) {
            this.renderTable();
            if (this.hasRestored) {
                this.saveCurrentState();
            }
        }
    }

    async isDirectory(filePath) {
        try {
            const result = await window.electronAPI.transferIsDirectory(filePath);
            return result?.isDirectory ?? false;
        } catch (e) {
            return false;
        }
    }

    async captureSnapshot(itemId, files, isFolder) {
        // files is the array of paths to monitor.
        // For folder share, simple single folder or array of folders.
        // Store the FULL source (array or string) in snapshot to preserve it for re-sharing.
        const folderPath = isFolder ? files : null;
        const snapshot = { files: {}, isFolder, folderPath };

        // console.log('[SendManager] captureSnapshot called:', itemId, 'isFolder:', isFolder, 'folderPath:', folderPath);

        if (isFolder && folderPath) {
            // Scan content. Validate path.
            // Support scanning the first folder if it's an array (Primary folder monitoring)
            const monitorPath = Array.isArray(folderPath) ? folderPath[0] : folderPath;

            if (monitorPath && typeof monitorPath === 'string') {
                const contents = await window.electronAPI.transferGetFolderContents(monitorPath);
                // console.log('[SendManager] Folder scan result:', monitorPath, 'success:', contents.success, 'files:', contents.files ? Object.keys(contents.files).length : 0);
                if (contents.success) {
                    for (const [filePath, data] of Object.entries(contents.files)) {
                        snapshot.files[filePath] = { hash: data.hash, size: data.size, mtime: data.mtime };
                        this.fileExistsCache[filePath] = true;
                        this.fileHashCache[filePath] = data.hash;
                    }
                }
            }
        } else {
            // For individual files
            for (const filePath of files) {
                try {
                    const hashResult = await window.electronAPI.transferGetFileHash(filePath);
                    if (hashResult.success) {
                        snapshot.files[filePath] = { hash: hashResult.hash, size: hashResult.size, mtime: hashResult.mtime };
                        this.fileExistsCache[filePath] = true;
                        this.fileHashCache[filePath] = hashResult.hash;
                    } else {
                        // Explicitly mark as not existing if hash fails
                        this.fileExistsCache[filePath] = false;
                    }
                } catch (e) {
                    // Start or permission error -> mark as missing/inaccessible
                    this.fileExistsCache[filePath] = false;
                }
            }
        }

        this.fileSnapshots[itemId] = snapshot;
        // console.log('[SendManager] Captured snapshot for item:', itemId, 'files:', Object.keys(snapshot.files).length);
    }

    async autoReShare(itemId, changes) {
        if (this.isReSharing[itemId]) return;
        this.isReSharing[itemId] = true;

        console.log('[SendManager] Auto re-sharing item:', itemId);

        // CHECK BACKOFF (Prevent infinite loop on Zip failure e.g. Disk Full)
        const lastError = this.rezipErrors[itemId];
        if (lastError && (Date.now() - lastError.time < 30000)) {
            console.warn('[SendManager] Skipping auto-reshare due to recent failure (Backoff active):', lastError.error);
            this.isReSharing[itemId] = false;
            return;
        }

        try {
            // Find the item
            const item = this.history.find(h => h.id === itemId);
            if (!item) {
                this.isReSharing[itemId] = false;
                return;
            }

            const snapshot = this.fileSnapshots[itemId];

            // Track old zip path for cleanup
            // CRITICAL FIX: For zip mode, the actual zip path is in item.filename (the generated zip)
            // NOT in item.originalFiles (which contains the source files)
            let oldZipPath = null;
            if (item.filename && typeof item.filename === 'string' && item.filename.endsWith('.zip')) {
                // item.filename is the zip path (e.g. /Users/.../transfer/sender/xxx.zip)
                oldZipPath = item.filename;
            } else if (item.originalFiles && typeof item.originalFiles === 'string' && item.originalFiles.endsWith('.zip')) {
                oldZipPath = item.originalFiles;
            } else if (Array.isArray(item.originalFiles) && item.originalFiles[0]?.endsWith?.('.zip')) {
                oldZipPath = item.originalFiles[0];
            }

            // Build new file list: existing + new - deleted
            let newFileList = [];
            let options = {};

            if (snapshot.isFolder && snapshot.folderPath) {
                // For folder share: RE-ZIP the folder with updated contents
                // folderPath can be string or array - extract first path for zipping
                // folderPath can be string or array - extract proper source
                const zipSourcePath = snapshot.folderPath; // Pass the whole structure! Backend now handles Arrays.
                console.log('[SendManager] Re-zipping folder for re-share:', zipSourcePath);

                // SAFETY CHECK: Ensure source is NOT a zip file (recursion prevention)
                const isSourceZip = Array.isArray(zipSourcePath)
                    ? zipSourcePath.some(p => p.endsWith('.zip'))
                    : (zipSourcePath && zipSourcePath.endsWith('.zip'));

                if (isSourceZip) {
                    console.error('[SendManager] ❌ CRITICAL: Source path detected as ZIP file! Aborting re-zip to prevent recursion.', zipSourcePath);
                    this.isReSharing[itemId] = false;
                    return;
                }

                // USER REQUEST: Delete old ZIP *BEFORE* creating new one
                // SAFETY: Check if any OTHER item is using this zip file before deleting.
                if (oldZipPath) {
                    const isUsedByOther = this.history.some(h => {
                        if (h.id === itemId) return false; // Skip self
                        const files = Array.isArray(h.originalFiles) ? h.originalFiles : [h.originalFiles];
                        return files.includes(oldZipPath);
                    });

                    if (isUsedByOther) {
                        console.warn('[SendManager] ⚠️ Skipping delete of old zip because it is used by another transfer:', oldZipPath);
                    } else {
                        try {
                            console.log('[SendManager] Deleting old ZIP before re-zip (Safe):', oldZipPath);
                            await window.electronAPI.transferDeleteFile(oldZipPath);
                        } catch (e) {
                            // Ignore deletion errors (file might be gone/busy)
                            console.warn('[SendManager] Warning: Failed to delete old zip:', e);
                        }
                    }
                }

                // --- DEBUG PROBE START ---
                // Logic Fix: Only apply Test Mode to NEW transfers or if we are explicitly testing fallback on this item.
                // If item.forceZip is explicitly false (from history), respect it.
                // If item.forceZip is true (default), try to Zip.

                // kw: Declare inheritedForceZip before use
                let zipResult = { success: false }; // Init default

                // Inherit forceZip from previous session history if available
                const previousForceZip = item.forceZip !== undefined ? item.forceZip : true;

                if (previousForceZip === false) {
                    // CASE: Originally No-Zip (e.g. from Test Mode or future "No Zip" checkbox)
                    // Skip Zip entirely.
                    zipResult = { success: false, simulated: true, inheritedNoZip: true };
                } else {
                    // CASE: Originally Zipped. Try to Zip again.
                    // Apply Test Mode ONLY if we want to simulate failure on a Zipped item
                    if (window.FORCE_NO_ZIP_TEST) {
                        console.warn('[SendManager] 🧪 DEBUG: Simulating Zip Failure (Test Mode Active)');
                        zipResult = { success: false, error: 'Simulated Logic Failure' };
                    } else {
                        zipResult = await window.electronAPI.transferZipFolder(zipSourcePath);
                    }
                }
                // --- DEBUG PROBE END ---

                if (zipResult.success && zipResult.zipPath) {
                    // ZIP SUCCESS
                    newFileList = [zipResult.zipPath];
                    options.forceZip = true; // Confirm it's zipped
                    if (this.rezipErrors[itemId]) delete this.rezipErrors[itemId];
                } else {
                    // ZIP FAILED or SKIPPED -> FALLBACK TO RAW TRANSFER
                    // If it was skipped due to inheritedNoZip, it's not an error.
                    if (!zipResult.inheritedNoZip) {
                        const errMsg = zipResult.error || 'Unknown Zip Error';
                        console.warn(`[SendManager] ⚠️ Re-zip failed/skipped ('${errMsg}'). Falling back to RAW transfer.`);
                    } else {
                        console.log('[SendManager] ℹ️ Staying in No-Zip mode (Inherited).');
                    }

                    // Fallback: Send the folder path directly
                    // CRITICAL FIX: If snapshot.folderPath is an array (multi-folder), pass the whole array!
                    // Previously we only passed zipSourcePath (folderPath[0]), leading to lost folders.
                    newFileList = Array.isArray(snapshot.folderPath) ? snapshot.folderPath : [snapshot.folderPath];
                    options.forceZip = false; // Important: Tell backend to use Batch Layout

                    // Clear error since we handled it gracefully
                    if (this.rezipErrors[itemId]) delete this.rezipErrors[itemId];
                }

                options.sourceFolderPath = snapshot.folderPath; // Keep original array/string for monitoring

                // Note: Old zip deletion handled at start of block now.
            } else {
                // For file share: existing files + new - deleted
                const existing = Object.keys(snapshot.files).filter(f => !changes.deleted.includes(f));
                newFileList = [...existing, ...changes.newFiles];
            }

            // STEP 1: Kill old share process
            console.log('[SendManager] Killing old share process:', itemId);
            await window.electronAPI.transferRemove(itemId);

            // STEP 2: Delete old zip if exists
            if (oldZipPath) {
                const isUsedByOther = this.history.some(h => {
                    if (h.id === itemId) return false;
                    const files = Array.isArray(h.originalFiles) ? h.originalFiles : [h.originalFiles];
                    return files.includes(oldZipPath);
                });

                if (!isUsedByOther) {
                    try {
                        console.log('[SendManager] Deleting old ZIP:', oldZipPath);
                        await window.electronAPI.transferDeleteFile(oldZipPath);
                    } catch (e) {
                        console.warn('[SendManager] Warning: Failed to delete old zip:', e);
                    }
                }
            }

            // STEP 3: Reshare - even if no files, try anyway
            // If no files exist, backend will fail to create ticket - that's OK
            if (newFileList.length === 0) {
                console.log('[SendManager] No files to reshare, but keeping item in tracking');
                // Use intendedFilesMap as the file list to monitor
                newFileList = this.intendedFilesMap[itemId] || [];
            }

            // Force Zip logic for Multi-File (Non-Folder) shares logic override?
            // If it was a multi-file share originally, we usually force zip.
            // But if forceZip was explicitly false, we should respect it?
            const wasMultiFile = this.intendedFilesMap[itemId] && this.intendedFilesMap[itemId].length > 1;

            // If options.forceZip is ALREADY set by logic above (folder logic), keep it.
            // If not set, check multi-file logic.
            if (options.forceZip === undefined) {
                if (wasMultiFile) {
                    // If we previously had forceZip: false, keep it.
                    if (item.forceZip === false) {
                        options.forceZip = false;
                    } else {
                        // Default multi-file is Zip.
                        // Check Test Mode for new decision? No, stick to history if available or default true.
                        options.forceZip = true;

                        // BUT wait, if valid files > 1 and we are in Test Mode for *re-share* of multi-file?
                        // Let's rely on item.forceZip primarily.
                    }
                }
            }

            const result = await window.electronAPI.transferSend(newFileList, options);
            if (result.success) {
                const newId = result.id;

                // Transfer intended files to new ID
                if (snapshot.isFolder) {
                    this.intendedFilesMap[newId] = newFileList;
                } else {
                    this.intendedFilesMap[newId] = this.intendedFilesMap[itemId];
                }

                // Reset ticket copied state
                this.ticketCopiedMap[newId] = false;

                // Mark new ticket
                this.isNewTicket[newId] = true;

                // Initialize fileChanges
                this.fileChanges[newId] = { deleted: [], updated: [], newFiles: [], hasChanges: true };

                // Inherit Source Folder Path properly if it wasn't passed in options?
                // transferSend usually sets it on the item.

                // RE-CAPTURE SNAPSHOT
                const snapshotPath = snapshot.isFolder ? snapshot.folderPath : newFileList;
                await this.captureSnapshot(newId, snapshotPath, snapshot.isFolder);

                // Clear old tracking
                delete this.fileSnapshots[itemId];
                delete this.fileChanges[itemId];
                delete this.intendedFilesMap[itemId];
                delete this.ticketCopiedMap[itemId];
                delete this.isNewTicket[itemId];
                delete this.isReSharing[itemId];

                // Remove old ID from history
                this.history = this.history.filter(h => h.id !== itemId);

                console.log('[SendManager] Re-shared successfully, old ID:', itemId, 'new ID:', newId);
            }
        } catch (e) {
            console.error('[SendManager] Auto re-share failed:', e);
        }

        this.isReSharing[itemId] = false;
    }

    copyTicket(ticket) {
        if (!ticket)
            return;

        // Find item by ticket and mark as copied (to hide badges)
        const item = this.history.find(h => h.ticket === ticket);
        if (item) {
            item.ticketCopied = true;
            this.ticketCopiedMap[item.id] = true; // Persist state
            this.isNewTicket[item.id] = false; // Clear new ticket badge
            this.fileChanges[item.id] = { deleted: [], updated: [], newFiles: [], hasChanges: false }; // Clear change badges

            // Save state immediately
            if (this.hasRestored) {
                this.saveCurrentState();
            }

            // Re-render to hide badges
            this.renderTable();
        }

        navigator.clipboard.writeText(ticket).then(() => {
            alert('Ticket copied to clipboard!');
        });
    }
    openFolders(foldersBase64) {
        try {
            // Decode base64 and parse JSON
            const foldersJson = atob(foldersBase64);
            const folders = JSON.parse(foldersJson);
            console.log('[SendManager] Opening folders:', folders);
            if (Array.isArray(folders) && folders.length > 0) {
                // Open each unique folder
                folders.forEach(folder => {
                    if (folder) {
                        console.log('[SendManager] Opening folder:', folder);
                        window.electronAPI.shellShowItem(folder);
                    }
                });
            } else {
                console.warn('[SendManager] No valid folders to open');
            }
        } catch (e) {
            console.error('Failed to parse folders:', e, 'Base64:', foldersBase64);
        }
    }
    renderTable() {
        const tbody = document.getElementById('tf-tbody-send');
        const statusSpan = document.getElementById('tf-status-send');
        if (!tbody)
            return;
        const items = this.history.filter(h => h.mode === 'send');
        const activeCount = items.filter(i => i.status === 'active' || i.active).length;
        const queuedCount = items.filter(i => i.status === 'pending').length;
        const statusText = activeCount > 0 ? `${activeCount} Active` : (queuedCount > 0 ? `${queuedCount} Queued` : 'Idle');
        if (statusSpan)
            statusSpan.textContent = statusText;
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding: 1rem; text-align: center; color: var(--text-muted);">No items</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map((item) => {
            // Use ID for actions
            const itemId = item.id;
            let statusText = '';
            let statusColor = '';
            const rowStyle = "border-bottom: 1px solid #444;";
            // FINAL FIX: Check backend isTransferring flag directly
            // Backend sets isTransferring=true when [TRANSFERRED SET] happens
            if (item.isTransferring) {
                statusText = 'Transferring';
                statusColor = '#3b82f6';
            }
            else {
                statusText = 'Sharing';
                statusColor = '#10b981';
            }
            // File Column Logic
            let fileCell = '';
            let rawFiles = item.originalFiles || item.filename;
            let files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

            // For folder shares, use sourceFolderPath for display (shows folder names instead of zip paths)
            const sourceFolders = item.sourceFolderPath;
            const isMultiFolderShare = Array.isArray(sourceFolders) && sourceFolders.length > 1;
            const isSingleFolderShare = !!sourceFolders && !Array.isArray(sourceFolders);

            // If multi-folder share, display folder names instead of zip paths
            if (isMultiFolderShare) {
                files = sourceFolders;
            }

            // Get changes for this item
            const changes = this.fileChanges[item.id] || { deleted: [], updated: [], newFiles: [] };
            const showBadges = !item.ticketCopied; // Only show badges if ticket not copied yet

            // Count files: existing count - deleted + new
            const deletedCount = changes.deleted.length;
            const newCount = changes.newFiles.length;

            const filesList = files.map(f => {
                if (!f)
                    return '';
                const name = f.split('/').pop();
                const exists = this.fileExistsCache[f] !== false;
                const isUpdated = changes.updated.includes(f);
                const isDeleted = changes.deleted.includes(f);

                // Use folder icon for folder shares
                const icon = (isMultiFolderShare || isSingleFolderShare) ? '📁' : '📄';

                // Determine badge (don't exist always shows, others only if not copied)
                let badge = '';
                let opacity = '1';
                if (!exists || isDeleted) {
                    badge = '<span style="color: var(--risky, #ef4444); font-size: 0.75em; margin-left: 6px; font-weight: 500;">⚠️ don\'t exist</span>';
                    opacity = '0.5';
                } else if (isUpdated && showBadges) {
                    badge = '<span style="color: #f59e0b; font-size: 0.75em; margin-left: 6px; font-weight: 500;">🔄 updated</span>';
                }

                const clickHandler = exists ? `window.electronAPI.shellShowItem('${f.replace(/'/g, "\\\\'")}')` : '';
                const cursorStyle = exists ? '' : 'cursor: default; pointer-events: none;';
                return `<div style="margin-bottom: 4px; opacity: ${opacity};">
                    <a href="#" onclick="event.preventDefault(); ${clickHandler}" style="color: var(--text-primary); text-decoration: none; border-bottom: 1px dotted #666; font-size: 0.9rem; ${cursorStyle}">
                        ${icon} ${name}${badge}
                    </a>
                </div>`;
            }).join('');

            // Add new files to display (from folder share)
            let newFilesHtml = '';
            if (showBadges && changes.newFiles.length > 0) {
                newFilesHtml = changes.newFiles.map(f => {
                    const name = f.split('/').pop();
                    return `<div style="margin-bottom: 4px;">
                        <a href="#" onclick="event.preventDefault(); window.electronAPI.shellShowItem('${f.replace(/'/g, "\\\\'")}');" style="color: var(--text-primary); text-decoration: none; border-bottom: 1px dotted #666; font-size: 0.9rem;">
                            📄 ${name}<span style="color: #10b981; font-size: 0.75em; margin-left: 6px; font-weight: 500;">🆕 new</span>
                        </a>
                    </div>`;
                }).join('');
            }

            fileCell = `<div>${filesList}${newFilesHtml}</div>`;

            // Zip row with badge - only for MULTI-FILE shares in ZIP MODE
            // For folder shares or no-zip mode, don't show zip row
            const isMultiFileShare = files.length > 1;
            const isLegacyZip = item.filename && typeof item.filename === 'string' && item.filename.endsWith('.zip') && item.filename !== files[0] && !item.sourceFolderPath;
            const isZipMode = item.forceZip !== false; // Only show zip row if NOT explicitly no-zip mode

            if ((isMultiFileShare || isLegacyZip) && isZipMode) {
                // Check if ALL files in this item don't exist
                const allFilesArr = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
                const validFiles = allFilesArr.filter(f => f && typeof f === 'string');
                const allFilesDontExist = validFiles.length > 0 && validFiles.every(f => this.fileExistsCache[f] === false);

                let zipName = 'Archive.zip';
                let zipBadge = '';

                if (allFilesDontExist) {
                    // All files don't exist -> show Archive.zip with don't exist badge
                    zipName = 'Archive.zip';
                    zipBadge = '<span style="color: var(--risky, #ef4444); font-size: 0.75em; margin-left: 6px; font-weight: 500;">⚠️ don\'t exist</span>';
                } else if (item.filename && typeof item.filename === 'string' && item.filename.endsWith('.zip')) {
                    // At least one file exists -> use original zip name
                    zipName = item.filename.split('/').pop();
                    // Show "new" badge only if showBadges and hasChanges
                    zipBadge = (showBadges && changes.hasChanges) ? '<span style="color: #10b981; font-size: 0.75em; margin-left: 6px; font-weight: 500;">🆕 new</span>' : '';
                } else if (files.length > 1) {
                    // Fallback for partial shares that backend sees as single file
                    zipName = 'Archive.zip';
                    zipBadge = (showBadges && changes.hasChanges) ? '<span style="color: #10b981; font-size: 0.75em; margin-left: 6px; font-weight: 500;">🆕 new</span>' : '';
                }

                fileCell += `<div style="color: #ef4444; font-size: 0.8rem; margin-top: 6px; font-weight: 500;">📦 ${zipName}${zipBadge}</div>`;
            }
            // Ticket + Info Column Logic
            const ticketVal = item.ticket || '';
            const ticketDisplay = ticketVal ? ticketVal.substring(0, 10) + '...' : '...';

            // Dynamic file count: existing - deleted + new
            const existingCount = files.filter(f => f).length;
            const actualCount = existingCount - deletedCount + newCount;

            let size = item.transferred || '';
            if (size === 'Calculating...' || size === 'Waiting...')
                size = '';
            // HIDE SIZE if "Sharing" (Completed/100%)
            if (statusText === 'Sharing') {
                size = ''; // Clear size for final state
            }

            // Ticket badge (new ticket after re-share)
            const ticketBadge = (showBadges && this.isNewTicket[item.id]) ? '<span style="color: #10b981; font-size: 0.75em; margin-left: 6px; font-weight: 500;">🆕 new</span>' : '';

            // === MULTI-RECEIVER PROGRESS DISPLAY (NEW) ===
            // When transferring, show each receiver's progress on separate lines
            let receiversHtml = '';
            const receivers = item.activeReceivers || {};
            const receiverList = Object.entries(receivers);
            if (item.isTransferring && receiverList.length > 0) {
                receiversHtml = receiverList.map(([nodeId, data]: [string, any]) => {
                    return `<div style="font-family: monospace; font-size: 0.7rem; color: #3b82f6; margin-top: 2px;">${nodeId}: ${data.transferred} / ${data.total}</div>`;
                }).join('');
            }

            // Build info section based on transfer state
            let infoSection = '';
            if (item.isTransferring && receiverList.length > 0) {
                // Show receiver list when transferring
                infoSection = `<div style="margin-top: 4px;">${receiversHtml}</div>`;
            } else {
                // Show file count and size (existing behavior)
                infoSection = `<div style="font-size: 0.75rem; color: #888; margin-top: 4px;">
                    ${actualCount} File(s) ${size ? '• ' + size : ''}
                </div>`;
            }

            const ticketCell = `
                <div style="cursor: pointer;" title="Click to Copy Ticket" onclick="window.SendManagerUI_Instance.copyTicket('${ticketVal}')"> 
                    <div style="font-family: monospace; color: var(--text-secondary); font-weight: 500;">${ticketDisplay}${ticketBadge}</div>
                    ${infoSection}
                </div>
            `;
            // Action Column - Cancel Sharing + Open Folder for Send
            // Use first file path for Open Folder (same approach as receive-manager)
            const firstFile = files[0] || '';
            const escapedPath = firstFile.replace(/'/g, "\\'");

            const cancelBtn = `<button onclick="window.SendManagerUI_Instance.removeTransfer('${itemId}')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Cancel Sharing</button>`;
            const openFolderBtn = `<button onclick="window.electronAPI.shellShowItem('${escapedPath}')" style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; color: #10b981; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Open Folder</button>`;

            const actionBtns = `<div style="display: flex; justify-content: center; align-items: center; gap: 8px;">${openFolderBtn}${cancelBtn}</div>`;

            return `
                <tr style="${rowStyle}">
                    <td style="padding: 12px 10px; border-right: 1px solid #444; color: var(--text-primary);">
                         ${fileCell}
                    </td>
                    <td style="padding: 12px 10px; border-right: 1px solid #444; color: ${statusColor};" title="${item.error || ''}">
                        ${statusText}
                    </td>
                    <td style="padding: 12px 10px; border-right: 1px solid #444;">
                        ${ticketCell}
                    </td>
                    <td style="padding: 12px 10px; text-align: center;">
                        ${actionBtns}
                    </td>
                </tr>
            `;
        }).join('');
    }
}
window.SendManagerUI_Instance = new SendManagerUI();
