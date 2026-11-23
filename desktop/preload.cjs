// Exposes a single call to the pages: the app has no print preview, so printing goes through a PDF.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  printPreview: () => ipcRenderer.invoke('print-preview'),
});
