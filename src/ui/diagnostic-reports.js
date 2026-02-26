// diagnostics-reports.js

document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('diagnostic-reports');
    if (!section) return;

    const tableBody = document.getElementById('diagnostics-table-body');
    const emptyState = document.getElementById('diagnostics-empty-state');
    const lastCheckedEl = document.getElementById('diagnostics-last-checked');
    const severityFilter = document.getElementById('diagnostic-severity-filter');
    const healthBarIcon = document.getElementById('health-bar-icon');
    const healthBarText = document.getElementById('health-bar-text');
    const healthBarStats = document.getElementById('health-bar-stats');
    const loadMoreContainer = document.getElementById('diagnostics-load-more');
    const loadMoreBtn = document.getElementById('diagnostics-load-more-btn');
    let logs = [];
    const PAGE_SIZE = 20;
    let visibleCount = PAGE_SIZE;
    let ramInterval = null;

    // Severity styling mapping (inline CSS)
    const badgeStyles = {
        'red': 'background-color: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2);',
        'orange': 'background-color: rgba(249, 115, 22, 0.1); color: #f97316; border-color: rgba(249, 115, 22, 0.2);',
        'yellow': 'background-color: rgba(245, 158, 11, 0.1); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2);',
        'green': 'background-color: rgba(34, 197, 94, 0.1); color: #22c55e; border-color: rgba(34, 197, 94, 0.2);',
    };

    const severityLabels = {
        'critical': 'CRITICAL',
        'dangerous': 'DANGEROUS',
        'concern': 'CONCERN',
        'normal': 'NORMAL'
    };

    // Human-readable descriptions
    function describeLog(log) {
        const app = log.appName || '';
        const severity = log.severity;

        if (severity === 'critical') {
            return app
                ? `${app} — system kernel panic, Mac restarted`
                : 'System kernel panic — Mac restarted unexpectedly';
        }
        if (severity === 'dangerous') {
            return app ? `${app} crashed unexpectedly` : 'An app crashed';
        }
        if (severity === 'concern') {
            return app ? `${app} became unresponsive` : 'An app became unresponsive';
        }
        return app ? `${app} — routine diagnostic` : 'Routine system log';
    }

    // Relative time formatting
    function relativeTime(dateString) {
        const now = Date.now();
        const date = new Date(dateString).getTime();
        const diff = now - date;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)}w ago`;
        return new Date(dateString).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Update the Health Summary Bar
    function updateHealthBar() {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const recentLogs = logs.filter(l => new Date(l.modifiedAt).getTime() > sevenDaysAgo);

        const criticalCount = recentLogs.filter(l => l.severity === 'critical').length;
        const dangerousCount = recentLogs.filter(l => l.severity === 'dangerous').length;

        const healthBar = document.getElementById('diagnostics-health-bar');

        if (criticalCount > 0) {
            healthBarIcon.textContent = '🔴';
            healthBarText.textContent = 'System instability detected — kernel panics found';
            healthBarText.style.color = '#ef4444';
            healthBar.style.borderColor = 'rgba(239, 68, 68, 0.3)';
            healthBar.style.background = 'rgba(239, 68, 68, 0.05)';
        } else if (dangerousCount > 0) {
            healthBarIcon.textContent = '🟡';
            healthBarText.textContent = `Some app crashes detected (${dangerousCount} in last 7 days)`;
            healthBarText.style.color = '#f59e0b';
            healthBar.style.borderColor = 'rgba(245, 158, 11, 0.3)';
            healthBar.style.background = 'rgba(245, 158, 11, 0.05)';
        } else {
            healthBarIcon.textContent = '🟢';
            healthBarText.textContent = 'Your Mac is healthy — no serious issues';
            healthBarText.style.color = '#22c55e';
            healthBar.style.borderColor = 'rgba(34, 197, 94, 0.3)';
            healthBar.style.background = 'rgba(34, 197, 94, 0.05)';
        }

        healthBarStats.textContent = `${recentLogs.length} events in 7 days`;

        // Render Sparkline (mini bar chart)
        const sparklineContainer = document.getElementById('diagnostics-sparkline');
        if (sparklineContainer) {
            sparklineContainer.innerHTML = '';

            // Group logs by day (0 = today, 6 = 6 days ago)
            const dailyStats = Array.from({ length: 7 }, () => ({ count: 0, maxSev: 0 }));
            const nowTime = Date.now();

            // Map severity to an integer for easy max comparison
            const sevWeights = { 'normal': 1, 'concern': 2, 'dangerous': 3, 'critical': 4 };

            recentLogs.forEach(log => {
                const logTime = new Date(log.modifiedAt).getTime();
                const daysAgo = Math.floor((nowTime - logTime) / (24 * 60 * 60 * 1000));
                if (daysAgo >= 0 && daysAgo < 7) {
                    const idx = 6 - daysAgo; // Index 6 is today
                    dailyStats[idx].count++;
                    const weight = sevWeights[log.severity] || 1;
                    if (weight > dailyStats[idx].maxSev) {
                        dailyStats[idx].maxSev = weight;
                    }
                }
            });

            const maxCount = Math.max(...dailyStats.map(s => s.count), 1);

            // Create a shared custom tooltip element for instant hover
            let tooltip = document.getElementById('sparkline-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'sparkline-tooltip';
                tooltip.style.cssText = `
                    position: absolute; display: none; background: var(--bg-card); color: var(--text-primary); 
                    padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; 
                    border: 1px solid var(--border); box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 1000;
                    pointer-events: none; white-space: nowrap;
                `;
                document.body.appendChild(tooltip);
            }

            dailyStats.forEach((stat, i) => {
                const heightPercent = stat.count > 0 ? Math.max((stat.count / maxCount) * 100, 15) : 0;
                const bar = document.createElement('div');
                const isToday = i === 6;
                const daysAgoLabel = isToday ? 'Today' : `${6 - i}d ago`;

                // Color based on HIGHEST severity of that day
                let bgColor = 'var(--border)';
                if (stat.count > 0) {
                    if (stat.maxSev === 4) bgColor = '#ef4444'; // critical
                    else if (stat.maxSev === 3) bgColor = '#f97316'; // dangerous
                    else if (stat.maxSev === 2) bgColor = '#f59e0b'; // concern
                    else bgColor = '#22c55e'; // normal
                }

                bar.style.cssText = `
                    width: 6px; 
                    height: ${heightPercent > 0 ? heightPercent + '%' : '4px'}; 
                    background-color: ${bgColor}; 
                    border-radius: 2px 2px 0 0;
                    transition: height 0.3s ease;
                    cursor: pointer;
                    opacity: ${stat.count > 0 ? '1' : '0.3'};
                `;

                // Instant custom tooltip
                bar.addEventListener('mouseenter', (e) => {
                    bar.style.filter = 'brightness(1.5)';
                    tooltip.textContent = `${daysAgoLabel}: ${stat.count} log${stat.count !== 1 ? 's' : ''}`;
                    tooltip.style.display = 'block';

                    const rect = bar.getBoundingClientRect();
                    tooltip.style.left = (rect.left + rect.width / 2 - tooltip.offsetWidth / 2) + 'px';
                    tooltip.style.top = (rect.top - tooltip.offsetHeight - 6) + 'px';
                });
                bar.addEventListener('mouseleave', () => {
                    bar.style.filter = '';
                    tooltip.style.display = 'none';
                });

                sparklineContainer.appendChild(bar);
            });
        }
    }

    async function fetchLogs() {
        lastCheckedEl.textContent = 'Gathering system metrics and logs...';
        let updates = 0;

        // Show loading state in metrics
        const memMetric = document.getElementById('metric-memory');
        const diskMetric = document.getElementById('metric-disk');
        const shutdownMetric = document.getElementById('metric-shutdown');
        const panicsMetric = document.getElementById('metric-panics');

        if (memMetric) memMetric.textContent = 'Scanning...';
        if (diskMetric) diskMetric.textContent = 'Scanning...';
        if (shutdownMetric) shutdownMetric.textContent = 'Scanning...';
        if (panicsMetric) panicsMetric.textContent = '...';

        const updateStatusText = () => {
            updates++;
            if (updates >= 3) {
                lastCheckedEl.textContent = `Metrics gathered successfully at ${new Date().toLocaleTimeString()}`;
            }
        };

        // 1. Fetch File Logs
        window.electronAPI.getDiagnosticLogs().then(logsResponse => {
            if (logsResponse.success) {
                logs = logsResponse.logs;
                visibleCount = PAGE_SIZE; // reset pagination on new data
                renderLogs();
                updateHealthBar();

                // Calculate weekly panics
                const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                const recentPanics = logs.filter(l => l.severity === 'critical' && new Date(l.modifiedAt).getTime() > sevenDaysAgo);
                if (panicsMetric) {
                    panicsMetric.textContent = recentPanics.length;
                    panicsMetric.style.color = recentPanics.length > 0 ? '#ef4444' : 'var(--text-primary)';
                }
            } else {
                console.error('[Diagnostics] Failed to fetch logs:', logsResponse.error);
                lastCheckedEl.textContent = 'Error checking log files';
            }
            updateStatusText();
        }).catch(err => {
            console.error(err);
            updateStatusText();
        });

        // 2. Fetch Instant System Health (Disk)
        window.electronAPI.getSystemHealth().then(healthResponse => {
            if (healthResponse.success) {
                if (diskMetric) {
                    diskMetric.textContent = healthResponse.diskSmartStatus;
                    diskMetric.style.color = healthResponse.diskSmartStatus.toLowerCase().includes('verified') ? '#22c55e' : '#ef4444';
                }
            } else {
                console.error('[Diagnostics] Failed to fetch health metrics:', healthResponse.error);
                if (diskMetric) diskMetric.textContent = 'Error';
            }
            updateStatusText();
        }).catch(err => {
            console.error(err);
            updateStatusText();
        });

        // 3. Fetch Slow System Health (Shutdown Cause)
        window.electronAPI.getShutdownCause().then(shutdownResponse => {
            if (shutdownResponse.success) {
                if (shutdownMetric) {
                    shutdownMetric.textContent = shutdownResponse.shutdownCause;
                    if (shutdownResponse.shutdownCause.includes('(5)')) {
                        shutdownMetric.style.color = '#22c55e';
                    } else if (shutdownResponse.shutdownCause.includes('No recent')) {
                        shutdownMetric.style.color = 'var(--text-primary)';
                    } else {
                        shutdownMetric.style.color = '#f59e0b';
                    }
                }
            } else {
                console.error('[Diagnostics] Failed to fetch shutdown metrics:', shutdownResponse.error);
                if (shutdownMetric) shutdownMetric.textContent = 'Error';
            }
            updateStatusText();
        }).catch(err => {
            console.error(err);
            updateStatusText();
        });
    }

    window.readDiagnosticFile = async function (filePath) {
        try {
            const response = await window.electronAPI.readDiagnosticLog(filePath);
            if (response.success) {
                console.log("File content sample:\n", response.content.substring(0, 500));

                const apiKey = await window.electronAPI.getAICatApiKey();
                const hasAI = apiKey && apiKey.apiKey;

                if (hasAI && window.aiCatEnabled && window.electronAPI.explainWithAICat) {
                    const snippetForPrompt = response.content.length > 2000 ? response.content.substring(0, 2000) + '...' : response.content;
                    const prompt = 'Please analyze this macOS diagnostic log and tell me what crashed and why. Give me a short 2-3 sentence summary:\\n\\n' + snippetForPrompt;

                    const overlay = document.createElement('div');
                    overlay.style = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000; color: white; flex-direction: column; text-align: center; font-family: sans-serif;';
                    overlay.innerHTML = '<div style="font-size: 48px; margin-bottom: 16px;">🐱</div><div style="font-size: 18px;">AI Cat is analyzing the system log...</div>';
                    document.body.appendChild(overlay);

                    try {
                        const result = await window.electronAPI.explainWithAICat(
                            apiKey.apiKey,
                            prompt,
                            apiKey.model,
                            apiKey.provider
                        );

                        let answer = result.success ? result.response : 'Error: ' + result.error;

                        overlay.innerHTML = `
                            <div style="background: var(--bg-card); color: var(--text-primary); padding: 32px; border-radius: 12px; max-width: 600px; width: 90%; text-align: left; box-shadow: 0 10px 25px rgba(0,0,0,0.5); margin: auto; border: 1px solid var(--border);">
                                <h3 style="margin-top: 0; margin-bottom: 16px; display: flex; align-items: center; font-size: 20px;"><span style="font-size: 24px; margin-right: 12px;">🐱</span> AI Cat Analysis</h3>
                                <div style="font-size: 14px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 24px; background: var(--bg-main); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">${answer.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                                <div style="text-align: right;">
                                    <button onclick="this.parentElement.parentElement.parentElement.remove()" style="padding: 10px 24px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Close</button>
                                </div>
                            </div>
                        `;
                    } catch (err) {
                        alert('AI request failed: ' + err.message);
                        overlay.remove();
                    }
                } else {
                    // Google Search fallback
                    let searchQuery = '';
                    const content = response.content;

                    try {
                        const json = JSON.parse(content);
                        if (json.bug_type) searchQuery += json.bug_type + ' ';
                        if (json.app_name || json.procName) searchQuery += (json.app_name || json.procName) + ' ';
                        if (json.incident_id) searchQuery += json.incident_id + ' ';
                    } catch (e) {
                        const exceptionMatch = content.match(/Exception Type:\s+([^\n]+)/);
                        const processMatch = content.match(/Process:\s+(?:\[\d+\]\s+)?([^\n]+)/);
                        const terminationMatch = content.match(/Termination Reason:\s+([^\n]+)/);

                        if (processMatch) searchQuery += processMatch[1].trim() + ' ';
                        if (exceptionMatch) searchQuery += exceptionMatch[1].trim() + ' ';
                        if (terminationMatch) searchQuery += terminationMatch[1].trim() + ' ';
                    }

                    if (!searchQuery.trim()) {
                        searchQuery = filePath.split('/').pop().replace(/\.[^/.]+$/, '');
                    }

                    searchQuery = 'macOS crash ' + searchQuery.trim();
                    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(searchQuery);

                    if (confirm(`Search Google for:\n"${searchQuery}"?\n\nThis will open your browser.`)) {
                        window.electronAPI.openExternal(searchUrl);
                    }
                }
            }
        } catch (e) {
            console.error(e);
            alert('Error reading file.');
        }
    };

    function renderLogs() {
        tableBody.innerHTML = '';

        const selectedSeverity = severityFilter ? severityFilter.value : 'all';
        const filteredLogs = logs.filter(log => selectedSeverity === 'all' || log.severity === selectedSeverity);

        if (filteredLogs.length === 0) {
            // Show inline "no results" message in the table — NOT the full empty state
            if (loadMoreContainer) loadMoreContainer.style.display = 'none';
            if (logs.length === 0) {
                // Truly no logs at all — show the big empty state
                emptyState.style.display = 'flex';
            } else {
                // Filter just yielded 0, show inline message in table
                emptyState.style.display = 'none';
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="4" style="padding: 40px 16px; text-align: center; color: var(--text-secondary); font-size: 14px;">No logs matching "${severityLabels[selectedSeverity] || selectedSeverity}" severity. Try selecting a different filter.</td>`;
                tableBody.appendChild(tr);
            }
            return;
        }

        // Has results — hide empty state
        emptyState.style.display = 'none';

        // Pagination: only show up to visibleCount
        const logsToShow = filteredLogs.slice(0, visibleCount);
        const hasMore = filteredLogs.length > visibleCount;

        logsToShow.forEach((log) => {
            const tr = document.createElement('tr');
            tr.style.cssText = 'transition: background 0.15s;';
            tr.addEventListener('mouseenter', () => tr.style.background = 'rgba(255,255,255,0.02)');
            tr.addEventListener('mouseleave', () => tr.style.background = '');

            const badgeClass = badgeStyles[log.badge] || badgeStyles['green'];
            const label = severityLabels[log.severity] || 'NORMAL';
            const description = describeLog(log);

            tr.innerHTML = `
                <td style="padding: 12px 16px; white-space: nowrap; font-size: 13px; color: var(--text-secondary); border-bottom: 1px solid var(--border);">
                    ${relativeTime(log.modifiedAt)}
                </td>
                <td style="padding: 12px 16px; white-space: nowrap; border-bottom: 1px solid var(--border);">
                    <span style="padding: 3px 10px; display: inline-flex; font-size: 11px; line-height: 18px; font-weight: 600; border-radius: 9999px; border: 1px solid currentColor; ${badgeClass}">
                        ${label}
                    </span>
                </td>
                <td style="padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 500; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px;" title="${log.errorSnippet || log.name}">${description}</div>
                    <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px;" title="${log.name}">${log.name}</div>
                </td>
                <td style="padding: 12px 16px; white-space: nowrap; text-align: right; border-bottom: 1px solid var(--border);">
                    <button onclick="window.electronAPI.showItemInFolder('${log.path}')" style="color: #4f46e5; background: none; border: none; cursor: pointer; white-space: nowrap; font-size: 13px;" title="Locate file in Finder">
                        Show In Finder
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // Load More button
        if (loadMoreContainer && loadMoreBtn) {
            if (hasMore) {
                loadMoreContainer.style.display = 'block';
                const remaining = filteredLogs.length - visibleCount;
                loadMoreBtn.textContent = `Load ${Math.min(remaining, PAGE_SIZE)} more (${remaining} remaining)`;
            } else {
                loadMoreContainer.style.display = 'none';
            }
        }
    }

    // Load More click handler
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            visibleCount += PAGE_SIZE;
            renderLogs();
        });
    }

    // Severity filter handler
    if (severityFilter) {
        severityFilter.addEventListener('change', () => {
            visibleCount = PAGE_SIZE; // reset pagination when filter changes
            renderLogs();
        });
    }

    async function fetchRAM() {
        if (document.getElementById('diagnostic-reports').classList.contains('hidden')) return;

        const memMetric = document.getElementById('metric-memory');
        try {
            const res = await window.electronAPI.getRealtimeRAM();
            if (res.success && memMetric) {
                memMetric.textContent = res.text;
                // Color based on free memory: < 20% danger (red), < 40% warning (yellow)
                const free = res.freePercent;
                if (free < 20) memMetric.style.color = '#ef4444';
                else if (free < 40) memMetric.style.color = '#f59e0b';
                else memMetric.style.color = 'var(--text-primary)';
            } else if (memMetric && memMetric.textContent === 'Scanning...') {
                memMetric.textContent = 'Error';
            }
        } catch (e) { }
    }

    function startRAMPolling() {
        if (ramInterval) clearInterval(ramInterval);
        fetchRAM();
        ramInterval = setInterval(fetchRAM, 2000); // 2 seconds
    }

    function stopRAMPolling() {
        if (ramInterval) clearInterval(ramInterval);
        ramInterval = null;
    }

    // Overwrite the globally available showSection router hook for this specific section
    const originalShowSection = window.showSection;
    if (originalShowSection) {
        window.showSection = function (sectionId) {
            originalShowSection(sectionId);
            if (sectionId === 'diagnostic-reports') {
                fetchLogs();
                startRAMPolling();
            } else {
                stopRAMPolling();
            }
        };
    }

    const cleanBtn = document.getElementById('diagnostics-clean-btn');
    if (cleanBtn) {
        cleanBtn.addEventListener('click', async () => {
            const selectedSeverity = severityFilter ? severityFilter.value : 'all';
            const logsToDelete = logs.filter(log => selectedSeverity === 'all' || log.severity === selectedSeverity);

            if (logsToDelete.length === 0) {
                alert(`No ${selectedSeverity === 'all' ? '' : selectedSeverity + ' '}logs to clean.`);
                return;
            }

            const confirmMsg = selectedSeverity === 'all'
                ? `Are you sure you want to clean ALL ${logsToDelete.length} diagnostic logs?\n\nThis action cannot be undone.`
                : `Are you sure you want to clean ${logsToDelete.length} ${selectedSeverity.toUpperCase()} logs?\n\nThis action cannot be undone.`;

            if (confirm(confirmMsg)) {
                cleanBtn.disabled = true;
                cleanBtn.innerHTML = 'Cleaning...';

                try {
                    const paths = logsToDelete.map(l => l.path);
                    const result = await window.electronAPI.deleteDiagnosticLogs(paths);

                    if (result.success) {
                        if (result.failedCount > 0) {
                            alert(`Cleaned ${result.deletedCount} logs. Failed to clean ${result.failedCount} logs.`);
                        }
                        // Refresh the list
                        await fetchLogs();
                    } else {
                        alert('Error cleaning logs: ' + result.error);
                    }
                } catch (e) {
                    console.error(e);
                    alert('Error cleaning logs.');
                } finally {
                    cleanBtn.disabled = false;
                    cleanBtn.innerHTML = `
                        <svg style="width: 18px; height: 18px; margin-right: 8px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                        Clean Logs
                    `;
                }
            }
        });
    }

    // Fetch once on load if this page is active, otherwise rely on the hook
    if (!document.getElementById('diagnostic-reports').classList.contains('hidden')) {
        fetchLogs();
        startRAMPolling();
    }
});
