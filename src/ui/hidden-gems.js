
// ============================================
// Hidden Gems Unlock System
// ============================================
// Secret command to unlock Super Mode and AI Cat features

const GEMS_UNLOCKED_KEY = 'mac-cleaner-gems-unlocked';

window.unlockHiddenGemsPro = function () {
    const gemsLocked = document.querySelectorAll('.gem-locked');

    if (gemsLocked.length === 0) {
        console.log('🎁 Hidden Gems already unlocked!');
        return;
    }

    // Unlock animation
    gemsLocked.forEach((el, index) => {
        setTimeout(() => {
            el.classList.remove('hidden');
            el.classList.remove('gem-locked');
            el.style.animation = 'fadeIn 0.5s ease-in';
        }, index * 200);
    });

    // Persist unlock state
    localStorage.setItem(GEMS_UNLOCKED_KEY, 'true');

    console.log('🎁✨ Hidden Gems Unlocked! ✨🎁');
    console.log('Super Mode and AI Cat Helper are now available in Settings.');
};

// Lock gems back (hide them again)
window.lockHiddenGemsPro = function () {
    // Find all elements that were unlocked (no gem-locked class but should be hidden)
    const superModeMenu = document.querySelector('.joke-nav');
    const superModeBtn = document.getElementById('fda-start-super-btn');
    const aiCatSettings = document.getElementById('aicat-settings-group');

    const elementsToLock = [superModeMenu, superModeBtn, aiCatSettings].filter(el => el);

    if (elementsToLock.every(el => el.classList.contains('gem-locked'))) {
        console.log('🔒 Hidden Gems already locked!');
        return;
    }

    elementsToLock.forEach(el => {
        el.classList.add('hidden');
        el.classList.add('gem-locked');
    });

    // Clear persisted state
    localStorage.removeItem(GEMS_UNLOCKED_KEY);

    console.log('🔒 Hidden Gems Locked!');
    console.log('Use window.unlockHiddenGemsPro() to unlock again.');
};

// Auto-restore unlock state on page load
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem(GEMS_UNLOCKED_KEY) === 'true') {
        // Delay slightly to ensure DOM is ready
        setTimeout(() => {
            window.unlockHiddenGemsPro();
            console.log('[Gems] Restored unlock state from storage');
        }, 100);
    }
});
