// ============================================
// AI Cat Helper - Floating Component
// ============================================
// Shows a cat icon that follows hover on file/threat items
// Click to get AI explanation via Gemini API

// State
let currentHoveredItem = null;
let aiCatElement = null;
let aiCatTooltip = null;
let isAICatLoading = false;

// Response cache - LRU with max 30 entries, persisted in localStorage
const responseCache = {
    cache: new Map(), // Key: file/threat path, Value: {response, timestamp, success}
    maxSize: 30,
    storageKey: 'aiCatResponseCache',

    // Load from localStorage on init
    load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                this.cache = new Map(parsed);
                // console.log('[AICat] Loaded', this.cache.size, 'cached responses from storage');
            }
        } catch (err) {
            console.error('[AICat] Failed to load cache:', err);
        }
    },

    // Save to localStorage
    save() {
        try {
            const serialized = JSON.stringify([...this.cache]);
            localStorage.setItem(this.storageKey, serialized);
        } catch (err) {
            console.error('[AICat] Failed to save cache:', err);
        }
    },

    get(key) {
        if (!this.cache.has(key)) return null;
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    },

    set(key, response, success = true) {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, {
            response,
            timestamp: Date.now(),
            success // Track if it was successful or error
        });
        // Persist to storage
        this.save();
    },

    has(key) {
        return this.cache.has(key);
    }
};

// Initialize AI Cat
function initAICat() {
    // Create floating cat element - animated sprite like dashboard
    aiCatElement = document.createElement('div');
    aiCatElement.id = 'ai-cat-float';
    aiCatElement.className = 'ai-cat-float running'; // Use running animation

    // Create cat sprite image
    const catImg = document.createElement('img');
    catImg.className = 'ai-cat-sprite';
    catImg.src = '../../assets/cat/cat_0.png'; // Use same cat as dashboard
    catImg.draggable = false;

    aiCatElement.appendChild(catImg);
    aiCatElement.onclick = onAICatClick;
    document.body.appendChild(aiCatElement);

    // Create tooltip
    aiCatTooltip = document.createElement('div');
    aiCatTooltip.id = 'ai-cat-tooltip';
    aiCatTooltip.className = 'ai-cat-tooltip hidden';
    document.body.appendChild(aiCatTooltip);

    // Load cached responses from localStorage
    responseCache.load();

    // Start frame animation cycling
    startCatAnimation();

    // console.log('[AICat] Component initialized with animated sprite');
}

// Frame animation for walking cat
let catFrameIndex = 0;
const catFrames = [
    '../../assets/cat/cat_0.png',
    '../../assets/cat/cat_1.png',
    '../../assets/cat/cat_2.png',
    '../../assets/cat/cat_3.png',
    '../../assets/cat/cat_4.png'
];

function startCatAnimation() {
    setInterval(() => {
        if (aiCatElement && aiCatElement.style.opacity === '1') {
            const catImg = aiCatElement.querySelector('.ai-cat-sprite');
            if (catImg) {
                catFrameIndex = (catFrameIndex + 1) % catFrames.length;
                catImg.src = catFrames[catFrameIndex];
            }
        }
    }, 150); // Change frame every 150ms
}

// Track if popup is open (lock mode)
let isPopupOpen = false;
let lockedRow = null;

// Show cat on item hover
function showAICat(item, context) {
    if (!window.aiCatEnabled) return;
    if (isPopupOpen) return; // Don't change when popup is open

    currentHoveredItem = { element: item, context };

    // Highlight the current row (handle both file-row and threat-item)
    document.querySelectorAll('.file-row, .threat-item').forEach(row => row.classList.remove('ai-cat-highlight'));
    item.classList.add('ai-cat-highlight');

    // Check if this item has cached response - show badge if yes
    const hasCachedResponse = responseCache.has(context.path) &&
        responseCache.get(context.path)?.success;

    // Remove any existing badge
    const existingBadge = aiCatElement.querySelector('.cache-badge');
    if (existingBadge) {
        existingBadge.remove();
    }

    if (hasCachedResponse) {
        // Create cache badge - small text on cat's belly
        const badge = document.createElement('span');
        badge.className = 'cache-badge';
        badge.textContent = 'cache';
        aiCatElement.appendChild(badge);
    }

    // Position cat to the LEFT of checkbox - adjust based on context
    const rect = item.getBoundingClientRect();
    aiCatElement.style.position = 'fixed';

    // For threats: border (3px) + spacing (8px) = cat inside highlighted area
    // For files: standard offset from left edge
    const leftOffset = context.type === 'threat' ? 11 : 10;
    aiCatElement.style.left = `${rect.left + leftOffset}px`;

    aiCatElement.style.right = 'auto';
    aiCatElement.style.top = `${rect.top + rect.height / 2}px`;
    aiCatElement.style.transform = 'translateY(-50%)'; // Center vertically
    aiCatElement.style.opacity = '1';
    aiCatElement.style.zIndex = '10000';
}

