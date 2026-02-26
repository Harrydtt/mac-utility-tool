const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for status dashboard
contextBridge.exposeInMainWorld('statusAPI', {
    getSystemStats: () => ipcRenderer.invoke('status:getSystemStats'),
    getScheduleInfo: () => ipcRenderer.invoke('status:getScheduleInfo'),
    getTransferStatus: () => ipcRenderer.invoke('status:getTransferStatus'),
    openMainWindow: () => ipcRenderer.invoke('status:openMainWindow'),
    runClean: () => ipcRenderer.invoke('status:runClean'),
    quitApp: () => ipcRenderer.invoke('status:quitApp'),
});
