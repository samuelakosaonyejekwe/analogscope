// Install support for every platform: the native prompt where the browser has one
// (Chrome, Edge, Samsung Internet, Opera on Android, Windows, macOS, Linux, ChromeOS),
// step-by-step instructions everywhere else (iOS/iPadOS Safari, Firefox, desktop Safari).
import { dialog, toast } from './state.js';

let deferred = null;
const ua = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
const isFirefox = /firefox|fxios/i.test(ua);
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function initInstall() {
  const btn = document.getElementById('installBtn');
  const refresh = () => { btn.hidden = standalone(); };
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; toast('AnalogScope installed. Open it from your home screen or app list.'); });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', refresh);
  refresh();
  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({}));
      if (outcome === 'accepted') deferred = null;
      return;
    }
    dialog('Install AnalogScope', instructions());
  });
}

function instructions() {
  const after = '<p class="muted" style="font-size:13px">Once installed, AnalogScope opens in its own window, works in airplane mode and refreshes NASA, JAXA, ESA and NOAA data whenever you are back online. It uses only a few MB of storage.</p>';
  if (isIOS) return `<ol class="steps">
      <li>Open this page in <b>Safari</b>. On iOS 16.4 or later, Chrome, Edge and Firefox also work.</li>
      <li>Tap the <b>Share</b> button <span aria-hidden="true">⬆︎</span> in the toolbar.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Add</b>. The AnalogScope icon appears on your home screen.</li></ol>${after}`;
  if (isAndroid) return `<ol class="steps">
      <li>Open the browser menu <b>⋮</b> (Chrome, Edge, Samsung Internet, Opera, Brave) or <b>⋯</b> (Firefox).</li>
      <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
      <li>Confirm. AnalogScope is added to your app drawer like a native app.</li></ol>${after}`;
  if (isSafari) return `<ol class="steps"><li>In Safari 17 or later on macOS, open the <b>File</b> menu (or the Share button).</li><li>Choose <b>Add to Dock…</b> and confirm.</li></ol>${after}`;
  if (isFirefox) return `<p>Desktop Firefox cannot install web apps. You can:</p><ol class="steps"><li>Open this page in <b>Chrome</b>, <b>Edge</b>, <b>Brave</b> or <b>Opera</b> and click the install icon <b>⊕</b> in the address bar, or</li><li>bookmark it. It still works offline in Firefox once it has loaded.</li></ol>${after}`;
  return `<ol class="steps"><li>Click the <b>install icon ⊕</b> at the right end of the address bar, or open the browser menu <b>⋮</b> → <b>Install AnalogScope</b> (Edge: <b>Apps → Install this site as an app</b>).</li><li>Confirm. AnalogScope opens in its own window and appears in your Start menu, Dock or app launcher.</li></ol>${after}`;
}
