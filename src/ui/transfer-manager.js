// @ts-nocheck
// Transfer Manager UI - Handles Transfer History/Queue
// separate module as requested
class TransferManagerUI {
    constructor() {
        this.history = [];
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
            const receiveContent = document.getElementById('tf-receive-content');
            if (sendContent && receiveContent) {
                // Determine if we need to inject our tables
                this.renderManager(sendContent, 'send');
                this.renderManager(receiveContent, 'receive');
                // Start polling status
                if (!this.pollingStarted) {
                    this.pollingStarted = true;
                    // polling loop: force check every 1s as requested
                    setInterval(() => this.poll(), 1000);
                }
            }
        }, 1000); // Check every second
    }
    renderManager(container, mode) {
        const id = `tf-manager-${mode}`;
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
        const title = mode === 'send' ? 'Sharing History' : 'Received History';
        historyDiv.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.1); padding: 10px; border-bottom: 2px solid #10b981; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="font-size: 0.95rem; color: #10b981; margin: 0; font-weight: 600;">${title}</h3>
                <span id="tf-status-${mode}" style="font-size: 0.75rem; color: #10b981; font-weight: 500;">Idle</span>
            </div>
            <div style="width: 100%; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;" id="tf-table-${mode}">
                    <thead style="background: var(--bg-tertiary); color: var(--text-secondary); text-align: left;">
                        <tr>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981; width: 45%;">File</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981;">Status</th>
                            <th style="padding: 10px; border-right: 1px solid #444; border-bottom: 2px solid #10b981;">Ticket + Info</th>
                            <th style="padding: 10px; border-bottom: 2px solid #10b981; text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="tf-tbody-${mode}">
                        <tr><td colspan="4" style="padding: 1rem; text-align: center; color: var(--text-muted);">No items</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(historyDiv);
    }
    async poll() {
        // Only poll if tab is potentially visible (optimization) OR just always poll if user demands it
        // User said: "còn không bật giao diện ... thì tạm dừng ... nhưng nếu đang xem tab này bắt buộc phải có vòng lặp"
        // Simple check: is transfer element in DOM?
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
        // No setTimeout here, we use setInterval in init()
    }
    update(statusList) {
        // STRICT SYNC: The backend is the source of truth.
        // We overwrite local history with backend history.
        // This ensures removed items disappear.
        this.history = statusList || [];
        this.renderTable('send');
        this.renderTable('receive');
    }
    async removeTransfer(id) {
        // Optimistic UI update: Remove locally first for instant feel
        const index = this.history.findIndex(x => x.id === id);
        if (index !== -1) {
            this.history.splice(index, 1);
            this.renderTable('send');
            this.renderTable('receive');
        }
        // Call backend to actually remove (and stop if running)
        await window.electronAPI.transferRemove(id);
        // Next poll will confirm sync.
    }
    copyTicket(ticket) {
        if (!ticket)
            return;
        navigator.clipboard.writeText(ticket).then(() => {
            alert('Ticket copied to clipboard!');
        });
    }
    renderTable(mode) {
        const tbody = document.getElementById(`tf-tbody-${mode}`);
        const statusSpan = document.getElementById(`tf-status-${mode}`);
        if (!tbody)
            return;
        const items = this.history.filter(h => (mode === 'send' ? h.mode === 'send' : h.mode === 'receive'));
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
            const isShare = item.mode === 'send';
            let statusText = '';
            let statusColor = '';
            const rowStyle = "border-bottom: 1px solid #444;";
            const state = item.status || (item.active ? 'active' : (item.complete ? 'completed' : 'failed'));
            if (isShare) {
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
            }
            else {
                statusText = `Receiving... ${item.progress ? item.progress.toFixed(0) : 0}%`;
                statusColor = '#3b82f6';
            }
            // File Column Logic
            let fileCell = '';
            let rawFiles = item.originalFiles || item.filename;
            const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
            const filesList = files.map(f => {
                if (!f)
                    return '';
                const name = f.split('/').pop();
                return `<div style="margin-bottom: 4px;">
                    <a href="#" onclick="event.preventDefault(); window.electronAPI.shellShowItem('${f.replace(/'/g, "\\'")}')" style="color: var(--text-primary); text-decoration: none; border-bottom: 1px dotted #666; font-size: 0.9rem;">
                        📄 ${name}
                    </a>
                </div>`;
            }).join('');
            fileCell = `<div>${filesList}</div>`;
            if (files.length > 1 || item.forceZip === true || (item.filename && typeof item.filename === 'string' && item.filename.endsWith('.zip') && item.filename !== files[0])) {
                const zipName = typeof item.filename === 'string' && item.filename.endsWith('.zip') ? item.filename.split('/').pop() : 'Archive.zip';
                fileCell += `<div style="color: #ef4444; font-size: 0.8rem; margin-top: 6px; font-weight: 500;">📦 ${zipName}</div>`;
            }
            // Ticket + Info Column Logic
            const ticketVal = item.ticket || '';
            const ticketDisplay = ticketVal ? ticketVal.substring(0, 10) + '...' : '...';
            const count = files.length;
            let size = item.transferred || '';
            if (size === 'Calculating...' || size === 'Waiting...')
                size = '';
            // HIDE SIZE if "Sharing" (Completed/100%)
            // Logic: If statusText is "Sharing" or "Received", hide size.
            // But User specifically said "Sau khi 2 con số bằng nhau thì chỉ còn 1 File(s) thôi" for State 3.
            if (statusText === 'Sharing' || statusText === 'Received') {
                size = ''; // Clear size for final state
            }
            const ticketCell = `
                <div style="cursor: pointer;" title="Click to Copy Ticket" onclick="window.TransferManagerUI_Instance.copyTicket('${ticketVal}')"> 
                    <div style="font-family: monospace; color: var(--text-secondary); font-weight: 500;">${ticketDisplay}</div>
                    <div style="font-size: 0.75rem; color: #888; margin-top: 4px;">
                        ${count} File(s) ${size ? '• ' + size : ''}
                    </div>
                </div>
            `;
            // Action Column
            let actionBtn = '-';
            // Specific Logic for Sender
            const removeBtn = `<button onclick="window.TransferManagerUI_Instance.removeTransfer('${itemId}')" style="background: none; border: none; color: #666; cursor: pointer; font-size: 0.75rem;">✕ Remove</button>`;
            const cancelSharBtn = `<button onclick="window.TransferManagerUI_Instance.removeTransfer('${itemId}')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Cancel Sharing</button>`;
            const openBtn = `<button onclick="window.electronAPI.shellShowItem('${files[0]?.replace(/'/g, "\\'")}')" style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; color: #10b981; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Open Folder</button>`;
            if (isShare) {
                // Sender Action: Always "Cancel Sharing" (removes). No Open Folder.
                actionBtn = cancelSharBtn;
            }
            else {
                // Receiver Action
                if (state === 'pending' || state === 'active') { // Active or Pending
                    actionBtn = `<button onclick="window.TransferManagerUI_Instance.removeTransfer('${itemId}')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem;">Cancel</button>`;
                }
                else { // Completed/Failed
                    actionBtn = `<div style="display: flex; gap: 8px;">${openBtn}${removeBtn}</div>`;
                }
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
window.TransferManagerUI_Instance = new TransferManagerUI();
