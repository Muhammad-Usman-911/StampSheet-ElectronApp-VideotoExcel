// History of what the app has done ON THIS DEVICE: every video it read and every Excel file it saved.
// Kept in one local file (history.jsonl, one JSON line per event) in the app's data folder. No account, no server:
// each computer has its own history, it works offline and nothing leaves the device.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const MAX_EVENTS = 50000;        // older events are dropped once the file holds more than this
let file = null;
let cache = null;                // all events in memory (newest last); loaded on first use

function init(filePath) { file = filePath; cache = null; }

function load() {
  if (cache) return cache;
  cache = [];
  if (!file || !fs.existsSync(file)) return cache;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { cache.push(JSON.parse(line)); } catch { /* skip a damaged line */ }
  }
  return cache;
}

function persistAll() {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, cache.map((e) => JSON.stringify(e)).join('\n') + (cache.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

/** Adds one event: { type: 'read' | 'export', ... }. Returns the stored event. */
function add(event) {
  if (!file) return null;
  const e = { id: crypto.randomUUID(), at: new Date().toISOString(), device: os.hostname(), ...event };
  load().push(e);
  try {
    fs.appendFileSync(file, JSON.stringify(e) + '\n');
    if (cache.length > MAX_EVENTS * 1.1) { cache.splice(0, cache.length - MAX_EVENTS); persistAll(); }
  } catch { /* history must never break the real work */ }
  return e;
}

/**
 * Newest first. `type` filters by kind, `query` searches names / files / folders, `limit` caps the result.
 * Also returns totals for the header of the history window.
 */
function list({ type, query, limit = 300 } = {}) {
  const all = load();
  const q = (query || '').trim().toLowerCase();
  const out = [];
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const e = all[i];
    if (type && e.type !== type) continue;
    if (q) {
      const hay = e.type === 'export'
        ? `${e.file} ${(e.rows || []).map((r) => r.video_name).join(' ')}`
        : `${e.row && e.row.video_name} ${e.folderPath || ''} ${e.row && e.row.date}`;
      if (!hay.toLowerCase().includes(q)) continue;
    }
    out.push(e);
  }
  const reads = all.filter((e) => e.type === 'read');
  return {
    device: os.hostname(),
    since: all.length ? all[0].at : null,
    totals: { reads: reads.length, exports: all.length - reads.length, needCheck: reads.filter((e) => e.row && e.row.warning).length },
    events: out,
  };
}

function remove(id) {
  const all = load();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return false;
  all.splice(i, 1);
  persistAll();
  return true;
}

function clear() {
  cache = [];
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}

module.exports = { init, add, list, remove, clear };
