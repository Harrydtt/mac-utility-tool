/**
 * Games Feature - NES/GBA Emulator
 * Grid-based game library with per-game controls, favorites, and filtering
 * Grouped by platform category
 */

// ============================================
// PLATFORM CATEGORIES
// ============================================
const PLATFORM_CATEGORIES = [
    { id: 'nes', name: 'NES', icon: '👾', exts: ['nes'] },
    { id: 'snes', name: 'SNES', icon: '🕹️', exts: ['sfc', 'smc'] },
    { id: 'gba', name: 'GBA', icon: '🎮', exts: ['gba'] },
    { id: 'gb', name: 'Game Boy', icon: '🟢', exts: ['gb', 'gbc'] },
    { id: 'sega', name: 'Sega', icon: '🔵', exts: ['md', 'bin'] }
];

// ============================================
// STATE
// ============================================
let gameLibrary = []; // { id, name, ext, filePath, romData, isRunning, isFavorite }
let filterState = {
    search: '',
    category: 'all',
    favoritesOnly: false
};
const runningGames = new Map(); // gameId -> windowId
let selectedGameIds = new Set();
let lastSelectedGameId = null;

// Update selection visuals helper
window.updateSelectionVisuals = () => {
    document.querySelectorAll('.game-item').forEach(item => {
        if (selectedGameIds.has(item.dataset.gameId)) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    const trashZone = document.getElementById('delete-drop-zone');
    if (trashZone) {
        if (selectedGameIds.size > 0) {
            trashZone.style.display = 'flex';
        } else {
            trashZone.style.display = 'none';
        }
    }
};

// ============================================
// INITIALIZATION
// ============================================
function initGamesFeature() {
    console.log('[Games] Initializing games feature...');

    // Load saved game library
    loadGameLibrary();

    // Setup Filters
    setupFilters();

    // Render game grid
    renderGameGrid();

    // Setup Drag-to-Select
    setupDragToSelect();

    // Setup Trash Drop Zone
    setupTrashZone();

    // Setup Add Card (drop zone)


    // Periodic check for missing/restored games (every 3 seconds)
    setInterval(() => {
        if (!window.electronAPI || !window.electronAPI.pathExists) return;

        // Background sync to sort and fetch new games dynamically
        if (window.electronAPI.syncGameLibrary) {
            syncGameLibraryWithBackend(false); // background sync, no forced render
        }

        gameLibrary.forEach(game => {
            window.electronAPI.pathExists(game.filePath).then(res => {
                const item = document.querySelector(`.game-item[data-game-id="${game.id}"]`);
                if (!item) return;

                if (!res.exists && item.dataset.missing !== 'true') {
                    applyMissingBadgeToItem(item);
                } else if (res.exists && item.dataset.missing === 'true') {
                    removeMissingBadgeFromItem(item);
                }
            });
        });
    }, 3000);

    // Initial deep sync on load
    if (window.electronAPI && window.electronAPI.syncGameLibrary) {
        syncGameLibraryWithBackend(true);
    }

    // Listen for game window closed events
    if (window.electronAPI && window.electronAPI.onGameWindowClosed) {
        window.electronAPI.onGameWindowClosed((gameId) => {
            console.log('[Games] Game window closed:', gameId);
            const game = gameLibrary.find(g => g.id === gameId);
            if (game) {
                game.isRunning = false;
            }
            runningGames.delete(gameId);

            // Force an immediate deep sync so the UI instantly picks up the new thumbnail
            if (window.electronAPI && window.electronAPI.syncGameLibrary) {
                syncGameLibraryWithBackend(true);
            } else {
                renderGameGrid();
            }
        });
    }

    // Add ROM button handler
    const addBtn = document.getElementById('add-game-btn');
    if (addBtn) {
        addBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.gba,.nes,.gb,.gbc,.sfc,.smc,.md,.bin,.jar';
            input.multiple = true;
            input.onchange = async (e) => {
                for (let i = 0; i < e.target.files.length; i++) {
                    await addGameToLibrary(e.target.files[i]);
                }
            };
            input.click();
        }

        // Drag and drop support on the Add Button directly
        addBtn.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addBtn.classList.add('drag-over');
        });

        addBtn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addBtn.classList.add('drag-over');
        });

        addBtn.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addBtn.classList.remove('drag-over');
        });

        addBtn.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            addBtn.classList.remove('drag-over');

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                // Must copy files to an array because `e.dataTransfer` gets cleared 
                // when yielding to the event loop during `await`
                const files = Array.from(e.dataTransfer.files);
                for (let i = 0; i < files.length; i++) {
                    await addGameToLibrary(files[i]);
                }
            }
        });
    }

    console.log('[Games] Initialization complete');
}

