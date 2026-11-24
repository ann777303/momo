// 離線版默默用：開機時跟外殼拿資料，存檔時交給外殼保存，連上網路後再合併回雲端
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__momoOff', {
  state: () => ipcRenderer.sendSync('off:state'),
  push: json => ipcRenderer.send('off:push', String(json))
});
