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

// FDA polling interval for joke page
let jokeFdaPollingInterval = null;

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
            startJokeFDAPolling();
        } else {
            // Has FDA - hide overlay, show joke, start!
            stopJokeFDAPolling();
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

// Update overlay UI when FDA not granted - show wizard with steps
function updateOverlayForNoFDA() {
    const overlay = document.getElementById('joke-fda-overlay');
    if (!overlay) return;

    const contentDiv = overlay.querySelector('div');
    if (!contentDiv) return;

    contentDiv.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 1rem;">🔐</div>
        <h2 style="color: #fbbf24; margin-bottom: 0.5rem;">Full Disk Access Required</h2>
        <p style="color: rgba(255,255,255,0.7); margin-bottom: 1.5rem; font-size: 13px;">
            Super Mode requires Full Disk Access. Follow these steps:
        </p>
        
        <div style="text-align: left; max-width: 400px; margin: 0 auto;">
            <div class="joke-fda-step" style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <span id="joke-fda-step-1" style="width: 28px; height: 28px; background: #fbbf24; color: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">1</span>
                <span style="flex: 1; font-size: 13px;">Click <strong style="color: #fbbf24;">Open Settings</strong> below</span>
            </div>
            <div class="joke-fda-step" style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <span id="joke-fda-step-2" style="width: 28px; height: 28px; background: rgba(255,255,255,0.1); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">2</span>
                <span style="flex: 1; font-size: 13px;">Click <strong style="color: #fbbf24;">+</strong> and select <strong style="color: #fbbf24;">MacCleaner</strong></span>
            </div>
            <div class="joke-fda-step" style="display: flex; align-items: center; gap: 12px; padding: 10px 0;">
                <span id="joke-fda-step-3" style="width: 28px; height: 28px; background: rgba(255,255,255,0.1); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">3</span>
                <span style="flex: 1; font-size: 13px;">Toggle <strong style="color: #fbbf24;">ON</strong> for MacCleaner</span>
            </div>
        </div>
        
        <button id="joke-fda-open-settings-btn" class="primary-btn" onclick="openSettingsFromJoke()" style="margin-top: 1.5rem; font-size: 1rem; padding: 0.75rem 1.5rem;">
            Open Settings
        </button>
        
        <div id="joke-fda-status" style="margin-top: 1rem; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 12px;">
            <div style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #fbbf24; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span id="joke-fda-status-text">Click "Open Settings" to begin...</span>
        </div>
        
        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
        </style>
    `;
}

// Open settings from joke page and update step 1
async function openSettingsFromJoke() {
    await window.electronAPI.openFullDiskAccessSettings();

    // Mark step 1 as done
    const step1 = document.getElementById('joke-fda-step-1');
    const step2 = document.getElementById('joke-fda-step-2');
    const statusText = document.getElementById('joke-fda-status-text');

    if (step1) {
        step1.textContent = '✓';
        step1.style.background = '#4ade80';
    }
    if (step2) {
        step2.style.background = '#fbbf24';
        step2.style.color = '#000';
    }
    if (statusText) {
        statusText.textContent = 'Click + and select MacCleaner from Applications...';
    }
}

// Update overlay UI when FDA granted
function updateOverlayForFDAGranted() {
    // Mark all steps as done
    ['joke-fda-step-1', 'joke-fda-step-2', 'joke-fda-step-3'].forEach(id => {
        const step = document.getElementById(id);
        if (step) {
            step.textContent = '✓';
            step.style.background = '#4ade80';
            step.style.color = '#000';
        }
    });

    // Update status
    const statusText = document.getElementById('joke-fda-status-text');
    if (statusText) {
        statusText.textContent = 'Full Disk Access granted! Starting Super Mode...';
        statusText.style.color = '#4ade80';
    }

    // Hide settings button
    const openBtn = document.getElementById('joke-fda-open-settings-btn');
    if (openBtn) openBtn.style.display = 'none';

    // Auto-start after 2 seconds
    setTimeout(() => {
        startSuperModeFromOverlay();
    }, 2000);
}

// Start polling to check FDA status for joke page
function startJokeFDAPolling() {
    if (jokeFdaPollingInterval) return; // Already polling

    console.log('[Joke] Starting FDA polling...');
    jokeFdaPollingInterval = setInterval(async () => {
        try {
            const hasFDA = await window.electronAPI.checkFullDiskAccess();
            if (hasFDA) {
                console.log('[Joke] FDA granted!');
                updateOverlayForFDAGranted();
                stopJokeFDAPolling();
            }
        } catch (e) {
            console.error('[Joke] FDA poll error:', e);
        }
    }, 2000); // Poll every 2 seconds
}

// Stop FDA polling for joke page
function stopJokeFDAPolling() {
    if (jokeFdaPollingInterval) {
        console.log('[Joke] Stopping FDA polling...');
        clearInterval(jokeFdaPollingInterval);
        jokeFdaPollingInterval = null;
    }
}

// Start Super Mode from overlay button
function startSuperModeFromOverlay() {
    const overlay = document.getElementById('joke-fda-overlay');
    const jokeContainer = document.querySelector('.joke-container');

    stopJokeFDAPolling();

    // Hide overlay, show joke
    if (overlay) overlay.classList.add('hidden');
    if (jokeContainer) jokeContainer.style.display = 'block';

    // Start the joke!
    startJoke();
}