// ============================================
// FILTERS SETUP
// ============================================
function setupFilters() {
    const searchInput = document.getElementById('game-search');
    const categorySelect = document.getElementById('game-category-filter');
    const favoriteToggle = document.getElementById('game-favorite-filter');

    if (searchInput) {
        searchInput.value = filterState.search;
        searchInput.oninput = (e) => {
            filterState.search = e.target.value.toLowerCase();
            renderGameGrid();
        };
    }

    if (categorySelect) {
        categorySelect.value = filterState.category;
        categorySelect.onchange = (e) => {
            filterState.category = e.target.value;
            renderGameGrid();
        };
    }

    if (favoriteToggle) {
        favoriteToggle.classList.toggle('active', filterState.favoritesOnly);
        favoriteToggle.onclick = () => {
            filterState.favoritesOnly = !filterState.favoritesOnly;
            favoriteToggle.classList.toggle('active', filterState.favoritesOnly);
            renderGameGrid();
        };
    }
}

// ============================================
// GAME LIBRARY PERSISTENCE
// ============================================
function loadGameLibrary() {
    try {
        const saved = localStorage.getItem('games-library');
        if (saved) {
            // Only load metadata, not romData (too large)
            const parsed = JSON.parse(saved);
            gameLibrary = parsed.map(g => ({
                ...g,
                romData: null, // ROM data not persisted
                isRunning: false,
                isFavorite: g.isFavorite || false // Ensure favorite property exists
            }));
        }
    } catch (e) {
        console.warn('[Games] Failed to load game library:', e);
        gameLibrary = [];
    }
}

async function syncGameLibraryWithBackend(forceRender = false) {
    if (!window.electronAPI || !window.electronAPI.syncGameLibrary) return;

    try {
        const response = await window.electronAPI.syncGameLibrary();
        if (response.success && response.games) {
            let libraryChanged = false;
            const backendGames = response.games;

            // 1. Add new games found on disk
            for (const bg of backendGames) {
                const existing = gameLibrary.find(g => g.id === bg.id || g.filePath === bg.filePath);
                if (!existing) {
                    gameLibrary.push(bg);
                    libraryChanged = true;
                } else {
                    if (existing.filePath !== bg.filePath) {
                        // Update filepath if it was moved/sorted
                        existing.filePath = bg.filePath;
                        existing.id = bg.id; // Update ID if path changed
                        libraryChanged = true;
                    }
                    if (bg.thumbnail && existing.thumbnail !== bg.thumbnail) {
                        existing.thumbnail = bg.thumbnail;
                        libraryChanged = true;
                    }
                }
            }

            // 2. Remove games that are permanently gone and not just temporarily missing
            // Actually, we keep them so the "don't exist" badge shows, as per user requirement.
            // A missing game is only removed if the user explicitly clicks delete.

            if (libraryChanged) {
                saveGameLibrary();
            }

            if (forceRender || libraryChanged) {
                renderGameGrid();
            }
        }
    } catch (e) {
        console.error('[Games] Failed to sync game library:', e);
    }
}

function saveGameLibrary() {
    try {
        // Save only metadata, not romData
        const toSave = gameLibrary.map(g => ({
            id: g.id,
            name: g.name,
            ext: g.ext,
            filePath: g.filePath,
            isFavorite: g.isFavorite
        }));
        localStorage.setItem('games-library', JSON.stringify(toSave));
    } catch (e) {
        console.error('[Games] Failed to save game library:', e);
    }
}