// Hide cat - only when leaving file list entirely AND popup not open
function hideAICat() {
    if (isPopupOpen) return; // Don't hide when popup is open

    setTimeout(() => {
        if (aiCatElement && !aiCatElement.matches(':hover') && !isPopupOpen) {
            aiCatElement.style.opacity = '0';
            // Remove highlight from all rows (both types)
            document.querySelectorAll('.file-row, .threat-item').forEach(row => row.classList.remove('ai-cat-highlight'));
        }
    }, 100);
    if (!isPopupOpen) {
        currentHoveredItem = null;
    }
}

// Hide tooltip and unlock
function hideAICatTooltip() {
    if (aiCatTooltip) {
        aiCatTooltip.classList.add('hidden');
    }
    // Unlock both file list and threats list
    isPopupOpen = false;
    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.classList.remove('ai-cat-locked');
    }
    const threatsList = document.getElementById('threats-list');
    if (threatsList) {
        threatsList.classList.remove('ai-cat-locked');
    }
    if (lockedRow) {
        lockedRow.classList.remove('ai-cat-highlight');
        lockedRow = null;
    }
}

// On cat click - call AI API
async function onAICatClick(e) {
    e.stopPropagation();
    e.preventDefault();

    // console.log('[AICat] Cat clicked! Context:', currentHoveredItem?.context);

    if (!currentHoveredItem || isAICatLoading) return;
    if (!window.aiCatApiKey) {
        showAICatError('Please add your API key in Settings');
        return;
    }

    const { element, context } = currentHoveredItem;

    // Use path as cache key
    const cacheKey = context.path;

    // Check cache first - only if previous response was successful
    const cached = responseCache.get(cacheKey);
    if (cached && cached.success) {
        // console.log('[AICat] Using cached response for:', cacheKey);
        // Lock mode
        isPopupOpen = true;
        lockedRow = element;
        if (context.type === 'file') {
            const fileList = document.getElementById('file-list');
            if (fileList) fileList.classList.add('ai-cat-locked');
        } else if (context.type === 'threat') {
            const threatsList = document.getElementById('threats-list');
            if (threatsList) threatsList.classList.add('ai-cat-locked');
        }

        // Show cached response immediately
        showAICatTooltipAbove(formatAIResponseNice(cached.response), true);
        return;
    }

    // Lock mode - dim the appropriate list, keep this row highlighted
    isPopupOpen = true;
    lockedRow = element;

    // Lock file list OR threats list based on context
    if (context.type === 'file') {
        const fileList = document.getElementById('file-list');
        if (fileList) {
            fileList.classList.add('ai-cat-locked');
        }
    } else if (context.type === 'threat') {
        const threatsList = document.getElementById('threats-list');
        if (threatsList) {
            threatsList.classList.add('ai-cat-locked');
        }
    }

    // Build prompt using custom templates from window globals
    let promptTemplate = '';
    if (context.type === 'file') {
        promptTemplate = window.aiCatPromptFile || `You are an AI assistant for a Mac cleaner app. About this file:
Path: \${context.path}

Give 2 short answers (1 sentence each, no questions):
Line 1: What is this file/folder
Line 2: Is it safe to delete, any risks

Be concise. No markdown formatting.`;
    } else if (context.type === 'threat') {
        promptTemplate = window.aiCatPromptThreat || `You are a Mac security expert. Analyze this detected threat:

Name: \${context.name}
Path: \${context.path}
Severity: \${context.threatType}

Give 2 short answers (1 sentence each):
Line 1: What danger does this pose? (specific risks)
Line 2: What severity level? (low/medium/high/critical and why)

Be direct and concise. No markdown formatting.`;
    }

    // Replace placeholders with actual values
    const prompt = promptTemplate
        .replace(/\$\{context\.path\}/g, context.path || '')
        .replace(/\$\{context\.name\}/g, context.name || '')
        .replace(/\$\{context\.threatType\}/g, context.threatType || '');

    // Show loading - position tooltip above cat
    isAICatLoading = true;
    showAICatTooltipAbove('<div class="loading">🐱 Thinking...</div>', false);

    try {
        const result = await window.electronAPI.explainWithAICat(
            window.aiCatApiKey,
            prompt,
            window.aiCatModel,
            window.aiCatProvider
        );

        if (result.success) {
            // Only cache if response is valid (not an error message)
            if (isValidAIResponse(result.response)) {
                responseCache.set(cacheKey, result.response, true);
                // console.log('[AICat] Valid response cached for:', cacheKey);
            } else {
                // console.log('[AICat] Response not cached (invalid/error):', result.response.substring(0, 100));
            }
            showAICatTooltipAbove(formatAIResponseNice(result.response), true);
        } else {
            // Don't cache errors - let user retry
            // console.log('[AICat] Error not cached:', result.error);
            showAICatTooltipAbove(`<div class="error">❌ ${result.error}</div>`, true);
        }
    } catch (err) {
        // Don't cache exceptions - let user retry
        // console.log('[AICat] Exception not cached:', err.message);
        showAICatTooltipAbove(`<div class="error">❌ ${err.message}</div>`, true);
    } finally {
        isAICatLoading = false;
    }
}

