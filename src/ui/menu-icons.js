/**
 * Menu Icon Animations - Simple CSS approach
 * Since anime.js UMD doesn't work well in Electron, using pure CSS
 */

// Add animated class on hover for CSS to handle
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        const icon = item.querySelector('.nav-icon');
        if (!icon) return;

        item.addEventListener('mouseenter', () => {
            icon.classList.add('animating');
        });

        item.addEventListener('mouseleave', () => {
            icon.classList.remove('animating');
        });

        // Remove class after animation completes
        icon.addEventListener('animationend', () => {
            icon.classList.remove('animating');
        });
    });

    console.log('[Menu Icons] CSS animations initialized');
});