// ============================================
// RENDER GAME GRID (Grouped by Category)
// ============================================
function renderGameGrid() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;

    // Clear existing content
    grid.innerHTML = '';

    // Apply Filters
    let filteredGames = gameLibrary.filter(game => {
        // Filter by name
        if (filterState.search && !game.name.toLowerCase().includes(filterState.search)) {
            return false;
        }
        // Filter by favorite
        if (filterState.favoritesOnly && !game.isFavorite) {
            return false;
        }
        return true;
    });

    // Group games by category and render
    let hasAnyGame = false;

    // Filter categories based on selection
    const categoriesToShow = (filterState.category === 'all')
        ? PLATFORM_CATEGORIES
        : PLATFORM_CATEGORIES.filter(c => c.id === filterState.category);



    for (const cat of categoriesToShow) {
        const gamesInCat = filteredGames.filter(g => cat.exts.includes(g.ext));

        // Skip empty categories (User request: "không có gasme thì danh mục đó bị ẩn đi")
        if (gamesInCat.length === 0) continue;

        hasAnyGame = true;

        // Category header (spans full grid width)
        const header = document.createElement('div');
        header.className = 'game-category-header';
        header.innerHTML = `
            <span class="category-icon">${cat.icon}</span>
            <span class="category-name">${cat.name}</span>
            <span class="category-count">${gamesInCat.length}</span>
        `;
        grid.appendChild(header);

        // Game cards in this category
        gamesInCat.forEach(game => {
            const card = createGameCard(game);
            grid.appendChild(card);
        });

        // REMOVED: Per-category Add Card
    }

    // Re-bind events for ALL Add Cards


    // Empty state if no games found
    if (!hasAnyGame && (filterState.favoritesOnly || filterState.search)) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-library';
        emptyState.textContent = 'No games found matching your filters.';
        grid.appendChild(emptyState);
    }
}

