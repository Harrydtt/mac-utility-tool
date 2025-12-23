
// State
let scanData = null;
let selectedPaths = new Set();
let currentCategory = null;
let isScanning = false;
let isFullScanCompleted = false;  // Track if full scan has been completed
let scannedCategoryIds = new Set();  // Track which categories have been scanned
let config = {};
let categoryOverrides = {}; // { id: 'safe' | 'risky' }

// Localization Removed
function t(key) { return key; } // No-op
function updateTexts() { } // No-op

function updateTexts() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
}

// Language joke handler
function handleLanguageChange(select) {
    if (select.value === 'other') {
        alert("Không có đâu, chịu khó đọc hiểu tiếng Anh đi, dễ mà ;)\n\nMà thực ra một số cái admin cũng không biết nên để thế nào cho đúng nghĩa ;)");
        // Reset back to English
        select.value = 'en';
    }
}

// Settings persistence key (for quick localStorage access)
const SETTINGS_KEY = 'mac-cleaner-settings';

// AI Cat Default Prompts
const DEFAULT_FILE_PROMPT = `You are an AI assistant for a Mac cleaner app. About this file:
Path: \${context.path}

Give 2 short answers (1 sentence each, no questions):
Line 1: What is this file/folder
Line 2: Is it safe to delete, any risks

Be concise. No markdown formatting.`;

const DEFAULT_THREAT_PROMPT = `You are a Mac security expert. Analyze this detected threat:

Name: \${context.name}
Path: \${context.path}
Severity: \${context.threatType}

Give 2 short answers (1 sentence each):
Line 1: What danger does this pose? (specific risks)
Line 2: What severity level? (low/medium/high/critical and why)

Be direct and concise. No markdown formatting.`;

// AI Cat Info Modal
function showAICatInfo() {
    const modal = document.getElementById('aicat-info-modal');
    if (!modal) return;

    // Update prompts in modal
    document.getElementById('modal-file-prompt').textContent = window.aiCatPromptFile || DEFAULT_FILE_PROMPT;
    document.getElementById('modal-threat-prompt').textContent = window.aiCatPromptThreat || DEFAULT_THREAT_PROMPT;

    modal.classList.remove('hidden');
}

function hideAICatInfo() {
    const modal = document.getElementById('aicat-info-modal');
    if (modal) modal.classList.add('hidden');
}

// Custom Prompt Management
function resetFilePrompt() {
    document.getElementById('aicat-prompt-file').value = DEFAULT_FILE_PROMPT;
    enableSavePromptsButton();
}

function resetThreatPrompt() {
    document.getElementById('aicat-prompt-threat').value = DEFAULT_THREAT_PROMPT;
    enableSavePromptsButton();
}

function enableSavePromptsButton() {
    const btn = document.getElementById('save-prompts-btn');
    if (btn) {
        btn.disabled = false;
        btn.style.display = 'block'; // Show button on change
    }
}

async function saveCustomPrompts() {
    const filePrompt = document.getElementById('aicat-prompt-file').value.trim();
    const threatPrompt = document.getElementById('aicat-prompt-threat').value.trim();

    try {
        // Get current settings and update with new prompts
        const config = await window.electronAPI.getSettings();
        config.aiCatPromptFile = filePrompt || DEFAULT_FILE_PROMPT;
        config.aiCatPromptThreat = threatPrompt || DEFAULT_THREAT_PROMPT;

        await window.electronAPI.saveSettings(config);

        // Update globals
        window.aiCatPromptFile = config.aiCatPromptFile;
        window.aiCatPromptThreat = config.aiCatPromptThreat;

        // Hide button after save
        const btn = document.getElementById('save-prompts-btn');
        if (btn) btn.style.display = 'none';

        alert('✅ Prompt settings saved!');
    } catch (err) {
        console.error('[AICat] Failed to save prompts:', err);
        console.error('[AICat] Error message:', err.message);
        console.error('[AICat] Error stack:', err.stack);
        alert('❌ Failed to save prompts: ' + (err.message || err));
    }
}

// Detect prompt changes
function setupPromptChangeDetection() {
    const fileTextarea = document.getElementById('aicat-prompt-file');
    const threatTextarea = document.getElementById('aicat-prompt-threat');

    if (fileTextarea) {
        fileTextarea.addEventListener('input', enableSavePromptsButton);
    }
    if (threatTextarea) {
        threatTextarea.addEventListener('input', enableSavePromptsButton);
    }
}

// Open macOS System Settings > Login Items
async function openLoginItemsSettings() {
    try {
        await window.electronAPI.openLoginSettings();
    } catch (e) {
        console.error('Failed to open login settings:', e);
        alert('Please go to System Settings > General > Login Items to configure app startup.');
    }
}

// Utils
const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Full Disk Access Check
async function checkFullDiskAccess() {
    try {
        const hasAccess = await window.electronAPI.checkFullDiskAccess();
        console.log('[FDA] Has Full Disk Access:', hasAccess);
        if (!hasAccess) {
            showFullDiskAccessBanner();
        } else {
            // Remove banner if it exists
            const existingBanner = document.getElementById('fda-banner');
            if (existingBanner) {
                existingBanner.remove();
            }
        }
    } catch (e) {
        console.error('Failed to check Full Disk Access:', e);
    }
}

function showFullDiskAccessBanner() {
    // Don't show duplicate banners
    if (document.getElementById('fda-banner')) return;

    // Add padding to sidebar for Mac window controls
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.style.paddingTop = '40px';
    }

    // Disable Scan button when FDA not granted
    const scanBtn = document.getElementById('scan-btn');
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.style.opacity = '0.5';
        scanBtn.style.cursor = 'not-allowed';
        scanBtn.title = 'Grant Full Disk Access first';
    }

    const banner = document.createElement('div');
    banner.id = 'fda-banner';
    banner.style.cssText = `
        position: absolute;
        bottom: 45px;
        left: 8px;
        right: 8px;
        background: rgba(30, 30, 35, 0.95);
        color: white;
        padding: 10px 16px;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-radius: 8px;
        border: 1px solid var(--safe, #4ade80);
        animation: slideUp 0.3s ease-out;
    `;

    // Add animation keyframes
    if (!document.getElementById('fda-animation-style')) {
        const style = document.createElement('style');
        style.id = 'fda-animation-style';
        style.textContent = `
            @keyframes slideUp {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span style="font-size: 13px;"><strong>Full Disk Access Required</strong> – Grant permission to scan system files</span>
        </div>
        <button id="fda-grant-btn" style="
            background: var(--safe, #4ade80);
            border: none;
            color: #1a1a1a;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: all 0.2s;
        ">Open Settings</button>
    `;

    // Insert into main-content instead of body
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.style.position = 'relative';
        mainContent.appendChild(banner);
    } else {
        document.body.appendChild(banner);
    }

    const grantBtn = document.getElementById('fda-grant-btn');
    grantBtn.onmouseenter = () => grantBtn.style.opacity = '0.9';
    grantBtn.onmouseleave = () => grantBtn.style.opacity = '1';

    grantBtn.onclick = async () => {
        await window.electronAPI.openFullDiskAccessSettings();
    };
}

// --- Init ---
async function init() {
    // Load config first
    try {
        config = await window.electronAPI.getSettings();
        categoryOverrides = config.categoryOverrides || {};
        updateTexts();
    } catch (e) { console.error(e); }

    // Load initial scanners metadata to draw empty cards
    try {
        const scanners = await window.electronAPI.getScanners();
        renderEmptyDashboard(scanners);
    } catch (e) { console.error(e); }

    // Setup event delegation for category checkboxes (ONE TIME ONLY)
    document.addEventListener('change', function (e) {
        if (e.target && e.target.classList.contains('category-checkbox')) {
            const categoryId = e.target.dataset.categoryId;
            const isChecked = e.target.checked;

            // Block trash category when delete mode is trash
            if (categoryId === 'trash' && isChecked) {
                const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
                if (deleteMode === 'trash') {
                    alert('Cannot clean Trash when Deletion Mode is "Move to Trash".\n\nPlease either:\n• Empty Trash manually (Finder → Empty Trash)\n• Change Settings → Deletion Mode to "Delete Permanently"');
                    e.target.checked = false;
                    return;
                }
            }

            console.log('[Checkbox] Changed:', categoryId, isChecked);
            updateSelectionStats();
        }
    });

    loadDiskInfo();

    // Setup IPC event listeners
    setupIPCListeners();

    // Check Full Disk Access permission
    checkFullDiskAccess();
}
window.onload = init;


