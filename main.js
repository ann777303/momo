// 默默：電腦版外殼（空殼）
// 這個外殼只負責三件事，其他畫面與功能都從網頁即時載入，所以之後更新功能不用重新下載：
// 1. 背景開著你的「默默」網頁（登入一次就好）
// 2. 開一個永遠在最上層的懸浮小窗；小窗的畫面由網頁提供（__petBridge.overlay）
// 3. 定時向網頁詢問到期的待辦，用系統通知跳出來
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, shell, nativeImage, session } = require('electron');
const path = require('path');
let autoUpdater = null; try { ({ autoUpdater } = require('electron-updater')); } catch {}
const fs = require('fs');

const SHELL_VERSION = 9;
const media = require('./media');
const PET_URL = process.env.PET_URL || 'https://claude.ai/artifact/6PUxrm536NpmWUss4AqBKr';
const SIZES = { 小: [210, 300], 中: [250, 360], 大: [300, 430] };

if (!app.requestSingleInstanceLock()) app.quit();
app.userAgentFallback = app.userAgentFallback.replace(/\s(pet-room|默默|Electron)\/\S+/g, '');
if (process.platform === 'win32') app.setAppUserModelId('tw.petroom.desktop');

// ---------- 設定檔 ----------
const cfgPath = () => path.join(app.getPath('userData'), 'settings.json');
let cfg = { pos: null, size: '中', showPet: true, notified: {}, shellNotice: 0, chrome: false };
function loadCfg() { try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch {} }
let saveT;
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(cfgPath(), JSON.stringify(cfg)); } catch {} }, 400); }

let appWin, petWin, tray, quitting = false, frame = null, lastKeys = {}, missCount = 0, overlayV = '';

// ---------- 主視窗（網頁） ----------
function createAppWin() {
  appWin = new BrowserWindow({
    width: 1180, height: 800, show: false, title: '默默', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { partition: 'persist:pet', backgroundThrottling: false }
  });
  appWin.removeMenu();
  // 語音聊天要用麥克風；只允許 Claude 自己的網址
  const ses = session.fromPartition('persist:pet');
  const okHost = u => { try { const h = new URL(u).hostname; return h === 'claude.ai' || h.endsWith('.claude.ai') || h.endsWith('claudeusercontent.com'); } catch { return false; } };
  ses.setPermissionRequestHandler((wc, perm, cb, d) => cb(['media', 'audioCapture', 'speaker-selection', 'notifications', 'clipboard-sanitized-write'].includes(perm) && okHost(d && d.requestingUrl || wc.getURL())));
  appWin.loadURL(PET_URL);
  appWin.on('close', e => { if (!quitting) { e.preventDefault(); appWin.hide(); } });
  appWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(claude\.ai|accounts\.google\.com|appleid\.apple\.com)\//.test(url)) return { action: 'allow' };
    shell.openExternal(url); return { action: 'deny' };
  });
  appWin.on('page-title-updated', e => e.preventDefault());
  appWin.webContents.on('did-navigate', (_, url) => { frame = null; backHome(url); });
  appWin.webContents.on('did-navigate-in-page', (_, url, isMain) => { if (isMain) backHome(url); });
  appWin.webContents.on('did-finish-load', fitArtifact);
  appWin.webContents.on('did-frame-navigate', () => { frame = null; });
}
const showApp = () => { appWin.show(); appWin.focus(); };

// 登入後 Claude 會跳到首頁或聊天畫面：自動帶回默默
function backHome(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'claude.ai') return;
    if (/^\/(new|recents|chats?|projects?)?(\/|$)/.test(u.pathname) && !u.pathname.startsWith('/artifact')) {
      setTimeout(() => appWin.loadURL(PET_URL), 300);
    }
  } catch {}
}

// 讓默默填滿整個視窗，蓋掉 Claude 的頁面外框（右鍵選單可以切換）
const FIT_JS = `(function(){if(window.__momoFit)return;window.__momoFit=1;
 const fit=()=>{const fs=[...document.querySelectorAll('iframe')].filter(f=>f.clientWidth>200&&f.clientHeight>200).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
  const f=document.querySelector('iframe[data-momo]')||fs[0];if(!f)return false;f.dataset.momo='1';
  f.style.setProperty('position','fixed','important');f.style.setProperty('inset','0','important');f.style.setProperty('width','100vw','important');f.style.setProperty('height','100vh','important');
  f.style.setProperty('max-width','none','important');f.style.setProperty('max-height','none','important');f.style.setProperty('z-index','2147483647','important');f.style.setProperty('border','0','important');f.style.setProperty('border-radius','0','important');
  document.documentElement.style.overflow='hidden';return true};
 let n=0;const t=setInterval(()=>{fit();if(++n>120)clearInterval(t)},500);
 new MutationObserver(()=>fit()).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});})()`;