function createGameCard(game) {
    const item = document.createElement('div');
    item.className = 'game-item';
    if (game.isRunning) item.classList.add('running');
    item.dataset.gameId = game.id;

    // Get icon based on extension
    const iconMap = {
        'gba': '🎮',
        'nes': '👾',
        'gb': '🎮',
        'gbc': '🎮',
        'sfc': '🕹️',
        'smc': '🕹️',
        'smc': '🕹️',
        'md': '🎮',
        'jar': '☕'
    };
    const icon = iconMap[game.ext] || '🎮';

    // Create card content using DOM elements for better event handling

    // 1. Header
    const header = document.createElement('div');
    header.className = 'game-card-header';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.title = game.name;
    title.textContent = game.name;

    const actions = document.createElement('div');
    actions.className = 'game-card-actions';

    // Open Folder Button
    const openBtn = document.createElement('button');
    openBtn.className = 'action-btn';
    openBtn.innerHTML = '📂'; // Folder icon
    openBtn.title = 'Open Game Folder';
    openBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.openGameFolder) {
            console.log('[Games] Requesting open folder:', game.filePath);
            window.electronAPI.openGameFolder(game.filePath).then(res => {
                console.log('[Games] Open folder result:', res);
            });
        }
    };

    // Favorite Button
    const favBtn = document.createElement('button');
    favBtn.className = 'action-btn favorite' + (game.isFavorite ? ' active' : '');
    favBtn.innerHTML = game.isFavorite ? '❤️' : '🤍';
    favBtn.title = game.isFavorite ? 'Remove from favorites' : 'Add to favorites';
    favBtn.onclick = (e) => toggleFavorite(game.id, e);

    // Remove Button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'action-btn remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Remove';
    removeBtn.onclick = (e) => removeGame(game.id, e);

    actions.appendChild(openBtn);
    actions.appendChild(favBtn);
    actions.appendChild(removeBtn);

    header.appendChild(title);

    // NEW Badge
    if (game.hasPlayed === false) {
        const badge = document.createElement('div');
        badge.className = 'game-badge-new';
        badge.textContent = 'NEW';
        item.appendChild(badge);
    }

    // 2. Body
    const body = document.createElement('div');
    body.className = 'game-card-body';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'card-icon';
    if (game.thumbnail) {
        // Append a cache-buster timestamp so Chromium re-fetches the saved image
        const imgUrl = `url('local://${encodeURI(game.thumbnail)}?t=${Date.now()}')`;
        body.style.backgroundImage = imgUrl;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
        iconDiv.style.display = 'none'; // Hide the text icon completely
        console.log(`[UI] Rendering thumbnail for ${game.name}: ${imgUrl}`);
    } else {
        iconDiv.textContent = icon;
        console.log(`[UI] No thumbnail for ${game.name}`);
    }

    const overlay = document.createElement('div');
    overlay.className = 'play-overlay';
    // Bind click to play or multi-select
    overlay.onclick = (e) => {
        // Only if not clicking buttons inside
        if (e.target.tagName === 'BUTTON') return;

        // Normal click: clear selection and play
        selectedGameIds.clear();
        if (window.updateSelectionVisuals) window.updateSelectionVisuals();

        if (!game.isRunning && item.dataset.missing !== 'true') playGame(game.id);
    };

    if (game.isRunning) {
        const stopBtn = document.createElement('button');
        stopBtn.className = 'stop-btn';
        stopBtn.textContent = '⏹';
        stopBtn.title = 'Stop Game';
        stopBtn.onclick = (e) => {
            e.stopPropagation();
            stopGame(game.id);
        };
        overlay.appendChild(stopBtn);
    } else {
        const playBtn = document.createElement('button');
        playBtn.className = 'play-btn';
        playBtn.textContent = '▶';
        playBtn.title = 'Play Game';
        playBtn.onclick = (e) => {
            e.stopPropagation();
            playGame(game.id);
        };
        overlay.appendChild(playBtn);
    }

    body.appendChild(iconDiv);
    body.appendChild(overlay);

    // 3. Footer
    const footer = document.createElement('div');
    footer.className = 'game-card-footer';

    footer.appendChild(actions);

    if (game.isRunning) {
        const runBadge = document.createElement('span');
        runBadge.style.cssText = 'color:#22c55e;font-weight:700;margin-left:auto;';
        runBadge.textContent = 'RUNNING';
        footer.appendChild(runBadge);
    }

    // Make game item draggable for trash
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
        // If the dragged item isn't in the selection, clear selection and select just this one
        if (!selectedGameIds.has(game.id)) {
            selectedGameIds.clear();
            selectedGameIds.add(game.id);
            lastSelectedGameId = game.id;
            if (window.updateSelectionVisuals) window.updateSelectionVisuals();
        }

        // Pass the array of selected IDs
        e.dataTransfer.setData('application/json', JSON.stringify(Array.from(selectedGameIds)));
        e.dataTransfer.effectAllowed = 'move';
    });

    item.appendChild(header);
    item.appendChild(body);
    item.appendChild(footer);

    // Double click to play
    item.addEventListener('dblclick', (e) => {
        if (item.dataset.missing === 'true') return;
        // Prevent double click if clicking buttons
        if (e.target.closest('button') || e.target.closest('.action-btn')) return;

        if (!game.isRunning) {
            playGame(game.id);
        }
    });

    // Async check for missing file
    if (window.electronAPI && window.electronAPI.pathExists) {
        window.electronAPI.pathExists(game.filePath).then(res => {
            console.log(`[Games] pathExists check for ${game.name}: exists=${res.exists}, path=${game.filePath}`);
            if (!res.exists) {
                console.log(`[Games] Applying missing badge for ${game.name}`);
                applyMissingBadgeToItem(item);
            }
        });
    }

    return item;
}

function applyMissingBadgeToItem(item) {
    if (!item || item.dataset.missing === 'true') return;
    item.dataset.missing = 'true';

    const missingBadge = document.createElement('div');
    missingBadge.className = 'game-badge-missing';
    missingBadge.textContent = "Don't exist";
    missingBadge.style.cssText = 'position:absolute;top:10px;right:10px;background:#ef4444;color:white;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:bold;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,0.2)';
    item.appendChild(missingBadge);

    item.style.opacity = '0.7';
    item.style.filter = 'grayscale(0.5)';

    const playBtn = item.querySelector('.play-btn');
    if (playBtn) {
        playBtn.disabled = true;
        playBtn.style.opacity = '0.3';
        playBtn.style.cursor = 'not-allowed';
        playBtn.title = 'Game file is missing';
    }

    const overlay = item.querySelector('.play-overlay');
    if (overlay) {
        overlay.style.cursor = 'not-allowed';
    }
}