// --- IPC Event Listeners ---
function setupIPCListeners() {
    // Scan progress
    window.electronAPI.onScanProgress((data) => {
        updateProgress(data.id, data.totalSize, data.itemsCount);
    });

    // Scan complete
    window.electronAPI.onScanComplete((summary) => {
        isScanning = false;
        scanData = summary;
        isFullScanCompleted = true;  // Mark that full scan has completed

        // Mark all categories as scanned
        scanData.results.forEach(r => {
            scannedCategoryIds.add(r.category.id);
        });

        // Auto-select safe items on complete
        selectedPaths.clear();
        scanData.results.forEach(r => {
            if (r.items.length > 0 && getSafety(r.category.id, r.category.safetyLevel) === 'safe') {
                r.items.forEach(i => selectedPaths.add(i.path));
            }
        });

        renderDashboard();

        // Auto-check safe categories after render completes
        setTimeout(() => {
            const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';

            const safeCategories = scanData.results
                .filter(r => {
                    const safety = getSafety(r.category.id, r.category.safetyLevel);
                    // Skip trash if delete mode is trash (can't clean trash by moving to trash)
                    if (r.category.id === 'trash' && deleteMode === 'trash') {
                        return false;
                    }
                    return safety === 'safe' && r.items.length > 0;
                })
                .map(r => r.category.id);

            safeCategories.forEach(id => {
                const cb = document.querySelector(`.category-checkbox[data-category-id="${id}"]`);
                if (cb) cb.checked = true;
            });

            updateSelectionStats();
        }, 100);

        document.querySelectorAll('.progress-bar-fill').forEach(el => el.style.width = '0%');
    });

    // Scan error
    window.electronAPI.onScanError((error) => {
        alert('Scan error: ' + error);
        isScanning = false;
    });
}

function updateProgress(id, size, count) {
    const card = document.querySelector(`.category-card[data-id="${id}"]`);
    if (!card) return;

    // Animate progress bar to 100% just to show activity? 
    // Or if we know total items beforehand... we don't.
    // So just show "Scanned X items" and maybe a spinner or pulse.

    const countEl = card.querySelector('.count');
    if (countEl) countEl.textContent = `${count} Scanned`;

    const sizeEl = card.querySelector('.size');
    if (sizeEl) sizeEl.textContent = formatSize(size);

    const bar = card.querySelector('.progress-bar-fill');
    if (bar) bar.style.width = '100%';

    const text = card.querySelector('.progress-text');
    if (text) text.textContent = `${count} items`;

    card.classList.remove('scanning');
}

window.startScan = async () => {
    if (isScanning) return;
    isScanning = true;

    // Disable scan button
    const scanBtn = document.querySelector('.header-actions .primary-btn:last-child');
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = 'Scanning...';
        scanBtn.style.opacity = '0.6';
        scanBtn.style.cursor = 'not-allowed';
    }

    // Reset UI - show scanning state on cards
    document.querySelectorAll('.category-card').forEach(card => {
        card.classList.add('scanning');
        const sizeEl = card.querySelector('.category-size');
        if (sizeEl) sizeEl.textContent = 'Scanning...';
        // Animate progress bar
        const barFill = card.querySelector('.category-bar-fill');
        if (barFill) barFill.style.width = '100%';
    });

    try {
        await window.electronAPI.startScan();
    } catch (e) {
        console.error('[Scan] Error:', e);
        alert('Scan failed: ' + e.message);
    } finally {
        isScanning = false;
        // Re-enable scan button
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = 'Run Smart Scan';
            scanBtn.style.opacity = '1';
            scanBtn.style.cursor = 'pointer';
        }
        document.querySelectorAll('.category-card').forEach(card => {
            card.classList.remove('scanning');
        });
    }
};

// --- Dashboard & Drag Drop ---
function getSafety(categoryId, defaultSafety) {
    if (categoryOverrides[categoryId]) return categoryOverrides[categoryId];
    return defaultSafety; // Respect default (safe, moderate, risky)
}

// Sync category badges in Settings page when safety level changes
function updateSettingsCategoryBadges() {
    const container = document.getElementById('auto-clean-categories');
    if (!container) return;

    // Update each badge based on current overrides
    container.querySelectorAll('.checkbox-label').forEach(label => {
        const input = label.querySelector('input[name="auto-cat"]');
        if (!input) return;

        const categoryId = input.value;
        const badge = label.querySelector('.badge');
        if (!badge) return;

        // Get current safety (from override or will use default next time settings loads)
        const currentSafety = categoryOverrides[categoryId];
        if (currentSafety) {
            badge.classList.remove('safe', 'moderate', 'risky');
            badge.classList.add(currentSafety);
            badge.textContent = currentSafety.toUpperCase();
        }
    });
}


function renderEmptyDashboard(scanners) {
    const safeContainer = document.getElementById('safe-categories');
    const modContainer = document.getElementById('moderate-categories');
    const riskyContainer = document.getElementById('risky-categories');

    if (!safeContainer || !modContainer || !riskyContainer) return;

    // Clear existing content to prevent duplication
    safeContainer.innerHTML = '';
    modContainer.innerHTML = '';
    riskyContainer.innerHTML = '';

    // Use dynamic scanners from backend, fallback to empty array if undefined
    // Filter out ignored categories
    const ignoredCategories = config.ignoredCategories || [];
    const categories = (scanners || []).filter(p => !ignoredCategories.includes(p.id));

    categories.forEach(p => {
        const mockResult = {
            category: { id: p.id, name: p.name, safetyLevel: p.safetyLevel },
            totalSize: 0,
            items: []
        };
        const cardHTML = createCategoryCard(mockResult);

        // Determine safety level (use override or default)
        const safety = getSafety(p.id, p.safetyLevel);

        if (safety === 'safe') {
            safeContainer.innerHTML += cardHTML;
        } else if (safety === 'moderate') {
            modContainer.innerHTML += cardHTML;
        } else {
            riskyContainer.innerHTML += cardHTML;
        }
    });
}
function renderDashboard() {
    if (!scanData) return;
    const safeContainer = document.getElementById('safe-categories');
    const modContainer = document.getElementById('moderate-categories');
    const riskyContainer = document.getElementById('risky-categories');

    if (safeContainer) safeContainer.innerHTML = '';
    if (modContainer) modContainer.innerHTML = '';
    if (riskyContainer) riskyContainer.innerHTML = '';

    // Sort by safety level
    const sortedResults = [
        ...scanData.results.filter(r => getSafety(r.category.id, r.category.safetyLevel) === 'safe'),
        ...scanData.results.filter(r => getSafety(r.category.id, r.category.safetyLevel) === 'moderate'),
        ...scanData.results.filter(r => getSafety(r.category.id, r.category.safetyLevel) === 'risky')
    ];

    // Filter out categories with 0 items only for categories that have been scanned
    // Unscanned categories always show, scanned empty categories are hidden
    // Also filter out ignored categories
    const ignoredCategories = config.ignoredCategories || [];
    const visibleResults = sortedResults.filter(r => {
        // Skip ignored categories
        if (ignoredCategories.includes(r.category.id)) {
            return false;
        }

        const wasScanned = scannedCategoryIds.has(r.category.id);
        if (wasScanned) {
            return r.items.length > 0;  // Hide if scanned and empty
        }
        return true;  // Show if not scanned yet
    });

    safeContainer.innerHTML = '';
    if (modContainer) modContainer.innerHTML = '';
    riskyContainer.innerHTML = '';

    visibleResults.forEach(r => {
        const safety = getSafety(r.category.id, r.category.safetyLevel);
        const cardHTML = createCategoryCard(r);

        if (safety === 'safe') {
            safeContainer.innerHTML += cardHTML;
        } else if (safety === 'moderate' && modContainer) {
            modContainer.innerHTML += cardHTML;
        } else {
            riskyContainer.innerHTML += cardHTML;
        }
    });

    updateSelectionStats();
}

function createCategoryCard(result) {
    const { category, totalSize, items } = result;
    const id = category.id;
    const name = category.name;
    const count = items.length;
    const safety = getSafety(id, category.safetyLevel);

    // Check if this category has been scanned
    const wasScanned = scannedCategoryIds.has(id);

    // Display stats based on scan status
    const statsHtml = wasScanned
        ? `<div class="category-size">${formatSize(totalSize)}</div>
           <div class="category-count">${count} items</div>`
        : `<div class="category-count not-scanned">Not scanned</div>`;

    return `
    <div class="category-card ${safety}" data-category-id="${id}" data-safety="${safety}" draggable="true" onclick="openCategory('${id}')" ondragstart="dragStart.call(this, event)" ondragend="dragEnd.call(this, event)">
        <input type="checkbox" class="category-checkbox" data-category-id="${id}" onclick="event.stopPropagation()">
            <div class="category-content">
                <div class="category-header">
                    <h4>${name}</h4>
                    <span class="badge ${safety}">${safety.toUpperCase()}</span>
                </div>
                <div class="category-stats">
                    ${statsHtml}
                </div>
                <div class="category-bar">
                    <div class="category-bar-fill" style="width: ${wasScanned ? Math.min(100, (totalSize / 1e9) * 100) : 0}%"></div>
                </div>
            </div>
            <button class="ignore-btn" onclick="event.stopPropagation(); ignoreCategory('${id}')" title="Ignore this category">✕</button>
        </div>
`;
}