function fitArtifact() {
  const url = appWin.webContents.getURL();
  if (cfg.chrome || !url.includes('/artifact/')) return;
  appWin.webContents.executeJavaScript(FIT_JS).catch(() => {});
}

// ---------- 找網頁裡的橋接 ----------
async function findFrame() {
  if (frame && !frame.detached) return frame;
  frame = null;
  for (const f of appWin.webContents.mainFrame.framesInSubtree) {
    try { if (await f.executeJavaScript('!!window.__petBridge')) { frame = f; break; } } catch {}
  }
  return frame;
}
async function bridge(expr) {
  const f = await findFrame();
  if (!f) return null;
  try { return await f.executeJavaScript('window.__petBridge.' + expr); } catch { frame = null; return null; }
}

// ---------- 懸浮小窗 ----------
const RMIN = [170, 240], RMAX = [520, 760];
function petBounds() {
  const [w, h] = cfg.wh || SIZES[cfg.size] || SIZES['中'];
  const wa = screen.getPrimaryDisplay().workArea;
  const p = cfg.pos || { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 16 };
  const d = screen.getDisplayMatching({ ...p, width: w, height: h }).workArea;
  return { x: Math.min(Math.max(p.x, d.x), d.x + d.width - w), y: Math.min(Math.max(p.y, d.y), d.y + d.height - h), width: w, height: h };
}
function createPetWin() {
  petWin = new BrowserWindow({
    ...petBounds(), frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload-pet.js'), contextIsolation: true, sandbox: true }
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.loadFile('pet.html');               // 網頁還沒連上前的暫時畫面
  petWin.webContents.on('did-finish-load', () => { lastKeys = {}; });
  petWin.once('ready-to-show', () => { if (cfg.showPet) petWin.showInactive(); });
}
async function refreshOverlay() {
  const o = await bridge('overlay()');
  if (!o || !o.html || o.v === overlayV) return;
  overlayV = o.v;
  await petWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(o.html));
}

// 拖曳與按鈕
let dragFrom = null;
ipcMain.on('pet:drag-start', (_, p) => { const [x, y] = petWin.getPosition(); dragFrom = { x, y, sx: p.x, sy: p.y }; });
ipcMain.on('pet:drag', (_, p) => { if (dragFrom) petWin.setPosition(Math.round(dragFrom.x + p.x - dragFrom.sx), Math.round(dragFrom.y + p.y - dragFrom.sy)); });
ipcMain.on('pet:drag-end', () => { if (!dragFrom) return; dragFrom = null; const [x, y] = petWin.getPosition(); cfg.pos = { x, y }; saveCfg(); });
ipcMain.on('pet:cmd', async (_, c) => { if (c && c.name) { const r = await bridge(`cmd(${JSON.stringify(c.name)},${JSON.stringify(c.args ?? null)})`); if (r == null) petWin.webContents.send('pet:say', '先打開主視窗登入一下嘛～'); } });
ipcMain.on('pet:open', async (_, o) => { showApp(); if (o && o.tab) await bridge(`cmd('tab',${JSON.stringify(o.tab)})`); });
ipcMain.on('pet:hide', () => { petWin.hide(); cfg.showPet = false; saveCfg(); refreshTray(); });
ipcMain.on('pet:menu', () => Menu.buildFromTemplate(menuItems()).popup({ window: petWin }));
// 縮放：拖右下角、Ctrl＋滾輪，或由網頁直接指定大小（pet:bounds）
let rsFrom = null;
const clampWH = (w, h) => [Math.round(Math.min(RMAX[0], Math.max(RMIN[0], w))), Math.round(Math.min(RMAX[1], Math.max(RMIN[1], h)))];
function setWH(w, h) { [w, h] = clampWH(w, h); const b = petWin.getBounds(); petWin.setBounds({ x: b.x, y: b.y, width: w, height: h }); cfg.wh = [w, h]; saveCfg(); }
ipcMain.on('pet:resize-start', (_, p) => { const b = petWin.getBounds(); rsFrom = { w: b.width, h: b.height, sx: p.x, sy: p.y }; });
ipcMain.on('pet:resize', (_, p) => { if (!rsFrom) return; const [w, h] = clampWH(rsFrom.w + p.x - rsFrom.sx, rsFrom.h + p.y - rsFrom.sy); const b = petWin.getBounds(); petWin.setBounds({ x: b.x, y: b.y, width: w, height: h }); });
ipcMain.on('pet:resize-end', () => { if (!rsFrom) return; rsFrom = null; const b = petWin.getBounds(); cfg.wh = [b.width, b.height]; saveCfg(); });
ipcMain.on('pet:zoom', (_, z) => { const b = petWin.getBounds(), k = z && z.d > 0 ? 0.92 : 1.08; setWH(b.width * k, b.height * k); });
ipcMain.on('pet:bounds', (_, o) => { if (o && o.w && o.h) setWH(o.w, o.h); });
// 舊版暫時畫面用的
// ---------- 影音 ----------
let mState = null, mThumb = '', wide = 0;
function petWide(on) {
  if (!petWin || petWin.isDestroyed()) return;
  const want = on ? 190 : 0; if (want === wide) return;
  const b = petWin.getBounds(); petWin.setBounds({ x: b.x - (want - wide), y: b.y, width: b.width + (want - wide), height: b.height }); wide = want;
}
media.init({
  onMode: (m, hb) => {
    petWide(m === 'music');
    if (m === 'tv' && petWin && !petWin.isDestroyed()) { const pb = petWin.getBounds(); petWin.setBounds({ x: Math.max(0, hb.x - pb.width + 10), y: hb.y + hb.height - pb.height, width: pb.width, height: pb.height }); if (cfg.showPet) petWin.showInactive(); }
  },
  onState: s => { if (!s) { mState = null; petWide(false); bridge('mstate(null)'); } },
  onSummary: () => { showApp(); bridge("cmd('msum')"); },
});
ipcMain.on('pet:media-ui', (_, e) => media.uiEvent(e));
ipcMain.on('pet:media', async (_, o) => { const r = await media.op(o || {}).catch(e => ({ err: String(e.message || e) })); if (r && r.err && petWin) petWin.webContents.send('pet:say', r.err); });
let mBusy = false;
async function pollMedia() {
  if (mBusy) return; mBusy = true;
  try {
    const q = await bridge(`mediaq(${SHELL_VERSION})`);
    if (Array.isArray(q)) for (const it of q.slice(0, 5)) media.op(it).catch(e => ({ err: String(e.message || e) })).then(r => bridge(`mediares(${JSON.stringify(it.id)},${JSON.stringify(r || {})})`));
    if (media.isOpen()) {
      const s = await media.state();
      if (s) { if (s.thumbData) mThumb = s.thumbData; delete s.thumbData; const sent = JSON.stringify(s); if (sent !== JSON.stringify(mState)) { mState = s; await bridge(`mstate(${JSON.stringify({ ...s, thumbData: mThumb })})`); } }
    }
  } finally { mBusy = false; }
}
ipcMain.on('pet:poke', () => bridge("cmd('poke')"));
ipcMain.on('pet:pet', () => bridge("cmd('pet')"));

// ---------- 同步狀態到小窗 ----------
async function syncPet() {
  if (!petWin || petWin.isDestroyed()) return;
  const s = await bridge('snap()');
  if (!s) {
    if (++missCount === 12 && !appWin.isVisible()) showApp();
    petWin.webContents.send('pet:state', { offline: true });
    return;
  }
  if (missCount >= 0) { missCount = -1; checkShell(); }
  await refreshOverlay();
  const imgs = {};
  for (const [w, k] of [['cur', s.key], ['blink', s.blink], ['talk', s.talk], ['room', s.room]]) {
    if (k !== lastKeys[w]) { imgs[w] = k ? await bridge(`img(${JSON.stringify(w)})`) : ''; lastKeys[w] = k; }
  }
  petWin.webContents.send('pet:state', { ...s, imgs, sys, media: media.isOpen() ? mState : null });
}

// ---------- 電量（網頁的小框架讀不到，由外殼從最上層讀） ----------
let sys = { shell: SHELL_VERSION };
async function readSys() {
  try { sys.battery = await appWin.webContents.executeJavaScript('navigator.getBattery?navigator.getBattery().then(b=>({level:b.level,charging:b.charging,ct:b.chargingTime,dt:b.dischargingTime})):null'); } catch { sys.battery = null; }
}

// ---------- 自動更新（從 GitHub Releases） ----------
let updState = '';
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => { updState = `正在下載新版 ${i.version}…`; refreshTray(); });
  autoUpdater.on('update-downloaded', i => {
    updState = `新版 ${i.version} 已下載，重新開啟就會套用`; refreshTray();
    if (Notification.isSupported()) { const n = new Notification({ title: '默默', body: `外殼新版 ${i.version} 準備好了，點這裡馬上重新開啟。` }); n.on('click', () => { quitting = true; autoUpdater.quitAndInstall(); }); n.show(); }
  });
  autoUpdater.on('error', () => { updState = ''; });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000); setInterval(check, 4 * 3600e3);
}

