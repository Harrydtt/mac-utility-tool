// ============================================
// JOKE PAGE - Fake System Wipe Animation
// ============================================
// This is completely fake and does NOTHING real!
// Just a visual prank with countdown and fake progress bars.
// Now with PAUSE/RESUME - can't escape by switching tabs! 😈

let jokeTimer = null;
let jokeRunning = false;
let jokePaused = false;

// State to save for pause/resume
let jokeState = {
    phase: 'idle', // 'countdown', 'deleting', 'restart', 'done'
    seconds: 10,
    currentFolder: 0,
    restartSeconds: 5,
    folderProgress: [] // progress for each folder
};

// Start the joke when entering the page
function startJoke() {
    if (jokeRunning && !jokePaused) return;

    const countdownEl = document.getElementById('joke-countdown');
    const resultEl = document.getElementById('joke-result');
    const folders = document.querySelectorAll('.folder-wipe-item');
    const cancelBtn = document.getElementById('joke-cancel-btn');

    // If resuming from pause
    if (jokePaused) {
        jokePaused = false;
        resumeFromState();
        return;
    }

    // Fresh start
    jokeRunning = true;
    jokeState = {
        phase: 'countdown',
        seconds: 10,
        currentFolder: 0,
        restartSeconds: 3, // Changed from 5 to 3
        folderProgress: Array(folders.length).fill(0)
    };

    // Reset UI
    resultEl.classList.add('hidden');
    countdownEl.textContent = '10';
    if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;
        cancelBtn.style.background = '';
        cancelBtn.style.display = 'inline-block';
    }

    const countdownLabel = document.querySelector('.countdown-label');
    const countdownSeconds = document.querySelector('.countdown-seconds');
    countdownLabel.textContent = 'Self-destruct in:';
    countdownLabel.style.color = '';
    countdownSeconds.textContent = 'seconds';

    resetFolderUI();

    runCountdown();
}

function resetFolderUI() {
    const folders = document.querySelectorAll('.folder-wipe-item');
    folders.forEach((f, i) => {
        f.querySelector('.wipe-bar').style.width = (jokeState.folderProgress[i] || 0) + '%';
        if (jokeState.folderProgress[i] >= 100) {
            f.querySelector('.wipe-status').textContent = 'DELETED!';
            f.querySelector('.wipe-status').className = 'wipe-status done';
        } else if (jokeState.folderProgress[i] > 0) {
            f.querySelector('.wipe-status').textContent = 'Deleting...';
            f.querySelector('.wipe-status').className = 'wipe-status deleting';
        } else {
            f.querySelector('.wipe-status').textContent = 'Waiting...';
            f.querySelector('.wipe-status').className = 'wipe-status';
        }
    });
}

function resumeFromState() {
    switch (jokeState.phase) {
        case 'countdown':
            runCountdown();
            break;
        case 'deleting':
            startDeletingFolders();
            break;
        case 'restart':
            showRestartWarning();
            break;
        case 'done':
            showJokeReveal();
            break;
    }
}

function runCountdown() {
    const countdownEl = document.getElementById('joke-countdown');
    const cancelBtn = document.getElementById('joke-cancel-btn');

    // Lock all nav items during countdown
    document.querySelectorAll('.nav-item').forEach(item => {
        if (!item.classList.contains('joke-cancel')) {
            item.style.pointerEvents = 'none';
            item.style.opacity = '0.5';
        }
    });

    countdownEl.textContent = jokeState.seconds;

    const runNextTick = () => {
        if (jokePaused) return;

        jokeState.seconds--;
        countdownEl.textContent = jokeState.seconds;

        if (jokeState.seconds <= 0) {
            if (cancelBtn) cancelBtn.style.display = 'none';
            jokeState.phase = 'deleting';
            unlockNavItems(); // Unlock UI when countdown ends
            startDeletingFolders();
            return;
        }

        // Slow phase: 10→5 (1 second each)
        // Fast phase: 5→0 (very fast, 100ms each)
        const delay = jokeState.seconds > 5 ? 1000 : 100;
        jokeTimer = setTimeout(runNextTick, delay);
    };

    // Start with first delay
    const firstDelay = jokeState.seconds > 5 ? 1000 : 100;
    jokeTimer = setTimeout(runNextTick, firstDelay);
}

// Start deleting folders after countdown reaches 0
function startDeletingFolders() {
    const folders = document.querySelectorAll('.folder-wipe-item');

    const deleteNext = () => {
        if (jokePaused) return;

        if (jokeState.currentFolder < folders.length) {
            animateFolder(folders[jokeState.currentFolder], () => {
                jokeState.currentFolder++;
                setTimeout(deleteNext, 300);
            });
        } else {
            jokeState.phase = 'restart';
            setTimeout(showRestartWarning, 500);
        }
    };

    deleteNext();
}

