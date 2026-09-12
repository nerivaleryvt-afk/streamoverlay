// preload.js - Puente seguro entre los HTML y main.js
// Expone funciones muy concretas. Nada más.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  // Guarda la elección del usuario (modo + ip) en setup.json
  save: (payload) => ipcRenderer.invoke('setup:save', payload),

  // Lee la elección actual (por si queremos reconfigurar)
  load: () => ipcRenderer.invoke('setup:load'),
});