// Drag logic
let draggedCard = null;
let isDragging = false;
let dragOriginalZone = null;  // Track original zone
let dropCompleted = false;    // Track if drop event fired

function dragStart(e) {
    isDragging = true;
    dropCompleted = false;
    draggedCard = this;
    dragOriginalZone = this.parentElement;  // Remember original zone
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.classList.add('dragging'), 0);
    console.log('[Drag] Started from zone:', dragOriginalZone?.id);
}

function dragEnd(e) {
    console.log('[Drag] End - dropCompleted:', dropCompleted, 'current parent:', this.parentElement?.id);

    // If drop didn't complete properly, restore to original zone
    if (!dropCompleted && dragOriginalZone && this.parentElement !== dragOriginalZone) {
        console.log('[Drag] Restoring to original zone:', dragOriginalZone.id);
        dragOriginalZone.appendChild(this);
    }

    isDragging = false;
    this.classList.remove('dragging');
    dragOriginalZone = null;
}

// Drop Zones
['safe-categories', 'moderate-categories', 'risky-categories'].forEach(id => {
    const zone = document.getElementById(id);
    if (!zone) return;

    zone.addEventListener('dragover', e => {
        e.preventDefault(); // Allow drop
        const afterElement = getDragAfterElement(zone, e.clientY);
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;  // Safety check
        if (afterElement == null) {
            zone.appendChild(dragging);
        } else {
            zone.insertBefore(dragging, afterElement);
        }
    });

    zone.addEventListener('drop', async e => {
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;  // Safety check

        dropCompleted = true;  // Mark drop as successful
        dragging.classList.remove('dragging');

        // Determine new safety based on parent
        let newSafety = 'risky';
        if (zone.id === 'safe-categories') newSafety = 'safe';
        if (zone.id === 'moderate-categories') newSafety = 'moderate';

        const cardId = dragging.getAttribute('data-category-id');
        console.log('[Drag] Dropped card:', cardId, 'to zone:', zone.id, 'newSafety:', newSafety);

        if (!cardId) return;

        // Save override
        categoryOverrides[cardId] = newSafety;

        // Auto-save
        console.log('[Drag] Saving layout:', categoryOverrides);
        try {
            const result = await window.electronAPI.saveLayout(categoryOverrides);
            console.log('[Drag] Save result:', result);
        } catch (e) {
            console.error('[Drag] Save failed:', e);
        }

        // Update visual style - remove old safety classes and add new one
        dragging.classList.remove('safe', 'moderate', 'risky');
        dragging.classList.add(newSafety);
        dragging.setAttribute('data-safety', newSafety);
        console.log('[Drag] Updated card classes:', dragging.className);

        // Update badge text and class - look in category-header
        const badge = dragging.querySelector('.category-header .badge') || dragging.querySelector('.badge');
        console.log('[Drag] Found badge:', badge);
        if (badge) {
            badge.className = 'badge ' + newSafety;  // Reset class completely
            badge.textContent = newSafety.toUpperCase();
            console.log('[Drag] Badge updated to:', newSafety);
        } else {
            console.warn('[Drag] Badge not found in card!');
        }

        // Sync settings page badges
        updateSettingsCategoryBadges();
    });
});

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.category-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- Other Logic (Copied/Modified from V2) --- 
// ... (Keep existing loadDiskInfo, results view, blacklist, history logic) ...
// We need to reimplement them or append them.
// For brevity, I will inject the key parts and keep previous functions.

// Navigation
window.showSection = (sectionId) => {
    // Hide AI Cat when changing sections
    if (window.forceHideAICat) {
        window.forceHideAICat();
    }

    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('onclick').includes(sectionId)) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    ['dashboard', 'scan-results', 'blacklist', 'history', 'settings', 'uninstaller', 'threats', 'joke'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === sectionId) {
            el.classList.add('active');
            el.classList.remove('hidden');
            if (id === 'blacklist') loadBlacklist();
            if (id === 'history') loadHistory();
            if (id === 'settings') {
                loadSettings();
                loadAICatPrompts(); // Load custom prompts
            }
        } else {
            el.classList.remove('active');
            el.classList.add('hidden');
        }
    });
};

async function loadDiskInfo() {
    try {
        const data = await window.electronAPI.getDiskInfo();
        window.diskData = data;

        const percent = Math.round((data.used / data.total) * 100);
        document.getElementById('disk-bar-fill').style.width = `${percent}% `;

        document.getElementById('disk-used').textContent = `${formatSize(data.used)} Used`;
        document.getElementById('disk-free').textContent = `${formatSize(data.free)} Free`;
    } catch (e) { }
}

window.openCategory = (categoryOrId) => {
    // Don't open if user was dragging
    if (isDragging) {
        isDragging = false;
        return;
    }

    // Check if scanData exists
    if (!scanData || !scanData.results) {
        alert('Please run a scan first to view category details.');
        return;
    }

    let category = categoryOrId;
    if (typeof categoryOrId === 'string') {
        const result = scanData.results.find(r => r.category.id === categoryOrId);
        if (result) category = result.category;
        else {
            alert('This category has not been scanned yet.');
            return;
        }
    }

    currentCategory = category;
    showSection('scan-results');
    document.getElementById('category-title').textContent = category.name;
    renderFilesList();
};