// Show "Restarting in 5s" before the reveal
function showRestartWarning() {
    if (jokePaused) return;

    const countdownEl = document.getElementById('joke-countdown');
    const countdownLabel = document.querySelector('.countdown-label');
    const countdownSeconds = document.querySelector('.countdown-seconds');

    countdownLabel.textContent = '⚠️ RESTARTING SYSTEM IN:';
    countdownLabel.style.color = '#ff3333';
    countdownSeconds.textContent = '';

    countdownEl.textContent = jokeState.restartSeconds;

    const restartTimer = setInterval(() => {
        if (jokePaused) {
            clearInterval(restartTimer);
            return;
        }

        jokeState.restartSeconds--;
        countdownEl.textContent = jokeState.restartSeconds;

        if (jokeState.restartSeconds <= 0) {
            clearInterval(restartTimer);
            jokeState.phase = 'done';
            showBlackScreen();
        }
    }, 1000);
}

// Show black screen for 2 seconds
function showBlackScreen() {
    if (jokePaused) return;

    const blackScreen = document.createElement('div');
    blackScreen.id = 'joke-black-screen';
    blackScreen.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #000;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    document.body.appendChild(blackScreen);

    setTimeout(() => {
        blackScreen.remove();
        showJokeReveal();
    }, 2000);
}

// Animate a single folder's fake deletion
function animateFolder(folderEl, onComplete) {
    if (jokePaused) return;

    const bar = folderEl.querySelector('.wipe-bar');
    const status = folderEl.querySelector('.wipe-status');
    const folderIndex = jokeState.currentFolder;

    status.textContent = 'Deleting...';
    status.className = 'wipe-status deleting';

    let progress = jokeState.folderProgress[folderIndex] || 0;

    const interval = setInterval(() => {
        if (jokePaused) {
            clearInterval(interval);
            return;
        }

        progress += Math.random() * 25 + 15;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            status.textContent = 'DELETED!';
            status.className = 'wipe-status done';
            if (onComplete) onComplete();
        }
        jokeState.folderProgress[folderIndex] = progress;
        bar.style.width = progress + '%';
    }, 60);
}

// Show the "just kidding" reveal
function showJokeReveal() {
    const resultEl = document.getElementById('joke-result');
    const headerEl = document.querySelector('.joke-header');
    const countdownContainer = document.querySelector('.countdown-container');
    const foldersEl = document.querySelector('.joke-folders');

    if (headerEl) headerEl.style.opacity = '0.3';
    if (countdownContainer) countdownContainer.style.opacity = '0.3';
    if (foldersEl) foldersEl.style.opacity = '0.3';

    resultEl.classList.remove('hidden');
    jokeRunning = false;
    jokeState.phase = 'idle';
    unlockNavItems(); // Make sure nav is unlocked
}

// Unlock nav items so user can navigate away
function unlockNavItems() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.style.pointerEvents = '';
        item.style.opacity = '';
    });
}

// Exit joke without restarting - go to dashboard
function exitJoke() {
    if (jokeTimer) {
        clearTimeout(jokeTimer);
        jokeTimer = null;
    }
    jokeRunning = false;
    jokePaused = false;
    jokeState.phase = 'idle';
    unlockNavItems();

    // Reset UI opacity back to normal
    resetJokeUIOpacity();

    // Go to dashboard
    showSection('dashboard');
}

// Reset joke UI elements opacity
function resetJokeUIOpacity() {
    const headerEl = document.querySelector('.joke-header');
    const countdownContainer = document.querySelector('.countdown-container');
    const foldersEl = document.querySelector('.joke-folders');
    const resultEl = document.getElementById('joke-result');

    if (headerEl) headerEl.style.opacity = '1';
    if (countdownContainer) countdownContainer.style.opacity = '1';
    if (foldersEl) foldersEl.style.opacity = '1';
    if (resultEl) resultEl.classList.add('hidden');
}

// Fake cancel button - does nothing!
function fakeCancelJoke() {
    const btn = document.getElementById('joke-cancel-btn');
    if (btn) {
        btn.textContent = 'Canceling...';
        btn.disabled = true;
        setTimeout(() => {
            btn.textContent = "Nah, can't cancel!";
            btn.style.background = '#ff3333';
        }, 1500);
    }
}

// Pause the joke (when switching away)
function pauseJoke() {
    if (!jokeRunning || jokeState.phase === 'idle' || jokeState.phase === 'done') return;

    jokePaused = true;
    if (jokeTimer) {
        clearInterval(jokeTimer);
        jokeTimer = null;
    }
    console.log('[Joke] Paused at phase:', jokeState.phase);
}

// Reset joke to try again
function resetJoke() {
    if (jokeTimer) {
        clearInterval(jokeTimer);
        jokeTimer = null;
    }
    jokeRunning = false;
    jokePaused = false;

    const headerEl = document.querySelector('.joke-header');
    const countdownContainer = document.querySelector('.countdown-container');
    const foldersEl = document.querySelector('.joke-folders');

    if (headerEl) headerEl.style.opacity = '1';
    if (countdownContainer) countdownContainer.style.opacity = '1';
    if (foldersEl) foldersEl.style.opacity = '1';

    jokeState = {
        phase: 'idle',
        seconds: 10,
        currentFolder: 0,
        restartSeconds: 3, // Changed from 5 to 3
        folderProgress: []
    };

    // Unlock nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.style.pointerEvents = '';
        item.style.opacity = '';
    });

    startJoke();
}