// Validate AI response before caching
function isValidAIResponse(text) {
    if (!text || typeof text !== 'string') return false;

    const lowerText = text.toLowerCase();

    // Check minimum length (at least 50 chars for a real answer)
    if (text.trim().length < 50) return false;

    // Check for error keywords
    const errorKeywords = [
        'connection failed', 'network error', 'connection error',
        'quota exceeded', 'limit exceeded', 'rate limit',
        'unauthorized', 'invalid key', 'api key',
        'timeout', 'timed out',
        'internal server error', '500', '502', '503',
        'service unavailable', 'unavailable',
        'authentication failed', 'access denied'
    ];

    for (const keyword of errorKeywords) {
        if (lowerText.includes(keyword)) {
            return false;
        }
    }

    // Check if response has at least 2 lines (as per prompt format)
    const lines = text.trim().split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return false;

    return true;
}

// Format AI response (cleanup markdown, truncate)
function formatAIResponse(text) {
    // Remove markdown formatting
    let clean = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .trim();

    // Truncate if too long
    if (clean.length > 250) {
        clean = clean.substring(0, 247) + '...';
    }

    return clean;
}

// Format AI response nicely with structure - 2 lines with different colors
function formatAIResponseNice(text) {
    // Clean up markdown
    let clean = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .trim();

    // Split into lines
    const lines = clean.split(/\n+/).filter(l => l.trim());

    // Format as 2 colored lines
    let html = '<div class="ai-response-content">';
    if (lines[0]) {
        html += `<span class="line1">${lines[0].trim()}</span>`;
    }
    if (lines[1]) {
        html += `<span class="line2">${lines[1].trim()}</span>`;
    }
    // Any extra lines
    for (let i = 2; i < lines.length; i++) {
        html += `<span class="line2">${lines[i].trim()}</span>`;
    }
    html += '</div>';

    return html;
}

// Show tooltip with X button
function showAICatTooltipWithClose(html, showClose) {
    if (!aiCatTooltip || !currentHoveredItem) return;

    const rect = currentHoveredItem.element.getBoundingClientRect();

    // Build HTML with optional close button
    let content = html;
    if (showClose) {
        content = `
            <button class="ai-cat-close" onclick="hideAICatTooltip()">&times;</button>
            ${html}
        `;
    }

    aiCatTooltip.innerHTML = content;
    aiCatTooltip.style.position = 'fixed';
    aiCatTooltip.style.right = '50px';
    aiCatTooltip.style.left = 'auto';
    aiCatTooltip.style.top = `${rect.top + rect.height / 2}px`;
    aiCatTooltip.style.transform = 'translateY(-50%)';
    aiCatTooltip.style.zIndex = '9999';
    aiCatTooltip.classList.remove('hidden');
}