function removeMissingBadgeFromItem(item) {
    if (!item || item.dataset.missing !== 'true') return;
    delete item.dataset.missing;

    const missingBadge = item.querySelector('.game-badge-missing');
    if (missingBadge) missingBadge.remove();

    item.style.opacity = '1';
    item.style.filter = 'none';

    const playBtn = item.querySelector('.play-btn');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.opacity = '1';
        playBtn.style.cursor = 'pointer';
        playBtn.title = 'Play Game';
    }

    const overlay = item.querySelector('.play-overlay');
    if (overlay) {
        overlay.style.cursor = 'pointer';
    }
}

// Wrapper to handle play click without triggering bubbles up weirdly
window.onPlayClick = (gameId, event) => {
    // If clicking directly on stop button, let that handler work
    if (event.target.closest('.stop-btn')) return;

    // Otherwise play
    const game = gameLibrary.find(g => g.id === gameId);
    if (!game.isRunning) {
        playGame(gameId);
    }
};


// ============================================
// GAME MANAGEMENT
// ============================================
async function addGameToLibrary(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts = ['gba', 'nes', 'gb', 'gbc', 'sfc', 'smc', 'md', 'bin', 'jar'];

    if (!validExts.includes(ext)) {
        showGameToast('❌ Unsupported format: ' + ext, true);
        return;
    }

    // Check if already exists
    const name = file.name.replace(/\.[^/.]+$/, '');
    const exists = gameLibrary.find(g => g.name === name && g.ext === ext);
    if (exists) {
        showGameToast('⚠️ Game already in library', true);
        return;
    }

    // Import Game via Backend
    let finalPath = file.path;
    let importSuccess = false;

    if (window.electronAPI && window.electronAPI.importGame) {
        try {
            showGameToast(`📥 Importing: ${name}...`);
            console.log('[Games] Importing file:', file.path);

            // Determine platform from ext
            // Map ext to platform ID
            let platformId = 'other';
            for (const cat of PLATFORM_CATEGORIES) {
                if (cat.exts.includes(ext)) {
                    platformId = cat.id;
                    break;
                }
            }

            const result = await window.electronAPI.importGame(file.path, platformId);
            console.log('[Games] Import result:', result);

            if (result.success) {
                finalPath = result.newPath;
                importSuccess = true;
            } else {
                console.error('[Games] Import failed:', result.error);
                showGameToast('⚠️ Import failed, using original path.', true);
            }
        } catch (e) {
            console.error('[Games] Import error:', e);
        }
    }

    // Create game entry
    const game = {
        id: 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        ext: ext,
        filePath: finalPath, // Use the new imported path
        // romData: ... we no longer need to cache romData in memory if we rely on file persistence
        // But for consistency with existing "play immediately" logic, IF import failed, we might want it?
        // Actually, playGame() falls back to filePath. If filePath is valid (imported), it works.
        isRunning: false,
        isFavorite: false,
        hasPlayed: false // Mark as NEW
    };

    gameLibrary.push(game);
    saveGameLibrary();
    renderGameGrid();

    showGameToast(`✅ Added: ${name}`);
}

function removeGame(gameId, event) {
    if (event) {
        event.stopPropagation();
    }

    const game = gameLibrary.find(g => g.id === gameId);
    if (!game) return;

    if (confirm(`Remove "${game.name}" from library? \n(This will delete the file based on settings)`)) {
        // Stop if running
        if (game.isRunning) {
            stopGame(gameId);
        }

        // Delete File via Backend
        if (window.electronAPI && window.electronAPI.deleteGame && game.filePath) {
            console.log('[Games] Deleting file:', game.filePath);
            window.electronAPI.deleteGame(game.filePath).then(res => {
                console.log('[Games] Delete result:', res);
                if (!res.success) {
                    console.error('[Games] Delete file failed:', res.error);
                }
            });
        }

        // Remove from library
        gameLibrary = gameLibrary.filter(g => g.id !== gameId);
        selectedGameIds.delete(gameId);
        saveGameLibrary();
        renderGameGrid();

        showGameToast(`🗑️ Removed: ${game.name}`);
    }
}

