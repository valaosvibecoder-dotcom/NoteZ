const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notez', {
  load: () => ipcRenderer.invoke('notez:load'),
  save: notes => ipcRenderer.invoke('notez:save', notes),
  exportPdf: page => ipcRenderer.invoke('notez:export-pdf', page),
  setFullscreen: enabled => ipcRenderer.invoke('notez:fullscreen', enabled),
  onFullscreenChange: callback => {
    const listener = (_event, enabled) => callback(enabled);
    ipcRenderer.on('notez:fullscreen-change', listener);
    return () => ipcRenderer.removeListener('notez:fullscreen-change', listener);
  }
});