// Show tooltip ABOVE the cat (like thought bubble)
function showAICatTooltipAbove(html, showClose) {
    if (!aiCatTooltip || !aiCatElement) return;

    // Get cat position
    const catRect = aiCatElement.getBoundingClientRect();

    // Build HTML with optional close button
    let content = html;
    if (showClose) {
        content = `
            <button class="ai-cat-close" onclick="hideAICatTooltip()">&times;</button>
            ${html}
        `;
    }

    aiCatTooltip.innerHTML = content;
    aiCatTooltip.style.position = 'fixed';
    aiCatTooltip.style.left = `${catRect.left}px`;
    aiCatTooltip.style.right = 'auto';
    aiCatTooltip.style.bottom = `${window.innerHeight - catRect.top + 10}px`; // 10px above cat
    aiCatTooltip.style.top = 'auto';
    aiCatTooltip.style.transform = 'none';
    aiCatTooltip.style.zIndex = '9999';
    aiCatTooltip.classList.remove('hidden');
    aiCatTooltip.classList.add('above-cat');
}

// Show tooltip with content (legacy)
function showAICatTooltip(html) {
    showAICatTooltipWithClose(html, false);
}

// Show error in tooltip
function showAICatError(message) {
    showAICatTooltip(`<div class="error">❌ ${message}</div>`);
}

// Setup hover listeners for Dashboard files - TARGET #file-list CONTAINER
function setupDashboardAICat() {
    // Target the actual file list container
    const fileList = document.getElementById('file-list');
    if (!fileList) {
        // console.log('[AICat] file-list container not found');
        return;
    }

    // Count items in file list
    const allRows = fileList.querySelectorAll('.file-row');
    const pathSpans = fileList.querySelectorAll('.file-path');

    // console.log('[AICat] File list setup - Total rows:', allRows.length,
    //     'Path elements:', pathSpans.length,
    //     'Enabled:', window.aiCatEnabled);

    // Remove old listener by cloning (avoid duplicates)
    const clone = fileList.cloneNode(true);
    fileList.parentNode.replaceChild(clone, fileList);
    const newFileList = document.getElementById('file-list');

    newFileList.addEventListener('mouseover', (e) => {
        // console.log('[AICat] Hover on file-list! Target:', e.target.tagName, e.target.className, 'Enabled:', window.aiCatEnabled);

        // Only check if AI Cat is enabled
        if (!window.aiCatEnabled) return;

        // Find closest .file-row
        const fileRow = e.target.closest('.file-row');

        if (fileRow) {
            // Get path from .file-path span
            const pathSpan = fileRow.querySelector('.file-path');
            if (pathSpan) {
                const path = pathSpan.textContent || pathSpan.innerText;
                // console.log('[AICat] Found file-row with path:', path);

                showAICat(fileRow, {
                    type: 'file',
                    path: path,
                    size: '',
                    category: ''
                });
            }
        }
    });

    newFileList.addEventListener('mouseout', (e) => {
        const related = e.relatedTarget;
        if (!related || (!newFileList.contains(related) &&
            related.id !== 'ai-cat-float' &&
            related.id !== 'ai-cat-tooltip')) {
            hideAICat();
        }
    });

    // CRITICAL: Hide cat/popup when scan-results page is scrolled
    const scanResultsSection = document.getElementById('scan-results');
    if (scanResultsSection) {
        // Remove old listeners if exist
        if (scanResultsSection._aiCatScrollListener) {
            scanResultsSection.removeEventListener('scroll', scanResultsSection._aiCatScrollListener, true);
        }
        if (window._aiCatDashboardScrollListener) {
            window.removeEventListener('scroll', window._aiCatDashboardScrollListener, true);
        }

        // Scroll listener - hide on ANY scroll
        const scrollListener = () => {
            // console.log('[AICat] Dashboard page scrolled - hiding cat and popup');
            forceHideAICat();
        };

        // Listen on BOTH section and window
        scanResultsSection.addEventListener('scroll', scrollListener, true);
        window.addEventListener('scroll', scrollListener, true);

        // Store references
        scanResultsSection._aiCatScrollListener = scrollListener;
        window._aiCatDashboardScrollListener = scrollListener;
    }

    // console.log('[AICat] File list event delegation attached - waiting for hovers');
}

