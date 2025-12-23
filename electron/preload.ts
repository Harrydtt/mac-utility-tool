const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Starting preload script...');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Full Disk Access
    checkFullDiskAccess: () => ipcRenderer.invoke('fda:check'),
    openFullDiskAccessSettings: () => ipcRenderer.invoke('fda:openSettings'),
    requestFullDiskAccess: () => ipcRenderer.invoke('fda:requestPermission'),

    // Disk
    getDiskInfo: () => ipcRenderer.invoke('disk:info'),

    // Scanners
    getScanners: () => ipcRenderer.invoke('scanners:list'),

    // Settings
    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    saveLayout: (categoryOverrides) => ipcRenderer.invoke('settings:layout', { categoryOverrides }),

    // History
    getHistory: () => ipcRenderer.invoke('history:get'),

    // Scan
    startScan: () => ipcRenderer.invoke('scan:start'),
    scanCategories: (categoryIds) => ipcRenderer.invoke('scan:categories', categoryIds),
    onScanProgress: (callback) => {
        ipcRenderer.on('scan:progress', (_event, data) => callback(data));
    },
    onScanComplete: (callback) => {
        ipcRenderer.on('scan:complete', (_event, data) => callback(data));
    },
    onScanError: (callback) => {
        ipcRenderer.on('scan:error', (_event, error) => callback(error));
    },

    // Clean
    clean: (params) => ipcRenderer.invoke('clean', params),

    // Ignore - Files (existing)
    ignore: (paths) => ipcRenderer.invoke('ignore', { paths }),
    unignore: (paths) => ipcRenderer.invoke('unignore', { paths }),

    // Ignore - Folders (new)
    pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
    pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
    ignoreFolders: (folders) => ipcRenderer.invoke('ignore:folders', { folders }),
    unignoreFolder: (folder) => ipcRenderer.invoke('unignore:folder', { folder }),

    // Ignore - Categories (new)
    ignoreCategory: (categoryId) => ipcRenderer.invoke('ignore:category', { categoryId }),
    unignoreCategory: (categoryId) => ipcRenderer.invoke('unignore:category', { categoryId }),

    // Login Item (Start at Login)
    getLoginItem: () => ipcRenderer.invoke('loginItem:get'),
    setLoginItem: (openAtLogin) => ipcRenderer.invoke('loginItem:set', { openAtLogin }),
    openLoginSettings: () => ipcRenderer.invoke('loginItem:openSettings'),

    // App Uninstaller
    selectApp: () => ipcRenderer.invoke('uninstaller:selectApp'),
    scanAppLeftovers: (appPath) => ipcRenderer.invoke('uninstaller:scanLeftovers', { appPath }),
    uninstallApp: (paths, appInfo) => ipcRenderer.invoke('uninstaller:uninstall', { paths, appInfo }),
    getUninstallHistory: () => ipcRenderer.invoke('uninstaller:getHistory'),
    addUninstallHistory: (entry) => ipcRenderer.invoke('uninstaller:addHistory', { entry }),

    // Threats Scanner
    scanThreats: (paths) => ipcRenderer.invoke('threats:scan', { paths }),
    scanThreatsWithProgress: (paths) => ipcRenderer.invoke('threats:scanWithProgress', { paths }),
    scanThreatsBackground: (paths) => ipcRenderer.invoke('threats:scanBackground', { paths }),
    deleteThreats: (paths) => ipcRenderer.invoke('threats:delete', { paths }),
    getThreatHistory: () => ipcRenderer.invoke('threats:getHistory'),
    updateThreatDB: () => ipcRenderer.invoke('threats:updateDB'),
    onShowThreatsResults: (callback) => {
        ipcRenderer.on('show-threats-results', (_event, threats) => callback(threats));
    },
    onThreatScanProgress: (callback) => {
        ipcRenderer.on('threats:scanProgress', (_event, data) => callback(data));
    },
    abortThreatScan: () => ipcRenderer.invoke('threats:abort'),
    resetThreatAbort: () => ipcRenderer.invoke('threats:resetAbort'),
    getFolderSize: (path) => ipcRenderer.invoke('threats:getFolderSize', { path }),
    pathExists: (path) => ipcRenderer.invoke('threats:pathExists', { path }),
    saveCustomPaths: (paths) => ipcRenderer.invoke('threats:saveCustomPaths', { paths }),
    getCustomPaths: () => ipcRenderer.invoke('threats:getCustomPaths'),
    saveScanState: (state) => ipcRenderer.invoke('threats:saveScanState', { state }),
    getScanState: () => ipcRenderer.invoke('threats:getScanState'),
    clearScanState: () => ipcRenderer.invoke('threats:clearScanState'),

    // ClamAV Engine
    checkClamAV: () => ipcRenderer.invoke('clamav:check'),
    installClamAV: () => ipcRenderer.invoke('clamav:install'),
    uninstallClamAV: () => ipcRenderer.invoke('clamav:uninstall'),
    updateClamAV: () => ipcRenderer.invoke('clamav:update'),
    getClamAVDBSize: () => ipcRenderer.invoke('clamav:getDBSize'),

    // AI Cat Helper
    saveAICatApiKey: (apiKey) => ipcRenderer.invoke('aicat:saveApiKey', { apiKey }),
    getAICatApiKey: () => ipcRenderer.invoke('aicat:getApiKey'),
    testAICatApiKey: (apiKey, model, provider) => ipcRenderer.invoke('aicat:testApiKey', { apiKey, model, provider }),
    explainWithAICat: (apiKey, prompt, model, provider) => ipcRenderer.invoke('aicat:explain', { apiKey, prompt, model, provider }),
    openGeminiApiPage: () => ipcRenderer.invoke('aicat:openApiPage'),
});

console.log('[Preload] electronAPI exposed successfully');
