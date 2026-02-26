// @ts-nocheck
// Receive Manager UI - Handles Receiving History/Queue
// COMPLETELY SEPARATE from Send Manager
// Modifications to this file DO NOT affect Sharing logic
class ReceiveManagerUI {
    constructor() {
        this.history = [];
        this.removedIds = new Set(); // Track removed IDs
        this.hasRestored = false;  // Prevent saving before restore completes
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
            const receiveContent = document.getElementById('tf-receive-content');
            if (receiveContent) {
                // Determine if we need to inject our table
                this.renderManager(receiveContent);
                // Start polling status
                if (!this.pollingStarted) {
                    this.pollingStarted = true;
                    // Restore saved state FIRST before any polling
                    this.restoreState();
                    // Then start polling loop
                    setInterval(() => this.poll(), 1000);
                }
            }
        }, 1000); // Check every second
    }
    renderManager(container) {
        const id = 'tf-manager-receive';
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
                <h3 style="font-size: 0.95rem; color: #10b981; margin: 0; font-weight: 600;">Received History</h3>
                <span id="tf-status-receive" style="font-size: 0.75rem; color: #10b981; font-weight: 500;">Idle</span>
            </div>
            <div style="width: 100%; max-height: 300px; overflow-y: auto; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;" id="tf-table-receive">
                    <thead style="background: #1e1e1e; color: var(--text-secondary); text-align: left; position: sticky; top: 0; z-index: 10;">
                        <tr>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; width: 40%; background: #1e1e1e;">File</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; background: #1e1e1e;">Status</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; background: #1e1e1e;">Ticket + Info</th>
                            <th style="padding: 10px; border-bottom: 2px solid #10b981; text-align: center; background: #1e1e1e;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="tf-tbody-receive">
                        <tr><td colspan="4" style="padding: 1rem; text-align: center; color: var(--text-muted);">No items</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(historyDiv);
    }
    async poll() {
        // Only poll if tab is potentially visible
        if (!document.getElementById('tf-receive-content'))
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
        // UPDATE ONLY: Do NOT add new items from backend automatically
        // New items should only come from restoreState or user input
        // This prevents "ghost resurrection" when backend sessions survive app close

        const backendItems = (statusList || []).filter(item => !this.removedIds.has(item.id) && item.mode === 'receive');

        // Only update items that ALREADY exist in this.history
        // Do NOT add items that are in backend but not in history
        const existingIds = new Set(this.history.map(h => h.id));

        for (const backendItem of backendItems) {
            if (existingIds.has(backendItem.id)) {
                // Update existing item
                const idx = this.history.findIndex(h => h.id === backendItem.id);
                if (idx !== -1) {
                    this.history[idx] = { ...this.history[idx], ...backendItem };
                }
            }
            // If not in existingIds, DO NOT ADD - it's a ghost from backend
        }

        this.renderTable();
        // Save state after each update (only if restore has completed)
        if (this.hasRestored) {
            this.saveCurrentState();
        }
    }

    // ===== State Persistence =====
    async restoreState() {
        if (this.isRestoring) return;
        this.isRestoring = true;

        try {
            const state = await window.electronAPI.transferLoadReceiving();
            if (state && state.receiving && state.receiving.length > 0) {
                // Include all items EXCEPT cancelled (for display/re-queue)
                const allItems = state.receiving.filter(r => r.status !== 'cancelled');
                if (allItems.length === 0) return;

                console.log('[ReceiveManager] Restoring', allItems.length, 'receives from saved state');

                // Get saved receive folder
                const receiveFolder = state.settings?.receiveFolder || null;

                let restoredCount = 0;

                // Re-queue each pending receive ticket (top to bottom)
                for (const savedItem of allItems) {
                    if (savedItem.ticket && typeof savedItem.ticket === 'string' && savedItem.ticket.trim() !== '') {
                        const itemStatus = savedItem.status || savedItem.state || 'pending';

                        // COMPLETED items: Just add to history for display, do NOT re-download
                        // CRITICAL: Only treat as completed if progress is 100% - prevents premature completion bug
                        if (itemStatus === 'completed' && (savedItem.progress || 0) >= 100) {
                            console.log('[ReceiveManager] Showing completed item:', savedItem.filename || savedItem.ticket.substring(0, 20) + '...');
                            this.history.push({
                                id: savedItem.id || 'completed-' + Date.now(),
                                ticket: savedItem.ticket,
                                mode: 'receive',
                                status: 'completed',
                                filename: savedItem.filename || '',
                                progress: 100
                            });
                            continue;
                        }

                        // FAILED items: Just add to history for display, do NOT re-download
                        if (itemStatus === 'failed') {
                            console.log('[ReceiveManager] Showing failed item (no re-download):', savedItem.ticket.substring(0, 20) + '...');
                            this.history.push({
                                id: savedItem.id || 'failed-' + Date.now(),
                                ticket: savedItem.ticket,
                                mode: 'receive',
                                status: 'failed',
                                filename: savedItem.filename || '',
                                progress: savedItem.progress || 0,
                                error: savedItem.error || 'Previously failed'
                            });
                            continue;
                        }

                        // PENDING/ACTIVE items: Re-queue for download
                        try {
                            // Call backend to re-queue receive (same ticket)
                            console.log('[ReceiveManager] Restoring ticket:', savedItem.ticket);
                            const result = await window.electronAPI.transferReceive(savedItem.ticket, receiveFolder);

                            if (result.success && result.id) {
                                // Add to local history with new ID from backend
                                this.history.push({
                                    id: result.id,
                                    ticket: savedItem.ticket,
                                    mode: 'receive',
                                    status: 'pending',
                                    filename: savedItem.filename || '',
                                    progress: 0
                                });
                                restoredCount++;
                            }

                            console.log('[ReceiveManager] Re-queued:', savedItem.ticket.substring(0, 20) + '...');
                        } catch (e) {
                            // Skip failed and continue to next
                            console.error('[ReceiveManager] Failed to restore receive, skipping:', e);
                        }
                    }
                }

                // Render immediately so user sees restored items
                this.renderTable();

                // DO NOT clear saved receives here.
                // Let the backend track them and the next update() cycle sync the state file.
                // This ensures persistence if the app crashes before the first update.

                // Notify user (only if some items were actually re-queued)
                if (restoredCount > 0) {
                    setTimeout(() => {
                        alert(`${restoredCount} receive session(s) restored and queued for download.`);
                    }, 2500);
                }
            }
        } catch (e) {
            console.error('[ReceiveManager] Failed to restore state:', e);
        }
        // Mark restore as complete - saveCurrentState can now run
        this.hasRestored = true;
    }

    async saveCurrentState() {
        try {
            // Debug: Log all history items - backend uses 'state' not 'status'
            // console.log('[ReceiveManager] saveCurrentState - history count:', this.history.length,
            //     'items:', this.history.map(h => ({ id: h.id, mode: h.mode, status: h.status, state: h.state })));

            // Filter: keep all items EXCEPT cancelled
            // Completed and failed items should persist so user can see them in history
            // Backend uses 'state' field, not 'status' - check BOTH for safety
            const receiveItems = this.history.filter(h => {
                const itemState = h.status || h.state || 'pending';  // Use status or state, default to pending
                return itemState !== 'cancelled';
            });

            // console.log('[ReceiveManager] Filtered items:', receiveItems.length);

            // ALWAYS overwrite saved receiving state with current items (even if empty)
            const receivingToSave = receiveItems.map(item => ({
                id: item.id,
                ticket: item.ticket || '',
                status: item.status || item.state || 'pending',
                filename: item.filename || '',
                progress: item.progress || 0,
                createdAt: new Date().toISOString()
            })).filter(item => item.ticket && typeof item.ticket === 'string' && item.ticket.trim() !== '');

            // Use PARTIAL update to avoid overwriting Sharing state
            // console.log('[ReceiveManager] Saving', receivingToSave.length, 'items to state (Partial Update)');
            await window.electronAPI.transferSaveReceiving(receivingToSave);
        } catch (e) {
            console.error('[ReceiveManager] saveCurrentState error:', e);
        }
    }

    async removeTransfer(id) {
        // Optimistic UI update: Remove locally first for instant feel
        const index = this.history.findIndex(x => x.id === id);
        if (index !== -1) {
            this.history.splice(index, 1);
            this.renderTable();
        }

        // Update saved state to reflect removal immediately
        if (this.hasRestored) {
            await this.saveCurrentState();
        }

        // Add to removed blacklist
        this.removedIds.add(id);

        // Call backend to actually remove (and stop if running)
        await window.electronAPI.transferRemove(id);
    }
    copyTicket(ticket) {
        if (!ticket)
            return;
        navigator.clipboard.writeText(ticket).then(() => {
            alert('Ticket copied to clipboard!');
        });
    }
    renderTable() {
        const tbody = document.getElementById('tf-tbody-receive');
        const statusSpan = document.getElementById('tf-status-receive');
        if (!tbody)
            return;
        const items = this.history.filter(h => h.mode === 'receive');
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
            const state = item.status || (item.active ? 'active' : (item.complete ? 'completed' : 'failed'));
            // Receive status logic - show different states
            // Only show "Received" if BOTH state=completed AND progress is very high (>= 98%)
            // This prevents premature "Received" display when backend marks completed too early
            const progress = item.progress || 0;
            if (state === 'completed' && progress >= 98 && !item.isTransferring) {
                statusText = 'Received';
                statusColor = '#10b981'; // Green for completed
            }
            else if (state === 'failed') {
                statusText = 'Failed';
                statusColor = '#ef4444'; // Red for failed
            }
            else {
                // Active, pending, or completed but still transferring
                statusText = `Receiving... ${progress.toFixed(0)}%`;
                statusColor = '#3b82f6'; // Blue for in progress
            }
            // File Column Logic - Show filename or ticket snippet if no filename yet
            let fileCell = '';
            let rawFiles = item.originalFiles || item.filename;
            const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

            // If no filename yet (still receiving), show ticket as placeholder
            if (!files[0] || files[0] === '' || files[0] === undefined) {
                const ticketSnippet = (item.ticket || '').substring(0, 15);
                fileCell = `<div style="color: #888; font-style: italic;">📥 Receiving: ${ticketSnippet}...</div>`;
            } else {
                const filesList = files.map(f => {
                    if (!f) return '';
                    const name = f.split('/').pop();
                    return `<div style="margin-bottom: 4px;">
                            <a href="#" onclick="event.preventDefault(); window.electronAPI.shellShowItem('${f.replace(/'/g, "\\'")}')" style="color: var(--text-primary); text-decoration: none; border-bottom: 1px dotted #666; font-size: 0.9rem;">
                                📄 ${name}
                            </a>
                        </div>`;
                }).join('');
                fileCell = `<div>${filesList}</div>`;
                if (files.length > 1 || (item.filename && typeof item.filename === 'string' && item.filename.endsWith('.zip') && item.filename !== files[0])) {
                    const zipName = typeof item.filename === 'string' ? item.filename.split('/').pop() : 'Archive.zip';
                    fileCell += `<div style="color: #ef4444; font-size: 0.8rem; margin-top: 6px; font-weight: 500;">📦 ${zipName}</div>`;
                }
            }
            // Ticket + Info Column Logic
            const ticketVal = item.ticket || '';
            const ticketDisplay = ticketVal ? ticketVal.substring(0, 10) + '...' : '...';
            // Count only valid files (not undefined/empty)
            const validFiles = files.filter(f => f && f !== '');
            const count = validFiles.length > 0 ? validFiles.length : 1; // At least 1 file
            let size = item.transferred || '';
            if (size === 'Calculating...' || size === 'Waiting...')
                size = '';
            // Only HIDE SIZE if truly completed (same logic as status: state=completed AND progress >= 98)
            if (state === 'completed' && progress >= 98 && !item.isTransferring) {
                size = ''; // Clear size for final state
            }
            const ticketCell = `
                    <div style="cursor: pointer;" title="Click to Copy Ticket" onclick="window.ReceiveManagerUI_Instance.copyTicket('${ticketVal}')"> 
                        <div style="font-family: monospace; color: var(--text-secondary); font-weight: 500;">${ticketDisplay}</div>
                        <div style="font-size: 0.75rem; color: #888; margin-top: 4px;">
                            ${count} File(s) ${size ? '• ' + size : ''}
                        </div>
                    </div>
                `;
            // Action Column - Use same "truly completed" logic as status
            let actionBtn = '-';
            const removeOnlyBtn = `<div style="display: flex; justify-content: center;"><button onclick="window.ReceiveManagerUI_Instance.removeTransfer('${itemId}')" style="background: none; border: 1px solid #666; color: #888; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">✕ Remove</button></div>`;
            const cancelBtn = `<div style="display: flex; justify-content: center;"><button onclick="window.ReceiveManagerUI_Instance.removeTransfer('${itemId}')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Cancel</button></div>`;
            const openBtn = `<button onclick="window.electronAPI.shellShowItem('${files[0]?.replace(/'/g, "\\'")}')" style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; color: #10b981; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Open Folder</button>`;
            const removeBtn = `<button onclick="window.ReceiveManagerUI_Instance.removeTransfer('${itemId}')" style="background: none; border: none; color: #666; cursor: pointer; font-size: 0.75rem;">✕ Remove</button>`;

            // Receiver Action - CENTERED with flexbox
            // Use SAME logic as status: only "completed" when state=completed AND progress >= 98 AND !isTransferring
            const isTrulyCompleted = state === 'completed' && progress >= 98 && !item.isTransferring;

            if (state === 'failed') {
                // FAILED: Only show Remove button (no Open Folder - file wasn't received)
                actionBtn = removeOnlyBtn;
            }
            else if (isTrulyCompleted) {
                // TRULY COMPLETED: Show Open Folder + Remove
                actionBtn = `<div style="display: flex; justify-content: center; align-items: center; gap: 8px;">${openBtn}${removeBtn}</div>`;
            }
            else {
                // STILL IN PROGRESS: Show Cancel button
                actionBtn = cancelBtn;
            }
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
                            ${actionBtn}
                        </td>
                    </tr>
                `;
        }).join('');
    }
}
// Singleton Guard
if (!window.ReceiveManagerUI_Instance) {
    window.ReceiveManagerUI_Instance = new ReceiveManagerUI();
    console.log('[ReceiveManager] Instance created');
} else {
    console.warn('[ReceiveManager] Instance already exists, skipping creation');
}