// Setup hover listeners for Threats results - TARGET #threats-list CONTAINER
function setupThreatsAICat() {
    const threatsList = document.getElementById('threats-list');
    if (!threatsList) {
        // console.log('[AICat] threats-list container not found');
        return;
    }

    // Count items
    const allItems = threatsList.querySelectorAll('.threat-item');
    // console.log('[AICat] Threats list setup - Total items:', allItems.length, 'Enabled:', window.aiCatEnabled);

    // Remove old listener by cloning
    const clone = threatsList.cloneNode(true);
    threatsList.parentNode.replaceChild(clone, threatsList);
    const newThreatsList = document.getElementById('threats-list');

    newThreatsList.addEventListener('mouseover', (e) => {
        // console.log('[AICat] Hover on threats-list! Target:', e.target.tagName, e.target.className, 'Enabled:', window.aiCatEnabled);

        if (!window.aiCatEnabled) return;
        if (isPopupOpen) return; // Don't change when popup is open

        // Find closest .threat-item
        const threatItem = e.target.closest('.threat-item');

        if (threatItem) {
            const pathEl = threatItem.querySelector('.threat-path');
            const nameEl = threatItem.querySelector('.threat-name');
            const severityEl = threatItem.querySelector('.threat-severity');

            const path = pathEl?.textContent || '';
            const name = nameEl?.textContent || '';
            const severity = severityEl?.textContent || 'unknown';

            // console.log('[AICat] Found threat-item:', name, 'Severity:', severity);

            showAICat(threatItem, {
                type: 'threat',
                path: path,
                name: name,
                threatType: severity
            });
        }
    });

    newThreatsList.addEventListener('mouseout', (e) => {
        const related = e.relatedTarget;
        if (!related || (!newThreatsList.contains(related) &&
            related.id !== 'ai-cat-float' &&
            related.id !== 'ai-cat-tooltip')) {
            hideAICat();
        }
    });

    // CRITICAL: Hide cat/popup when threats page is scrolled
    const threatsSection = document.getElementById('threats');
    if (threatsSection) {
        // Remove old listeners if exist
        if (threatsSection._aiCatScrollListener) {
            threatsSection.removeEventListener('scroll', threatsSection._aiCatScrollListener, true);
        }
        if (window._aiCatThreatsScrollListener) {
            window.removeEventListener('scroll', window._aiCatThreatsScrollListener, true);
        }

        // Scroll listener - hide on ANY scroll
        const scrollListener = () => {
            // console.log('[AICat] Threats page scrolled - hiding cat and popup');
            forceHideAICat();
        };

        // Listen on BOTH section and window (window catches body/page scroll)
        threatsSection.addEventListener('scroll', scrollListener, true);
        window.addEventListener('scroll', scrollListener, true);

        // Store references for cleanup
        threatsSection._aiCatScrollListener = scrollListener;
        window._aiCatThreatsScrollListener = scrollListener;
    }

    // console.log('[AICat] Threats list event delegation attached');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initAICat();

    // Setup listeners after a delay to ensure elements exist
    setTimeout(() => {
        setupDashboardAICat();
        setupThreatsAICat();
    }, 1000);
});

// Re-setup listeners when navigating to sections AND hide cat
window.addEventListener('hashchange', () => {
    // ALWAYS hide cat and popup when changing sections
    forceHideAICat();

    setTimeout(() => {
        setupDashboardAICat();
        setupThreatsAICat();
    }, 500);
});

// Force hide cat and popup (when navigating away)
function forceHideAICat() {
    if (aiCatElement) {
        aiCatElement.style.opacity = '0';
    }
    hideAICatTooltip();
    isPopupOpen = false;
    lockedRow = null;
    currentHoveredItem = null;

    // Remove all highlights (both types)
    document.querySelectorAll('.file-row, .threat-item').forEach(row => row.classList.remove('ai-cat-highlight'));

    // Unlock both file list and threats list
    const fileList = document.getElementById('file-list');
    if (fileList) {
        fileList.classList.remove('ai-cat-locked');
    }
    const threatsList = document.getElementById('threats-list');
    if (threatsList) {
        threatsList.classList.remove('ai-cat-locked');
    }
}

// Expose global function to be called after file list renders
window.setupAICatForFiles = function () {
    // console.log('[AICat] Manually triggered setup for file list');
    setTimeout(() => setupDashboardAICat(), 300);
};

// Expose threats setup globally
window.setupThreatsAICat = setupThreatsAICat;

// Expose hide functions globally
window.hideAICatTooltip = hideAICatTooltip;
window.forceHideAICat = forceHideAICat;
