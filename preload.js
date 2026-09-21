// preload.js - Puente seguro entre los HTML y main.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  save: (payload) => ipcRenderer.invoke('setup:save', payload),
  load: () => ipcRenderer.invoke('setup:load'),
});

// 🎬 KICK — Crear clip vía navegador
contextBridge.exposeInMainWorld('kickAPI', {
  createClip: (data) => ipcRenderer.invoke('kick:create-clip-via-browser', data),
});