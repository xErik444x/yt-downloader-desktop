const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  downloadDependency: (depName) => ipcRenderer.invoke('download-dependency', depName),
  analyzeUrl: (url) => ipcRenderer.invoke('analyze-url', url),
  startDownload: (options) => ipcRenderer.invoke('start-download', options),
  cancelDownload: (downloadId) => ipcRenderer.invoke('cancel-download', downloadId),
  openDownloadFolder: () => ipcRenderer.invoke('open-download-folder'),
  selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
  getDownloadFolder: () => ipcRenderer.invoke('get-download-folder'),

  // Listeners for progress events
  onDependencyProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('dependency-progress', listener);
    return () => ipcRenderer.removeListener('dependency-progress', listener);
  },
  onDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onDownloadFinished: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-finished', listener);
    return () => ipcRenderer.removeListener('download-finished', listener);
  },
  onDownloadError: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-error', listener);
    return () => ipcRenderer.removeListener('download-error', listener);
  },
  onDependenciesUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('dependencies-updated', listener);
    return () => ipcRenderer.removeListener('dependencies-updated', listener);
  }
});
