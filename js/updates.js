// App updates: register the service worker, check for new versions, and ask the user
// before switching. The version number and release notes live only in sw.js.
import { dialog, toast } from './state.js';
import { esc } from './charts.js';

let reg = null, shown = null, reloading = false;

/** Ask a worker for its { version, notes }. */
function info(worker) {
  return new Promise(resolve => {
    if (!worker) return resolve(null);
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
    worker.postMessage('info', [ch.port2]);
  });
}

export const currentVersion = () => info(navigator.serviceWorker?.controller).then(i => i?.version || null);

async function offer(worker) {
  if (!worker || shown === worker) return;
  shown = worker;
  const [next, now] = await Promise.all([info(worker), currentVersion()]);
  dialog('Update available', `<p>A new version of AnalogScope${next?.version ? ` (<b>${esc(next.version)}</b>)` : ''} is ready${now ? `. You are using ${esc(now)}` : ''}.</p>
    ${next?.notes?.length ? `<p style="margin:8px 0 4px"><b>What's new</b></p><ul class="steps">${next.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="muted" style="font-size:13px">Updating takes a second and keeps your saved candidates, settings and offline data.</p>`, [
    { label: 'Later', onClick: () => toast('The update will be installed the next time you open AnalogScope.', 4000) },
    { label: 'Update now', primary: true, onClick: () => worker.postMessage('skip-waiting') },
  ]);
}

/** Check the server for a new version; returns true if one was found. */
export async function checkForUpdates({ quiet = false } = {}) {
  if (!reg) { if (!quiet) toast('Updates need a browser with offline support.'); return false; }
  if (!navigator.onLine) { if (!quiet) toast('You are offline. Connect to check for updates.'); return false; }
  try { await reg.update(); } catch { /* network error */ }
  const w = reg.installing || reg.waiting;
  if (w) {
    if (w.state === 'installed') offer(w);
    else w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    return true;
  }
  if (!quiet) toast(`You have the latest version${(await currentVersion()) ? ` (${await currentVersion()})` : ''}.`);
  return false;
}

export function initUpdates() {
  if (!('serviceWorker' in navigator)) return;
  // When the new worker takes over, load the new version once.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !shown) return;
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(r => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) offer(r.waiting);
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    // Look for updates at launch, every 30 minutes, and whenever the app comes back to the foreground.
    checkForUpdates({ quiet: true });
    setInterval(() => checkForUpdates({ quiet: true }), 30 * 6e4);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdates({ quiet: true }); });
    // Background refresh of live feeds where supported (installed Chromium apps), and on every launch.
    if ('periodicSync' in r) navigator.permissions?.query({ name: 'periodic-background-sync' }).then(s => { if (s.state === 'granted') r.periodicSync.register('refresh-live', { minInterval: 6 * 3600e3 }).catch(() => {}); }).catch(() => {});
    navigator.serviceWorker.ready.then(x => { if (navigator.onLine) x.active?.postMessage('refresh-live'); }).catch(() => {});
  }).catch(() => {});
}