async function removeMultipleGames(gameIds) {
    const gamesToDelete = gameLibrary.filter(g => gameIds.includes(g.id));
    if (gamesToDelete.length === 0) return;

    const gameNames = gamesToDelete.map(g => g.name).join(', ');
    const displayNames = gameNames.length > 100 ? gameNames.substring(0, 100) + '...' : gameNames;

    if (confirm(`Remove ${gamesToDelete.length} games from library?\n\n${displayNames}\n\n(This will delete the files based on settings)`)) {

        for (const game of gamesToDelete) {
            if (game.isRunning) stopGame(game.id);

            if (window.electronAPI && window.electronAPI.deleteGame && game.filePath) {
                try {
                    const res = await window.electronAPI.deleteGame(game.filePath);
                    if (!res.success) console.error('[Games] Delete failed:', res.error);
                } catch (err) {
                    console.error('[Games] IPC delete error:', err);
                }
            }
        }

        gameLibrary = gameLibrary.filter(g => !gameIds.includes(g.id));
        selectedGameIds.clear();
        saveGameLibrary();
        renderGameGrid();

        showGameToast(`🗑️ Removed ${gamesToDelete.length} games`);
    }
}

// ============================================
// TRASH ZONE
// ============================================
function setupTrashZone() {
    const trashZone = document.getElementById('delete-drop-zone');
    if (!trashZone) return;

    trashZone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        trashZone.classList.add('drag-over');
    });

    trashZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        trashZone.classList.add('drag-over');
    });

    trashZone.addEventListener('dragleave', (e) => {
        trashZone.classList.remove('drag-over');
    });

    trashZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        trashZone.classList.remove('drag-over');

        const data = e.dataTransfer.getData('application/json');
        if (!data) return;

        try {
            const ids = JSON.parse(data);
            if (ids && ids.length > 0) {
                await removeMultipleGames(ids);
            }
        } catch (err) {
            console.error('[Games] Failed to parse drag payload for trash', err);
        }
    });

    // Provide click-to-delete functionality as well
    trashZone.addEventListener('click', async () => {
        const ids = Array.from(selectedGameIds);
        if (ids && ids.length > 0) {
            await removeMultipleGames(ids);
        }
    });
}


// ============================================
// DRAG TO SELECT (MARQUEE)
// ============================================
function setupDragToSelect() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;

    let selectionBox = document.getElementById('selection-box');
    if (!selectionBox) {
        selectionBox = document.createElement('div');
        selectionBox.id = 'selection-box';
        selectionBox.className = 'selection-box';
        document.body.appendChild(selectionBox);
    }

    let isSelecting = false;
    let startX = 0, startY = 0;

    // Track items that were already selected before this drag started,
    // so we can support Shift-drag to append to selection
    let initialSelected = new Set();

    grid.addEventListener('mousedown', (e) => {
        // Ignore right clicks or middle clicks
        if (e.button !== 0) return;

        // Don't start selection if clicking on a button or scrollbar
        if (e.target.closest('button') || e.target.closest('.action-btn')) return;

        // If clicking on a game item, we might be starting a native drag
        // Wait to see if it's a drag or just a click. Native drag handles itself.
        // Actually, if we start on a .play-overlay or .game-item, let native drag or click handle it.
        if (e.target.closest('.game-item')) {
            // But if Shift is held, maybe they want to start a box from ON the item?
            // Usually marquee starts from empty space. Let's enforce starting on empty space.
            if (e.target.closest('.play-overlay') || e.target.closest('.game-card-header')) {
                return;
            }
        }

        isSelecting = true;
        startX = e.clientX;
        startY = e.clientY;

        // If not holding shift/cmd, clear previous selection
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            selectedGameIds.clear();
        }

        initialSelected = new Set(selectedGameIds);

        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';

        // Clear native text selection to avoid weird highlighting
        window.getSelection().removeAllRanges();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isSelecting) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;

        // Calculate intersections
        const boxRect = selectionBox.getBoundingClientRect();

        // Reset selection to the initial state when drag started
        selectedGameIds = new Set(initialSelected);

        document.querySelectorAll('.game-item').forEach(item => {
            const itemRect = item.getBoundingClientRect();

            // Check intersection (AABB)
            const isIntersecting = !(
                boxRect.right < itemRect.left ||
                boxRect.left > itemRect.right ||
                boxRect.bottom < itemRect.top ||
                boxRect.top > itemRect.bottom
            );

            if (isIntersecting) {
                const gameId = item.dataset.gameId;
                if (gameId) selectedGameIds.add(gameId);
            }
        });

        window.updateSelectionVisuals();
    });

    document.addEventListener('mouseup', () => {
        if (!isSelecting) return;
        isSelecting = false;
        selectionBox.style.display = 'none';

        // If it was just a click without moving, it might have been a click on empty space
        // which should clear the selection.
        const width = parseInt(selectionBox.style.width || '0');
        const height = parseInt(selectionBox.style.height || '0');
        if (width < 5 && height < 5 && initialSelected.size > 0 && selectedGameIds.size === initialSelected.size) {
            selectedGameIds.clear();
            window.updateSelectionVisuals();
        }
    });
}


