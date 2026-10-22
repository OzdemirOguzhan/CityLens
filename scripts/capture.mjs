// Renders the publish images with a local headless Chrome, driven over the DevTools protocol (no dependencies):
//   public/favicon-32.png, public/apple-touch-icon.png  (from public/favicon.svg)
//   docs/screenshot.png                                   (README screenshot of the running app)
//   public/og-image.png                                   (social preview, from scripts/social-card.html)
// Start the dev server first (npm run dev), then: npm run capture
// Env: APP_URL (default http://localhost:5173), CHROME (path to chrome/msedge).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const PORT = 9333;
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(existsSync);
if (!CHROME) throw new Error('No Chrome/Edge found; set CHROME=/path/to/browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- minimal CDP client

async function openPage() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(200);
  }
  throw new Error('Chrome did not open a debugging port');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    pending.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((ok) => {
    const l = (msg) => { if (msg.method === method) { listeners.delete(l); ok(msg.params); } };
    listeners.add(l);
  });
  return new Promise((ok) => { ws.onopen = () => ok({ send, once, close: () => ws.close() }); });
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
}

async function shoot(cdp, { url, width, height, out, transparent = false, ready = 'true', prepare = '' }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  const loaded = cdp.once('Page.loadEventFired');
  const nav = await cdp.send('Page.navigate', { url });
  if (nav.errorText) throw new Error(`Could not open ${url}: ${nav.errorText}`);
  await loaded;
  // The load event alone can belong to the previous page, so also wait until the new URL is the one showing.
  const isReady = `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && (${ready})`;
  for (let t = 0; !(await evaluate(cdp, isReady)); t += 250) {
    if (t > 60000) throw new Error(`Timed out waiting for ${url} (showing ${await evaluate(cdp, 'location.href')})`);
    await sleep(250);
  }
  if (prepare) await evaluate(cdp, `(async () => { ${prepare} })()`);
  await sleep(800); // let the render loop settle (damping, fog)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(join(root, out)), { recursive: true });
  writeFileSync(join(root, out), Buffer.from(data, 'base64'));
  console.log(`wrote ${out}`);
}

// ---------------------------------------------------------------- shots

const logo = readFileSync(join(root, 'public/favicon.svg'), 'utf8');
const page = (body, bg = 'transparent') => 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<!doctype html><html><body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh">${body}</body></html>`);
const sized = (px) => logo.replace('<svg ', `<svg width="${px}" height="${px}" `);

const profile = mkdtempSync(join(tmpdir(), 'citylens-capture-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' });

try {
  const cdp = await connect(await openPage());
  await cdp.send('Page.enable');

  await shoot(cdp, { url: page(sized(32)), width: 32, height: 32, out: 'public/favicon-32.png', transparent: true });
  // iOS fills transparency with black, so the touch icon gets the app's own dark background.
  await shoot(cdp, { url: page(sized(140), '#1c2128'), width: 180, height: 180, out: 'public/apple-touch-icon.png' });

  await shoot(cdp, {
    url: `${APP_URL}/?sample=OGC-v3_FZK-Haus_LOD3_interior.gml`,
    width: 1600, height: 900, out: 'docs/screenshot.png',
    ready: `!document.body.classList.contains('no-files') && document.getElementById('loading').hidden`,
    // Section plane just above the ground-floor furniture, then dolly in a little.
    prepare: `
      const chk = document.getElementById('chk-clip');
      chk.checked = true; chk.dispatchEvent(new Event('change'));
      const r = document.getElementById('clip-range');
      r.value = (+r.min + (+r.max - +r.min) * 0.28).toFixed(2); r.dispatchEvent(new Event('input'));
      const c = document.querySelector('#viewport canvas'), b = c.getBoundingClientRect();
      for (let i = 0; i < 3; i++) {
        c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 150));
      }`,
  });

  await shoot(cdp, {
    url: `${APP_URL}/scripts/social-card.html`, width: 1200, height: 630, out: 'public/og-image.png',
    ready: `document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete)`,
    prepare: `await new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = '/docs/screenshot.png'; });`,
  });
  cdp.close();
} finally {
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}
