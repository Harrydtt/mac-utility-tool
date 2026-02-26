/**
 * 🐱 Kitten Mascot - Premium Feature
 * Simple animated cat that follows card hovers
 */

class KittenMascot {
    constructor() {
        this.element = null;
        this.catImg = null;
        this.speechBubble = null;
        this.x = 100;
        this.y = 100;
        this.targetX = 100;
        this.targetY = 100;
        this.currentCard = null;
        this.isVisible = false;
        this.state = 'idle';
        this.animationFrame = null;
        this.frameIndex = 0;
        this.lastFrameTime = 0;
        this.moveTimeout = null;

        // PNG cat animation frames
        this.runFrames = [
            '../../assets/cat/cat_0.png',
            '../../assets/cat/cat_1.png',
            '../../assets/cat/cat_2.png',
            '../../assets/cat/cat_3.png',
            '../../assets/cat/cat_4.png'
        ];

        this.init();
    }

    init() {
        // Create kitten container
        this.element = document.createElement('div');
        this.element.className = 'kitten-mascot';
        this.element.style.display = 'none';

        // Create cat image
        this.catImg = document.createElement('img');
        this.catImg.className = 'kitten-sprite';
        this.catImg.src = this.runFrames[0];
        this.catImg.draggable = false;

        this.element.appendChild(this.catImg);

        // Create speech bubble
        this.speechBubble = document.createElement('div');
        this.speechBubble.className = 'kitten-speech-bubble';
        this.speechBubble.style.display = 'none';
        this.speechBubble.addEventListener('mouseleave', () => this.hideSpeechBubble());

        document.body.appendChild(this.element);
        document.body.appendChild(this.speechBubble);

        // Click handler
        this.element.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showCardInfo();
        });

        this.setupCardTracking();
        this.setupSectionTracking();
        this.startAnimation();
    }

    setupCardTracking() {
        document.addEventListener('mouseover', (e) => {
            const card = e.target.closest('.category-card');
            if (card && card !== this.currentCard) {
                this.currentCard = card;

                // Debounce
                clearTimeout(this.moveTimeout);
                this.moveTimeout = setTimeout(() => this.moveToCard(card), 100);
            }
        });
    }

    setupSectionTracking() {
        const originalShowSection = window.showSection;
        window.showSection = (sectionId) => {
            originalShowSection(sectionId);
            if (sectionId === 'dashboard') {
                this.show();
            } else {
                this.hide();
            }
        };
    }

    moveToCard(card) {
        if (!this.isVisible) return;

        const rect = card.getBoundingClientRect();
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;

        // Calculate target position
        const newTargetX = rect.left + scrollX + (rect.width / 2) - 16;

        // Check row position for vertical placement
        const zone = card.closest('.drop-zone');
        const cards = zone ? Array.from(zone.querySelectorAll('.category-card')) : [];
        const rows = new Map();
        cards.forEach(c => {
            const r = c.getBoundingClientRect();
            const rowKey = Math.round(r.top / 50) * 50;
            if (!rows.has(rowKey)) rows.set(rowKey, []);
            rows.get(rowKey).push(c);
        });
        const sortedRows = Array.from(rows.keys()).sort((a, b) => a - b);
        const cardRow = Math.round(rect.top / 50) * 50;
        const isLastRow = sortedRows.indexOf(cardRow) === sortedRows.length - 1;

        const newTargetY = isLastRow ?
            rect.bottom + scrollY + 4 :
            rect.top + scrollY - 36;

        // SET DIRECTION BASED ON TARGET (simple: left or right of current position)
        const goingLeft = newTargetX < this.x;

        // Apply flip using CSS class (not inline style)
        this.element.classList.toggle('flip-left', goingLeft);

        this.targetX = newTargetX;
        this.targetY = newTargetY;
        this.state = 'running';
        this.hideSpeechBubble();
    }

    startAnimation() {
        const FRAME_DURATION = 120; // ms per sprite frame

        const animate = (timestamp) => {
            if (!this.isVisible) {
                this.animationFrame = requestAnimationFrame(animate);
                return;
            }

            // Sprite animation (always animate, even when idle)
            if (timestamp - this.lastFrameTime > FRAME_DURATION) {
                this.lastFrameTime = timestamp;
                this.frameIndex = (this.frameIndex + 1) % this.runFrames.length;
                this.catImg.src = this.runFrames[this.frameIndex];
            }

            // Movement
            const dx = this.targetX - this.x;
            const dy = this.targetY - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 3) {
                this.x += dx * 0.1;
                this.y += dy * 0.1;
                this.element.style.left = this.x + 'px';
                this.element.style.top = this.y + 'px';
            } else if (this.state === 'running') {
                this.state = 'idle';
            }

            this.animationFrame = requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    showCardInfo() {
        if (!this.currentCard) return;

        const categoryId = this.currentCard.dataset.categoryId;
        const infos = {
            'system-cache': 'Temporary cache files from macOS and apps. Auto-generated, safe to delete.',
            'system-logs': 'Log files recording system activity. Located in /var/log and ~/Library/Logs.',
            'temp-files': 'Temporary files from apps. Safe to remove, found in /tmp.',
            'trash': 'Files in your Trash, taking up space until emptied.',
            'downloads': 'Downloaded files in ~/Downloads. Review before deleting.',
            'browser-cache': 'Browser cache from Safari, Chrome, Firefox. Safe to delete.',
            'dev-cache': 'Developer caches from npm, pip, gradle. Will be re-downloaded.',
            'homebrew': 'Old Homebrew packages. Safe to remove with "brew cleanup".',
            'docker': 'Unused Docker images and containers.',
            'ios-backups': 'Old iPhone/iPad backups. Check dates before deleting.',
            'mail-attachments': 'Email attachments downloaded locally.',
            'language-files': 'Unused language files (.lproj) in apps.',
            'large-files': 'Files larger than 500MB. Review individually.',
            'node-modules': 'node_modules folders. Run "npm install" to restore.',
            'duplicates': 'Duplicate files. Keep only one copy.'
        };

        const info = infos[categoryId] || 'Files that can be cleaned up.';

        this.speechBubble.innerHTML = `<div class="speech-content"><span class="speech-info"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>${info}</span></div>`;

        // Center bubble above cat (cat is ~32px wide, bubble is ~280px max)
        // Cat center = this.x + 16
        // Bubble should be centered, so left = catCenter - bubbleWidth/2
        // We'll use CSS to handle centering with transform
        this.speechBubble.style.left = (this.x + 16) + 'px'; // Cat center X
        this.speechBubble.style.top = (this.y - 70) + 'px';
        this.speechBubble.style.display = 'block';
    }

    hideSpeechBubble() {
        this.speechBubble.style.display = 'none';
    }

    show() {
        // Only show on dashboard section
        const dashboardSection = document.getElementById('dashboard');
        if (!dashboardSection || dashboardSection.classList.contains('hidden')) {
            return; // Don't show if not on dashboard
        }

        this.isVisible = true;
        this.element.style.display = 'block';
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            const rect = mainContent.getBoundingClientRect();
            this.x = rect.right - 100;
            this.y = rect.bottom - 125;
            this.targetX = this.x;
            this.targetY = this.y;
            this.element.style.left = this.x + 'px';
            this.element.style.top = this.y + 'px';
        }
    }

    hide() {
        this.isVisible = false;
        this.element.style.display = 'none';
        this.hideSpeechBubble();
    }
}

// Global
let kittenMascot = null;
function initKitten() {
    if (!kittenMascot) {
        kittenMascot = new KittenMascot();
        window.kittenMascot = kittenMascot;
    }
}
function showKitten() { kittenMascot?.show(); }
function hideKitten() { kittenMascot?.hide(); }
