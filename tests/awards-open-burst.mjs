// Same-second page-open burst: N simulated devices open the winner portal link at once.
// Each device = one fresh HTTP/2 connection (like a phone browser) replaying the guest app boot:
// HTML -> JS + CSS + logo -> state + live stream -> debounced second state -> hold the stream.
// Read-only against production: no joins, no votes, nothing written.
import http2 from 'node:http2';
import zlib from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

const N = Number(process.env.AWARDS_OPEN_N || 500);
const HOLD_MS = Number(process.env.AWARDS_OPEN_HOLD_MS || 20000);
const ORIGIN = process.env.AWARDS_OPEN_BASE;
if (!ORIGIN) {
  console.error('Usage: AWARDS_OPEN_BASE=<url> node tests/awards-open-burst.mjs');
  process.exit(1);
}
const TIMEOUT = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clients = [];

function decode(buffer, encoding) {
  if (encoding === 'br') return zlib.brotliDecompressSync(buffer);
  if (encoding === 'gzip') return zlib.gunzipSync(buffer);
  return buffer;
}

function connect(c) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const session = http2.connect(ORIGIN);
    const timer = setTimeout(() => { session.destroy(new Error('connect timeout')); }, TIMEOUT);
    session.once('connect', () => { clearTimeout(timer); c.latency.connect = +(performance.now() - start).toFixed(1); resolve(session); });
    session.once('error', (e) => { clearTimeout(timer); c.sessionError = String(e.code || e.message); reject(e); });
    session.on('goaway', (code) => { c.goaway = code; });
  });
}

function get(session, path, c, step) {
  return new Promise((resolve, reject) => {
    const api = path.startsWith('/api/');
    const start = performance.now();
    const req = session.request({
      ':path': path,
      'accept-encoding': 'br, gzip',
      accept: api ? 'application/json' : '*/*',
      'cache-control': 'no-cache',
      ...(api ? { 'x-awards-request': '1', 'content-type': 'application/json' } : {}),
    });
    const chunks = [];
    let headers = {};
    const timer = setTimeout(() => req.destroy(new Error(step + ' timeout')), TIMEOUT);
    req.on('response', (h) => { headers = h; });
    req.on('data', (d) => chunks.push(d));
    req.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { step })); });
    req.on('end', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      const status = headers[':status'];
      c.bytes += raw.length;
      c.status[step] = status;
      c.latency[step] = +(performance.now() - start).toFixed(1);
      if (headers['cf-cache-status']) c.cf[step] = headers['cf-cache-status'];
      if (status !== 200) return reject(Object.assign(new Error(`${step} HTTP ${status}`), { step }));
      let text = '';
      try { text = decode(raw, headers['content-encoding']).toString('utf8'); } catch (e) { return reject(Object.assign(e, { step })); }
      resolve({ status, headers, text });
    });
    req.end();
  });
}

function openStream(session, c) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = session.request({ ':path': '/api/awards/events', accept: 'text/event-stream', 'cache-control': 'no-cache' });
    let buffer = '';
    let ready = false;
    const timer = setTimeout(() => { if (!ready) req.destroy(new Error('stream timeout')); }, TIMEOUT);
    req.on('response', (h) => { c.sse.status = h[':status']; if (h[':status'] !== 200) { clearTimeout(timer); req.close(); reject(new Error('stream HTTP ' + h[':status'])); } });
    req.on('data', (d) => {
      buffer += d.toString('utf8');
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
        if (block.startsWith(': heartbeat')) c.sse.heartbeats++;
        const m = block.match(/data: (\d+)/);
        if (m) { c.sse.events++; c.sse.revision = Number(m[1]); if (!ready) { ready = true; clearTimeout(timer); c.latency.stream = +(performance.now() - start).toFixed(1); c.sse.opened = true; resolve(); } }
      }
    });
    req.on('error', (e) => { clearTimeout(timer); c.sse.error = String(e.code || e.message); if (!ready) reject(e); });
    req.on('close', () => { c.sse.closedAt = performance.now(); if (!ready) { clearTimeout(timer); reject(new Error('stream closed before first event')); } });
    c.sse.req = req;
  });
}

async function openDevice(i, t0) {
  const c = { i, steps: {}, latency: {}, status: {}, cf: {}, bytes: 0, errors: [], sse: { opened: false, events: 0, heartbeats: 0 }, session: null };
  clients.push(c);
  c.startedAt = performance.now() - t0;
  const since = () => +(performance.now() - t0 - c.startedAt).toFixed(1);
  try {
    c.session = await connect(c);
    const html = await get(c.session, '/', c, 'html');
    const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    if (assets.length < 2) throw new Error('HTML did not reference the JS and CSS bundle');
    await Promise.all(
      assets.map((a) => get(c.session, a, c, a.endsWith('.css') ? 'css' : 'js')),
    );
    c.steps.assetsDone = since();
    const stream = openStream(c.session, c);
    const state = await get(c.session, '/api/awards/state', c, 'state');
    const parsed = JSON.parse(state.text);
    if (typeof parsed.revision !== 'number' || !Array.isArray(parsed.categories)) throw new Error('state payload malformed');
    if (parsed.rankings !== undefined || parsed.confirmedWinners !== undefined) throw new Error('state leaked host-only fields');
    c.stateRevision = parsed.revision;
    c.steps.usable = since();
    await stream;
    c.steps.streamReady = since();
    await sleep(80 + Math.random() * 180);
    await get(c.session, '/api/awards/state', c, 'state2');
    c.steps.settled = since();
  } catch (e) {
    c.errors.push(`${e.step ? e.step + ': ' : ''}${e.code || e.message}`);
  }
  return c;
}