function renderFilesList() {
    const container = document.getElementById('file-list');
    container.innerHTML = '';
    const result = scanData.results.find(r => r.category.id === currentCategory.id);
    if (!result) return;

    let items = [...result.items].sort((a, b) => b.size - a.size);
    const term = document.getElementById('search-input').value.toLowerCase();
    if (term) items = items.filter(i => i.name.toLowerCase().includes(term));

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
            <div class="col-allow"><input type="checkbox" class="ignore-check" data-path="${item.path}"></div>
            <div class="col-info"><span class="file-path">${item.path}</span></div>
            <div class="col-size">${formatSize(item.size)}</div>
`;
        container.appendChild(row);
    });

    // Attach event listeners to ignore checkboxes
    container.querySelectorAll('.ignore-check').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const path = e.target.getAttribute('data-path');
            if (e.target.checked) {
                ignoreFile(path);
            }
        });
    });

    // Re-setup AI Cat listeners after rendering file list
    if (window.setupAICatForFiles) {
        window.setupAICatForFiles();
    }
}

window.toggleSelect = (path, checked) => {
    if (checked) selectedPaths.add(path); else selectedPaths.delete(path);
    updateSelectionStats();
};

function updateSelectionStats() {
    // Check if any categories are selected via checkboxes
    const selectedCheckboxes = document.querySelectorAll('.category-checkbox:checked');
    const cleanBtn = document.getElementById('clean-selected-btn');

    if (!cleanBtn) return;

    if (selectedCheckboxes.length > 0) {
        cleanBtn.style.display = 'flex';
        cleanBtn.innerHTML = `Clean ${selectedCheckboxes.length} ${selectedCheckboxes.length === 1 ? 'Category' : 'Categories'}`;
    } else {
        cleanBtn.style.display = 'none';
    }

    // Legacy: Update file selection stats if in detail view
    if (document.getElementById('selection-stats')) {
        document.getElementById('selection-stats').textContent = `${selectedPaths.size} selected`;
    }
    const detailCleanBtn = document.getElementById('clean-btn');
    if (detailCleanBtn) {
        detailCleanBtn.disabled = selectedPaths.size === 0;
    }

    // Update Disk Projection
    calculateDiskProjection();
}

// --- Scheduler Logic ---
function updateScheduleInputs() {
    const freqEl = document.getElementById('schedule-freq');
    const weekday = document.getElementById('input-weekday');
    const day = document.getElementById('input-day');

    if (!freqEl || !weekday || !day) return;

    const freq = freqEl.value;

    // Simplified Toggle Logic
    const isWeekly = freq === 'weekly';
    const isMonthly = freq === 'monthly';

    // Toggle hidden class: Add if NOT matching frequency, Remove if matching
    if (isWeekly) weekday.classList.remove('hidden');
    else weekday.classList.add('hidden');

    if (isMonthly) day.classList.remove('hidden');
    else day.classList.add('hidden');

    // console.log(`Frequency: ${ freq }, Weekly: ${ isWeekly }, Monthly: ${ isMonthly } `); 
}
window.updateScheduleInputs = updateScheduleInputs;

async function calculateDiskProjection() {
    if (!window.diskData) return;

    let selectedSize = 0;

    // Check if user is in detail view or dashboard
    const isInDetailView = document.getElementById('scan-results') &&
        document.getElementById('scan-results').classList.contains('active');

    if (isInDetailView && selectedPaths.size > 0) {
        // Detail view: Calculate based on selected file paths
        if (scanData) {
            scanData.results.forEach(r => {
                r.items.forEach(i => {
                    if (selectedPaths.has(i.path)) selectedSize += i.size;
                });
            });
        }
    } else {
        // Dashboard: Calculate based on selected categories
        const selectedCheckboxes = document.querySelectorAll('.category-checkbox:checked');
        const selectedCategoryIds = Array.from(selectedCheckboxes)
            .map(cb => cb.dataset.categoryId)
            .filter(Boolean);

        if (scanData) {
            scanData.results.forEach(r => {
                if (selectedCategoryIds.includes(r.category.id)) {
                    selectedSize += r.totalSize;
                }
            });
        }
    }

    const total = window.diskData.total;
    const used = window.diskData.used;
    const usedPercent = (used / total) * 100;
    const cleanPercent = (selectedSize / total) * 100;

    // We want to show the 'clean' part AT THE END of the 'used' bar.
    // CSS: .disk-bar-fill width is 'usedPercent'.
    // We want .disk-bar-projected to act as a "highlight" of the chunk to be removed.
    // So correct math:
    // Left = (used - selectedSize) / total * 100
    // Width = cleanPercent

    const left = ((used - selectedSize) / total) * 100;
    const el = document.getElementById('disk-bar-projected');
    const txt = document.getElementById('disk-projection-text');

    if (el && txt) {
        // Safety check if cleaning more than used (impossible theoretically but logic safety)
        const safeLeft = Math.max(0, left);

        el.style.left = `${safeLeft}% `;
        el.style.width = `${cleanPercent}% `;

        if (selectedSize > 0) {
            txt.textContent = `Expected free: +${formatSize(selectedSize)} `;
            el.style.opacity = '1';
        } else {
            txt.textContent = '';
            el.style.width = '0%';
            el.style.opacity = '0';
        }
    }
}

async function loadDiskInfo() {
    try {
        const data = await window.electronAPI.getDiskInfo();
        window.diskData = data;

        const percent = Math.round((data.used / data.total) * 100);
        document.getElementById('disk-bar-fill').style.width = `${percent}% `;

        document.getElementById('disk-used').textContent = `${formatSize(data.used)} Used`;
        document.getElementById('disk-free').textContent = `${formatSize(data.free)} Free`;
    } catch (e) { }
}

window.ignoreFile = async (path) => {
    try {
        await window.electronAPI.ignore([path]);

        // Optimistic UI update
        if (scanData) {
            scanData.results.forEach(r => {
                r.items = r.items.filter(i => i.path !== path);
                r.totalSize = r.items.reduce((acc, i) => acc + i.size, 0);
            });
        }

        if (selectedPaths.has(path)) {
            selectedPaths.delete(path);
            updateSelectionStats();
        }

        renderFilesList();
        renderDashboard();
    } catch (e) { console.error(e); }
};

window.confirmClean = async () => {
    const items = Array.from(selectedPaths);

    // Track which categories these items belong to
    const categoryNames = new Set();
    if (scanData && currentCategory) {
        categoryNames.add(currentCategory.name);
    }

    console.log('Cleaning items:', items);
    console.log('Categories:', Array.from(categoryNames));

    try {
        const result = await window.electronAPI.clean({
            items,
            categories: Array.from(categoryNames)
        });

        console.log('Clean result:', result);

        if (result.errors && result.errors.length > 0) {
            console.error('Clean errors:', result.errors);
            alert(`Cleaned ${result.count} items.Errors: ${result.errors.length} \nCheck console for details.`);
        } else {
            alert(`Successfully cleaned ${result.count} items!`);
        }

        selectedPaths.clear();
        alert('Click "Run Smart Scan" to refresh.');
    } catch (e) {
        console.error('Clean failed:', e);
        alert('Clean failed: ' + e.message);
    }
};

window.filterResults = () => renderFilesList();

// Helper to escape paths for use in onclick attributes
function escapeForJS(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\''");
}

async function loadBlacklist() {
    const config = await window.electronAPI.getSettings();
    const scanners = await window.electronAPI.getScanners();

    // Folders Zone
    const foldersContainer = document.getElementById('ignored-folders-list');
    const folders = config.ignoredFolders || [];
    if (folders.length === 0) {
        foldersContainer.innerHTML = '<p class="empty-message">No folders ignored</p>';
    } else {
        foldersContainer.innerHTML = folders.map(p => `
            <div class="blacklist-item">
                <span class="path" title="${p}">${p}</span>
                <button class="text-btn danger unignore-folder-btn" data-path="${p}">Un-ignore</button>
            </div>
        `).join('');
    }

    // Files Zone
    const filesContainer = document.getElementById('ignored-files-list');
    const files = config.ignoredPaths || [];
    if (files.length === 0) {
        filesContainer.innerHTML = '<p class="empty-message">No files ignored</p>';
    } else {
        filesContainer.innerHTML = files.map(p => `
            <div class="blacklist-item">
                <span class="path" title="${p}">${p}</span>
                <button class="text-btn danger unignore-file-btn" data-path="${p}">Un-ignore</button>
            </div>
        `).join('');
    }

    // Categories Zone
    const categoriesContainer = document.getElementById('ignored-categories-list');
    const categories = config.ignoredCategories || [];
    if (categories.length === 0) {
        categoriesContainer.innerHTML = '<p class="empty-message">No categories ignored</p>';
    } else {
        categoriesContainer.innerHTML = categories.map(catId => {
            const scanner = scanners.find(s => s.id === catId);
            const name = scanner ? scanner.name : catId;
            // Get current safety level (override or default)
            const defaultSafety = scanner ? scanner.safetyLevel : 'moderate';
            const safety = categoryOverrides[catId] || defaultSafety;
            return `
                <div class="blacklist-item">
                    <span class="path">${name}</span>
                    <span class="badge ${safety}">${safety.toUpperCase()}</span>
                    <button class="text-btn danger unignore-category-btn" data-category-id="${catId}">Un-ignore</button>
                </div>
            `;
        }).join('');
    }

    // Attach event listeners using event delegation
    document.querySelectorAll('.unignore-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.getAttribute('data-path');
            unignoreFolder(path);
        });
    });

    document.querySelectorAll('.unignore-file-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.getAttribute('data-path');
            unignoreFile(path);
        });
    });

    document.querySelectorAll('.unignore-category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const catId = btn.getAttribute('data-category-id');
            unignoreCategory(catId);
        });
    });
}

// Filter blacklist items based on search query
window.filterBlacklist = (query) => {
    const q = query.toLowerCase().trim();

    // Get all zones
    const zones = document.querySelectorAll('.blacklist-zone');

    zones.forEach(zone => {
        const items = zone.querySelectorAll('.blacklist-item');
        let hasVisibleItems = false;

        items.forEach(item => {
            const path = item.querySelector('.path')?.textContent.toLowerCase() || '';
            if (q === '' || path.includes(q)) {
                item.classList.remove('hidden');
                hasVisibleItems = true;
            } else {
                item.classList.add('hidden');
            }
        });

        // Show/hide zone based on whether it has visible items
        // (but only if there are items, not if it's empty)
        const emptyMsg = zone.querySelector('.empty-message');
        if (items.length > 0) {
            zone.classList.toggle('hidden', !hasVisibleItems && q !== '');
        }
    });
};

// Add Folders via picker
window.addIgnoredFolders = async () => {
    const folders = await window.electronAPI.pickFolders();
    if (folders && folders.length > 0) {
        await window.electronAPI.ignoreFolders(folders);
        loadBlacklist();
    }
};

// Add Files via picker
window.addIgnoredFiles = async () => {
    const files = await window.electronAPI.pickFiles();
    if (files && files.length > 0) {
        await window.electronAPI.ignore(files);
        loadBlacklist();
    }
};

// Un-ignore functions
window.unignoreFolder = async (folder) => {
    await window.electronAPI.unignoreFolder(folder);
    loadBlacklist();
};

window.unignoreFile = async (filePath) => {
    console.log('[DEBUG] Attempting to un-ignore file:', filePath);
    const result = await window.electronAPI.unignore([filePath]);
    console.log('[DEBUG] Un-ignore result:', result);
    await loadBlacklist();
    console.log('[DEBUG] Blacklist reloaded');
};

window.unignoreCategory = async (categoryId) => {
    await window.electronAPI.unignoreCategory(categoryId);
    // Reload config to get updated ignoredCategories
    config = await window.electronAPI.getSettings();
    loadBlacklist();
    // Refresh dashboard to show the category again
    if (scanData) {
        renderDashboard(scanData);
    } else {
        const scanners = await window.electronAPI.getScanners();
        renderEmptyDashboard(scanners);
    }
};

// Ignore category from dashboard
window.ignoreCategory = async (categoryId) => {
    await window.electronAPI.ignoreCategory(categoryId);
    // Reload config to get updated ignoredCategories
    config = await window.electronAPI.getSettings();
    // Refresh dashboard to hide the category
    if (scanData) {
        renderDashboard(scanData);
    } else {
        const scanners = await window.electronAPI.getScanners();
        renderEmptyDashboard(scanners);
    }
};

// Legacy alias
window.unignore = async (p) => {
    await window.electronAPI.unignore([p]);
    loadBlacklist();
};
async function loadHistory() {
    const logs = await window.electronAPI.getHistory();
    document.querySelector('#history-table tbody').innerHTML = logs.map(l => {
        const date = new Date(l.timestamp);
        const dateStr = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        const categories = l.categories && l.categories.length > 0 ? l.categories.join(', ') : 'N/A';

        return `<tr>
            <td>${dateStr} ${timeStr}</td>
            <td>${categories}</td>
            <td>${l.itemsCount}</td>
            <td>${formatSize(l.totalFreed || 0)}</td>
        </tr>`;
    }).join('');
}

// Settings
async function loadSettings() {
    const c = await window.electronAPI.getSettings();

    // Schedule
    const sched = c.autoCleanSchedule || {};
    document.getElementById('schedule-enable').checked = sched.enabled;
    document.getElementById('schedule-freq').value = sched.frequency || 'daily';
    document.getElementById('schedule-time').value = sched.time || '09:00';

    if (sched.day) {
        if (sched.frequency === 'weekly') document.getElementById('schedule-weekday').value = sched.day;
        if (sched.frequency === 'monthly') document.getElementById('schedule-day').value = sched.day;
    }

    // Delete Mode
    const mode = c.deleteMode || 'trash';
    const modeRadio = document.querySelector(`input[name="delete-mode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    // Trigger UI update
    if (typeof updateScheduleInputs === 'function') {
        updateScheduleInputs();
    }

    // Start at Login - always refresh from system state
    try {
        const loginItem = await window.electronAPI.getLoginItem();
        const loginCheckbox = document.getElementById('start-at-login');
        if (loginCheckbox) {
            // Always update to reflect current system state
            loginCheckbox.checked = loginItem.openAtLogin;
            console.log('[Settings] Login item state from system:', loginItem.openAtLogin);

            // Remove existing listener to avoid duplicates, then add new one
            loginCheckbox.onchange = () => detectChanges();
        }
    } catch (e) {
        console.log('Login item API not available:', e);
    }

    // Auto Clean Categories
    const scanners = await window.electronAPI.getScanners();
    const container = document.getElementById('auto-clean-categories');
    const deleteMode = c.deleteMode || 'trash';

    if (container) {
        container.innerHTML = scanners.map(s => {
            const currentSafety = getSafety(s.id, s.safetyLevel);
            // Disable trash when delete mode is trash
            const isTrashDisabled = s.id === 'trash' && deleteMode === 'trash';
            const disabledAttr = isTrashDisabled ? 'disabled' : '';
            const disabledClass = isTrashDisabled ? 'disabled-option' : '';
            const checkedAttr = (sched.categories || []).includes(s.id) && !isTrashDisabled ? 'checked' : '';

            return `
    <label class="checkbox-label ${disabledClass}" ${isTrashDisabled ? 'title="Cannot select Trash when Deletion Mode is Move to Trash"' : ''}>
        <input type="checkbox" name="auto-cat" value="${s.id}" ${checkedAttr} ${disabledAttr}
            ${isTrashDisabled ? 'onclick="alert(\'Cannot select Trash when Deletion Mode is Move to Trash.\\n\\nChange Settings → Deletion Mode to Delete Permanently first.\'); return false;"' : ''}>
            ${s.name} <span class="badge ${currentSafety}">${currentSafety}</span>
            ${isTrashDisabled ? '<span class="disabled-note">(requires permanent delete)</span>' : ''}
        </label>
`;
        }).join('');
    }

    // Store initial settings for change detection
    storeInitialSettings();

    // Attach change detection (not auto-save)
    attachChangeDetection();
}

// Refresh auto-clean categories based on current delete mode
async function refreshAutoCleanCategories() {
    const scanners = await window.electronAPI.getScanners();
    const container = document.getElementById('auto-clean-categories');
    const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
    const sched = config.autoCleanSchedule || {};

    if (container) {
        container.innerHTML = scanners.map(s => {
            const currentSafety = getSafety(s.id, s.safetyLevel);
            // Disable trash when delete mode is trash
            const isTrashDisabled = s.id === 'trash' && deleteMode === 'trash';
            const disabledAttr = isTrashDisabled ? 'disabled' : '';
            const disabledClass = isTrashDisabled ? 'disabled-option' : '';
            const checkedAttr = (sched.categories || []).includes(s.id) && !isTrashDisabled ? 'checked' : '';

            return `
    <label class="checkbox-label ${disabledClass}" ${isTrashDisabled ? 'title="Cannot select Trash when Deletion Mode is Move to Trash"' : ''}>
        <input type="checkbox" name="auto-cat" value="${s.id}" ${checkedAttr} ${disabledAttr}
            ${isTrashDisabled ? 'onclick="alert(\'Cannot select Trash when Deletion Mode is Move to Trash.\\n\\nChange Settings → Deletion Mode to Delete Permanently first.\'); return false;"' : ''}>
            ${s.name} <span class="badge ${currentSafety}">${currentSafety}</span>
            ${isTrashDisabled ? '<span class="disabled-note">(requires permanent delete)</span>' : ''}
        </label>
`;
        }).join('');
    }
}

// Initial settings for change detection
let initialSettings = {};

function storeInitialSettings() {
    const enabled = document.getElementById('schedule-enable')?.checked || false;
    const freq = document.getElementById('schedule-freq')?.value || 'daily';
    const time = document.getElementById('schedule-time')?.value || '09:00';

    let day = undefined;
    if (freq === 'weekly') day = document.getElementById('schedule-weekday')?.value;
    if (freq === 'monthly') day = document.getElementById('schedule-day')?.value;

    const cats = Array.from(document.querySelectorAll('input[name="auto-cat"]:checked')).map(el => el.value);
    const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
    const startAtLogin = document.getElementById('start-at-login')?.checked || false;

    initialSettings = {
        enabled,
        freq,
        time,
        day,
        cats: cats.join(','),
        deleteMode,
        startAtLogin,
        // AI Cat settings
        aiCatEnabled,
        aiCatProvider,
        aiCatModel
    };

    // Hide save button initially
    const container = document.getElementById('save-changes-container');
    if (container) container.classList.add('hidden');
}

function getCurrentSettings() {
    const enabled = document.getElementById('schedule-enable')?.checked || false;
    const freq = document.getElementById('schedule-freq')?.value || 'daily';
    const time = document.getElementById('schedule-time')?.value || '09:00';

    let day = undefined;
    if (freq === 'weekly') day = document.getElementById('schedule-weekday')?.value;
    if (freq === 'monthly') day = document.getElementById('schedule-day')?.value;

    const cats = Array.from(document.querySelectorAll('input[name="auto-cat"]:checked')).map(el => el.value);
    const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
    const startAtLogin = document.getElementById('start-at-login')?.checked || false;

    // Include AI Cat settings
    return {
        enabled, freq, time, day,
        cats: cats.join(','),
        deleteMode,
        startAtLogin,
        aiCatEnabled,
        aiCatProvider,
        aiCatModel
    };
}

function detectChanges() {
    const current = getCurrentSettings();
    const changes = [];

    if (initialSettings.time !== current.time) {
        changes.push(`Time: ${initialSettings.time} → ${current.time}`);
    }
    if (initialSettings.deleteMode !== current.deleteMode) {
        changes.push(`Delete: ${initialSettings.deleteMode} → ${current.deleteMode}`);
    }
    if (initialSettings.enabled !== current.enabled) {
        changes.push(`Schedule: ${current.enabled ? 'enabled' : 'disabled'}`);
    }
    if (initialSettings.startAtLogin !== current.startAtLogin) {
        changes.push(`Start at Login: ${current.startAtLogin ? 'enabled' : 'disabled'}`);
    }
    if (initialSettings.freq !== current.freq) {
        changes.push(`Frequency: ${current.freq}`);
    }
    if (initialSettings.cats !== current.cats) {
        const added = current.cats.split(',').filter(c => c && !initialSettings.cats.includes(c));
        const removed = initialSettings.cats.split(',').filter(c => c && !current.cats.includes(c));
        if (added.length) changes.push(`Added categories: ${added.length}`);
        if (removed.length) changes.push(`Removed categories: ${removed.length}`);
    }

    // AI Cat changes
    if (initialSettings.aiCatEnabled !== current.aiCatEnabled) {
        changes.push(`AI Cat: ${current.aiCatEnabled ? 'enabled' : 'disabled'}`);
    }
    if (initialSettings.aiCatProvider !== current.aiCatProvider) {
        changes.push(`AI Provider: ${current.aiCatProvider || 'none'}`);
    }
    if (initialSettings.aiCatModel !== current.aiCatModel) {
        changes.push(`AI Model: ${current.aiCatModel || 'none'}`);
    }

    const container = document.getElementById('save-changes-container');
    const preview = document.getElementById('changes-preview');

    if (changes.length > 0) {
        preview.innerHTML = changes.map(c => `<div class="change-item">• ${c}</div>`).join('');
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

function attachChangeDetection() {
    const inputs = document.querySelectorAll('#settings input, #settings select');
    inputs.forEach(input => {
        input.addEventListener('change', detectChanges);
    });

    // Explicit listener for frequency to update UI immediately
    const freqEl = document.getElementById('schedule-freq');
    if (freqEl) {
        freqEl.addEventListener('change', () => {
            updateScheduleInputs();
            detectChanges();
        });
    }

    // AI Cat Helper listeners - update UI and show save button
    const aiCatToggle = document.getElementById('aicat-enabled');
    if (aiCatToggle) {
        aiCatToggle.addEventListener('change', (e) => {
            aiCatEnabled = e.target.checked;
            console.log('[AICat] Toggle changed:', aiCatEnabled);
            detectChanges();
        });
    }

    const aiCatProvider = document.getElementById('aicat-provider-select');
    if (aiCatProvider) {
        aiCatProvider.addEventListener('change', (e) => {
            onProviderChange(e.target);
        });
    }

    const aiCatModelSelect = document.getElementById('aicat-model');
    if (aiCatModelSelect) {
        aiCatModelSelect.addEventListener('change', (e) => {
            aiCatModel = e.target.value;
            console.log('[AICat] Model changed:', aiCatModel);
            detectChanges();
        });
    }

    // Day of month validation - enforce 1-28 range
    const dayEl = document.getElementById('schedule-day');
    if (dayEl) {
        dayEl.addEventListener('input', () => {
            let val = parseInt(dayEl.value) || 1;
            if (val < 1) val = 1;
            if (val > 28) val = 28;
            dayEl.value = val;
        });
        dayEl.addEventListener('blur', () => {
            let val = parseInt(dayEl.value) || 1;
            if (val < 1) val = 1;
            if (val > 28) val = 28;
            dayEl.value = val;
        });
    }
}

window.saveSettings = async (silent = false) => {
    const enabled = document.getElementById('schedule-enable').checked;
    const freq = document.getElementById('schedule-freq').value;
    const time = document.getElementById('schedule-time').value;

    let day = undefined;
    if (freq === 'weekly') day = parseInt(document.getElementById('schedule-weekday').value);
    if (freq === 'monthly') day = parseInt(document.getElementById('schedule-day').value);

    const cats = Array.from(document.querySelectorAll('input[name="auto-cat"]:checked')).map(el => el.value);

    const deleteMode = document.querySelector('input[name="delete-mode"]:checked').value;
    const startAtLogin = document.getElementById('start-at-login')?.checked || false;

    const settings = {
        categoryOverrides,
        deleteMode,
        startAtLogin,
        autoCleanSchedule: {
            enabled,
            frequency: freq,
            time,
            day,
            categories: cats
        },
        // AI Cat Helper settings
        aiCatEnabled,
        aiCatProvider,
        aiCatModel
    };

    // Also save to localStorage for quick access
    localStorage.setItem('mac-cleaner-settings', JSON.stringify({ deleteMode, startAtLogin }));

    try {
        await window.electronAPI.saveSettings(settings);

        // Also update login item in system
        try {
            await window.electronAPI.setLoginItem(startAtLogin);
        } catch (e) {
            console.log('Failed to set login item:', e);
        }

        config = { ...config, ...settings };
        updateTexts();

        // Update window variables for AI Cat
        window.aiCatEnabled = aiCatEnabled;
        window.aiCatProvider = aiCatProvider;
        window.aiCatModel = aiCatModel;
        console.log('[AICat] Window variables synced after save:', window.aiCatEnabled, window.aiCatProvider, window.aiCatModel);

        // Reset initial settings to current (hide save container)
        storeInitialSettings();

        // Refresh auto-clean categories to update trash disable state based on new delete mode
        await refreshAutoCleanCategories();

        // If delete mode is trash, uncheck dashboard trash checkbox immediately
        if (deleteMode === 'trash') {
            const trashCheckbox = document.querySelector('.category-checkbox[data-category-id="trash"]');
            if (trashCheckbox && trashCheckbox.checked) {
                trashCheckbox.checked = false;
                updateSelectionStats();
            }
        }

        if (!silent) {
            // Optional visual feedback
        }
    } catch (e) {
        console.error(e);
    }
};

// Auto-save listeners helper
// Removed duplicate attachAutoSave
// The main one is defined above at line 571

// New Helpers
window.toggleCategory = (id, checked) => {
    if (!scanData) return;

    // Block selecting Trash category when delete mode is "trash"
    if (id === 'trash' && checked) {
        const deleteMode = document.querySelector('input[name="delete-mode"]:checked')?.value || 'trash';
        if (deleteMode === 'trash') {
            alert('Cannot clean Trash when Deletion Mode is "Move to Trash".\n\nPlease either:\n• Empty Trash manually (Finder → Empty Trash)\n• Change Settings → Deletion Mode to "Delete Permanently"');
            // Uncheck the checkbox
            const checkbox = document.querySelector(`.category-checkbox[data-category-id="${id}"]`);
            if (checkbox) checkbox.checked = false;
            return;
        }
    }

    const result = scanData.results.find(r => r.category.id === id);
    if (!result) return;

    result.items.forEach(item => {
        if (checked) selectedPaths.add(item.path);
        else selectedPaths.delete(item.path);
    });

    updateSelectionStats();
    calculateDiskProjection();

    // If in detail view, update checkboxes there too
    if (currentCategory && currentCategory.id === id) {
        renderFilesList();
    }
}


// Re-scan specific categories
async function rescanCategories(categoryIds) {
    if (!categoryIds || categoryIds.length === 0) return;

    console.log('[Re-scan] Scanning categories:', categoryIds);

    // Show loading state
    categoryIds.forEach(catId => {
        const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
        if (card) {
            card.classList.add('scanning');
            const sizeEl = card.querySelector('.category-size');
            if (sizeEl) sizeEl.textContent = 'Scanning...';
        }
    });

    try {
        // Scan only selected categories
        const results = await window.electronAPI.scanCategories(categoryIds);

        // Update scanData with new results
        if (scanData && scanData.results) {
            categoryIds.forEach(catId => {
                const newResult = results.results.find(r => r.category.id === catId);
                const oldIndex = scanData.results.findIndex(r => r.category.id === catId);

                if (newResult && oldIndex !== -1) {
                    scanData.results[oldIndex] = newResult;
                }
            });

            // Recalculate totals
            scanData.totalSize = scanData.results.reduce((sum, r) => sum + r.totalSize, 0);
            scanData.totalItems = scanData.results.reduce((sum, r) => sum + r.items.length, 0);
        }

        // Update UI
        renderDashboard(scanData);

        // Mark these categories as scanned
        categoryIds.forEach(catId => {
            scannedCategoryIds.add(catId);
        });

        console.log('[Re-scan] Complete. Updated results:', results);

        // Auto-scan Trash after cleaning (if config enabled AND using trash mode)
        if (!categoryIds.includes('trash')) {
            try {
                const config = await window.electronAPI.getSettings();
                // Only rescan trash if:
                // 1. alwaysScanTrash is enabled (default true)
                // 2. deleteMode is 'trash' (not 'permanent')
                const shouldRescanTrash = config.alwaysScanTrash !== false && config.deleteMode !== 'permanent';
                console.log('[Re-scan] Config deleteMode:', config.deleteMode, 'shouldRescanTrash:', shouldRescanTrash);

                if (shouldRescanTrash) {
                    console.log('[Re-scan] Auto-scanning Trash after clean');
                    const trashResults = await window.electronAPI.scanCategories(['trash']);

                    // Merge trash results into scanData
                    if (scanData && scanData.results) {
                        const trashIdx = scanData.results.findIndex(r => r.category.id === 'trash');
                        const newTrashResult = trashResults.results.find(r => r.category.id === 'trash');

                        if (newTrashResult && trashIdx !== -1) {
                            scanData.results[trashIdx] = newTrashResult;
                            scanData.totalSize = scanData.results.reduce((sum, r) => sum + r.totalSize, 0);
                            scanData.totalItems = scanData.results.reduce((sum, r) => sum + r.items.length, 0);

                            // Re-render to show updated Trash size
                            renderDashboard(scanData);
                            console.log('[Re-scan] Trash updated:', newTrashResult.totalSize);
                        }
                    }
                }
            } catch (error) {
                console.error('[Re-scan] Failed to auto-scan Trash:', error);
            }
        }
    } catch (error) {
        console.error('[Re-scan] Failed:', error);
        alert('Re-scan failed: ' + error.message);
    } finally {
        // Remove loading state
        categoryIds.forEach(catId => {
            const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
            if (card) {
                card.classList.remove('scanning');
            }
        });
    }
}

window.cleanSelectedCategories = async () => {
    // Get selected categories from checkboxes
    const selectedCheckboxes = document.querySelectorAll('.category-checkbox:checked');
    const selectedCategoryIds = Array.from(selectedCheckboxes)
        .map(cb => cb.dataset.categoryId)
        .filter(Boolean);

    if (selectedCategoryIds.length === 0) {
        alert('Please select at least one category to clean');
        return;
    }

    console.log('[Clean] Selected categories:', selectedCategoryIds);

    // Check if we need to scan first
    const needsScan = selectedCategoryIds.some(catId => {
        if (!scanData || !scanData.results) return true;
        const result = scanData.results.find(r => r.category.id === catId);
        return !result || result.items.length === 0;
    });

    if (needsScan) {
        // Show loading state
        selectedCategoryIds.forEach(catId => {
            const card = document.querySelector(`.category-card[data-category-id="${catId}"]`);
            if (card) {
                card.classList.add('scanning');
                const sizeEl = card.querySelector('.category-size');
                if (sizeEl) sizeEl.textContent = 'Scanning...';
            }
        });

        try {
            console.log('Auto-scanning selected:', selectedCategoryIds);
            const scanResults = await window.electronAPI.scanCategories(selectedCategoryIds);

            if (!scanData) {
                // Initialize scanData with ALL scanners to prevent data loss
                const scanners = await window.electronAPI.getScanners();
                scanData = {
                    results: scanners.map(s => ({
                        category: { id: s.id, name: s.name, safetyLevel: s.safetyLevel },
                        items: [],
                        totalSize: 0
                    })),
                    totalSize: 0,
                    totalItems: 0
                };
            }

            // Merge results
            scanResults.results.forEach(newR => {
                const idx = scanData.results.findIndex(r => r.category.id === newR.category.id);
                if (idx !== -1) scanData.results[idx] = newR;
            });

            // Recalculate totals
            scanData.totalSize = scanData.results.reduce((sum, r) => sum + r.totalSize, 0);
            scanData.totalItems = scanData.results.reduce((sum, r) => sum + r.items.length, 0);

            // Re-render to show updated sizes
            renderDashboard();

            // RESTORE SELECTION
            selectedCategoryIds.forEach(id => {
                const cb = document.querySelector(`.category-checkbox[data-category-id="${id}"]`);
                if (cb) cb.checked = true;
            });
            updateSelectionStats();

        } catch (error) {
            console.error('Scan failed:', error);
            alert('Scan failed: ' + error.message);
            // Even on error, render what we have
            renderDashboard();
            return;
        }
    }

    // Collect items to clean
    const items = [];
    const categoryNames = new Set();

    selectedCategoryIds.forEach(catId => {
        const result = scanData.results.find(r => r.category.id === catId);
        if (result && result.items.length > 0) {
            items.push(...result.items.map(item => item.path));
            categoryNames.add(result.category.name);
        }
    });

    if (items.length === 0) {
        alert('No items to clean in selected categories');
        return;
    }

    if (!confirm(`Clean ${items.length} items from ${categoryNames.size} categories ? `)) {
        return;
    }

    console.log('Cleaning items:', items);
    console.log('Categories:', Array.from(categoryNames));

    try {
        const result = await window.electronAPI.clean({
            items,
            categories: Array.from(categoryNames)
        });

        console.log('Clean result:', result);

        if (result.errors && result.errors.length > 0) {
            console.error('Clean errors:', result.errors);
            alert(`Cleaned ${result.count} items.Errors: ${result.errors.length} \nCheck console for details.`);
        } else {
            alert(`Successfully cleaned ${result.count} items!`);
        }

        // Auto re-scan cleaned categories
        if (selectedCategoryIds.length > 0) {
            console.log('[Re-scan] Starting re-scan of cleaned categories:', selectedCategoryIds);
            await rescanCategories(selectedCategoryIds);
        }
    } catch (e) {
        console.error('Clean failed:', e);
        alert('Clean failed: ' + e.message);
    }
};


window.resetCategoryLayout = async () => {
    if (!confirm('Reset all categories to their original safety levels?')) return;

    // Clear overrides
    categoryOverrides = {};

    // Save empty overrides
    await window.electronAPI.saveLayout({});

    // Re-render dashboard with original safety levels
    if (scanData) {
        renderDashboard();
    } else {
        try {
            const scanners = await window.electronAPI.getScanners();
            renderEmptyDashboard(scanners);
        } catch (e) {
            console.error(e);
        }
    }

    // Also update blacklist badges and settings badges
    loadBlacklist();
    updateSettingsCategoryBadges();
};

// ============================================
// AI Cat Helper - Settings Functions
// ============================================

// Use ONLY window.* variables to avoid sync issues
window.aiCatApiKey = window.aiCatApiKey || '';
window.aiCatEnabled = window.aiCatEnabled || false;
window.aiCatModel = window.aiCatModel || '';
window.aiCatProvider = window.aiCatProvider || ''; // 'gemini', 'openai', 'grok', 'openrouter'

// Provider model lists
const AI_PROVIDER_MODELS = {
    gemini: [
        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Default)' },
        { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Fast)' },
        { value: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash Latest' },
        { value: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro Latest' }
    ],
    openai: [
        { value: 'gpt-4o', label: 'GPT-4o (Best)' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Cheap)' }
    ],
    grok: [
        { value: 'grok-2', label: 'Grok 2 (Best)' },
        { value: 'grok-2-mini', label: 'Grok 2 Mini (Fast)' },
        { value: 'grok-beta', label: 'Grok Beta' }
    ],
    openrouter: [
        { value: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (Free)' },
        { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
        { value: 'openai/gpt-oss-120b:free', label: 'GPT OSS 120B (Free)' },
        { value: 'deepseek/deepseek-r1-0528:free', label: 'DeepSeek R1 (Free)' },
        { value: 'google/gemma-3-27b-it:free', label: 'Gemma 3 27B (Free)' },
        { value: 'openai/gpt-oss-20b:free', label: 'GPT OSS 20B (Free)' }
    ]
};

// Detect provider from API key format
function detectAIProvider(apiKey) {
    if (!apiKey) return '';
    if (apiKey.startsWith('AIza')) return 'gemini';
    if (apiKey.startsWith('sk-or-v1-')) return 'openrouter'; // OpenRouter first (more specific)
    if (apiKey.startsWith('sk-')) return 'openai';
    if (apiKey.startsWith('xai-')) return 'grok';
    return '';
}

// Update model dropdown based on provider
function updateModelDropdown(provider) {
    const select = document.getElementById('aicat-model');

    if (!select) return;

    // Clear existing options
    select.innerHTML = '';

    if (!provider || !AI_PROVIDER_MODELS[provider]) {
        select.innerHTML = '<option value="">-- Select provider first --</option>';
        aiCatModel = '';
        return;
    }

    // Add model options
    const models = AI_PROVIDER_MODELS[provider];
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.label;
        select.appendChild(option);
    });

    // Keep current model if it's valid for this provider, otherwise use first
    if (!models.find(m => m.value === aiCatModel)) {
        aiCatModel = models[0].value;
        console.log('[AICat] Model dropdown updated for', provider, '- reset to default:', aiCatModel);
    } else {
        console.log('[AICat] Model dropdown updated for', provider, '- preserved model:', aiCatModel);
    }
    select.value = aiCatModel;
}

// Initialize AI Cat settings on page load
async function initAICatSettings() {
    try {
        // Load saved state from config
        const config = await window.electronAPI.getSettings();
        aiCatEnabled = config.aiCatEnabled || false;
        aiCatModel = config.aiCatModel || '';
        aiCatProvider = config.aiCatProvider || '';

        // Set toggle state
        const toggle = document.getElementById('aicat-enabled');
        if (toggle) toggle.checked = aiCatEnabled;

        // Set provider selector
        const providerSelect = document.getElementById('aicat-provider-select');
        if (providerSelect && aiCatProvider) {
            providerSelect.value = aiCatProvider;
            updateModelDropdown(aiCatProvider);
        }

        // Load API key
        const result = await window.electronAPI.getAICatApiKey();
        if (result.success && result.apiKey) {
            aiCatApiKey = result.apiKey;
            const input = document.getElementById('aicat-api-key');
            if (input) input.value = result.apiKey;
        }

        console.log('[AICat] Settings loaded:', { enabled: aiCatEnabled, provider: aiCatProvider, model: aiCatModel, hasKey: !!aiCatApiKey });
    } catch (e) {
        console.error('[AICat] Failed to load settings:', e);
    }
}

// Manual provider selector change
async function onProviderChange(select) {
    aiCatProvider = select.value;

    // Update model dropdown
    updateModelDropdown(aiCatProvider);

    // Update placeholder
    const input = document.getElementById('aicat-api-key');
    const placeholders = {
        gemini: 'Enter Gemini API key (AIza...)',
        openai: 'Enter OpenAI API key (sk-...)',
        grok: 'Enter Grok API key (xai-...)',
        openrouter: 'Enter OpenRouter API key (sk-...)'
    };
    if (input) input.placeholder = placeholders[aiCatProvider] || 'Select provider first';

    // Save provider
    try {
        const config = await window.electronAPI.getSettings();
        await window.electronAPI.saveSettings({ ...config, aiCatProvider, aiCatModel });
        console.log('[AICat] Provider changed to:', aiCatProvider);
    } catch (e) { }
}

// Toggle AI Cat activation
// Toggle AI Cat activation - mark dirty, don't auto-save
async function onAICatToggle(checkbox) {
    aiCatEnabled = checkbox.checked;
    window.aiCatEnabled = aiCatEnabled; // Sync to window
    detectChanges(); // Show Save button
    console.log('[AICat] Enabled changed:', aiCatEnabled, '- waiting for Save');
}

// Handle model change - mark dirty, don't auto-save
async function onAICatModelChange(select) {
    aiCatModel = select.value;
    window.aiCatModel = aiCatModel; // Sync to window
    detectChanges(); // Show Save button
    console.log('[AICat] Model changed to:', aiCatModel, '- waiting for Save');
}

// Load AI Cat prompts into window globals and textareas
async function loadAICatPrompts() {
    try {
        const settings = await window.electronAPI.getSettings();
        window.aiCatPromptFile = settings.aiCatPromptFile || DEFAULT_FILE_PROMPT;
        window.aiCatPromptThreat = settings.aiCatPromptThreat || DEFAULT_THREAT_PROMPT;

        // Populate textareas if they exist
        const fileTextarea = document.getElementById('aicat-prompt-file');
        const threatTextarea = document.getElementById('aicat-prompt-threat');

        if (fileTextarea) fileTextarea.value = window.aiCatPromptFile;
        if (threatTextarea) threatTextarea.value = window.aiCatPromptThreat;

        // Setup change detection
        setupPromptChangeDetection();
    } catch (err) {
        console.error('[AICat] Failed to load prompts:', err);
        window.aiCatPromptFile = DEFAULT_FILE_PROMPT;
        window.aiCatPromptThreat = DEFAULT_THREAT_PROMPT;
    }
}

// Delete API key completely
async function deleteAICatApiKey() {
    if (!confirm('Delete AI Cat API key from storage?\n\nThis will permanently remove the key.')) {
        return;
    }

    try {
        // Clear from storage
        await window.electronAPI.saveAICatApiKey('');

        // Clear UI
        aiCatApiKey = '';
        const input = document.getElementById('aicat-api-key');
        const status = document.getElementById('aicat-api-status');
        if (input) input.value = '';
        if (status) {
            status.textContent = '✅ API key deleted';
            status.className = 'api-status success';
            setTimeout(() => { status.textContent = ''; }, 2000);
        }

        console.log('[AICat] API key deleted from storage');
    } catch (e) {
        console.error('[AICat] Failed to delete API key:', e);
        const status = document.getElementById('aicat-api-status');
        if (status) {
            status.textContent = '❌ Delete failed';
            status.className = 'api-status error';
        }
    }
}

// Toggle API key visibility
function toggleApiKeyVisibility() {
    const input = document.getElementById('aicat-api-key');
    const showIcon = document.getElementById('eye-icon-show');
    const hideIcon = document.getElementById('eye-icon-hide');

    if (input.type === 'password') {
        input.type = 'text';
        showIcon.classList.add('hidden');
        hideIcon.classList.remove('hidden');
    } else {
        input.type = 'password';
        showIcon.classList.remove('hidden');
        hideIcon.classList.add('hidden');
    }
}

// Handle API key change - detect provider and update model list
async function onAICatApiKeyChange() {
    const input = document.getElementById('aicat-api-key');
    const newKey = input.value.trim();

    // Detect provider from key format and auto-select
    const newProvider = detectAIProvider(newKey);

    if (newProvider && newProvider !== aiCatProvider) {
        aiCatProvider = newProvider;

        // Update provider dropdown
        const providerSelect = document.getElementById('aicat-provider-select');
        if (providerSelect) providerSelect.value = newProvider;

        // Update model dropdown for new provider
        updateModelDropdown(newProvider);

        console.log('[AICat] Auto-detected provider:', newProvider);

        // Save provider to config
        try {
            const config = await window.electronAPI.getSettings();
            await window.electronAPI.saveSettings({ ...config, aiCatProvider, aiCatModel });
        } catch (e) { }
    }

    if (newKey === aiCatApiKey) return; // No change

    try {
        const result = await window.electronAPI.saveAICatApiKey(newKey);
        if (result.success) {
            aiCatApiKey = newKey;
            console.log('[AICat] API key saved, provider:', aiCatProvider);
        } else {
            console.error('[AICat] Failed to save API key:', result.error);
        }
    } catch (e) {
        console.error('[AICat] Error saving API key:', e);
    }
}

// Test API key connection
async function testAICatApiKey() {
    const input = document.getElementById('aicat-api-key');
    const status = document.getElementById('aicat-api-status');
    const key = input.value.trim();

    if (!key) {
        status.textContent = '❌ Please enter an API key';
        status.className = 'api-status error';
        return;
    }

    // Use manually selected provider
    if (!aiCatProvider) {
        status.textContent = '❌ Please select a provider first';
        status.className = 'api-status error';
        return;
    }

    status.textContent = '⏳ Testing...';
    status.className = 'api-status loading';

    try {
        const result = await window.electronAPI.testAICatApiKey(key, aiCatModel, aiCatProvider);

        if (result.success) {
            status.textContent = '✅ Connected!';
            status.className = 'api-status success';

            // Save the key since it's valid
            await window.electronAPI.saveAICatApiKey(key);
            aiCatApiKey = key;
        } else {
            status.textContent = `❌ ${result.error}`;
            status.className = 'api-status error';
        }
    } catch (e) {
        status.textContent = `❌ ${e.message}`;
        status.className = 'api-status error';
    }
}

// Open Google AI Studio page
function openGeminiApiPage() {
    window.electronAPI.openGeminiApiPage();
}

// Open OpenAI API page
function openOpenAIApiPage() {
    window.open('https://platform.openai.com/api-keys', '_blank');
}

// Open Grok (xAI) API page
function openGrokApiPage() {
    window.open('https://console.x.ai', '_blank');
}

// Open OpenRouter API page
function openOpenRouterApiPage() {
    window.open('https://openrouter.ai/keys', '_blank');
}

// Add to init
const originalInit = window.onload;
window.onload = async function () {
    if (originalInit) await originalInit();
    await initAICatSettings();
};
