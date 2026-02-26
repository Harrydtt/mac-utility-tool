const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Starting preload script...');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Full Disk Access
    checkFullDiskAccess: () => ipcRenderer.invoke('fda:check'),
    openFullDiskAccessSettings: () => ipcRenderer.invoke('fda:openSettings'),
    requestFullDiskAccess: () => ipcRenderer.invoke('fda:requestPermission'),
    fixQuarantine: () => ipcRenderer.invoke('fda:fixQuarantine'),
    checkFdaStatus: () => ipcRenderer.invoke('fda:checkStatus'),

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
    onScanLog: (callback) => {
        ipcRenderer.on('scan:log', (_event, msg) => callback(msg));
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
    scanThreats: (paths, workerCount = 2) => ipcRenderer.invoke('threats:scan', { paths, workerCount }),
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
    onClamAVProgress: (callback) => {
        ipcRenderer.on('clamav:scanProgress', (_event, data) => callback(data));
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
    onClamAVInstallProgress: (callback) => ipcRenderer.on('clamav:progress', (_, data) => callback(data.progress, data.status)),

    // Threat Databases
    downloadDatabases: () => ipcRenderer.invoke('databases:download'),
    checkDatabaseStatus: () => ipcRenderer.invoke('databases:checkStatus'),
    setAutoUpdateDatabases: (enabled) => ipcRenderer.invoke('databases:setAutoUpdate', enabled),
    onDatabaseProgress: (callback) => ipcRenderer.on('databases:progress', (_, status) => callback(status)),
    uninstallDatabases: () => ipcRenderer.invoke('databases:uninstall'),

    // System resources
    getSystemResources: () => ipcRenderer.invoke('system:getResources'),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', { url }),

    // AI Cat Helper
    saveAICatApiKey: (apiKey) => ipcRenderer.invoke('aicat:saveApiKey', { apiKey }),
    getAICatApiKey: () => ipcRenderer.invoke('aicat:getApiKey'),
    testAICatApiKey: (apiKey, model, provider) => ipcRenderer.invoke('aicat:testApiKey', { apiKey, model, provider }),
    explainWithAICat: (apiKey, prompt, model, provider) => ipcRenderer.invoke('aicat:explain', { apiKey, prompt, model, provider }),
    openGeminiApiPage: () => ipcRenderer.invoke('aicat:openApiPage'),

    // System Optimizer
    runSystemCommand: (command, requiresSudo) => ipcRenderer.invoke('system:runCommand', { command, requiresSudo }),

    // Disk Analyzer
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    analyzeDirectory: (dirPath) => ipcRenderer.invoke('disk:analyzeDirectory', { dirPath }),
    deleteFile: (filePath) => ipcRenderer.invoke('disk:deleteFile', { filePath }),
    moveToTrash: (paths) => ipcRenderer.invoke('clean', { paths, mode: 'trash' }),
    openPath: (path) => ipcRenderer.invoke('disk:openPath', { path }),
    showItemInFolder: (path) => ipcRenderer.invoke('disk:showInFinder', { path }),
    getFileProperties: (path) => ipcRenderer.invoke('disk:getProperties', { path }),
    moveFile: (sourcePath, destDir) => ipcRenderer.invoke('disk:moveFile', { sourcePath, destDir }),
    copyFile: (sourcePath, destDir) => ipcRenderer.invoke('disk:copyFile', { sourcePath, destDir }),
    undoMove: (currentPath, originalPath) => ipcRenderer.invoke('disk:undoMove', { currentPath, originalPath }),
    undoCopy: (copiedPath) => ipcRenderer.invoke('disk:undoCopy', { copiedPath }),
    getFileIcon: (path, size) => ipcRenderer.invoke('disk:getFileIcon', { path, size }),

    // Transfer Files (Bundled sendme CLI)
    transferSend: (filePath, options) => ipcRenderer.invoke('transfer:send', filePath, options),
    transferReceive: (ticket, outputDir) => ipcRenderer.invoke('transfer:receive', ticket, outputDir),
    transferStatus: () => ipcRenderer.invoke('transfer:status'),
    transferCancel: (id) => ipcRenderer.invoke('transfer:cancel', id),
    transferRemove: (id) => ipcRenderer.invoke('transfer:remove', id),
    transferGetFreeSpace: () => ipcRenderer.invoke('transfer:getFreeSpace'),
    transferGetPathSize: (path) => ipcRenderer.invoke('transfer:getPathSize', path),
    shellShowItem: (path) => ipcRenderer.invoke('disk:showInFinder', { path }),

    // Transfer - File/Folder selection
    pickFilesOrFolders: () => ipcRenderer.invoke('dialog:pickFilesOrFolders'),
    transferZipFolder: (folderPath) => ipcRenderer.invoke('transfer:zipFolder', folderPath),
    transferIsDirectory: (itemPath) => ipcRenderer.invoke('transfer:isDirectory', itemPath),
    transferGetFileHash: (filePath) => ipcRenderer.invoke('transfer:getFileHash', filePath),
    transferGetFolderContents: (folderPath) => ipcRenderer.invoke('transfer:getFolderContents', folderPath),
    transferDeleteFile: (filePath) => ipcRenderer.invoke('transfer:deleteFile', filePath),

    // Transfer - State Persistence
    transferLoadState: () => ipcRenderer.invoke('transfer:loadState'),
    transferLoadSharing: () => ipcRenderer.invoke('transfer:loadSharing'),
    transferLoadReceiving: () => ipcRenderer.invoke('transfer:loadReceiving'),
    transferSaveState: (state) => ipcRenderer.invoke('transfer:saveState', state),
    transferSaveSharing: (items) => ipcRenderer.invoke('transfer:saveSharing', items),
    transferSaveReceiving: (items) => ipcRenderer.invoke('transfer:saveReceiving', items),
    transferGetReceiveFolder: () => ipcRenderer.invoke('transfer:getReceiveFolder'),
    transferSetReceiveFolder: (folder) => ipcRenderer.invoke('transfer:setReceiveFolder', folder),
    transferSaveShareItem: (item) => ipcRenderer.invoke('transfer:saveShareItem', item),
    transferSaveReceiveItem: (item) => ipcRenderer.invoke('transfer:saveReceiveItem', item),
    transferClearShareItem: (id) => ipcRenderer.invoke('transfer:clearShareItem', id),
    transferClearReceiveItem: (id) => ipcRenderer.invoke('transfer:clearReceiveItem', id),
    transferUpdateReceiveStatus: (id, status, progress) => ipcRenderer.invoke('transfer:updateReceiveStatus', id, status, progress),

    // Games
    // Games
    launchGameWindow: (params) => ipcRenderer.invoke('launch-game-window', params),

    // Game Storage & Management
    importGame: (sourcePath, platform) => ipcRenderer.invoke('games:import', { sourcePath, platform }),
    deleteGame: (filePath) => ipcRenderer.invoke('games:delete', { filePath }),
    openGameFolder: (filePath) => ipcRenderer.invoke('games:openFolder', { filePath }),
    syncGameLibrary: () => ipcRenderer.invoke('games:syncFolder'),
    saveGameThumbnail: (gameId, dataUrl) => ipcRenderer.invoke('games:saveThumbnail', { gameId, dataUrl }),

    sendGameCommand: (command, args) => ipcRenderer.send('game-command', command, args),
    onGameCommand: (callback) => ipcRenderer.on('game-command', (_event, command, args) => callback(command, args)),
    onGameWindowClosed: (callback) => ipcRenderer.on('game-window-closed', (_event, gameId) => callback(gameId)),

    // Diagnostics
    getDiagnosticLogs: () => ipcRenderer.invoke('diagnostics:getLogs'),
    readDiagnosticLog: (filePath) => ipcRenderer.invoke('diagnostics:readLog', { filePath }),
    deleteDiagnosticLogs: (paths) => ipcRenderer.invoke('diagnostics:deleteLogs', { paths }),
    getSystemHealth: () => ipcRenderer.invoke('diagnostics:getSystemHealth'),
    getShutdownCause: () => ipcRenderer.invoke('diagnostics:getShutdownCause'),
    getRealtimeRAM: () => ipcRenderer.invoke('diagnostics:getRealtimeRAM'),
});

console.log('[Preload] electronAPI exposed successfully');
