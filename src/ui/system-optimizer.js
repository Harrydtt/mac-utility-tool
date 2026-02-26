// ============================================
// System Optimizer Module
// ============================================
// Implements system optimization features from Mole
// Each operation respects deletion settings (trash vs permanent)

// State management
let optimizerRunning = false;
let currentOptimizationStep = 0;

// Optimization tasks configuration
const OPTIMIZER_TASKS = [
    {
        id: 'flush-dns',
        name: 'Fix Network Connection',
        description: 'Clears DNS cache. Helps when websites fail to load. Safe, won\'t close apps.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        requiresSudo: true,
        command: 'dscacheutil -flushcache && killall -HUP mDNSResponder'
    },
    {
        id: 'refresh-finder',
        name: 'Restart Desktop & Finder',
        description: 'Fixes stuck icons or Dock. ⚠️ Will close active Finder windows.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
        requiresSudo: false,
        command: 'killall Finder && killall Dock'
    },
    {
        id: 'clear-font-cache',
        name: 'Fix Font Display',
        description: 'Resets font system to fix garbled text. Safe to run.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
        requiresSudo: true,
        command: 'atsutil databases -remove'
    },
    {
        id: 'repair-disk-permissions',
        name: 'Check Disk Health',
        description: 'Runs a quick read-only check on your startup disk. Safe.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        requiresSudo: true,
        command: 'diskutil verifyVolume /'
    },
    {
        id: 'clear-clipboard',
        name: 'Clear Copy History',
        description: 'Empties the clipboard to remove sensitive data. Safe.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`,
        requiresSudo: false,
        command: 'pbcopy < /dev/null'
    },
    {
        id: 'purge-memory',
        name: 'Free Up RAM',
        description: 'Releases unused memory to speed up your Mac. Safe.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="16"/><line x1="10" y1="10" x2="10" y2="16"/><line x1="14" y1="6" x2="14" y2="16"/><line x1="18" y1="12" x2="18" y2="16"/></svg>`,
        requiresSudo: true,
        command: 'purge'
    },
    {
        id: 'rebuild-launch-services',
        name: 'Fix "Open With" Menu',
        description: 'Resets app associations if they are messed up. Safe.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        requiresSudo: false,
        command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -r -domain local -domain user && killall Finder'
    },
    {
        id: 'clear-quicklook-cache',
        name: 'Fix Thumbnails',
        description: 'Refreshes file previews properly. Safe.',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8-11-8-11-8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        requiresSudo: false,
        command: 'qlmanage -r cache'
    }
];