function toggleFavorite(gameId, event) {
    if (event) {
        event.stopPropagation();
    }

    const game = gameLibrary.find(g => g.id === gameId);
    if (!game) return;

    game.isFavorite = !game.isFavorite;
    saveGameLibrary();
    renderGameGrid();

    // Don't show toast for rapid toggling, just visual feedback is enough
}

// ============================================
// GAME CONTROLS
// ============================================
async function playGame(gameId) {
    const game = gameLibrary.find(g => g.id === gameId);
    if (!game) return;

    // Check if file still exists before launching
    if (window.electronAPI && window.electronAPI.pathExists) {
        const res = await window.electronAPI.pathExists(game.filePath);
        if (!res.exists) {
            console.log(`[Games] File deleted since last scan, aborting launch for ${game.name}`);
            const item = document.querySelector(`.game-item[data-game-id="${gameId}"]`);
            if (item) applyMissingBadgeToItem(item);
            showGameToast(`❌ Launch Failed: Game file not found`);
            return;
        }
    }

    // Determine core
    const coreMap = {
        'nes': 'fceumm',
        'gba': 'vba_next',
        'gb': 'gambatte',
        'gbc': 'gambatte',
        'sfc': 'snes9x',
        'smc': 'snes9x',
        'md': 'genesis_plus_gx',
        'bin': 'genesis_plus_gx'
    };
    const core = coreMap[game.ext] || 'mgba';

    try {
        console.log('[Games] Launching game:', game.name, 'core:', core);

        let launchParams = {
            gameId: game.id,
            core: core
        };

        // Always send romPath so backend knows where to save adjacent thumbnails
        if (game.filePath) {
            launchParams.romPath = game.filePath;
        }

        // Prefer romData if available (first play after adding)
        if (game.romData) {
            launchParams.romData = new Uint8Array(game.romData);
        }

        if (!launchParams.romPath && !launchParams.romData) {
            showGameToast('❌ ROM data not available. Please re-add the game.', true);
            return;
        }

        const result = await window.electronAPI.launchGameWindow(launchParams);

        if (!result.success) {
            throw new Error(result.error);
        }

        // Update state
        game.isRunning = true;

        // Remove NEW badge on first play
        if (game.hasPlayed === false) {
            game.hasPlayed = true;
            saveGameLibrary();
        }

        runningGames.set(game.id, result.windowId);
        renderGameGrid();

        showGameToast(`🚀 ${game.name} launched!`);

    } catch (error) {
        console.error('[Games] Failed to launch:', error);
        showGameToast('❌ Launch failed: ' + error.message, true);
    }
}

function stopGame(gameId) {
    const game = gameLibrary.find(g => g.id === gameId);
    if (!game) return;

    // Send stop command (main process will intercept this and take a snapshot)
    window.electronAPI.sendGameCommand('stop', { gameId });
    showGameToast(`⏹️ ${game.name} stopped`);
}

// ============================================
// UI HELPERS
// ============================================
function showGameToast(message, isError = false) {
    // Remove existing toast
    document.querySelectorAll('.game-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'game-toast' + (isError ? ' error' : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ============================================
// SECTION ACTIVATION
// ============================================
function onGamesSection() {
    initGamesFeature();
}

// Make functions globally available
window.initGamesFeature = initGamesFeature;
window.onGamesSection = onGamesSection;
window.playGame = playGame;
window.stopGame = stopGame;
window.removeGame = removeGame;
window.toggleFavorite = toggleFavorite;
