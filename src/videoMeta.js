const path = require('path');
const { execFile, spawn } = require('child_process');
const { createWorker } = require('tesseract.js');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const eng = require('@tesseract.js-data/eng');

const unpacked = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer', ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(bin)} failed: ${stderr.toString().slice(-400)}`));
      resolve(stdout);
    });
  });
}

async function getDurationSeconds(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(out.toString().trim());
  if (!isFinite(d)) throw new Error('Could not read video duration');
  return d;
}

// ---- Image "views" of the camera clock --------------------------------------------------------------
// The clock is in the top-left corner. We cut that corner out of the frame ONCE (grabRaw) and then make many
// different cleaned-up versions of it (VARIANTS), because the camera text changes colour with the background
// (white on dark areas, black on bright areas) and bright light can wash it out.
//  - "time" views: only the HH:MM:SS part, read with digits only, in block-of-text mode (psm 6 / 11).
//    This mode copes with stray lines and bright patches much better than single-line mode.
//  - "date" views: only the date + weekday part.
//  - "full" views: the whole line (older method, kept as a fallback).
const PAD = 'pad=iw+60:ih+60:30:30:white';
const TIME_CROP = 'crop=iw*0.2489:ih:iw*0.3644:0';   // x 16.4% .. 27.5% of the video width
const DATE_CROP = 'crop=iw*0.34:ih:iw*0.0267:0';     // x 1.2% .. 16.6% of the video width (date + weekday)
const sc = (w) => `scale=${w}:-1:flags=lanczos,format=gray`;
const lutDark = (t) => `lut=y=if(lt(val\\,${t})\\,0\\,255)`;     // dark text on bright background -> black on white
const lutLight = (t) => `lut=y=if(gte(val\\,${t})\\,0\\,255)`;   // light text on dark background -> black on white
function graph(crop, w, op) {
  const base = (crop ? crop + ',' : '') + sc(w);
  if (op.k === 'gray') return `[0:v]${base},${PAD}[o]`;
  if (op.k === 'dark') return `[0:v]${base},${lutDark(op.t)},${PAD}[o]`;
  if (op.k === 'light') return `[0:v]${base},${lutLight(op.t)},${PAD}[o]`;
  // "local contrast": keeps whatever differs from the blurred surroundings (works for mixed colours)
  return `[0:v]${base},split[a][b];[b]gblur=sigma=${op.s}[bb];[a][bb]blend=all_mode=difference,${lutLight(op.t)},${PAD}[o]`;
}
const WL_TIME = '0123456789:';
const WL_DATE = '0123456789-:/. ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const WL_FULL = '0123456789-:/. ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';   // whole line: date + weekday + time (needs the colon)
const VARIANTS = [];
const add = (name, crop, w, op, psm, wl) => VARIANTS.push({ name, psm, wl, graph: graph(crop, w, op) });
for (const [nm, op] of [['gray', { k: 'gray' }], ['dark110', { k: 'dark', t: 110 }], ['dark150', { k: 'dark', t: 150 }], ['diff30', { k: 'diff', t: 30, s: 14 }]]) {
  add(`time ${nm} psm6`, TIME_CROP, 360, op, '6', WL_TIME);
  add(`time ${nm} psm11`, TIME_CROP, 360, op, '11', WL_TIME);
}
add('time light200 psm6', TIME_CROP, 360, { k: 'light', t: 200 }, '6', WL_TIME);
for (const [nm, op] of [['gray', { k: 'gray' }], ['dark110', { k: 'dark', t: 110 }], ['dark150', { k: 'dark', t: 150 }], ['diff30', { k: 'diff', t: 30, s: 16 }]]) {
  add(`date ${nm} psm6`, DATE_CROP, 500, op, '6', WL_DATE);
}
const REGION_COUNT = VARIANTS.length;
for (const w of [1000, 1300, 800, 1150, 1500]) add(`full gray ${w}`, null, w, { k: 'gray' }, '7', WL_FULL);
for (const t of [90, 130]) add(`full dark${t}`, null, 1000, { k: 'dark', t }, '7', WL_FULL);
for (const t of [200, 225]) add(`full light${t}`, null, 1000, { k: 'light', t }, '7', WL_FULL);
add('full diff30', null, 1000, { k: 'diff', t: 30, s: 12 }, '7', WL_FULL);
add('full diff50', null, 1000, { k: 'diff', t: 50, s: 12 }, '7', WL_FULL);
add('full diff40 w1300', null, 1300, { k: 'diff', t: 40, s: 16 }, '7', WL_FULL);
const LEGACY_END = VARIANTS.length;
// "wide" views: for cameras whose clock text is larger relative to the picture (the time then sits further right)
const TIME_WIDE = 'crop=iw*0.5:ih:iw*0.5:0';
const DATE_WIDE = 'crop=iw*0.62:ih:0:0';
for (const [nm, op] of [['gray', { k: 'gray' }], ['dark110', { k: 'dark', t: 110 }], ['dark150', { k: 'dark', t: 150 }], ['diff30', { k: 'diff', t: 30, s: 14 }]]) {
  add(`wtime ${nm} psm6`, TIME_WIDE, 360, op, '6', WL_TIME);
  add(`wtime ${nm} psm11`, TIME_WIDE, 360, op, '11', WL_TIME);
}
add('wtime light200 psm6', TIME_WIDE, 360, { k: 'light', t: 200 }, '6', WL_TIME);
for (const [nm, op] of [['gray', { k: 'gray' }], ['dark110', { k: 'dark', t: 110 }], ['dark150', { k: 'dark', t: 150 }]]) {
  add(`wdate ${nm} psm6`, DATE_WIDE, 600, op, '6', WL_DATE);
}
const VARIANT_COUNT = VARIANTS.length;
const REGION_IDX = Array.from({ length: REGION_COUNT }, (_, i) => i);
const LEGACY_IDX = Array.from({ length: LEGACY_END - REGION_COUNT }, (_, i) => REGION_COUNT + i);
const WIDE_IDX = Array.from({ length: VARIANT_COUNT - LEGACY_END }, (_, i) => LEGACY_END + i);

