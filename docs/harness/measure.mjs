// 用 Edge headless + CDP 量面板真实尺寸。视觉模型对「挤不挤」的判断不可信，数字才可信。
// 用法：node docs/harness/measure.mjs <html 绝对路径> <宽度>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const file = path.resolve(process.argv[2]);
const width = Number(process.argv[3] || 1280);
const PORT = 9411 + Math.floor(Math.random() * 40);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-measure-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-allow-origins=*',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=' + width + ',900', 'about:blank',
], { stdio: 'ignore' });

let ws = null;
const cleanup = () => {
  try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
};

const EXPR = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (s, p) => { const e = q(s); return e ? getComputedStyle(e)[p] : null; };
  const items = Array.from(document.querySelectorAll('.mb-item')).map((e) => Math.round(e.getBoundingClientRect().height));
  const thumb = rect('.mb-thumbwrap');
  const acts = rect('.mb-rowacts');
  const overlap = thumb && acts && !(thumb.x + thumb.w <= acts.x || acts.x + acts.w <= thumb.x || thumb.y + thumb.h <= acts.y || acts.y + acts.h <= thumb.y);
  const form = q('.mb-form2');
  return {
    width: innerWidth,
    scrollW: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    head: rect('.mb-head'),
    toolbar: rect('.mb-toolbar'),
    left: rect('.mb-left'),
    items,
    thumb, acts, overlap,
    drop: rect('.mb-drop'),
    dropBorder: cs('.mb-drop', 'borderStyle'),
    fbOk: cs('.mb-fb.ok', 'backgroundColor'),
    fbMe: cs('.mb-fb.me', 'backgroundColor'),
    page: rect('.mb-page'),
    form: rect('.mb-form2'),
    fbact: rect('.mb-fbact'),
    fbimgs: rect('.mb-fbimgs'),
    formCols: form ? getComputedStyle(form).gridTemplateColumns : null,
    formH: form ? Math.round(form.getBoundingClientRect().height) : null,
    chips: rect('.mb-chips'),
    chipKids: Array.from(document.querySelectorAll('.mb-chips')).slice(0,2).map((c) => Array.from(c.children).map((e) => Math.round(e.getBoundingClientRect().height))),
    qLine: cs('.mb-q', 'webkitLineClamp'),
  };
})()`;

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    await sleep(200);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) { console.error('no devtools'); cleanup(); process.exit(1); }

  ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await sleep(900);
  const out = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: false });
  console.log(JSON.stringify(out.result && out.result.value ? out.result.value : out, null, 2));
  cleanup();
  process.exit(0);
})().catch((error) => { console.error(String(error)); cleanup(); process.exit(1); });