// ---------- 外殼本身有新版時提醒一次 ----------
async function checkShell() {
  const s = await bridge('shell()');
  if (!s || !(s.latest > SHELL_VERSION) || cfg.shellNotice >= s.latest) return;
  if (autoUpdater && app.isPackaged) { autoUpdater.checkForUpdates().catch(() => {}); return; }
  cfg.shellNotice = s.latest; saveCfg();
  if (Notification.isSupported()) new Notification({ title: '默默', body: '電腦版外殼有新版本（只有很少數更新需要），到默默的「連動設定」看看。' }).show();
}

// ---------- 系統通知 ----------
async function checkDue() {
  const list = await bridge('due()');
  if (!Array.isArray(list)) return;
  const day = new Date().toDateString();
  for (const k of Object.keys(cfg.notified)) if (!k.endsWith(day)) delete cfg.notified[k];
  for (const it of list) {
    const key = it.id + '|' + day;
    if (cfg.notified[key]) continue;
    cfg.notified[key] = 1;
    if (Notification.isSupported()) {
      const n = new Notification({ title: it.title, body: it.body, icon: path.join(__dirname, 'icon.png'), urgency: it.lv >= 2 ? 'critical' : 'normal' });
      n.on('click', showApp); n.show();
    }
    petWin?.webContents.send('pet:say', it.body);
  }
  saveCfg();
}