// native-resolution PNG of the top-left corner of the frame at `atSec`
function grabRaw(file, atSec) {
  return run(FFMPEG, ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'crop=iw*0.45:ih*0.18:0:0', '-f', 'image2pipe', '-vcodec', 'png', '-']);
}

// Small concurrency limiter so parallel work never starts hundreds of processes at once.
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const CPUS = Math.max(1, os.cpus().length);
const ffmpegSlot = limiter(Math.max(2, Math.min(16, CPUS)));

function runWithInput(bin, args, input) {
  return ffmpegSlot(() => runWithInputNow(bin, args, input));
}
function runWithInputNow(bin, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg failed: ' + Buffer.concat(err).toString().slice(-300)))));
    child.stdin.end(input);
  });
}

function applyVariant(rawPng, i) {
  return runWithInput(FFMPEG, ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-filter_complex', VARIANTS[i].graph, '-map', '[o]', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], rawPng);
}

async function grabCorner(file, atSec, variant) {
  return applyVariant(await grabRaw(file, atSec), variant);
}

// Tesseract workers. Each video being analysed borrows its own worker, so several videos can be read at once.
// Inside Electron, tesseract.js treats langPath as a URL. Avoid that: unzip the traineddata
// once into a cache folder and let tesseract read it from there.
let langDir = null;
function prepareLang() {
  if (langDir) return langDir;
  const cacheDir = path.join(os.tmpdir(), 'video-meta-ocr');
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, 'eng.traineddata');
  if (!fs.existsSync(target) || fs.statSync(target).size < 1000000) {
    const gz = fs.readFileSync(unpacked(path.join(eng.langPath, 'eng.traineddata.gz')));
    const tmp = target + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, zlib.gunzipSync(gz));
    fs.renameSync(tmp, target);
  }
  return (langDir = cacheDir);
}
const allWorkers = [];
const idleWorkers = [];
async function newWorker() {
  const w = await createWorker('eng', 1, { cachePath: prepareLang(), cacheMethod: 'readOnly', gzip: false });
  w._vmParams = '';
  allWorkers.push(w);
  return w;
}
async function acquireWorker() { return idleWorkers.pop() || newWorker(); }
function releaseWorker(w) { if (allWorkers.includes(w)) idleWorkers.push(w); }

