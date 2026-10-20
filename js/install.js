// Install centre: one-tap install where the browser offers it (Chrome, Edge, Samsung
// Internet, Opera, Brave on Android, Windows, macOS, Linux, ChromeOS), step-by-step
// guidance for every platform, a QR code to open the app on a phone, offline readiness,
// and the app version with an update check.
import { dialog, toast } from './state.js';

let deferred = null;
const ua = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
const isFirefox = /firefox|fxios/i.test(ua);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function initInstall() {
  const btn = document.getElementById('installBtn');
  // Visible even after installing: it then shows install status, offline readiness and updates.
  const refresh = () => { btn.querySelector('span').textContent = standalone() ? 'App & offline' : 'Install app'; };
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); toast('AnalogScope installed. Open it from your home screen or app list.'); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', refresh);
  refresh();
  // The button always opens the install centre, which offers one-tap install where the
  // browser supports it and step-by-step guidance everywhere else.
  btn.addEventListener('click', openCentre);
}

function os() {
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  return 'Linux';
}

// Desktop shortcut files that open the app (for browsers without PWA install).
function downloadShortcut() {
  const url = new URL('./', location.href).href;
  const icon = new URL('icons/favicon.ico', location.href).href;
  const kind = os();
  let name, body, type = 'application/octet-stream';
  if (kind === 'Windows') { name = 'AnalogScope.url'; body = `[InternetShortcut]\r\nURL=${url}\r\nIconFile=${icon}\r\nIconIndex=0\r\n`; }
  else if (kind === 'macOS') { name = 'AnalogScope.webloc'; type = 'application/xml'; body = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${url}</string></dict></plist>\n`; }
  else { name = 'analogscope.desktop'; body = `[Desktop Entry]\nType=Link\nName=AnalogScope\nComment=Earth analogs for Moon and Mars\nURL=${url}\nIcon=applications-science\n`; }
  const u = URL.createObjectURL(new Blob([body], { type }));
  Object.assign(document.createElement('a'), { href: u, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
  toast('Shortcut downloaded. Move it to your Desktop.');
}
document.addEventListener('click', e => { if (e.target.closest('#shortcutBtn')) downloadShortcut(); });

// Firefox Web Apps ("Taskbar Tabs"): on by default on Windows from Firefox 143, available
// but off by default on Linux (pref browser.taskbarTabs.enabled), not yet on macOS.
// Source: firefox-source-docs.mozilla.org/browser/components/taskbartabs/docs/
function firefoxSteps() {
  const ver = +(ua.match(/Firefox\/(\d+)/)?.[1] || 0), kind = os();
  if (kind === 'Windows' && ver >= 143) return `<p style="font-size:13.5px">Click <b>Add tab to taskbar</b> at the right end of the address bar. AnalogScope opens in its own window with a taskbar icon.</p>`;
  if (kind === 'Windows') return `<p style="font-size:13.5px">Firefox 143 and later can install web apps; this copy is version ${ver || 'unknown'}. Update it from <b>☰ → Help → About Firefox</b>, then click <b>Add tab to taskbar</b>.</p>`;
  if (kind === 'Linux') return `<p style="font-size:13.5px">Open <b>about:config</b>, set <b>browser.taskbarTabs.enabled</b> to <b>true</b>, reload this page and click <b>Add tab to taskbar</b>.</p>`;
  return `<p style="font-size:13.5px">Firefox on macOS cannot install web apps yet: use the desktop shortcut below, or Safari's <b>File → Add to Dock…</b>.</p>`;
}

const APP_URL = 'https://samuelakosaonyejekwe.github.io/analogscope/';
const platform = () => (isIOS ? 'ios' : isAndroid ? 'android' : /CrOS/.test(ua) ? 'chromeos' : os().toLowerCase());

/** Steps for every platform; the visitor's own platform opens first. */
function platformSteps() {
  const ff = firefoxSteps();
  const sections = [
    ['android', 'Android phones and tablets', `<ol class="steps">
      <li>Open this page in <b>Chrome</b>, <b>Samsung Internet</b>, <b>Edge</b>, <b>Firefox</b>, <b>Opera</b> or <b>Brave</b>.</li>
      <li>Tap <b>Install app</b> when it appears, or open the browser menu (<b>⋮</b> or <b>≡</b>) and tap <b>Install app</b> / <b>Add to Home screen</b>.</li>
      <li>Confirm. AnalogScope appears in your app drawer and opens full-screen like any other app.</li></ol>`],
    ['ios', 'iPhone and iPad', `<ol class="steps">
      <li>Open this page in <b>Safari</b>. On iOS/iPadOS 16.4 and later, Chrome, Edge and Firefox also work.</li>
      <li>Tap the <b>Share</b> button (square with an arrow) in the toolbar.</li>
      <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open AnalogScope from its home-screen icon. It runs full-screen and works offline.</li></ol>`],
    ['windows', 'Windows', `<ol class="steps">
      <li><b>Chrome, Edge, Brave or Opera:</b> click the install icon <b>⊕</b> at the right end of the address bar (Edge: <b>… → Apps → Install this site as an app</b>).</li>
      <li><b>Firefox 143 or later:</b> click <b>Add tab to taskbar</b> in the address bar.</li>
      <li>AnalogScope gets its own window and appears in the Start menu and taskbar.</li></ol>`],
    ['macos', 'Mac', `<ol class="steps">
      <li><b>Safari 17 or later:</b> <b>File → Add to Dock…</b>, then <b>Add</b>.</li>
      <li><b>Chrome, Edge, Brave or Opera:</b> click the install icon <b>⊕</b> in the address bar.</li>
      <li><b>Firefox:</b> cannot install web apps on macOS yet; use the desktop shortcut below.</li></ol>`],
    ['linux', 'Linux', `<ol class="steps">
      <li><b>Chrome, Chromium, Edge, Brave or Opera:</b> click the install icon <b>⊕</b> in the address bar.</li>
      <li><b>Firefox:</b> in <b>about:config</b> set <b>browser.taskbarTabs.enabled</b> to <b>true</b>, reload, then click <b>Add tab to taskbar</b>.</li>
      <li>AnalogScope appears in your applications menu.</li></ol>`],
    ['chromeos', 'Chromebook', `<ol class="steps">
      <li>Click the install icon <b>⊕</b> in the address bar, or <b>⋮ → Cast, save and share → Install page as app</b>.</li>
      <li>AnalogScope appears in the launcher and works offline.</li></ol>`],
  ];
  const mine = platform();
  return sections.sort((a, b) => (b[0] === mine) - (a[0] === mine)).map(([id, title, body]) =>
    `<details class="plat"${id === mine ? ' open' : ''}><summary><b>${title}</b>${id === mine ? ' <span class="tag live">this device</span>' : ''}</summary>${body}${isFirefox && id === mine && !isIOS && !isAndroid ? `<div class="muted" style="font-size:13px"><b>Your browser (Firefox):</b></div>${ff}` : ''}</details>`).join('');
}

async function offlineStatus() {
  const rows = [];
  const sw = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  rows.push([sw, 'App saved for offline use', sw ? '' : 'Reload once while online to finish saving it.']);
  let shell = false, pack = 0;
  try {
    const keys = await caches.keys();
    shell = keys.some(k => k.startsWith('as-shell-')) && !!(await caches.match('data/snapshot.json'));
    if (keys.includes('as-pack-v1')) pack = (await (await caches.open('as-pack-v1')).keys()).length;
  } catch { /* caches unavailable */ }
  rows.push([shell, 'All 35 documented sites and their data available offline', '']);
  let persisted = false;
  try { persisted = !!(await navigator.storage?.persisted?.()); } catch { /* unsupported */ }
  rows.push([persisted || standalone(), 'Storage protected from automatic clean-up', 'Installing the app protects its storage on most devices.']);
  rows.push([pack > 0, `Offline map pack${pack ? ` (${pack} tiles)` : ''}`, pack ? '' : 'Optional: save it from the Live page before going offline.']);
  return `<ul class="list">${rows.map(([ok, label, hint]) => `<li><span class="${ok ? 'ok' : 'muted'}" aria-hidden="true">${ok ? '✓' : '○'}</span><span>${label}${!ok && hint ? `<br><span class="muted" style="font-size:12.5px">${hint}</span>` : ''}</span></li>`).join('')}</ul>`;
}

async function openCentre() {
  const installed = standalone();
  const { currentVersion, checkForUpdates } = await import('./updates.js');
  const version = await currentVersion();
  dialog('Install AnalogScope', `
    ${installed ? '<p class="ok"><b>✓ AnalogScope is installed on this device.</b></p>'
      : deferred ? '<p><button type="button" class="btn btn-primary" id="installNow">Install on this device</button></p>' : ''}
    <p style="margin:0 0 10px">AnalogScope installs like an app on phones, tablets and computers, straight from the browser: no app store and no download size beyond a few MB. Once installed it opens in its own window, <b>works in airplane mode</b>, and refreshes NASA, JAXA, ESA and NOAA data whenever you are back online.</p>
    <div class="install-grid">
      <div>${platformSteps()}
        ${isIOS || isAndroid ? '' : `<p><button type="button" class="btn" id="shortcutBtn">Download a desktop shortcut (${os()})</button></p>`}
        <p class="muted" style="font-size:12.5px">Works on any phone, tablet or computer with a current browser. Offline use needs offline support in the browser (iOS 11.3+, Android Chrome, Samsung Internet, Firefox, Edge, Safari 11.1+); older browsers can still use AnalogScope online.</p>
      </div>
      <div class="qr"><img src="icons/qr.svg" width="168" height="168" alt="QR code linking to ${APP_URL}"><small>Scan with your phone's camera to open AnalogScope there.</small>
        <button type="button" class="btn" id="copyLink" style="margin-top:6px">Copy link</button></div>
    </div>
    <h3 style="font-size:15px;margin:14px 0 6px">Offline readiness</h3><div id="offStatus"><div class="skeleton"></div></div>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Version ${version || 'not yet installed'}</p>`, [
    { label: 'Check for updates', onClick: () => checkForUpdates() },
    { label: 'Done', primary: true },
  ]);
  offlineStatus().then(h => { const el = document.getElementById('offStatus'); if (el) el.innerHTML = h; });
  document.getElementById('installNow')?.addEventListener('click', promptInstall);
  document.getElementById('copyLink')?.addEventListener('click', () => navigator.clipboard?.writeText(APP_URL).then(() => toast('Link copied'), () => toast(APP_URL, 6000)));
}

async function promptInstall() {
  if (!deferred) return;
  deferred.prompt();
  const { outcome } = await deferred.userChoice.catch(() => ({}));
  if (outcome === 'accepted') { deferred = null; document.getElementById('dlg').close?.(); }
}
