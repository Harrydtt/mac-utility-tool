// ============================================
// Transfer Feature - Standalone Module
// Uses bundled maccleaner_transfer (sendme CLI)
// ============================================
// @ts-nocheck
(function () {
    'use strict';
    // State
    let transferState = {
        mode: 'send', // 'send' or 'receive'
        status: 'idle',
        ticket: '',
        filename: '',
        selectedFiles: [], // Array of ORIGINAL paths (folders/files)
        receiveDir: '', // Custom receive directory
        itemMetadata: {}, // NEW: Map path -> { type: 'folder'|'file', displayName: string, originalPath: string }
        zipToFolderMap: {}, // NEW: Map zipPath -> originalFolderPath
        zipMode: localStorage.getItem('tf-zip-mode') || 'zip' // Persist zip preference
    };
    // Inject CSS for pulse animation
    (function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulse-ring {
                0% { transform: scale(0.33); opacity: 0; }
                80%, 100% { opacity: 0; }
            }
            @keyframes pulse-dot {
                0% { transform: scale(0.8); }
                50% { transform: scale(1); }
                100% { transform: scale(0.8); }
            }
            .pulse-container {
                position: relative;
                width: 120px;
                height: 120px;
                margin: 2rem auto;
            }
            .pulse-ring {
                position: absolute;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                background-color: rgba(16, 185, 129, 0.2);
                animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
            }
            .pulse-circle {
                position: absolute;
                top: 25%;
                left: 25%;
                width: 50%;
                height: 50%;
                border-radius: 50%;
                background-color: rgba(16, 185, 129, 0.6);
                animation: pulse-dot 3s cubic-bezier(0.455, 0.03, 0.515, 0.955) -0.4s infinite;
            }
            .pulse-core {
                position: absolute;
                top: 42%;
                left: 42%;
                width: 16%;
                height: 16%;
                border-radius: 50%;
                background-color: #10b981;
                animation: pulse-dot 3s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite;
            }
            .tf-context-menu {
                position: fixed;
                background: var(--bg-secondary, #1f2937);
                border: 1px solid var(--border-color, #374151);
                border-radius: 8px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
                padding: 6px;
                min-width: 140px;
                z-index: 10000;
                display: none;
            }
            .tf-context-menu-item {
                padding: 10px 12px;
                color: var(--text-primary, #e5e7eb);
                font-size: 0.9rem;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                border-radius: 6px;
                transition: background 0.2s;
            }
            .tf-context-menu-item:hover {
                background: var(--bg-tertiary, #374151);
                color: #10b981;
            }
        `;
        document.head.appendChild(style);
    })();
    // Create and inject Transfer UI into the page
    function createTransferUI() {
        // Create menu button
        const navContainer = document.querySelector('.sidebar nav');
        if (navContainer && !document.querySelector('[data-section="transfer-feature"]')) {
            const transferBtn = document.createElement('button');
            transferBtn.className = 'nav-item';
            transferBtn.setAttribute('data-section', 'transfer-feature');
            transferBtn.onclick = () => showTransferSection();
            transferBtn.innerHTML = `
                <svg class="nav-icon nav-icon-animated" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                    <path d="M5 19h14" />
                </svg>
                Transfer Files
            `;
            // Insert before the joke button if it exists, otherwise at the end
            const jokeBtn = navContainer.querySelector('.joke-nav');
            if (jokeBtn) {
                navContainer.insertBefore(transferBtn, jokeBtn);
            }
            else {
                navContainer.appendChild(transferBtn);
            }
        }
        // Create section if not exists
        if (!document.getElementById('transfer-feature')) {
            const mainContent = document.querySelector('main');
            if (mainContent) {
                const section = document.createElement('section');
                section.id = 'transfer-feature';
                section.className = 'section hidden';
                section.innerHTML = getTransferSectionHTML();
                mainContent.appendChild(section);
            }
        }
    }
    // Transfer section HTML
    function getTransferSectionHTML() {
        return `
            <div style="padding: 2rem; max-width: 900px; margin: 0 auto;">
                <h2 style="text-align: center; margin-bottom: 0.5rem;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" style="display: inline-block; vertical-align: middle; margin-right: 8px;">
                        <path d="M12 19V5M5 12l7-7 7 7" />
                        <path d="M5 19h14" />
                    </svg>
                    Transfer Files
                </h2>
                <p style="text-align: center; color: var(--text-secondary); margin-bottom: 1.5rem;">
                    Secure P2P file sharing. Direct device-to-device transfer.
                </p>

                <!-- Tab Navigation -->
                <div style="display: flex; gap: 0; margin-bottom: 1.5rem; background: var(--bg-secondary); border-radius: 12px; padding: 4px;">
                    <button id="tf-tab-send" onclick="TransferFeature.switchTab('send')" 
                        style="flex: 1; padding: 12px 24px; border: none; background: #10b981; color: white; font-size: 1rem; font-weight: 600; cursor: pointer; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        📤 SHARING
                    </button>
                    <button id="tf-tab-receive" onclick="TransferFeature.switchTab('receive')"
                        style="flex: 1; padding: 12px 24px; border: none; background: transparent; color: var(--text-secondary); font-size: 1rem; font-weight: 600; cursor: pointer; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        📥 RECEIVING
                    </button>
                </div>

                <!-- SHARING Content -->
                <div id="tf-send-content">
                    
                    <!-- File Selection List -->
                    <div id="tf-file-list" style="display: none; margin-bottom: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                            <span style="font-weight: 600; color: var(--text-primary);">Selected Files (<span id="tf-file-count">0</span>)</span>
                            <button onclick="TransferFeature.clearAllFiles()" style="background: none; border: none; color: var(--risky); font-size: 0.85rem; cursor: pointer;">Clear All</button>
                        </div>
                        <div id="tf-file-items" style="max-height: 200px; overflow-y: auto; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid #444;">
                            <!-- Items go here -->
                        </div>
                        <div style="margin-top: 1rem; display: flex; gap: 10px;">
                             <button onclick="document.getElementById('tf-file-input').click()" style="flex: 1; padding: 10px; background: #3b82f6; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 500;">
                                📄 Add Files
                            </button>
                             <button onclick="TransferFeature.openFolderPicker()" style="flex: 1; padding: 10px; background: #8b5cf6; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 500;">
                                📁 Add Folders
                            </button>
                        </div>
                        <div style="margin-top: 1rem; margin-bottom: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                             <div style="display: flex; gap: 20px; align-items: center;">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" id="tf-chk-zip" onchange="TransferFeature.toggleZipMode('zip')">
                                    <span style="color: var(--text-primary); font-size: 0.9rem;">Compress (Zip)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                    <input type="checkbox" id="tf-chk-nozip" onchange="TransferFeature.toggleZipMode('no-zip')">
                                    <span style="color: var(--text-primary); font-size: 0.9rem;">No Compression</span>
                                </label>
                             </div>
                             <div id="tf-zip-warning" style="display: none; color: #ef4444; font-size: 0.8rem; font-weight: 500;">
                                ⚠️ Not enough space to create Zip. Switched to No-Zip.
                             </div>
                        </div>

                        <div style="margin-top: 0.5rem;">
                             <button onclick="TransferFeature.proceedSend()" style="width: 100%; padding: 12px; background: #10b981; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 600;">
                                🚀 Share Now
                            </button>
                        </div>
                    </div>

                    <div id="tf-dropzone" style="border: 2px dashed #10b981; border-radius: 16px; padding: 3rem 2rem; text-align: center; background: rgba(16, 185, 129, 0.05); min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; transition: all 0.3s ease;">
                        <div style="font-size: 4rem;">📁</div>
                        <div style="font-size: 1.1rem; color: #10b981; font-weight: 500;">Share files or folders</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">Drag & drop here, or use buttons below</div>
                        <div style="display: flex; gap: 10px;">
                            <button onclick="document.getElementById('tf-file-input').click(); event.stopPropagation();" style="padding: 10px 20px; background: #10b981; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 500;">
                                📄 Add Files
                            </button>
                            <button onclick="TransferFeature.openFolderPicker(); event.stopPropagation();" style="padding: 10px 20px; background: #10b981; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 500;">
                                📁 Add Folders
                            </button>
                        </div>
                    </div>
                    <input type="file" id="tf-file-input" style="display: none;" multiple>

                    <!-- Ticket Display - Modified for Multi-file -->
                    <div id="tf-ticket-box" style="display: none; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 12px; padding: 1rem; margin-top: 1.5rem;">
                         <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.8rem; color: var(--text-secondary);">Sharing:</div>
                                <div id="tf-sent-summary" style="font-weight: 600; color: var(--text-primary);"></div>
                            </div>
                            <button onclick="TransferFeature.resetSend()" style="font-size: 0.8rem; padding: 4px 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; color: var(--text-primary);">
                                🔄 New Share
                            </button>
                        </div>

                        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">🎫 Share this ticket with the receiver:</div>
                        <div id="tf-ticket-code" style="font-family: monospace; font-size: 0.9rem; background: var(--bg-primary); padding: 12px; border-radius: 8px; word-break: break-all; color: var(--accent); margin-bottom: 0.75rem; max-height: 80px; overflow-y: auto;"></div>
                        <button id="tf-copy-btn" onclick="TransferFeature.copyTicket()" style="width: 100%; padding: 10px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer;">
                            📋 Copy Ticket
                        </button>
                    </div>

                    <!-- Status/Progress -->
                    <div id="tf-send-status" style="display: none; text-align: center; padding: 1.5rem; background: var(--bg-secondary); border-radius: 12px; margin-top: 1.5rem;">
                        <div id="tf-send-status-icon" style="font-size: 2rem; margin-bottom: 0.5rem;">⏳</div>
                        <div id="tf-send-status-text" style="font-size: 1rem; color: var(--text-primary); margin-bottom: 1rem;"></div>
                        <!-- Progress Bar (Sharing) -->
                        <div style="width: 100%; background: var(--bg-primary); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 1rem;">
                            <div id="tf-send-progress" style="width: 0%; height: 100%; background: #10b981; transition: width 0.3s ease;"></div>
                        </div>
                        <button onclick="TransferFeature.cancel()" style="padding: 8px 16px; background: transparent; border: 1px solid var(--risky); color: var(--risky); border-radius: 8px; cursor: pointer;">Cancel Sharing</button>
                    </div>
                </div>

                <!-- RECEIVING Content -->
                <div id="tf-receive-content" style="display: none;">
                    <p style="text-align: center; color: var(--text-secondary); margin-bottom: 1rem;">
                        Paste the ticket to start receiving
                    </p>
                    <input type="text" id="tf-receive-input" placeholder="Paste ticket here (blob...)" 
                        style="width: 100%; padding: 14px; border: 2px solid #10b981 !important; border-radius: 12px; background: var(--bg-secondary); color: var(--text-primary); font-size: 1rem; margin-bottom: 1rem; box-sizing: border-box;">
                    
                    <!-- Destination Folder Selection -->
                    <div style="display: flex; gap: 10px; margin-bottom: 1rem; align-items: center;">
                        <input type="text" id="tf-receive-dir" placeholder="Save to: Downloads (Default)" readonly
                             style="flex: 1; padding: 10px; border: 2px solid #10b981 !important; border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); font-size: 0.9rem;">
                        <button onclick="TransferFeature.selectReceiveFolder()" style="padding: 10px 16px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px; cursor: pointer; white-space: nowrap;">
                            📂 Browse
                        </button>
                    </div>

                    <button id="tf-receive-btn" onclick="TransferFeature.startReceive()" disabled
                        style="width: 100%; padding: 14px; background: #10b981; color: white; border: none; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; opacity: 0.5;">
                        📥 Start Receiving
                    </button>

                    <!-- Receive Status (Modern UI) -->
                    <div id="tf-receive-status" style="display: none; background: #1a1a1a; border-radius: 12px; padding: 1.5rem; margin-top: 1.5rem; color: white; position: relative; border: 1px solid var(--border-color);">
                        <!-- Header -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></div>
                                <span style="color: #10b981; font-weight: 500;">Downloading in progress</span>
                            </div>
                            <!-- Stop Button -->
                            <button onclick="TransferFeature.cancel()" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; color: #ef4444; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease;">
                                <div style="width: 10px; height: 10px; background: currentColor; border-radius: 2px;"></div>
                            </button>
                        </div>

                        <!-- Pulse Animation -->
                        <div class="pulse-container">
                             <div class="pulse-ring"></div>
                             <div class="pulse-circle"></div>
                             <div class="pulse-core"></div>
                        </div>
                        
                        <div style="text-align: center; color: #888; font-size: 0.85rem; margin-bottom: 2rem; margin-top: -1rem;">
                            Keep this app open while downloading files
                        </div>

                        <!-- Progress Section -->
                        <div style="margin-top: auto;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.9rem;">
                                <span style="color: #ccc;">Transfer Progress</span>
                                <span id="tf-receive-pct" style="color: #fff; font-weight: 600;">0%</span>
                            </div>
                            
                            <!-- Progress Bar -->
                            <div style="height: 12px; background: #333; border-radius: 6px; overflow: hidden; margin-bottom: 12px; border: 1px solid #444;">
                                <div id="tf-receive-progress" style="width: 0%; height: 100%; background: linear-gradient(90deg, #10b981, #059669); transition: width 0.3s ease;"></div>
                            </div>

                            <!-- Footer Stats -->
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: #888;">
                                <span id="tf-receive-speed">Waiting...</span>
                                <span id="tf-receive-size">-- / --</span>
                            </div>
                        </div>
                    </div>


                </div>

                <!-- How it works - SHARING (shown in Send tab) -->
                <div id="tf-how-send" style="background: var(--bg-tertiary); border-radius: 8px; padding: 1rem; margin-top: 1.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 How to Share</div>
                    <ol style="margin: 0.5rem 0 0 1.2rem; padding: 0;">
                        <li>Add files or folders to share</li>
                        <li>Click "Share Now" to generate a ticket</li>
                        <li>Copy and send the ticket to receiver(s)</li>
                        <li>Keep app open while others download</li>
                    </ol>
                    <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                        <div style="font-weight: 500; color: #10b981; margin-bottom: 0.4rem;">✨ Benefits</div>
                        <ul style="margin: 0; padding-left: 1.2rem; list-style: disc;">
                            <li><b>P2P Transfer</b> - Direct device-to-device, no server storage</li>
                            <li><b>Multi-Receiver</b> - Share with unlimited people at once</li>
                            <li><b>Large Files</b> - No file size limits</li>
                        </ul>
                    </div>
                    <div style="margin-top: 0.75rem; font-size: 0.8rem; opacity: 0.8;">
                        🔗 Receiver can also use <a href="https://www.altsendme.com/" target="_blank" style="color: #10b981; text-decoration: underline;">AltSendMe</a> app to download
                    </div>
                </div>

                <!-- How it works - RECEIVING (shown in Receive tab, initially hidden) -->
                <div id="tf-how-receive" style="display: none; background: var(--bg-tertiary); border-radius: 8px; padding: 1rem; margin-top: 1.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                    <div style="font-weight: 600; margin-bottom: 0.5rem;">💡 How to Receive</div>
                    <ol style="margin: 0.5rem 0 0 1.2rem; padding: 0;">
                        <li>Get the ticket from sender (via this app or <a href="https://www.altsendme.com/" target="_blank" style="color: #10b981;">AltSendMe</a>)</li>
                        <li>Paste the ticket in the input field above</li>
                        <li>Optionally choose a save location</li>
                        <li>Click "Start Receiving" to download</li>
                    </ol>
                    <div style="margin-top: 0.75rem; font-size: 0.8rem; opacity: 0.8;">
                        ✅ Files transfer directly from sender's device - fast & secure
                    </div>
                </div>
            </div>
        `;
    }
    // Show transfer section
    function showTransferSection() {
        // Hide all sections - explicitly handling dashboard if it doesn't have .section class
        document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
        const dashboard = document.getElementById('dashboard');
        if (dashboard)
            dashboard.classList.add('hidden');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        // Show transfer section
        const section = document.getElementById('transfer-feature');
        if (section) {
            section.classList.remove('hidden');
        }
        // Mark nav active
        const navBtn = document.querySelector('[data-section="transfer-feature"]');
        if (navBtn) {
            navBtn.classList.add('active');
        }
    }
    // Switch between Send/Receive tabs
    function switchTab(tab) {
        transferState.mode = tab;
        const sendTab = document.getElementById('tf-tab-send');
        const receiveTab = document.getElementById('tf-tab-receive');
        const sendContent = document.getElementById('tf-send-content');
        const receiveContent = document.getElementById('tf-receive-content');
        const howSend = document.getElementById('tf-how-send');
        const howReceive = document.getElementById('tf-how-receive');
        if (tab === 'send') {
            sendTab.style.background = 'var(--accent)';
            sendTab.style.color = 'white';
            receiveTab.style.background = 'transparent';
            receiveTab.style.color = 'var(--text-secondary)';
            sendContent.style.display = 'block';
            receiveContent.style.display = 'none';
            if (howSend)
                howSend.style.display = 'block';
            if (howReceive)
                howReceive.style.display = 'none';
        }
        else {
            receiveTab.style.background = 'var(--accent)';
            receiveTab.style.color = 'white';
            sendTab.style.background = 'transparent';
            sendTab.style.color = 'var(--text-secondary)';
            sendContent.style.display = 'none';
            receiveContent.style.display = 'block';
            if (howSend)
                howSend.style.display = 'none';
            if (howReceive)
                howReceive.style.display = 'block';
        }
    }
    // Setup Context Menu for Paste
    function setupPasteContextMenu() {
        const input = document.getElementById('tf-receive-input');
        if (!input)
            return;
        // Check if menu already exists
        let menu = document.getElementById('tf-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'tf-context-menu';
            menu.className = 'tf-context-menu';
            menu.innerHTML = `
                <div class="tf-context-menu-item" id="tf-ctx-paste">
                    <span>📋</span> Paste
                </div>
            `;
            document.body.appendChild(menu);
            // Handle Paste Click
            const pasteBtn = document.getElementById('tf-ctx-paste');
            if (pasteBtn) {
                pasteBtn.onclick = async () => {
                    try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                            input.value = text;
                            // Trigger input event for validation
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }
                    catch (err) {
                        console.error('Failed to read clipboard:', err);
                    }
                    menu.style.display = 'none';
                };
            }
            // Close on outside click
            document.addEventListener('click', (e) => {
                if (menu && e.target.closest('#tf-context-menu') !== menu) {
                    menu.style.display = 'none';
                }
            });
            // Close on scroll - simple fix for loose menu
            document.addEventListener('scroll', () => {
                if (menu)
                    menu.style.display = 'none';
            }, true);
        }
        // Context Menu Event
        input.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (menu) {
                menu.style.display = 'block';
                menu.style.left = `${e.clientX}px`;
                menu.style.top = `${e.clientY}px`;
            }
        });
    }
    // Setup event listeners
    function setupEventListeners() {
        // Dropzone
        const dropzone = document.getElementById('tf-dropzone');
        const fileInput = document.getElementById('tf-file-input');
        const receiveInput = document.getElementById('tf-receive-input');
        const receiveBtn = document.getElementById('tf-receive-btn');
        // Init Context Menu
        setupPasteContextMenu();
        if (dropzone) {
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'var(--accent)';
                dropzone.style.background = 'rgba(var(--accent-rgb), 0.1)';
            });
            dropzone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'var(--border-color)';
                dropzone.style.background = 'var(--bg-secondary)';
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.style.borderColor = 'var(--border-color)';
                dropzone.style.background = 'var(--bg-secondary)';
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    addFiles(files);
                }
            });
            dropzone.addEventListener('click', () => fileInput?.click());
        }
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files.length > 0) {
                    addFiles(files);
                }
            });
        }
        if (receiveInput) {
            receiveInput.addEventListener('input', () => {
                const ticket = receiveInput.value.trim();
                receiveBtn.disabled = ticket.length < 10;
                receiveBtn.style.opacity = ticket.length < 10 ? '0.5' : '1';
            });
        }
    }
    // Open folder picker dialog (LAZY ZIPPING - No zip until Share Now)
    async function openFolderPicker() {
        try {
            const paths = await window.electronAPI.pickFolders();
            if (!paths || paths.length === 0)
                return;
            const warning = document.getElementById('tf-zip-warning');
            for (const folderPath of paths) {
                // Always check disk space for Zip mode
                if (transferState.zipMode === 'zip') {
                    const sizeRes = await window.electronAPI.transferGetPathSize(folderPath);
                    const freeRes = await window.electronAPI.transferGetFreeSpace();
                    if (sizeRes.success && freeRes.success && sizeRes.sizeBytes > freeRes.freeBytes) {
                        // Not enough space -> Auto switch to No-Zip
                        if (warning) {
                            warning.style.display = 'block';
                            warning.textContent = '⚠️ Not enough space for ' + folderPath.split('/').pop() + '. Switched to No-Zip.';
                        }
                        transferState.zipMode = 'no-zip';
                        localStorage.setItem('tf-zip-mode', 'no-zip');
                        const zipChk = document.getElementById('tf-chk-zip');
                        const nozipChk = document.getElementById('tf-chk-nozip');
                        if (zipChk)
                            zipChk.checked = false;
                        if (nozipChk)
                            nozipChk.checked = true;
                    }
                }
                // Add to selection (NO ZIP YET!)
                if (!transferState.selectedFiles.includes(folderPath)) {
                    transferState.selectedFiles.push(folderPath);
                    // Store metadata
                    const folderName = folderPath.split('/').pop();
                    const displayName = transferState.zipMode === 'zip' ? `${folderName}.zip` : folderName;
                    transferState.itemMetadata[folderPath] = {
                        type: 'folder',
                        displayName: displayName,
                        originalPath: folderPath
                    };
                }
            }
            renderFileList();
        }
        catch (e) {
            console.error('[Transfer] Failed to open folder picker:', e);
        }
    }
    // Toggle Zip Mode (Checkbox Handler) - MUTUAL EXCLUSIVE + LAZY
    async function toggleZipMode(mode) {
        const zipChk = document.getElementById('tf-chk-zip');
        const nozipChk = document.getElementById('tf-chk-nozip');
        const warning = document.getElementById('tf-zip-warning');
        // If clicking the already active mode, prevent unchecking
        if (mode === transferState.zipMode) {
            if (mode === 'zip' && zipChk)
                zipChk.checked = true;
            if (mode === 'no-zip' && nozipChk)
                nozipChk.checked = true;
            return;
        }
        // Update State
        transferState.zipMode = mode;
        localStorage.setItem('tf-zip-mode', mode);
        // Update UI - MUTUAL EXCLUSIVE
        if (mode === 'zip') {
            if (zipChk)
                zipChk.checked = true;
            if (nozipChk)
                nozipChk.checked = false; // Uncheck the other
        }
        else {
            if (zipChk)
                zipChk.checked = false; // Uncheck the other
            if (nozipChk)
                nozipChk.checked = true;
        }
        if (warning)
            warning.style.display = 'none';
        // Update display names only (NO ACTUAL ZIPPING)
        for (const path of transferState.selectedFiles) {
            if (!transferState.itemMetadata)
                transferState.itemMetadata = {};
            const metadata = transferState.itemMetadata[path];
            if (metadata && metadata.type === 'folder') {
                const folderName = path.split('/').pop();
                metadata.displayName = mode === 'zip' ? `${folderName}.zip` : folderName;
            }
        }
        // Re-render
        renderFileList();
    }
    // Add files to selection
    function addFiles(fileList) {
        for (const file of fileList) {
            // Avoid duplicates?
            if (!transferState.selectedFiles.includes(file.path)) {
                transferState.selectedFiles.push(file.path);
            }
        }
        renderFileList();
    }
    // Remove file
    function removeFile(index) {
        transferState.selectedFiles.splice(index, 1);
        renderFileList();
    }
    // Clear all
    function clearAllFiles() {
        transferState.selectedFiles = [];
        renderFileList();
    }
    // Render File List UI
    function renderFileList() {
        const listContainer = document.getElementById('tf-file-list');
        const itemsContainer = document.getElementById('tf-file-items');
        const dropzone = document.getElementById('tf-dropzone');
        const countSpan = document.getElementById('tf-file-count');
        countSpan.textContent = transferState.selectedFiles.length;
        if (transferState.selectedFiles.length > 0) {
            listContainer.style.display = 'block';
            dropzone.style.display = 'none';
            // SYNC UI WITH STATE: Ensure checkboxes match zipMode
            const zipChk = document.getElementById('tf-chk-zip');
            const nozipChk = document.getElementById('tf-chk-nozip');
            if (zipChk)
                zipChk.checked = transferState.zipMode === 'zip';
            if (nozipChk)
                nozipChk.checked = transferState.zipMode === 'no-zip';
        }
        else {
            listContainer.style.display = 'none';
            dropzone.style.display = 'flex';
            return;
        }
        itemsContainer.innerHTML = transferState.selectedFiles.map((path, index) => {
            // Use metadata displayName if available, otherwise extract from path
            const metadata = transferState.itemMetadata[path];
            const filename = metadata ? metadata.displayName : path.split('/').pop();
            const dirPath = path.split('/').slice(0, -1).join('/');
            const icon = metadata && metadata.type === 'folder' ? '📁' : '📄';
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #333;">
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-size: 0.9rem; color: var(--text-primary); font-weight: 500;">
                        ${icon} ${filename}
                    </div>
                    <div style="font-size: 0.75rem; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;" title="${path}">
                        ${dirPath}/
                    </div>
                </div>
                <button onclick="TransferFeature.removeFile(${index})" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 1rem;">✕</button>
            </div>
        `;
        }).join('');
    }
    // Proceed to Send (LAZY ZIPPING IMPLEMENTATION)
    async function proceedSend() {
        if (transferState.selectedFiles.length === 0)
            return;
        const statusDiv = document.getElementById('tf-send-status');
        const statusIcon = document.getElementById('tf-send-status-icon');
        const statusText = document.getElementById('tf-send-status-text');
        // Prepare file list to send
        let filesToSend = [];
        // LAZY ZIPPING: Zip folders now if needed
        if (transferState.zipMode === 'zip') {
            // Show Compressing UI
            const dropzone = document.getElementById('tf-dropzone');
            const fileList = document.getElementById('tf-file-list');
            if (dropzone)
                dropzone.style.display = 'none';
            if (fileList)
                fileList.style.display = 'none';
            if (statusDiv) {
                statusDiv.style.display = 'block';
                statusIcon.textContent = '📦';
                statusText.textContent = 'Compressing items...';
            }
            for (const path of transferState.selectedFiles) {
                const metadata = transferState.itemMetadata[path];
                // Only zip folders that are not already zips
                if (metadata && metadata.type === 'folder') {
                    // Check if already zipped (optimization)
                    const existingZip = transferState.zipToFolderMap[path]; // Logic inverted in map? No.
                    // Actually we don't store zip path yet.
                    const zipResult = await window.electronAPI.transferZipFolder(path);
                    if (zipResult.success && zipResult.zipPath) {
                        filesToSend.push(zipResult.zipPath);
                        transferState.zipToFolderMap[zipResult.zipPath] = path;
                    }
                    else {
                        // Failed to zip -> fallback to original
                        console.error('Zip failed, falling back:', path);
                        filesToSend.push(path);
                    }
                }
                else {
                    filesToSend.push(path);
                }
            }
        }
        else {
            // No Zip Mode -> Send originals
            filesToSend = [...transferState.selectedFiles];
        }
        await startSend(filesToSend);
    }
    // Start sending (Backend Logic)
    async function startSend(filePaths) {
        // If filePaths is string (single), make array. If array, use as is.
        const items = Array.isArray(filePaths) ? filePaths : [filePaths];
        const dropzone = document.getElementById('tf-dropzone');
        const fileList = document.getElementById('tf-file-list');
        const ticketBox = document.getElementById('tf-ticket-box');
        const statusDiv = document.getElementById('tf-send-status');
        const statusIcon = document.getElementById('tf-send-status-icon');
        const statusText = document.getElementById('tf-send-status-text');
        const progressBar = document.getElementById('tf-send-progress');
        dropzone.style.display = 'none';
        fileList.style.display = 'none'; // Hide list during send
        statusDiv.style.display = 'block';
        statusIcon.textContent = '⏳';
        statusText.textContent = items.length > 1 ? `Packaging ${items.length} items...` : 'Preparing to share...';
        if (progressBar)
            progressBar.style.width = '0%';
        try {
            // Send array of paths!
            // For folder shares, pass original folder paths for monitoring and display
            let options = {
                forceZip: transferState.zipMode === 'zip'
            };
            // Collect all original folder paths from zipToFolderMap OR itemMetadata
            const folderPaths = items
                .map(path => {
                // 1. Try Zip Map (Zip Mode)
                if (transferState.zipToFolderMap && transferState.zipToFolderMap[path]) {
                    return transferState.zipToFolderMap[path];
                }
                // 2. Try Metadata (No-Zip Mode)
                const meta = transferState.itemMetadata[path];
                if (meta && meta.type === 'folder') {
                    return path;
                }
                return null;
            })
                .filter(fp => fp);
            if (folderPaths.length > 0) {
                // Pass as array (single folder or multiple)
                options.sourceFolderPath = folderPaths.length === 1 ? folderPaths[0] : folderPaths;
            }
            const result = await window.electronAPI.transferSend(items, options);
            if (result.success) {
                // QUEUE UX: Don't block. Just confirm and reset.
                // Show temporary "Added to Queue" on the button or general area?
                // We'll Alert for simplicity or use a temporary toast if we had one.
                // For now: Alert is blocking.
                // Better: Change the "Share Now" button text temporarily.
                const shareBtn = document.querySelector('button[onclick="TransferFeature.proceedSend()"]');
                if (shareBtn) {
                    const originalText = shareBtn.textContent;
                    shareBtn.textContent = '✅ Added to Queue';
                    shareBtn.style.background = '#10b981';
                    setTimeout(() => {
                        shareBtn.textContent = originalText;
                        shareBtn.style.background = '#10b981';
                    }, 2000);
                }
                // Reset UI immediately for next file
                resetSend();
                // Poll for completion (Table will show it)
                pollTransferStatus();
            }
            else {
                statusDiv.style.display = 'block';
                statusIcon.textContent = '❌';
                statusText.textContent = result.error || 'Failed to send';
            }
        }
        catch (e) {
            statusDiv.style.display = 'block';
            statusIcon.textContent = '❌';
            statusText.textContent = e.message;
        }
    }
    // Start receiving
    async function startReceive() {
        const receiveInput = document.getElementById('tf-receive-input');
        const receiveBtn = document.getElementById('tf-receive-btn');
        const statusDiv = document.getElementById('tf-receive-status');
        const progressBar = document.getElementById('tf-receive-progress');
        const ticket = receiveInput.value.trim();
        if (!ticket)
            return;
        // Visual Feedback: Adding...
        const originalText = receiveBtn.textContent;
        receiveBtn.textContent = 'Adding...';
        receiveBtn.disabled = true;
        try {
            const result = await window.electronAPI.transferReceive(ticket, transferState.receiveDir);
            if (result.success) {
                // Add to ReceiveManagerUI history so it appears in the table
                if (window.ReceiveManagerUI_Instance && result.id) {
                    window.ReceiveManagerUI_Instance.history.push({
                        id: result.id,
                        ticket: ticket,
                        mode: 'receive',
                        status: 'pending',
                        filename: '',
                        progress: 0
                    });
                    window.ReceiveManagerUI_Instance.renderTable();
                }
                // Success Feedback
                receiveBtn.textContent = '✅ Added to Queue';
                // Keep button color - don't change it
                receiveInput.value = '';
                // Reset button after 1.5s
                setTimeout(() => {
                    receiveBtn.textContent = '📥 Start Receiving';
                    // Don't reset background - keep original green
                    receiveBtn.disabled = true; // Disabled until new ticket entered
                    receiveBtn.style.opacity = '0.5';
                }, 1500);
                pollTransferStatus();
            }
            else {
                alert(result.error);
                receiveBtn.textContent = 'Receive File';
                receiveBtn.disabled = false;
            }
        }
        catch (e) {
            alert(e.message);
            receiveBtn.textContent = 'Receive File';
            receiveBtn.disabled = false;
        }
    }
    // Poll for transfer status
    async function pollTransferStatus() {
        if (transferState.mode === 'receive') {
            // REMOVED: Progress bar is now handled entirely by ReceiveManagerUI table
            // We do NOT show the #tf-receive-status block anymore - only the table
            const statusList = await window.electronAPI.transferStatus();
            const sessions = Array.isArray(statusList) ? statusList : [statusList];
            // Check if we should keep polling (if queue exists)
            const pending = sessions.some(s => s.mode === 'receive' && (s.status === 'pending' || s.status === 'active'));
            if (pending)
                setTimeout(pollTransferStatus, 1000);
            return;
        }
        // Send Logic (Simplified for Multi-Session: Table handles everything now)
        // We do NOT show the blocking status box anymore.
        // Just poll to keep the table updated (via TransferManager)
        // The Table poll is separate in TransferManager, but this poll loop might be useful if we add global counters later.
        // For now, we can actually stop polling here if we don't need the top box.
        // BUT, TransferManager has its own poll.
        // So this function `pollTransferStatus` might be redundantly updating the DEPRECATED status box.
        // Let's just return. The TransferManagerUI handles the Table.
        // We only kept this to update the "Big Box".
        // Since we killed the Big Box, we can kill this logic.
        return;
    }
    // Copy ticket
    function copyTicket() {
        const ticket = transferState.ticket;
        if (!ticket)
            return;
        navigator.clipboard.writeText(ticket).then(() => {
            const btn = document.getElementById('tf-copy-btn');
            if (btn) {
                btn.textContent = '✅ Copied!';
                btn.style.background = '#10b981';
                setTimeout(() => {
                    btn.textContent = '📋 Copy Ticket';
                    btn.style.background = '#10b981';
                }, 2000);
            }
        });
    }
    // Cancel transfer
    async function cancel() {
        try {
            await window.electronAPI.transferCancel();
        }
        catch (e) {
            console.log('[Transfer] Cancel error:', e);
        }
        resetUI();
    }
    // Select Receive Folder
    async function selectReceiveFolder() {
        try {
            const result = await window.electronAPI.pickFolders();
            if (result && result.length > 0) {
                const path = result[0];
                transferState.receiveDir = path;
                const input = document.getElementById('tf-receive-dir');
                if (input)
                    input.value = path;
                // Save using new state persistence API
                window.electronAPI.transferSetReceiveFolder(path).catch(err => console.error(err));
            }
        }
        catch (e) {
            console.error('Failed to select folder:', e);
        }
    }
    // Load saved receive folder on startup
    async function loadSavedReceiveFolder() {
        try {
            const folder = await window.electronAPI.transferGetReceiveFolder();
            if (folder) {
                transferState.receiveDir = folder;
                const input = document.getElementById('tf-receive-dir');
                if (input) {
                    input.value = folder;
                }
            }
        }
        catch (e) {
            console.error('Failed to load receive folder:', e);
        }
    }
    // Reset UI (Receive)
    function resetUI() {
        transferState.status = 'idle';
        transferState.ticket = '';
        const dropzone = document.getElementById('tf-dropzone');
        const ticketBox = document.getElementById('tf-ticket-box');
        const sendStatus = document.getElementById('tf-send-status');
        const receiveStatus = document.getElementById('tf-receive-status');
        if (dropzone)
            dropzone.style.display = 'flex';
        if (ticketBox)
            ticketBox.style.display = 'none';
        if (sendStatus)
            sendStatus.style.display = 'none';
        if (receiveStatus)
            receiveStatus.style.display = 'none';
        const receiveInput = document.getElementById('tf-receive-input');
        const receiveBtn = document.getElementById('tf-receive-btn');
        if (receiveInput) {
            // Always block display now
            receiveInput.style.display = 'block';
            receiveInput.value = '';
        }
        if (receiveBtn) {
            receiveBtn.style.display = 'block';
            receiveBtn.disabled = false;
            receiveBtn.textContent = 'Receive File';
            receiveBtn.style.opacity = '1';
        }
    }
    // Reset Send UI to pick another file
    function resetSend() {
        const dropzone = document.getElementById('tf-dropzone');
        const ticketBox = document.getElementById('tf-ticket-box');
        const statusDiv = document.getElementById('tf-send-status');
        const fileList = document.getElementById('tf-file-list');
        if (dropzone)
            dropzone.style.display = 'flex';
        if (ticketBox)
            ticketBox.style.display = 'none';
        if (statusDiv)
            statusDiv.style.display = 'none';
        if (fileList)
            fileList.style.display = 'none';
        transferState.ticket = '';
        transferState.filename = '';
        transferState.selectedFiles = [];
        const countSpan = document.getElementById('tf-file-count');
        if (countSpan)
            countSpan.textContent = '0';
        const fileInput = document.getElementById('tf-file-input');
        if (fileInput)
            fileInput.value = '';
    }
    // Initialize
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                createTransferUI();
                setTimeout(setupEventListeners, 100);
                // Load saved receive folder
                setTimeout(loadSavedReceiveFolder, 500);
            });
        }
        else {
            createTransferUI();
            setTimeout(setupEventListeners, 100);
            // Load saved receive folder
            setTimeout(loadSavedReceiveFolder, 500);
        }
    }
    // Expose to global
    window.TransferFeature = {
        showTransferSection,
        switchTab,
        startSend,
        startReceive,
        copyTicket,
        cancel,
        selectReceiveFolder,
        resetSend,
        removeFile,
        clearAllFiles,
        proceedSend,
        proceedSend,
        openFolderPicker,
        toggleZipMode
    };
    // Auto-init
    init();
})();
