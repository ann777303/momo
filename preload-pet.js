// 只開放 pet: 開頭的頻道，讓網頁提供的小窗畫面可以跟外殼溝通
const { contextBridge, ipcRenderer } = require('electron');
const ok = ch => typeof ch === 'string' && /^pet:[a-z-]+$/.test(ch);
contextBridge.exposeInMainWorld('pet', {
  send: (ch, d) => { if (ok(ch)) ipcRenderer.send(ch, d); },
  on: (ch, f) => { if (ok(ch)) ipcRenderer.on(ch, (_, d) => f(d)); }
});