const pct = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)].toFixed(1) : null; };
const summary = (values) => ({ n: values.length, p50Ms: pct(values, 0.5), p95Ms: pct(values, 0.95), p99Ms: pct(values, 0.99), maxMs: pct(values, 1) });
const count = (items) => items.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc; }, {});

console.log(`Opening ${N} devices at once against ${ORIGIN} ...`);
const t0 = performance.now();
const wall = new Date().toISOString();
const promises = [];
for (let i = 0; i < N; i++) promises.push(openDevice(i, t0));
await Promise.all(promises);
const openPhaseMs = +(performance.now() - t0).toFixed(1);
console.log(`Open phase finished in ${openPhaseMs} ms; holding streams for ${HOLD_MS} ms ...`);
// Every Start/End question makes all connected devices re-fetch state at once.
const BURSTS = Number(process.env.AWARDS_OPEN_BURSTS || 3);
const burstRows = [];
await sleep(3000);
for (let b = 1; b <= BURSTS; b++) {
  const step = 'burst' + b;
  const live = clients.filter((c) => !c.errors.length);
  const begin = performance.now();
  await Promise.all(live.map((c) => get(c.session, '/api/awards/state', c, step).catch((e) => c.errors.push(`${step}: ${e.code || e.message}`))));
  burstRows.push({ step, devices: live.length, wallMs: +(performance.now() - begin).toFixed(1) });
  console.log(`State refresh burst ${b}: ${live.length} devices in ${burstRows.at(-1).wallMs} ms`);
  await sleep(4000);
}
await sleep(Math.max(0, HOLD_MS - 3000 - BURSTS * 4000));
const holdEnd = performance.now();

for (const c of clients) { try { c.sse.req?.close(); } catch {} try { c.session?.close(); } catch {} }
await sleep(1500);
for (const c of clients) { try { c.session?.destroy(); } catch {} }

const ok = clients.filter((c) => !c.errors.length);
const streamsOpen = clients.filter((c) => c.sse.opened);
const streamsHeld = clients.filter((c) => c.sse.opened && !c.sse.error && !(c.sse.closedAt && c.sse.closedAt < holdEnd));
const heartbeatSeen = clients.filter((c) => c.sse.heartbeats > 0);
const steps = ['connect', 'html', 'css', 'js', 'state', 'stream', 'state2', ...burstRows.map((r) => r.step)];
const milestones = ['assetsDone', 'usable', 'streamReady', 'settled'];
const result = {
  passed: ok.length === N && streamsHeld.length === N && heartbeatSeen.length === N,
  generatedAt: wall,
  target: ORIGIN,
  devices: N,
  dispatchWindowMs: +(Math.max(...clients.map((c) => c.startedAt)) - Math.min(...clients.map((c) => c.startedAt))).toFixed(1),
  openPhaseMs,
  holdMs: HOLD_MS,
  devicesWithoutErrors: ok.length,
  errors: count(clients.flatMap((c) => c.errors)),
  requestLatency: Object.fromEntries(steps.map((s) => [s, summary(clients.map((c) => c.latency[s]).filter((v) => v != null))])),
  milestonesFromOpen: Object.fromEntries(milestones.map((m) => [m, summary(clients.map((c) => c.steps[m]).filter((v) => v != null))])),
  httpStatus: Object.fromEntries(steps.filter((s) => s !== 'connect' && s !== 'stream').map((s) => [s, count(clients.map((c) => c.status[s]).filter(Boolean))])),
  refreshBursts: burstRows,
  cloudflareCache: Object.fromEntries(['html', 'css', 'js', 'state'].map((s) => [s, count(clients.map((c) => c.cf[s]).filter(Boolean))])),
  liveStreams: { opened: streamsOpen.length, heldThroughHold: streamsHeld.length, heartbeatReceived: heartbeatSeen.length, statuses: count(clients.map((c) => c.sse.status).filter(Boolean)), errors: count(clients.map((c) => c.sse.error).filter(Boolean)) },
  stateRevisions: count(clients.map((c) => c.stateRevision).filter((v) => v != null)),
  goaways: clients.filter((c) => c.goaway != null).length,
  bytesOnWire: { total: clients.reduce((n, c) => n + c.bytes, 0), perDeviceAvg: Math.round(clients.reduce((n, c) => n + c.bytes, 0) / N) },
  loadGenerator: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, host: os.hostname() },
};
await mkdir('output', { recursive: true });
const stamp = process.env.AWARDS_OPEN_LABEL || 'run';
await writeFile(`output/awards-open-burst-${stamp}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log(result.passed ? 'PASS' : 'FAIL');
process.exitCode = result.passed ? 0 : 1;