// ---------- 系統匣選單 ----------
function menuItems() {
  return [
    { label: '打開默默', click: showApp },
    { label: cfg.showPet ? '收起懸浮小窗' : '顯示懸浮小窗', click: () => { cfg.showPet = !cfg.showPet; cfg.showPet ? petWin.showInactive() : petWin.hide(); saveCfg(); refreshTray(); } },
    { label: '小窗大小', submenu: Object.keys(SIZES).map(k => ({ label: k, type: 'radio', checked: cfg.size === k, click: () => { cfg.size = k; cfg.wh = null; petWin.setBounds(petBounds()); saveCfg(); } })) },
    { label: '小窗回到右下角', click: () => { cfg.pos = null; petWin.setBounds(petBounds()); saveCfg(); } },
    ...(updState ? [{ label: updState, enabled: updState.includes('重新開啟'), click: () => { quitting = true; autoUpdater.quitAndInstall(); } }] : []),
    { label: '檢查更新', visible: !!(autoUpdater && app.isPackaged), click: () => autoUpdater.checkForUpdates().then(r => { if (!r || !r.updateInfo || r.updateInfo.version === app.getVersion()) new Notification({ title: '默默', body: `已經是最新版（${app.getVersion()}）` }).show(); }).catch(() => new Notification({ title: '默默', body: '檢查更新失敗，等一下再試' }).show()) },
    { label: '影音視窗', click: () => media.op({ op: 'open', site: 'ytm' }) },
    { label: '開機時自動啟動', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { label: '顯示 Claude 的頁面外框', type: 'checkbox', checked: !!cfg.chrome, click: m => { cfg.chrome = m.checked; saveCfg(); frame = null; appWin.loadURL(PET_URL); } },
    { label: '回到默默／重新整理', click: () => { frame = null; overlayV = ''; appWin.loadURL(PET_URL); } },
    { type: 'separator' },
    { label: '結束', click: () => { quitting = true; app.quit(); } }
  ];
}
function refreshTray() { tray.setContextMenu(Menu.buildFromTemplate(menuItems())); }

app.on('second-instance', showApp);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', e => e.preventDefault());

app.whenReady().then(() => {
  loadCfg();
  createAppWin();
  createPetWin();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('默默');
  tray.on('click', () => { if (!petWin.isVisible()) { cfg.showPet = true; petWin.showInactive(); saveCfg(); refreshTray(); } else showApp(); });
  refreshTray();
  if (!process.argv.includes('--hidden')) appWin.once('ready-to-show', showApp);
  setInterval(syncPet, 1500);
  setInterval(pollMedia, 900);
  setInterval(readSys, 5000); setTimeout(readSys, 3000);
  setupUpdater();
  setInterval(checkDue, 30000);
  setTimeout(checkDue, 8000);
  screen.on('display-removed', () => { cfg.pos = null; petWin.setBounds(petBounds()); });
});