// Auto-start when joke section becomes visible
document.addEventListener('DOMContentLoaded', () => {
    const jokeSection = document.getElementById('joke');
    if (jokeSection) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(async (mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (!jokeSection.classList.contains('hidden')) {
                        // Section visible - check FDA first
                        await checkFDAForJoke();
                    } else {
                        // Section hidden - PAUSE instead of reset!
                        pauseJoke();
                    }
                }
            });
        });

        observer.observe(jokeSection, { attributes: true });
    }
});

// FDA polling interval
let fdaPollingInterval = null;

// Check Full Disk Access before showing joke
async function checkFDAForJoke() {
    const overlay = document.getElementById('joke-fda-overlay');
    const jokeContainer = document.querySelector('.joke-container');

    try {
        // Read FDA status (non-destructive, just reading)
        const hasFDA = await window.electronAPI.checkFullDiskAccess();

        if (!hasFDA) {
            // No FDA - show overlay with "Open Settings" button, hide joke
            if (overlay) overlay.classList.remove('hidden');
            if (jokeContainer) jokeContainer.style.display = 'none';
            updateOverlayForNoFDA();
            startFDAPolling();
        } else {
            // Has FDA - hide overlay, show joke, start!
            stopFDAPolling();
            if (overlay) overlay.classList.add('hidden');
            if (jokeContainer) jokeContainer.style.display = 'block';
            startJoke();
        }
    } catch (e) {
        console.error('[Joke] FDA check error:', e);
        // On error, just hide overlay and start (fail-safe)
        if (overlay) overlay.classList.add('hidden');
        if (jokeContainer) jokeContainer.style.display = 'block';
        startJoke();
    }
}

// Update overlay UI when FDA not granted
function updateOverlayForNoFDA() {
    const icon = document.getElementById('fda-icon');
    const title = document.getElementById('fda-title');
    const message = document.getElementById('fda-message');
    const openSettingsBtn = document.getElementById('fda-open-settings-btn');
    const startSuperBtn = document.getElementById('fda-start-super-btn');

    if (icon) icon.textContent = '🔒';
    if (title) {
        title.textContent = 'Full Disk Access Required';
        title.style.color = 'var(--risky)';
    }
    if (message) message.innerHTML = 'This feature requires Full Disk Access to work.<br>Please grant permission in System Settings.';
    if (openSettingsBtn) openSettingsBtn.classList.remove('hidden');
    if (startSuperBtn) startSuperBtn.classList.add('hidden');
}

// Update overlay UI when FDA granted
function updateOverlayForFDAGranted() {
    const icon = document.getElementById('fda-icon');
    const title = document.getElementById('fda-title');
    const message = document.getElementById('fda-message');
    const openSettingsBtn = document.getElementById('fda-open-settings-btn');
    const startSuperBtn = document.getElementById('fda-start-super-btn');

    if (icon) icon.textContent = '✅';
    if (title) {
        title.textContent = 'Access Granted!';
        title.style.color = 'var(--safe)';
    }
    if (message) message.innerHTML = 'Full Disk Access has been granted.<br>Ready to start Super Mode!';
    if (openSettingsBtn) openSettingsBtn.classList.add('hidden');

    // Only show Super Mode button if Hidden Gems are unlocked
    if (startSuperBtn && !startSuperBtn.classList.contains('gem-locked')) {
        startSuperBtn.classList.remove('hidden');
    }
}

// Start polling to check FDA status
function startFDAPolling() {
    if (fdaPollingInterval) return; // Already polling

    console.log('[Joke] Starting FDA polling...');
    fdaPollingInterval = setInterval(async () => {
        try {
            const hasFDA = await window.electronAPI.checkFullDiskAccess();
            if (hasFDA) {
                console.log('[Joke] FDA granted!');
                updateOverlayForFDAGranted();
                stopFDAPolling();
            }
        } catch (e) {
            console.error('[Joke] FDA poll error:', e);
        }
    }, 2000); // Poll every 2 seconds
}

// Stop FDA polling
function stopFDAPolling() {
    if (fdaPollingInterval) {
        console.log('[Joke] Stopping FDA polling...');
        clearInterval(fdaPollingInterval);
        fdaPollingInterval = null;
    }
}

// Start Super Mode from overlay button
function startSuperModeFromOverlay() {
    const overlay = document.getElementById('joke-fda-overlay');
    const jokeContainer = document.querySelector('.joke-container');

    stopFDAPolling();

    // Hide overlay, show joke
    if (overlay) overlay.classList.add('hidden');
    if (jokeContainer) jokeContainer.style.display = 'block';

    // Start the joke!
    startJoke();
}