// One shared worker for scripts (debug-ocr.js)
let sharedWorker = null;
function getWorker() { if (!sharedWorker) sharedWorker = acquireWorker(); return sharedWorker; }

async function closeWorker() {
  const ws = allWorkers.splice(0);
  idleWorkers.length = 0;
  sharedWorker = null;
  await Promise.all(ws.map((w) => w.terminate().catch(() => {})));
}

// Start N workers ahead of time so the first videos do not wait for tesseract to load.
function warmUp(n) {
  const missing = Math.max(0, n - allWorkers.length);
  return Promise.all(Array.from({ length: missing }, () => newWorker().then((w) => idleWorkers.push(w)))).catch(() => {});
}

// OCR one cleaned image with the settings that belong to its view (character set + layout mode)
async function ocrText(worker, png, v) {
  const key = v.wl + '|' + v.psm;
  if (key !== worker._vmParams) {
    await worker.setParameters({ tessedit_char_whitelist: v.wl, tessedit_pageseg_mode: v.psm });
    worker._vmParams = key;
  }
  return ((await worker.recognize(png)).data.text || '');
}

const DAYS = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];   // first two letters are enough (some cameras cut the weekday to 2 letters)
function fixDigits(s) { return s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'); }

const NUM = '[0-9OoIl|SB]';
// Date part, e.g. "11-03-2026 Tue" -> '2026-11-03'. Rejects impossible years and dates that disagree with the weekday.
// In Auto mode a readable weekday is required (otherwise 11-04 could be 11 April or 4 November).
function parseDate(text, dateOrder = 'auto') {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(new RegExp(`(${NUM}{1,4})\\s*[-/.]\\s*(${NUM}{1,2})\\s*[-/.]\\s*(${NUM}{2,4})[\\s-]*([A-Za-z]{2,3})?`));
  if (!m) return null;
  const [a, b, c] = [m[1], m[2], m[3]].map((x) => parseInt(fixDigits(x), 10));
  const dow = m[4] ? DAYS.indexOf(m[4].slice(0, 2).toLowerCase()) : -1;
  const cands = [];
  if (m[1].length === 4) cands.push({ y: a, mo: b, d: c });
  else {
    if (dateOrder === 'auto' || dateOrder === 'dmy') cands.push({ y: c, mo: b, d: a });
    if (dateOrder === 'auto' || dateOrder === 'mdy') cands.push({ y: c, mo: a, d: b });
  }
  const thisYear = new Date().getFullYear();
  // A thin leading '1' is often dropped by the OCR ("1-06-2026" instead of "11-06-2026"): also try the token with a '1' put back.
  // Such a repaired date is only accepted when the weekday confirms it.
  const repaired = [];
  if (dow >= 0 && m[1].length !== 4) {
    const fix = (tok, n) => (tok.length === 1 ? parseInt('1' + fixDigits(tok), 10) : n);
    const a2 = fix(m[1], a), b2 = fix(m[2], b);
    if (a2 !== a || b2 !== b) {
      if (dateOrder === 'auto' || dateOrder === 'dmy') repaired.push({ y: c, mo: b2, d: a2 });
      if (dateOrder === 'auto' || dateOrder === 'mdy') repaired.push({ y: c, mo: a2, d: b2 });
    }
  }
  const dowOk = (x) => new Date(Date.UTC(x.y, x.mo - 1, x.d)).getUTCDay() === dow;
  const inRange = (x) => x.y >= thisYear - 6 && x.y <= thisYear + 1 && x.mo >= 1 && x.mo <= 12 && x.d >= 1 && x.d <= 31;
  const valid = cands.filter((x) => x.y >= thisYear - 6 && x.y <= thisYear + 1 && x.mo >= 1 && x.mo <= 12 && x.d >= 1 && x.d <= 31);
  if (!valid.length || (dow >= 0 && !valid.some(dowOk))) {
    const fixed = repaired.find((x) => inRange(x) && dowOk(x));
    if (fixed) { const pd = (n) => String(n).padStart(2, '0'); return `${fixed.y}-${pd(fixed.mo)}-${pd(fixed.d)}`; }
  }
  if (!valid.length) return null;
  let pick = valid[0];
  if (dow >= 0) {
    const hit = valid.find((x) => new Date(Date.UTC(x.y, x.mo - 1, x.d)).getUTCDay() === dow);
    if (!hit) return null;
    pick = hit;
  } else if (valid.length > 1) {
    return null; // day-first or month-first is ambiguous and the weekday is unreadable: do not guess
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${pick.y}-${pad(pick.mo)}-${pad(pick.d)}`;
}

// Time part, e.g. "05:00:46" -> seconds since midnight
function parseTime(text) {
  const m = text.replace(/\s+/g, ' ').match(new RegExp(`(?<![0-9])(${NUM}{2})\\s*[:;.]\\s*(${NUM}{2})\\s*[:;.]\\s*(${NUM}{2})(?!${NUM})`));
  if (!m) return null;
  const hh = parseInt(fixDigits(m[1]), 10), mm = parseInt(fixDigits(m[2]), 10), ss = parseInt(fixDigits(m[3]), 10);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

const mod86400 = (x) => ((Math.round(x) % 86400) + 86400) % 86400;

// ---- "Colour-blind" clock views ---------------------------------------------------------------------------
// Many cameras draw each character in black OR white, whichever contrasts with the wall behind it, so one line
// can mix black and white characters (e.g. "05:5" black, "6" white). Thresholds that expect one text colour fail
// on those. These views work on the raw grey pixels instead:
//   1. find the row band that holds the clock text (rows with many sharp left-right jumps),
//   2. estimate the wall colour locally (median of a window around each column),
//   3. mark as "ink" every pixel much darker OR much brighter than the wall that is also close to pure
//      black / pure white (the OSD colours), so scene edges in mid-grey are ignored,
//   4. crop to the text, scale it to a fixed letter height and read it with Tesseract.
// Each view uses slightly different settings; their reads are combined by the same voting as the other views.
const PF_VIEWS = [
  { name: 'pf T65', T: 65, win: 3, lo: 90, hi: 170 },
  { name: 'pf T50', T: 50, win: 3, lo: 90, hi: 170 },
  { name: 'pf narrow', T: 50, win: 2, lo: 90, hi: 170 },
  { name: 'pf rim T65', bg: 'rim', T: 65, lo: 90, hi: 170 },
  { name: 'pf rim T50', bg: 'rim', T: 50, lo: 90, hi: 170 },
];
const PF_TEXT_H = 34;   // letter height (px) given to Tesseract
const PF_WL = WL_FULL;

function parsePGM(buf) {
  let i = 0;
  const tok = [];
  const ws = (c) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
  while (tok.length < 4 && i < buf.length) {
    while (i < buf.length && ws(buf[i])) i++;
    let t = '';
    while (i < buf.length && !ws(buf[i])) t += String.fromCharCode(buf[i++]);
    tok.push(t);
  }
  i++;
  const w = +tok[1], h = +tok[2];
  if (tok[0] !== 'P5' || !(w > 0) || !(h > 0) || buf.length < i + w * h) throw new Error('bad frame');
  return { w, h, d: buf.subarray(i, i + w * h) };
}
const toPGM = (img) => Buffer.concat([Buffer.from(`P5\n${img.w} ${img.h}\n255\n`), Buffer.from(img.d.buffer, img.d.byteOffset, img.d.length)]);

// native-resolution grey pixels of the top-left corner (same area as grabRaw)
async function grabGray(file, atSec) {
  return parsePGM(await run(FFMPEG, ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'crop=iw*0.45:ih*0.18:0:0,format=gray', '-f', 'image2pipe', '-vcodec', 'pgm', '-']));
}

// The clock text line: the rows with the most sharp horizontal jumps.
function findTextBand(img) {
  const { w, h, d } = img;
  const sc = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    const o = y * w;
    for (let x = 0; x + 2 < w; x++) if (Math.abs(d[o + x + 2] - d[o + x]) > 70) n++;
    sc[y] = n;
  }
  const sm = new Float64Array(h);
  for (let y = 0; y < h; y++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) if (y + k >= 0 && y + k < h) { a += sc[y + k]; n++; } sm[y] = a / n; }
  let best = 0;
  for (let y = 1; y < h; y++) if (sm[y] > sm[best]) best = y;
  if (sm[best] < 8) return null;
  const thr = sm[best] * 0.3;
  let a = best, b = best;
  while (a > 0 && sm[a - 1] > thr) a--;
  while (b < h - 1 && sm[b + 1] > thr) b++;
  return b - a >= 6 ? { y0: a, y1: b } : null;
}

// Pure function: grey pixels + band + settings -> ink mask of the band (1 = text)
function polarityFreeInk(img, band, cfg) {
  const { w, d } = img;
  const th = band.y1 - band.y0 + 1;
  const pad = Math.round(th * 0.4);
  const y0 = Math.max(0, band.y0 - pad), y1 = Math.min(img.h - 1, band.y1 + pad), bh = y1 - y0 + 1;
  // Wall colour per column. 'rim': only the rows just above and below the text, so a pole or door edge that
  // runs through the text line is part of the wall and not taken for a letter. Otherwise: the whole band.
  const rim = cfg.bg === 'rim';
  const half = rim ? Math.max(3, Math.round(th * 0.3)) : Math.max(8, Math.round((th * cfg.win) / 2));
  const gap = Math.max(2, Math.round(th * 0.08));
  const rows = [];
  for (let y = y0; y <= y1; y++) if (!rim || y < band.y0 - gap || y > band.y1 + gap) rows.push(y);
  if (!rows.length) return { w, h: bh, ink: new Uint8Array(w * bh), th, tTop: band.y0 - y0, tBot: band.y1 - y0 };
  const cols = new Array(w);
  for (let x = 0; x < w; x++) { const c = new Uint16Array(256); for (const y of rows) c[d[y * w + x]]++; cols[x] = c; }
  const H = new Int32Array(256);
  let n = 0;
  const add = (x, s) => { const c = cols[x]; for (let v = 0; v < 256; v++) if (c[v]) H[v] += s * c[v]; n += s * rows.length; };
  for (let x = 0; x <= Math.min(w - 1, half); x++) add(x, 1);
  const ink = new Uint8Array(w * bh);
  for (let x = 0; x < w; x++) {
    if (x - half - 1 >= 0) add(x - half - 1, -1);
    if (x > 0 && x + half < w) add(x + half, 1);
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += H[v]; if (acc * 2 >= n) { med = v; break; } }
    for (let y = 0; y < bh; y++) {
      const p = d[(y0 + y) * w + x];
      const diff = p - med;
      if ((diff < -cfg.T && p <= cfg.lo) || (diff > cfg.T && p >= cfg.hi)) ink[y * w + x] = 1;
    }
  }
  return { w, h: bh, ink, th, tTop: band.y0 - y0, tBot: band.y1 - y0 };
}

// Left/right edge of the text: the widest group of ink columns (gaps up to ~1 letter height are allowed).
function textExtent(m) {
  const runs = [];
  let cur = null, gap = 0;
  for (let x = 0; x < m.w; x++) {
    let has = false;
    for (let y = m.tTop; y <= m.tBot && !has; y++) if (m.ink[y * m.w + x]) has = true;
    if (has) { if (!cur) cur = { a: x, b: x }; else cur.b = x; gap = 0; }
    else if (cur && ++gap > m.th * 1.2) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  runs.sort((p, q) => (q.b - q.a) - (p.b - p.a));
  return runs[0] || null;
}

// Black text on white, cropped to the text, scaled to PF_TEXT_H letter height, with a white margin.
function renderInk(m, ex) {
  const x0 = Math.max(0, ex.a - 4), x1 = Math.min(m.w - 1, ex.b + 4);
  const mg = Math.round(m.th * 0.2);
  const ya = Math.max(0, m.tTop - mg), yb = Math.min(m.h - 1, m.tBot + mg);
  const cw = x1 - x0 + 1, ch = yb - ya + 1, f = PF_TEXT_H / m.th;
  const W = Math.max(1, Math.round(cw * f)), H = Math.max(1, Math.round(ch * f)), P = 16, OW = W + 2 * P;
  const o = new Uint8Array(OW * (H + 2 * P)).fill(255);
  for (let y = 0; y < H; y++) {
    const sy = ya + Math.min(ch - 1, Math.floor(y / f));
    for (let x = 0; x < W; x++) if (m.ink[sy * m.w + x0 + Math.min(cw - 1, Math.floor(x / f))]) o[(y + P) * OW + x + P] = 0;
  }
  return { w: OW, h: H + 2 * P, d: o };
}

// OCR one frame with the colour-blind views -> [{sec, v, date, time}]
async function readFramePF(worker, file, sec, dateOrder, grayCache = new Map()) {
  let img = grayCache.get(sec);
  if (img === undefined) {
    try { img = await grabGray(file, sec); } catch { img = null; }
    grayCache.set(sec, img);
  }
  if (!img) return [];
  const band = findTextBand(img);
  if (!band) return [];
  const out = [];
  for (const cfg of PF_VIEWS) {
    const m = polarityFreeInk(img, band, cfg);
    const ex = textExtent(m);
    if (!ex) continue;
    let text = '';
    try { text = await ocrText(worker, toPGM(renderInk(m, ex)), { wl: PF_WL, psm: '7' }); } catch { continue; }
    out.push({ sec, v: cfg.name, date: parseDate(text, dateOrder), time: parseTime(text) });
  }
  return out;
}

// OCR one frame with the given views -> [{sec, v, date, time}]. The corner is cut out of the video only once.
async function readFrame(worker, file, sec, variants, dateOrder, rawCache = new Map()) {
  let raw = rawCache.get(sec);
  if (!raw) {
    try { raw = await grabRaw(file, sec); } catch { return []; }
    rawCache.set(sec, raw);
  }
  if (!raw || !raw.length) return [];
  const out = [];
  const pngs = variants.map((v) => applyVariant(raw, v).catch(() => null));   // all views are prepared at the same time
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    let text = '';
    const png = await pngs[i];
    if (!png || !png.length) continue;
    try { text = await ocrText(worker, png, VARIANTS[v]); } catch { continue; }
    out.push({ sec, v, date: parseDate(text, dateOrder), time: parseTime(text) });
  }
  return out;
}

// Picks the video's START clock time from all reads.
// The clock on the first frame (sec 0) is the start time. Reads from later frames are used as evidence:
// a later frame must show the same or a slightly later time (the camera clock does not tick exactly with
// video time). Reads of the SAME frame tend to make the same mistake (e.g. a cable crossing a "7" makes it
// look like a "2" in every view), so later frames that contradict a candidate count against it.
// Pure function (no I/O) so it can be tested.
function chooseStart(reads) {
  const timed = reads.filter((r) => r.time !== null);
  const at0 = timed.filter((r) => r.sec === 0);
  const later = timed.filter((r) => r.sec > 0);
  const cands = new Map();
  const fromFirstFrame = at0.length > 0;
  if (fromFirstFrame) for (const r of at0) cands.set(r.time, (cands.get(r.time) || 0) + 1);
  else for (const r of later) cands.set(mod86400(r.time - r.sec), (cands.get(mod86400(r.time - r.sec)) || 0) + 1);
  if (!cands.size) return null;
  const scored = [];
  for (const [S, n] of cands) {
    let consistent = 0, contradicted = 0;
    for (const r of later) {
      const d = mod86400(r.time - S);
      if (d <= 2 * r.sec + 3) consistent++;
      else contradicted++;
    }
    scored.push({ seconds: S, agree: n, consistent, contradicted, score: n * 2 + consistent * 2 - contradicted });
  }
  scored.sort((x, y) => y.score - x.score || y.agree - x.agree);
  const [best, second] = scored;
  return { ...best, margin: second ? best.score - second.score : Infinity, fromFirstFrame, firstFrameReads: at0.length, laterReads: later.length };
}

function chooseDate(reads) {
  const votes = new Map();
  for (const r of reads) if (r.date) votes.set(r.date, (votes.get(r.date) || 0) + 1);
  const sorted = [...votes.entries()].sort((x, y) => y[1] - x[1]);
  return sorted.length ? { date: sorted[0][0], votes: sorted[0][1], runnerUp: sorted[1] ? sorted[1][1] : 0 } : null;
}

// Reads the burned-in clock on several frames with several image "views" and votes.
async function readStartStamp(worker, file, dateOrder, duration) {
  const secs = [0, 1, 2, 3, 5, 8, 12, 20, 30, 60, 120].filter((s) => s === 0 || s < duration - 0.5);
  const reads = [];
  const raws = new Map();
  const good = new Set();           // views that produced a readable result: reused on later frames
  let choice = null, dchoice = null;
  const evaluate = (sec) => {
    choice = chooseStart(reads);
    dchoice = chooseDate(reads);
    // never stop on the first frame alone: at least two reads of a later frame must confirm the start time
    const timeSure = choice && choice.fromFirstFrame && choice.agree >= 2 && choice.consistent >= 2 && choice.margin > 2;
    const dateSure = dchoice && dchoice.votes >= 2;
    return timeSure && dateSure;
  };
  const grays = new Map();
  const tier = async (sec, idxs) => {
    const got = await readFrame(worker, file, sec, idxs, dateOrder, raws);
    for (const r of got) if (r.time !== null || r.date) good.add(r.v);
    reads.push(...got);
    return evaluate(sec);
  };
  const pfTier = async (sec) => {
    reads.push(...(await readFramePF(worker, file, sec, dateOrder, grays)));
    grays.delete(sec);
    return evaluate(sec);
  };
  for (const sec of secs) {
    if (await pfTier(sec)) break;                            // colour-blind views: fast, handle black + white text
    // the colour-blind views agree on this frame: just move on to the next frame for confirmation
    if (choice && choice.agree >= 2 && dchoice && dchoice.votes >= 2 && !good.size) continue;
    const fresh = sec === 0 || !good.size;
    if (await tier(sec, fresh ? REGION_IDX : [...good])) break;
    if (fresh && (await tier(sec, LEGACY_IDX))) break;     // older whole-line views, only when needed
    if (fresh && sec === 0 && (await tier(sec, WIDE_IDX))) break;   // larger-text cameras
    raws.delete(sec);
  }
  return { choice, dchoice, reads: reads.length, goodVariants: [...good] };
}

// Reads the clock near the END of the video (used when "End time = read from last frame" is chosen).
async function readEndClock(worker, file, duration, variants, dateOrder) {
  const vs = variants && variants.length ? variants : Array.from({ length: VARIANT_COUNT }, (_, i) => i);
  let single = null;
  for (const back of [2, 5, 10, 20]) {
    const sec = duration - back;
    if (sec < 10) break;
    let got = (await readFramePF(worker, file, sec, dateOrder)).filter((r) => r.time !== null);
    if (got.length < 2) got = got.concat((await readFrame(worker, file, sec, vs, dateOrder)).filter((r) => r.time !== null));
    const votes = new Map();
    for (const r of got) votes.set(r.time, (votes.get(r.time) || 0) + 1);
    const sorted = [...votes.entries()].sort((x, y) => y[1] - x[1]);
    if (sorted.length && sorted[0][1] >= 2) return { seconds: mod86400(sorted[0][0] + back), sure: true };
    if (sorted.length && !single) single = { seconds: mod86400(sorted[0][0] + back), sure: false };
  }
  return single;
}

const fmtHMS = (s) => {
  s = ((Math.round(s) % 86400) + 86400) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

async function analyseVideo(file, opts = {}) {
  const worker = await acquireWorker();
  try { return await analyseWith(worker, file, opts); }
  finally { releaseWorker(worker); }
}

// `file` is a local path or a local bridge address (MEGA). `name` = file name shown in the sheet (needed for MEGA,
// where the address does not contain the real name); `rowPath` = id the screen uses for this row.
async function analyseWith(worker, file, { camera = 'Camera 1', dateOrder = 'mdy', endMode = 'length', name, rowPath } = {}) {
  const base = name || path.basename(file);
  const duration = Math.round(await getDurationSeconds(file));
  const st = await readStartStamp(worker, file, dateOrder, duration);
  const { dchoice } = st;
  // Only trust a start time that at least two reads agree on (or that later frames confirm).
  // A single unconfirmed read is more likely wrong than right, so the cell is left empty with a note.
  const raw = st.choice;
  const reliable = raw && (raw.agree >= 2 || raw.consistent >= 2);
  const choice = reliable ? raw : null;
  const warns = [];
  if (!raw) warns.push('Could not read the camera time (no frame gave a readable clock). Type it manually.');
  else if (!reliable) warns.push(`Could not read the camera time reliably (best guess ${fmtHMS(raw.seconds)}). Type it manually.`);
  else if (raw.margin <= 1) warns.push(`Camera time not certain (read ${fmtHMS(raw.seconds)}). Verify.`);
  else if (!choice.fromFirstFrame) warns.push('First frame not readable; start time estimated from a later frame (may be a few seconds off). Verify.');
  if (!dchoice) warns.push('Could not read the date. Type it manually.');
  else if (dchoice.votes < 2) warns.push(`Date low confidence (${dchoice.votes} read). Verify.`);
  else if (dchoice.runnerUp >= dchoice.votes) warns.push('Date reads disagree. Verify.');

  let endSeconds = choice ? choice.seconds + duration : null;
  if (choice && endMode === 'clock') {
    const e = await readEndClock(worker, file, duration, st.goodVariants, dateOrder);
    if (e) {
      endSeconds = e.seconds;
      if (!e.sure) warns.push('End time read from the last frame with low confidence. Verify.');
    } else warns.push('Could not read the clock at the end of the video; end time = start + video length.');
  }
  return {
    path: rowPath || file,
    video_name: `${camera}_${base}`,
    date: dchoice ? dchoice.date : '',
    start_time: choice ? fmtHMS(choice.seconds) : '',
    end_time: endSeconds !== null ? fmtHMS(endSeconds) : '',
    duration: fmtHMS(duration),
    usefulness: 'Yes',
    warning: warns.join(' '),
  };
}

module.exports = { analyseVideo, readFramePF, findTextBand, polarityFreeInk, textExtent, parsePGM, closeWorker, warmUp, limiter, CPUS, parseDate, parseTime, chooseStart, chooseDate, fmtHMS, grabCorner, grabRaw, applyVariant, ocrText, getWorker, FFMPEG, getDurationSeconds, VARIANT_COUNT, VARIANTS };