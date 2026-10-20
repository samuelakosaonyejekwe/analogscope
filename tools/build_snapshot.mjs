// Rebuild data/snapshot.json: long-term normals for every documented site, fetched
// with the app's own data layer (js/data.js) in a headless browser, so the bundled
// values are produced by exactly the code that refreshes them live.
//
// Usage:
//   cd tools && npm install && npx playwright install chromium && npm run snapshot
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>snapshot</title>'); }
  try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(await readFile(join(root, path))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => console.log(m.text()));
await page.goto(base + '/');
const { sites, failed } = await page.evaluate(async () => {
  const d = await import('/js/data.js');
  const { SITES } = await import('/js/sites.js');
  const sites = {}, failed = [];
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < SITES.length) {
      const s = SITES[i++];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const p = await d.profile(s.lat, s.lon, { useCache: false });
          if (!(p.sources.power && p.sources.terrain && p.sources.jaxa)) throw new Error('incomplete: ' + JSON.stringify(p.sources));
          sites[s.id] = p; console.log('ok', s.id); break;
        } catch (e) { if (attempt === 3) failed.push(`${s.id}: ${e.message}`); }
      }
    }
  }));
  return { sites, failed };
});
await browser.close();
server.close();

if (failed.length) { console.error('Snapshot not written; failed sites:\n' + failed.join('\n')); process.exit(1); }
await writeFile(join(root, 'data/snapshot.json'), JSON.stringify({
  generated: new Date().toISOString(),
  note: 'Long-term normals bundled for offline use; refreshed live in the browser. Built by tools/build_snapshot.mjs.',
  sites,
}));
console.log(`Wrote data/snapshot.json (${Object.keys(sites).length} sites)`);
