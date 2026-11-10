// Local "bridge" that lets ffmpeg/ffprobe read a video that lives somewhere else (MEGA) WITHOUT downloading it.
//
// ffmpeg is given an address like http://127.0.0.1:<port>/<secret>/<id>. When ffmpeg asks for bytes
// (it always asks for a byte range: the file header, then the part around the frame it wants), the bridge
// fetches just those pieces from the source, keeps them in a small memory cache (so the header is not fetched
// again for every frame) and sends them on. Nothing is written to disk.
//
// A "source" is { name, size, read(start, endInclusive) -> Promise<Buffer> }.
const http = require('http');
const crypto = require('crypto');

const BLOCK = 512 * 1024;           // bytes fetched per request to the source
const MAX_BLOCKS = 320;             // memory cache: 320 x 512 KB = 160 MB at most
const PREFETCH = 2;                 // blocks fetched ahead while ffmpeg reads forward

const secret = crypto.randomBytes(12).toString('hex');
const sources = new Map();          // id -> source
const cache = new Map();            // `${id}#${block}` -> Promise<Buffer>  (Map keeps insertion order = LRU order)
const stats = { fetchedBytes: 0, fetches: 0 };
let server, port;

function getBlock(id, src, b) {
  const key = `${id}#${b}`;
  let p = cache.get(key);
  if (p) { cache.delete(key); cache.set(key, p); return p; }          // mark as recently used
  const start = b * BLOCK, end = Math.min(src.size, start + BLOCK) - 1;
  p = src.read(start, end).then((buf) => { stats.fetchedBytes += buf.length; stats.fetches++; return buf; });
  p.catch(() => cache.delete(key));                                     // failed pieces are fetched again next time
  cache.set(key, p);
  while (cache.size > MAX_BLOCKS) cache.delete(cache.keys().next().value);
  return p;
}

async function handle(req, res) {
  const m = /^\/([0-9a-f]+)\/([^/?]+)/.exec(req.url || '');
  const src = m && m[1] === secret && sources.get(decodeURIComponent(m[2]));
  if (!src) { res.writeHead(404); res.end(); return; }
  const id = decodeURIComponent(m[2]);
  const size = src.size;

  let start = 0, end = size - 1, partial = false;
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r) {
    partial = true;
    if (r[1] === '') { start = Math.max(0, size - Number(r[2])); }   // "bytes=-500" = last 500 bytes
    else { start = Number(r[1]); if (r[2] !== '') end = Math.min(size - 1, Number(r[2])); }
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
  }
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'application/octet-stream' };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') { res.end(); return; }

  let closed = false;
  res.on('close', () => { closed = true; });
  try {
    for (let b = Math.floor(start / BLOCK); b <= Math.floor(end / BLOCK) && !closed; b++) {
      for (let k = 1; k <= PREFETCH && (b + k) * BLOCK <= end; k++) getBlock(id, src, b + k).catch(() => {});
      const buf = await getBlock(id, src, b);
      if (closed) break;
      const from = Math.max(start, b * BLOCK) - b * BLOCK;
      const to = Math.min(end, b * BLOCK + buf.length - 1) - b * BLOCK + 1;
      if (!res.write(buf.subarray(from, to))) await new Promise((ok) => { res.once('drain', ok); res.once('close', ok); });
    }
    res.end();
  } catch (err) {
    // cut the connection so ffmpeg sees an error instead of a short (broken) file
    src.lastError = err;
    res.destroy(err);
  }
}

function start() {
  if (server) return server.ready;
  server = http.createServer((req, res) => { handle(req, res).catch((e) => res.destroy(e)); });
  server.keepAliveTimeout = 5000;
  server.ready = new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { port = server.address().port; ok(); });
  });
  return server.ready;
}

/** Registers a source and returns the local address ffmpeg can read it from. */
async function urlFor(id, source) {
  await start();
  if (source) sources.set(id, source);
  if (!sources.has(id)) throw new Error('Unknown video');
  return `http://127.0.0.1:${port}/${secret}/${encodeURIComponent(id)}`;
}

/** Frees the memory used for one video once it has been read. */
function forget(id) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${id}#`)) cache.delete(k);
}

function stop() { if (server) server.close(); server = null; }

module.exports = { urlFor, forget, stop, stats, BLOCK };
