const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('standup', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  getEnv: () => ipcRenderer.invoke('get-env'),
  openNotificationSettings: () => ipcRenderer.invoke('open-notification-settings'),
  completeOnboarding: (s) => ipcRenderer.invoke('complete-onboarding', s),
  action: (name) => ipcRenderer.send('action', name),
  onStatus: (cb) => ipcRenderer.on('status', (_ev, st) => cb(st)),
  onSound: (cb) => ipcRenderer.on('sound', (_ev, kind) => cb(kind)),
});
