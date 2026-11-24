// 默默離線版：
// 有網路時，把默默網頁本體、畫板、字型、用到的程式庫和角色圖片存一份在電腦裡（userData/offline）；
// 沒網路時改開這份離線版（momo://app/），資料存在電腦裡；連上網路後，把離線時改的東西合併回雲端。
const { app, net, protocol, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'momo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const DIR = () => path.join(app.getPath('userData'), 'offline');
const APPDIR = () => path.join(DIR(), 'app');
const CACHE = () => path.join(DIR(), 'cache');
const P = n => path.join(DIR(), n);
const sha = s => crypto.createHash('sha1').update(s).digest('hex');
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm', mp3: 'audio/mpeg', wav: 'audio/wav' };
const mimeOf = f => MIME[(f.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeAtomic = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, data); fs.renameSync(t, f); };
const fromDataURL = d => { const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(d || ''); if (!m) return null; return { type: m[1] || 'application/octet-stream', buf: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])) }; };

const OFF_URL = 'momo://app/index.html';
const ready = () => fs.existsSync(path.join(APPDIR(), 'index.html')) && fs.existsSync(P('state.json'));
const lastAt = () => (readJSON(P('meta.json'), {}).at || 0);
const hasPending = () => fs.existsSync(P('pending.json'));

function cacheGet(key) {
  const f = path.join(CACHE(), sha(key));
  if (!fs.existsSync(f)) return null;
  return { buf: fs.readFileSync(f), type: (readJSON(f + '.json', {}).type) || mimeOf(key.split('?')[0]) };
}
function cachePut(key, buf, type) { const f = path.join(CACHE(), sha(key)); writeAtomic(f, buf); fs.writeFileSync(f + '.json', JSON.stringify({ type, key: key.slice(0, 300) })); }
const cached = key => fs.existsSync(path.join(CACHE(), sha(key)));

// 離線視窗用的 session：momo:// 讀本機檔案；https 先找快取（程式庫、角色圖片），找不到才上網
let offSes = null;
function offSession() {
  if (offSes) return offSes;
  offSes = session.fromPartition('persist:off');
  offSes.protocol.handle('momo', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p.startsWith('/_blob/')) { const c = cacheGet(p); return c ? new Response(c.buf, { headers: { 'content-type': c.type } }) : new Response('', { status: 404 }); }
    if (p === '/' || !p) p = '/index.html';
    const f = path.normalize(path.join(APPDIR(), p));
    if (!f.startsWith(APPDIR()) || !fs.existsSync(f)) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'content-type': mimeOf(f) } });
  });
  offSes.protocol.handle('https', async req => {
    const c = cacheGet(req.url);
    if (c) return new Response(c.buf, { headers: { 'content-type': c.type, 'access-control-allow-origin': '*' } });
    try { return await net.fetch(req, { bypassCustomProtocolHandlers: true }); } catch { return new Response('', { status: 504 }); }
  });
  return offSes;
}

// 離線網頁開機時拿資料、存檔時送回來
ipcMain.on('off:state', e => {
  const st = readJSON(P('state.json'), null), pd = readJSON(P('pending.json'), null);
  e.returnValue = pd && (!st || pd.at >= st.at) ? { at: pd.at, data: pd.data } : st;
});
ipcMain.on('off:push', (_, json) => {
  try {
    const n = JSON.parse(json), old = readJSON(P('pending.json'), null);
    const keys = [...new Set([...(old && old.keys || []), ...(n.keys || [])])];
    writeAtomic(P('pending.json'), JSON.stringify({ at: n.at, keys, data: n.data }));
  } catch {}
});

// 有網路時：更新離線版
let busy = false;
async function refresh(bridge, log = () => {}) {
  if (busy) return false; busy = true;
  try {
    if (!(await bridge('offReady()'))) return false;
    if (hasPending()) await mergePending(bridge);
    // 1. 網頁本體、畫板、字型（照清單，只抓有變的）
    const manData = await bridge('offGet("offline.json")');
    const man = manData && JSON.parse(fromDataURL(manData).buf.toString('utf8'));
    if (!man || !Array.isArray(man.files)) return false;
    const meta = readJSON(P('meta.json'), { files: {} });
    let n = 0;
    for (const f of man.files) {
      if (meta.files[f.p] === f.h && fs.existsSync(path.join(APPDIR(), f.p))) continue;
      const d = await bridge(`offGet(${JSON.stringify(f.p)})`);
      const x = fromDataURL(d); if (!x) continue;
      writeAtomic(path.join(APPDIR(), f.p), x.buf); meta.files[f.p] = f.h; n++;
      log(`離線版更新中（${n}）…`);
    }
    // 2. 網頁用到的程式庫（cdn）
    const html = fs.readFileSync(path.join(APPDIR(), 'index.html'), 'utf8');
    for (const u of new Set(html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^"'`\s)]+/g) || [])) {
      if (cached(u)) continue;
      try { const r = await net.fetch(u); if (r.ok) cachePut(u, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || mimeOf(u)); } catch {}
    }
    // 3. 目前的資料和角色圖片
    const packTxt = await bridge('offPack()');
    if (!packTxt) return false;
    const pack = JSON.parse(packTxt);
    for (const ref of pack.refs || []) {
      if (cached(ref)) continue;
      const d = await bridge(`offGet(${JSON.stringify(ref)})`);
      const x = fromDataURL(d); if (x) cachePut(ref, x.buf, x.type);
    }
    if (!hasPending()) writeAtomic(P('state.json'), JSON.stringify({ at: pack.at, data: pack.data }));
    meta.at = Date.now(); writeAtomic(P('meta.json'), JSON.stringify(meta));
    return true;
  } catch { return false; } finally { busy = false; }
}

// 回到網路：把離線時的變更交給網頁合併、同步上雲端
async function mergePending(bridge) {
  const txt = fs.existsSync(P('pending.json')) ? fs.readFileSync(P('pending.json'), 'utf8') : '';
  if (!txt) return 0;
  const n = await bridge(`offMerge(${JSON.stringify(txt)})`);
  if (n === null || n === undefined) return null;
  try { fs.renameSync(P('pending.json'), P('pending-merged.json')); } catch {}
  return n;
}

async function online(url) {
  try { const r = await net.fetch(new URL(url || 'https://claude.ai/').origin + '/', { method: 'HEAD', cache: 'no-store' }); return r.status < 500; } catch { return false; }
}

module.exports = { OFF_URL, offSession, ready, lastAt, hasPending, refresh, mergePending, online, DIR };
