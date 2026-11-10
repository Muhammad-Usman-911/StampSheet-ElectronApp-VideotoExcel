const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  megaStatus: () => ipcRenderer.invoke('mega-status'),
  megaLogin: (form) => ipcRenderer.invoke('mega-login', form),
  megaLogout: () => ipcRenderer.invoke('mega-logout'),
  megaRefresh: () => ipcRenderer.invoke('mega-refresh'),
  megaFolder: (id) => ipcRenderer.invoke('mega-folder', id),
  megaAddress: (text) => ipcRenderer.invoke('mega-address', text),
  megaVideos: (ids) => ipcRenderer.invoke('mega-videos', ids),
  analyse: (id, opts) => ipcRenderer.invoke('analyse', id, opts),
  exportExcel: (rows, mode) => ipcRenderer.invoke('export-excel', rows, mode),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  pathOf: (file) => webUtils.getPathForFile(file),
  historyList: (opts) => ipcRenderer.invoke('history-list', opts),
  historyRemove: (id) => ipcRenderer.invoke('history-remove', id),
  historyClear: () => ipcRenderer.invoke('history-clear'),
  appInfo: () => ipcRenderer.invoke('app-info'),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: (cb) => {
    const h = (_e, st) => cb(st);
    ipcRenderer.on('update-status', h);
    return () => ipcRenderer.removeListener('update-status', h);
  },
  // called with the video id (file path or mega:...) when a queued video actually starts being read
  onStarted: (cb) => {
    const h = (_e, file) => cb(file);
    ipcRenderer.on('analyse-started', h);
    return () => ipcRenderer.removeListener('analyse-started', h);
  },
});
