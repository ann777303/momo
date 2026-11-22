// 默默外殼：影音視窗（YouTube Music／YouTube／Bilibili），登入狀態存在這台電腦
const { BrowserWindow, WebContentsView, screen, net, session } = require('electron');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SITES = {
  ytm: { name: 'YouTube Music', url: 'https://music.youtube.com/', search: q => 'https://music.youtube.com/search?q=' + encodeURIComponent(q) },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/', search: q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) },
  bili: { name: 'Bilibili', url: 'https://www.bilibili.com/', search: q => 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(q) },
};
const BAR = 38, TV = { pad: 26, bottom: 58, top: 30 };
let host = null, view = null, mode = 'browse', hooks = {}, thumbCache = {}, lastThumb = '';

function hostHTML() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;font:13px "Microsoft JhengHei","PingFang TC",sans-serif;user-select:none}
.bar{position:fixed;inset:0 0 auto 0;height:${BAR}px;background:#2b2850;color:#fff;display:flex;align-items:center;gap:4px;padding:0 6px;-webkit-app-region:drag;border-bottom:3px solid #ff7eb6}
.bar button,.tvb button{-webkit-app-region:no-drag;background:#fff;color:#2b2850;border:2px solid #2b2850;box-shadow:2px 2px 0 #ff7eb6;font:inherit;padding:2px 8px;cursor:pointer;min-height:26px}
.bar button.on{background:#ff7eb6;color:#fff}.bar .g{flex:1}.bar b{margin:0 6px;white-space:nowrap}
body.tv{background:transparent}body.tv .bar{display:none}
.tv-shell{display:none;position:fixed;inset:0;-webkit-app-region:drag}
body.tv .tv-shell{display:block}
.case{position:absolute;inset:${TV.top}px 4px 18px 4px;background:#e8b04a;border:4px solid #3a2410;border-radius:14px;box-shadow:inset -6px -6px 0 #b9802a,inset 6px 6px 0 #f6d58a,4px 4px 0 #3a2410}
.scr{position:absolute;left:${TV.pad}px;right:${TV.pad}px;top:${TV.top + TV.pad - 8}px;bottom:${TV.bottom}px;background:#111;border:4px solid #3a2410;border-radius:10px}
.ant{position:absolute;top:0;left:50%;width:120px;height:${TV.top + 6}px;transform:translateX(-50%)}
.ant i{position:absolute;bottom:0;width:4px;height:${TV.top + 6}px;background:#3a2410}.ant i:first-child{left:30px;transform:rotate(-30deg);transform-origin:bottom}.ant i:last-child{right:30px;transform:rotate(30deg);transform-origin:bottom}
.tvb{position:absolute;left:${TV.pad}px;right:${TV.pad}px;bottom:24px;height:26px;display:flex;gap:6px;align-items:center}
.tvb .k{width:18px;height:18px;border-radius:50%;background:#3a2410;box-shadow:inset 3px 3px 0 #6b4a20}.tvb .g{flex:1}
.legs{position:absolute;bottom:0;left:0;right:0;height:18px}.legs i{position:absolute;bottom:0;width:10px;height:18px;background:#3a2410}.legs i:first-child{left:22%}.legs i:last-child{right:22%}
</style></head><body>
<div class="bar"><button data-o="back" title="上一頁">◀</button><button data-o="fwd" title="下一頁">▶</button><button data-o="reload" title="重新整理">⟳</button>
<button data-s="ytm">YT Music</button><button data-s="yt">YouTube</button><button data-s="bili">Bilibili</button><span class="g"></span>
<button data-o="music" title="收起成像素音響，聲音繼續播">像素音響</button><button data-o="tv" title="變成小電視">小電視</button><button data-o="min">＿</button><button data-o="close">✕</button></div>
<div class="tv-shell"><div class="ant"><i></i><i></i></div><div class="case"></div><div class="scr"></div>
<div class="tvb"><span class="k"></span><span class="k"></span><span class="g"></span><button data-o="sum">總整</button><button data-o="browse">放大</button><button data-o="close">✕</button></div><div class="legs"><i></i><i></i></div></div>
<script>document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;window.pet.send('pet:media-ui',{o:b.dataset.o,s:b.dataset.s})});
window.pet.on('pet:media-host',m=>{document.body.classList.toggle('tv',m.mode==='tv');document.querySelectorAll('[data-s]').forEach(b=>b.classList.toggle('on',b.dataset.s===m.site))});</script></body></html>`;
}

function siteOf(url) { const h = (() => { try { return new URL(url).host; } catch { return ''; } })(); return h.includes('music.youtube') ? 'ytm' : h.includes('youtube') ? 'yt' : h.includes('bilibili') ? 'bili' : ''; }

function ensure() {
  if (host && !host.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  host = new BrowserWindow({ width: Math.min(1100, wa.width - 80), height: Math.min(760, wa.height - 80), frame: false, transparent: true, backgroundColor: '#00000000', show: false, title: '默默影音',
    icon: path.join(__dirname, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload-pet.js'), contextIsolation: true, sandbox: true } });
  host.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(hostHTML()));
  const ses = session.fromPartition('persist:media');
  ses.setUserAgent(UA);
  view = new WebContentsView({ webPreferences: { partition: 'persist:media', backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  view.webContents.setUserAgent(UA);
  view.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) view.webContents.loadURL(url); return { action: 'deny' }; });
  host.contentView.addChildView(view);
  host.on('resize', layout);
  host.on('closed', () => { host = null; view = null; mode = 'browse'; hooks.onState && hooks.onState(null); });
  view.webContents.on('did-navigate-in-page', pushHost); view.webContents.on('did-navigate', pushHost);
  host.webContents.on('did-finish-load', () => { layout(); pushHost(); });
}
function pushHost() { if (host && !host.isDestroyed()) host.webContents.send('pet:media-host', { mode, site: siteOf(view.webContents.getURL()) }); }
function layout() {
  if (!host || host.isDestroyed()) return;
  const [w, h] = host.getContentSize();
  if (mode === 'tv') view.setBounds({ x: TV.pad + 4, y: TV.top + TV.pad - 4, width: Math.max(10, w - 2 * TV.pad - 8), height: Math.max(10, h - TV.top - TV.pad - TV.bottom) });
  else view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(10, h - BAR) });
}
const TV_CSS = `html,body{overflow:hidden!important;background:#000!important}
video{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483646!important;object-fit:contain!important;background:#000!important;transform:none!important;left:0!important;top:0!important}`;
let tvKey = null;
async function setMode(m) {
  ensure(); mode = m;
  if (tvKey) { try { await view.webContents.removeInsertedCSS(tvKey); } catch {} tvKey = null; }
  const wa = screen.getPrimaryDisplay().workArea;
  if (m === 'tv') {
    tvKey = await view.webContents.insertCSS(TV_CSS).catch(() => null);
    host.setAlwaysOnTop(true, 'floating'); host.setBounds({ x: wa.x + wa.width - 560, y: wa.y + wa.height - 430, width: 470, height: 380 }); host.showInactive();
  } else if (m === 'music') {
    host.setAlwaysOnTop(false); host.hide();
  } else {
    host.setAlwaysOnTop(false); host.setBounds({ x: wa.x + 40, y: wa.y + 40, width: Math.min(1100, wa.width - 80), height: Math.min(760, wa.height - 80) }); host.show(); host.focus();
  }
  layout(); pushHost(); hooks.onMode && hooks.onMode(m, host.getBounds());
}
function open(site, m) { ensure(); const s = SITES[site] || SITES.ytm; const cur = view.webContents.getURL(); if (!cur || siteOf(cur) !== site) view.webContents.loadURL(s.url); setMode(m || 'browse'); }

const J = (fn, arg) => `(${fn})(${JSON.stringify(arg ?? null)})`;
async function run(fn, arg) { if (!view) throw new Error('影音視窗還沒打開'); return view.webContents.executeJavaScript(J(fn, arg), true); }

// 在網頁裡執行的小工具（字串化後丟進 YouTube／Bilibili 的頁面）
const STATE = function () {
  const q = s => document.querySelector(s), tx = s => (q(s) && q(s).textContent || '').trim(), h = location.host, v = q('video');
  const site = h.includes('music.youtube') ? 'ytm' : h.includes('youtube') ? 'yt' : h.includes('bilibili') ? 'bili' : '';
  let title = '', artist = '', thumb = '', liked = null;
  if (site === 'ytm') { title = tx('ytmusic-player-bar .title'); artist = tx('ytmusic-player-bar .byline').split('•')[0].trim(); const im = q('ytmusic-player-bar img.image') || q('ytmusic-player-bar img'); thumb = im ? im.src : ''; const lk = q('ytmusic-player-bar ytmusic-like-button-renderer'); liked = lk ? lk.getAttribute('like-status') === 'LIKE' : null; }
  else if (site === 'yt') { title = tx('h1.ytd-watch-metadata') || (location.pathname === '/watch' ? document.title.replace(/ - YouTube$/, '') : ''); artist = tx('ytd-watch-metadata ytd-channel-name a'); const id = new URLSearchParams(location.search).get('v'); thumb = id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : ''; const lb = q('like-button-view-model button') || q('#segmented-like-button button'); liked = lb ? lb.getAttribute('aria-pressed') === 'true' : null; }
  else if (site === 'bili') { title = tx('h1.video-title') || (location.pathname.startsWith('/video/') ? document.title.replace(/_哔哩哔哩.*$/, '') : ''); artist = tx('.up-name') || tx('.up-detail-top a'); const m = document.querySelector('meta[itemprop="image"]') || document.querySelector('meta[property="og:image"]'); thumb = m ? m.content.replace(/^\/\//, 'https://').replace(/@.*$/, '') + '@320w_180h.jpg' : ''; const lk = q('.video-like'); liked = lk ? lk.classList.contains('on') : null; }
  return { site, title, artist, thumb, cur: v ? v.currentTime : 0, dur: v && isFinite(v.duration) ? v.duration : 0, paused: v ? v.paused : true, liked, url: location.href };
};
const CTRL = async function (op) {
  const q = s => document.querySelector(s), h = location.host, v = q('video'), ytm = h.includes('music.youtube'), yt = !ytm && h.includes('youtube'), bili = h.includes('bilibili');
  const click = (...ss) => { for (const s of ss) { const e = q(s); if (e) { e.click(); return true; } } return false; };
  if (op === 'toggle') { if (ytm && click('#play-pause-button')) return true; if (v) { v.paused ? v.play() : v.pause(); return true; } return false; }
  if (op === 'play') { if (v) { await v.play().catch(() => {}); return true; } return false; }
  if (op === 'pause') { if (v) { v.pause(); return true; } return false; }
  if (op === 'next') return ytm ? click('ytmusic-player-bar .next-button', '.next-button') : yt ? click('.ytp-next-button') : click('.bpx-player-ctrl-next', '.bilibili-player-video-btn-next');
  if (op === 'prev') { if (ytm) return click('ytmusic-player-bar .previous-button', '.previous-button'); if (v) { v.currentTime = 0; return true; } return false; }
  if (op === 'like') return ytm ? click('ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like button', 'ytmusic-player-bar ytmusic-like-button-renderer button') : yt ? click('like-button-view-model button', '#segmented-like-button button') : click('.video-like');
  return false;
};
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const PLAYLISTS = async function (add) {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), h = location.host, ytm = h.includes('music.youtube'), yt = !ytm && h.includes('youtube'), bili = h.includes('bilibili');
  const all = s => [...document.querySelectorAll(s)], byText = (s, re) => all(s).find(e => re.test((e.textContent || e.getAttribute('aria-label') || '').trim()));
  async function openDialog() {
    if (ytm) { const m = document.querySelector('ytmusic-player-bar ytmusic-menu-renderer button, ytmusic-player-bar #button-shape button'); if (!m) return false; m.click(); await sleep(600); const it = byText('ytmusic-menu-navigation-item-renderer, tp-yt-paper-listbox ytmusic-menu-navigation-item-renderer', /儲存|保存|Save to playlist|播放清單/i); if (!it) return false; it.click(); await sleep(1200); return true; }
    if (yt) { let b = byText('ytd-watch-metadata button, ytd-menu-renderer button', /^(儲存|保存|Save)$/i) || document.querySelector('button[aria-label*="Save"],button[aria-label*="儲存"],button[aria-label*="保存"]'); if (!b) { const more = document.querySelector('ytd-watch-metadata #button-shape button[aria-label], ytd-watch-metadata ytd-menu-renderer yt-button-shape#button-shape button'); if (more) { more.click(); await sleep(600); b = byText('ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model', /儲存|保存|Save/i); } } if (!b) return false; b.click(); await sleep(1300); return true; }
    if (bili) { const b = document.querySelector('.video-fav, .video-toolbar-left-item.video-fav'); if (!b) return false; b.click(); await sleep(1300); return true; }
    return false;
  }
  const opts = () => ytm ? all('ytmusic-add-to-playlist-renderer ytmusic-playlist-add-to-option-renderer, ytmusic-add-to-playlist-renderer button.ytmusic-playlist-add-to-option-renderer').map(e => ({ e, name: (e.querySelector('.title,yt-formatted-string') || e).textContent.trim(), on: false }))
    : yt ? all('yt-list-item-view-model, ytd-playlist-add-to-option-renderer').map(e => ({ e, name: (e.querySelector('.yt-list-item-view-model__title, .yt-list-item-view-model-wiz__title, #label') || e).textContent.trim(), on: e.getAttribute('aria-pressed') === 'true' || !!e.querySelector('[aria-checked="true"]') }))
    : all('.group-list li, .fav-list li, .collection-list li').map(e => ({ e, name: (e.querySelector('.fav-title, .title, span') || e).textContent.trim(), on: !!e.querySelector('input:checked, .checked, .is-checked') }));
  if (!await openDialog()) return { err: '找不到「儲存到播放清單」的按鈕，請在影音視窗裡自己按一下' };
  const L = opts().filter(x => x.name);
  if (!add) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); const close = document.querySelector('.bili-dialog-m .close, .collection-m .close, tp-yt-iron-overlay-backdrop'); if (close && bili) close.click(); return { list: L.map(x => ({ name: x.name, on: x.on })) }; }
  const t = L.find(x => x.name === add) || L.find(x => x.name.includes(add) || add.includes(x.name));
  if (!t) return { err: '找不到叫「' + add + '」的播放清單', list: L.map(x => ({ name: x.name, on: x.on })) };
  (t.e.querySelector('input,button,[role=checkbox]') || t.e).click(); await sleep(700);
  if (bili) { const ok = byText('.btn-submit, .submit-move, button', /確定|确定|完成/); if (ok) ok.click(); }
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { ok: true, name: t.name };
};
const LYRICS = async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!location.host.includes('music.youtube')) return { err: '歌詞只有 YouTube Music 有提供' };
  const tabs = [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page .tab-header')];
  if (!tabs.length) { const bar = document.querySelector('ytmusic-player-bar .middle-controls, ytmusic-player-bar .content-info-wrapper'); if (bar) { bar.click(); await sleep(900); } }
  const tab = [...document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab, ytmusic-player-page .tab-header')].find(t => /歌詞|歌词|Lyrics/i.test(t.textContent));
  if (!tab) return { err: '這首歌沒有歌詞分頁' };
  tab.click(); await sleep(1200);
  const box = document.querySelector('ytmusic-player-page ytmusic-description-shelf-renderer .description, ytmusic-player-page #description');
  const src = document.querySelector('ytmusic-player-page ytmusic-description-shelf-renderer .footer');
  if (!box || !box.textContent.trim()) return { err: 'YouTube Music 沒有這首歌的歌詞' };
  return { text: box.innerText.trim(), source: src ? src.textContent.trim() : '' };
};
const TRANSCRIPT = async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), h = location.host, title = document.title;
  if (h.includes('bilibili')) {
    const st = window.__INITIAL_STATE__ || {}, bvid = st.bvid || (location.pathname.match(/BV\w+/) || [])[0], cid = st.cid || (st.videoData && st.videoData.cid);
    const desc = (st.videoData && st.videoData.desc) || '';
    if (!bvid || !cid) return { err: '請先打開一部 Bilibili 影片', title, desc };
    try { const r = await fetch(`https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`, { credentials: 'include' }).then(r => r.json()); const subs = (((r.data || {}).subtitle || {}).subtitles || []);
      if (subs.length) { const s = subs.find(x => /zh/.test(x.lan)) || subs[0]; const j = await fetch(s.subtitle_url.replace(/^\/\//, 'https://')).then(r => r.json()); return { text: j.body.map(b => `[${Math.floor(b.from / 60)}:${String(Math.floor(b.from % 60)).padStart(2, '0')}] ${b.content}`).join('\n'), title, desc, lang: s.lan }; } } catch (e) {}
    return { err: '這部影片沒有字幕（Bilibili 的 AI 字幕通常要登入才看得到）', title, desc };
  }
  if (h.includes('youtube')) {
    const desc = (document.querySelector('#description-inline-expander, ytd-text-inline-expander') || {}).innerText || '';
    let pr = null; try { pr = document.querySelector('#movie_player').getPlayerResponse(); } catch (e) {}
    const tracks = (((pr || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
    if (tracks.length) { const t = tracks.find(x => /^zh/.test(x.languageCode)) || tracks.find(x => !x.kind) || tracks[0];
      try { const j = await fetch(t.baseUrl + '&fmt=json3').then(r => r.json()); const lines = (j.events || []).filter(e => e.segs).map(e => `[${Math.floor(e.tStartMs / 60000)}:${String(Math.floor(e.tStartMs / 1000) % 60).padStart(2, '0')}] ` + e.segs.map(s => s.utf8).join('').replace(/\n/g, ' ')); if (lines.length) return { text: lines.join('\n'), title, desc, lang: t.languageCode }; } catch (e) {} }
    const btn = document.querySelector('ytd-video-description-transcript-section-renderer button, button[aria-label*="transcript" i], button[aria-label*="字幕記錄"], button[aria-label*="转写"]');
    if (btn) { btn.click(); await sleep(2200); const seg = [...document.querySelectorAll('ytd-transcript-segment-renderer')].map(s => `[${(s.querySelector('.segment-timestamp') || {}).textContent?.trim() || ''}] ${(s.querySelector('.segment-text') || {}).textContent?.trim() || ''}`); if (seg.length) return { text: seg.join('\n'), title, desc }; }
    return { err: '這部影片沒有字幕可以讀', title, desc };
  }
  return { err: '請先打開 YouTube 或 Bilibili 的影片', title };
};
const PLAYFIRST = async function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 12; i++) { await sleep(500);
    const a = document.querySelector('ytmusic-card-shelf-renderer ytmusic-play-button-renderer, ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer, ytd-video-renderer a#thumbnail, .bili-video-card a, .video-list-item a');
    if (a) { a.click(); return true; } }
  return false;
};

async function thumbData(url) {
  if (!url) return '';
  if (thumbCache[url]) return thumbCache[url];
  try { const r = await net.fetch(url, { session: session.fromPartition('persist:media') }); const b = Buffer.from(await r.arrayBuffer()); const d = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${b.toString('base64')}`; thumbCache = { [url]: d }; return d; } catch { return ''; }
}

async function state() {
  if (!view) return null;
  let s = null; try { s = await run(STATE); } catch { return null; }
  if (!s) return null;
  s.mode = mode; s.visible = !!(host && host.isVisible());
  if (s.thumb && s.thumb !== lastThumb) { s.thumbData = await thumbData(s.thumb); lastThumb = s.thumb; }
  return s;
}

async function op(o = {}) {
  switch (o.op) {
    case 'open': open(o.site || 'ytm', o.mode || 'browse'); return { ok: true };
    case 'mode': await setMode(o.mode); return { ok: true };
    case 'close': if (host) host.close(); return { ok: true };
    case 'search': { const s = SITES[o.site] || SITES[siteOf(view ? view.webContents.getURL() : '') || 'ytm']; ensure(); view.webContents.loadURL(s.search(o.q || '')); if (o.play) { await SLEEP(2500); const ok = await run(PLAYFIRST).catch(() => false); if (mode === 'browse' && !host.isVisible()) host.show(); return { ok, msg: ok ? '開始播放' : '搜尋結果開好了，請自己點一首' }; } if (!host.isVisible() && mode !== 'music') host.show(); return { ok: true }; }
    case 'toggle': case 'play': case 'pause': case 'next': case 'prev': case 'like': return { ok: await run(CTRL, o.op).catch(() => false) };
    case 'playlists': return run(PLAYLISTS, null).catch(e => ({ err: String(e.message || e) }));
    case 'addto': return run(PLAYLISTS, o.name).catch(e => ({ err: String(e.message || e) }));
    case 'lyrics': return run(LYRICS).catch(e => ({ err: String(e.message || e) }));
    case 'transcript': return run(TRANSCRIPT).catch(e => ({ err: String(e.message || e) }));
    case 'seek': if (view) await run(function (t) { const v = document.querySelector('video'); if (v) v.currentTime = t; }, +o.t || 0); return { ok: true };
  }
  return { err: '不認得的指令' };
}

function uiEvent(e) {
  if (!e) return;
  if (e.s) open(e.s, mode === 'tv' ? 'tv' : 'browse');
  else if (e.o === 'back' && view && view.webContents.canGoBack()) view.webContents.goBack();
  else if (e.o === 'fwd' && view && view.webContents.canGoForward()) view.webContents.goForward();
  else if (e.o === 'reload' && view) view.webContents.reload();
  else if (e.o === 'min' && host) host.minimize();
  else if (e.o === 'close' && host) host.close();
  else if (e.o === 'music' || e.o === 'tv' || e.o === 'browse') setMode(e.o);
  else if (e.o === 'sum') hooks.onSummary && hooks.onSummary();
}

function init(h) {
  hooks = h || {};
  // TV 外框可以拖曳：拖 host 的空白處就會移動（-webkit-app-region: drag）
}
const hostBounds = () => (host && !host.isDestroyed() && host.isVisible() ? host.getBounds() : null);
module.exports = { _v: () => view, _h: () => host, init, op, state, uiEvent, hostBounds, isOpen: () => !!(host && !host.isDestroyed()), getMode: () => mode };