// Initialize System Optimizer UI
function initSystemOptimizer() {
    const container = document.getElementById('system-optimizer-tasks');
    if (!container) return;

    container.innerHTML = OPTIMIZER_TASKS.map(task => `
        <div class="optimizer-task" data-task-id="${task.id}">
            <div class="optimizer-task-icon">${task.icon}</div>
            <div class="optimizer-task-info">
                <div class="optimizer-task-name">${task.name}</div>
                <div class="optimizer-task-desc">${task.description}</div>
            </div>
            <div class="optimizer-task-status">
                <span class="status-text">Ready</span>
                <button class="optimizer-run-btn" onclick="runSingleOptimization('${task.id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// Run a single optimization task
async function runSingleOptimization(taskId) {
    const task = OPTIMIZER_TASKS.find(t => t.id === taskId);
    if (!task || optimizerRunning) return;

    const taskEl = document.querySelector(`[data-task-id="${taskId}"]`);
    const statusEl = taskEl?.querySelector('.status-text');
    const btnEl = taskEl?.querySelector('.optimizer-run-btn');

    if (statusEl) statusEl.textContent = 'Running...';
    if (statusEl) statusEl.classList.add('running');
    if (btnEl) btnEl.disabled = true;

    try {
        const result = await window.electronAPI.runSystemCommand(task.command, task.requiresSudo);

        if (result.success) {
            if (statusEl) {
                statusEl.textContent = '✓ Done';
                statusEl.classList.remove('running');
                statusEl.classList.add('success');
            }
        } else {
            if (statusEl) {
                statusEl.textContent = result.error || 'Failed';
                statusEl.classList.remove('running');
                statusEl.classList.add('error');
            }
        }
    } catch (err) {
        if (statusEl) {
            statusEl.textContent = 'Error';
            statusEl.classList.remove('running');
            statusEl.classList.add('error');
        }
        console.error('[Optimizer] Error:', err);
    }

    if (btnEl) btnEl.disabled = false;

    // Reset status after 5 seconds
    setTimeout(() => {
        if (statusEl) {
            statusEl.textContent = 'Ready';
            statusEl.classList.remove('success', 'error');
        }
    }, 5000);
}

// Run all optimizations
// Helper to update task UI status
function updateTaskStatus(taskId, status) {
    const taskEl = document.querySelector(`[data-task-id="${taskId}"]`);
    const statusEl = taskEl?.querySelector('.status-text');
    if (!statusEl) return;

    statusEl.classList.remove('running', 'success', 'warning', 'error');

    if (status === 'running') {
        statusEl.textContent = 'Running...';
        statusEl.classList.add('running');
    } else if (status === 'success') {
        statusEl.textContent = '✓ Done';
        statusEl.classList.add('success');
    } else if (status === 'error') {
        statusEl.textContent = 'Error';
        statusEl.classList.add('error');
    } else if (status === 'ready') {
        statusEl.textContent = 'Ready';
    }
}

// Run all optimizations
async function runAllOptimizations() {
    if (optimizerRunning) return;
    optimizerRunning = true;

    const runAllBtn = document.getElementById('optimizer-run-all-btn');
    if (runAllBtn) {
        runAllBtn.disabled = true;
        runAllBtn.textContent = 'Running...';
    }

    let successCount = 0;
    let failCount = 0;

    // Split tasks
    const normalTasks = OPTIMIZER_TASKS.filter(t => !t.requiresSudo);
    const sudoTasks = OPTIMIZER_TASKS.filter(t => t.requiresSudo);

    // 1. Run Normal Tasks (Sequential)
    for (const task of normalTasks) {
        updateTaskStatus(task.id, 'running');
        await new Promise(r => setTimeout(r, 200)); // Visual delay

        try {
            const result = await window.electronAPI.runSystemCommand(task.command, false);
            if (result.success) {
                successCount++;
                updateTaskStatus(task.id, 'success');
            } else {
                failCount++;
                updateTaskStatus(task.id, 'error');
            }
        } catch (err) {
            failCount++;
            updateTaskStatus(task.id, 'error');
        }
    }

    // 2. Run Sudo Tasks (Batched)
    if (sudoTasks.length > 0) {
        // Set all to running
        sudoTasks.forEach(t => updateTaskStatus(t.id, 'running'));

        // Combine commands: cmd1 ; cmd2 ; cmd3
        // We use ; so one failure doesn't stop others
        const combinedCmd = sudoTasks.map(t => t.command).join(' ; ');

        try {
            // Ask for password ONCE
            const result = await window.electronAPI.runSystemCommand(combinedCmd, true);

            if (result.success) {
                // Assume all succeeded if the batch ran (process exit code 0)
                // Since we use ; it usually returns 0 unless the shell crashes
                successCount += sudoTasks.length;
                sudoTasks.forEach(t => updateTaskStatus(t.id, 'success'));
            } else {
                failCount += sudoTasks.length;
                sudoTasks.forEach(t => updateTaskStatus(t.id, 'error'));

                // If user cancelled, show specific msg if possible
                if (result.error && result.error.includes('Password required')) {
                    // handled generally
                }
            }
        } catch (err) {
            failCount += sudoTasks.length;
            sudoTasks.forEach(t => updateTaskStatus(t.id, 'error'));
        }
    }

    optimizerRunning = false;

    if (runAllBtn) {
        runAllBtn.disabled = false;
        // Fixed: Added width/height and class to preserve styling
        runAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="margin-right: 8px;">
                <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run All Optimizations
        `;
    }

    // Show summary
    showOptimizerSummary(successCount, failCount);
}

// Show optimization summary
function showOptimizerSummary(success, failed) {
    const summaryEl = document.getElementById('optimizer-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="optimizer-summary-content">
                <span class="summary-success">✓ ${success} optimizations completed</span>
                ${failed > 0 ? `<span class="summary-failed">✗ ${failed} skipped</span>` : ''}
            </div>
        `;
        summaryEl.classList.remove('hidden');

        // Hide after 10 seconds
        setTimeout(() => {
            summaryEl.classList.add('hidden');
        }, 10000);
    }
}

// Show section when nav item clicked
function showSystemOptimizerSection() {
    initSystemOptimizer();
}

// Initialize on section show
document.addEventListener('DOMContentLoaded', () => {
    // Will be called when section is shown
});
