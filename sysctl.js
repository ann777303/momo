// 默默外殼：電腦控制（開 Claude、Wi-Fi、藍牙）。只在 Windows 有作用。
const { execFile } = require('child_process');
const { shell, app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const WIN = process.platform === 'win32';

function run(cmd, args, timeout = 20000) {
  return new Promise(ok => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (e, out, err) => ok({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') })));
}
const utf8 = c => run('cmd.exe', ['/d', '/s', '/c', 'chcp 65001>nul & ' + c]);

// Windows.Devices.Radios：開關 Wi-Fi／藍牙不需要系統管理員
const PS_RADIO = (kind, state) => `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$m=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function W($t,$r){$x=$m.MakeGenericMethod($r).Invoke($null,@($t));$x.Wait(-1)|Out-Null;$x.Result}
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]|Out-Null
W ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])|Out-Null
$rs=W ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
${kind ? `foreach($r in $rs){if("$($r.Kind)" -eq '${kind}'){W ($r.SetStateAsync('${state}')) ([Windows.Devices.Radios.RadioAccessStatus])|Out-Null}}
$rs=W ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])` : ''}
$o=@{};foreach($r in $rs){$o["$($r.Kind)"]="$($r.State)"};[Console]::OutputEncoding=[Text.Encoding]::UTF8;$o|ConvertTo-Json -Compress`;
async function radios(kind, on) {
  const k = kind === 'WiFi' || kind === 'Bluetooth' ? kind : '';
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_RADIO(k, on ? 'On' : 'Off')], 30000);
  try { const o = JSON.parse(r.out.trim() || '{}'); return { wifi: o.WiFi || null, bt: o.Bluetooth || null }; } catch { return { wifi: null, bt: null, err: '讀不到無線電狀態' }; }
}

function parseNetworks(t) {
  const L = [];let cur = null;
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^SSID \d+\s*:\s?(.*)$/);
    if (m) { cur = { ssid: m[1].trim(), signal: 0, secure: true }; if (cur.ssid) L.push(cur); continue; }
    if (!cur) continue;
    const v = (line.split(/\s:\s/)[1] || '').trim();
    if (/^\d+%$/.test(v)) cur.signal = Math.max(cur.signal, parseInt(v));
    if (/^(Open|開放|开放)$/i.test(v)) cur.secure = false;
  }
  const best = {};for (const n of L) if (!best[n.ssid] || best[n.ssid].signal < n.signal) best[n.ssid] = n;
  return Object.values(best).sort((a, b) => b.signal - a.signal).slice(0, 25);
}
function parseProfiles(t) {
  const out = [];let on = false;
  for (const line of t.split(/\r?\n/)) { if (/^-{4,}/.test(line.trim())) { on = true; continue; } if (!on) continue; const m = line.match(/^\s+\S.*?\s:\s(.+)$/); if (m) out.push(m[1].trim()); }
  return out;
}
function parseIface(t) {
  const g = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
  return { ssid: g(/^\s*SSID\s*:\s(.+)$/m), signal: parseInt(g(/:\s(\d+)%\s*$/m)) || 0 };
}
async function wifi() {
  const [i, n, p] = await Promise.all([utf8('netsh wlan show interfaces'), utf8('netsh wlan show networks mode=bssid'), utf8('netsh wlan show profiles')]);
  const prof = parseProfiles(p.out);
  return { now: parseIface(i.out), nets: parseNetworks(n.out).map(x => ({ ...x, saved: prof.includes(x.ssid) })), noAdapter: !i.ok };
}
const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
async function wconnect(ssid, pass) {
  ssid = String(ssid || '').slice(0, 64); if (!ssid) return { ok: false, msg: '沒有網路名稱' };
  const prof = parseProfiles((await utf8('netsh wlan show profiles')).out);
  if (!prof.includes(ssid)) {
    const hex = Buffer.from(ssid, 'utf8').toString('hex').toUpperCase();
    const sec = pass ? `<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xml(pass)}</keyMaterial></sharedKey>`
      : `<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>`;
    const f = path.join(os.tmpdir(), 'momo-wifi-' + Date.now() + '.xml');
    fs.writeFileSync(f, `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${xml(ssid)}</name><SSIDConfig><SSID><hex>${hex}</hex><name>${xml(ssid)}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security>${sec}</security></MSM></WLANProfile>`, 'utf8');
    const a = await run('netsh', ['wlan', 'add', 'profile', 'filename=' + f, 'user=current']);
    try { fs.unlinkSync(f); } catch {}
    if (!a.ok) return { ok: false, msg: '無法建立這個網路的設定' };
  }
  await run('netsh', ['wlan', 'connect', 'name=' + ssid, 'ssid=' + ssid]);
  for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); const now = parseIface((await utf8('netsh wlan show interfaces')).out); if (now.ssid === ssid) return { ok: true, msg: '已連上 ' + ssid }; }
  if (pass && !prof.includes(ssid)) await run('netsh', ['wlan', 'delete', 'profile', 'name=' + ssid]);
  return { ok: false, msg: pass ? '連不上，可能是密碼錯了' : '連不上這個網路' };
}
async function openClaude() {
  try { if (app.getApplicationNameForProtocol('claude://')) { await shell.openExternal('claude://'); return { ok: true, msg: '已開啟 Claude App' }; } } catch {}
  await shell.openExternal('https://claude.ai/new'); return { ok: true, msg: '已在瀏覽器開啟 Claude' };
}
const PANELS = { bt: ['ms-actioncenter:controlcenter/bluetooth', 'ms-settings:bluetooth'], wifi: ['ms-availablenetworks:', 'ms-settings:network-wifi'], btset: ['ms-settings:bluetooth'], wifiset: ['ms-settings:network-wifi'] };
async function panel(k) { for (const u of PANELS[k] || []) { try { await shell.openExternal(u); return { ok: true }; } catch {} } return { ok: false, msg: '打不開系統面板' }; }

async function sysOp(op, a = {}) {
  if (op === 'claude') return openClaude();
  if (!WIN) return { ok: false, msg: '這個功能只支援 Windows' };
  switch (op) {
    case 'radios': return radios();
    case 'radio': return radios(a.kind, !!a.on);
    case 'wifi': return wifi();
    case 'wconnect': return wconnect(a.ssid, a.pass);
    case 'wdisconnect': await run('netsh', ['wlan', 'disconnect']); return { ok: true, msg: '已中斷 Wi-Fi' };
    case 'panel': return panel(a.k);
  }
  return { ok: false, msg: '不認得的指令' };
}
module.exports = { sysOp };
