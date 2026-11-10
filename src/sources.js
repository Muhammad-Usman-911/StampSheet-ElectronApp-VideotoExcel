// Where videos come from (this computer or a MEGA link) and which camera each one belongs to.
//
// Camera name rule (same for local folders and MEGA folders):
//   Look at the folders the video is in, starting with the closest one. The first folder whose name has
//   "camera" or "cam" followed by a number (Camera 2, CAMERA_02, cam-3, Cam3 ...) gives the name "Camera <n>".
//   If no folder matches, the default camera name from the settings is used.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'mov', 'ts', 'dav', 'wmv', 'flv', 'm4v'];
const isVideo = (name) => VIDEO_EXT.includes(path.extname(name).slice(1).toLowerCase());

// "Camera 2", "camera_02", "CAM-3", "Cam3", "IPCam 4", "IP Camera 12 (gate)"  -> 2, 2, 3, 3, 4, 12
// The word must start at a word boundary, so names like "Webcam5" or "Scam 1" do not count.
const CAMERA_RE = /(?:^|[^a-z]|ip)cam(?:era)?[\s._-]*0*(\d{1,3})(?!\d)/i;

/** Camera name from one folder name, or null. */
function cameraFromName(name) {
  const m = CAMERA_RE.exec(name || '');
  return m ? `Camera ${Number(m[1])}` : null;
}

/**
 * Camera name from a list of folder names (outermost first, closest folder last).
 * Returns { camera, folder } for the closest matching folder, or { camera: null, folder: null }.
 */
function cameraFromFolders(folders) {
  for (let i = folders.length - 1; i >= 0; i--) {
    const camera = cameraFromName(folders[i]);
    if (camera) return { camera, folder: folders[i] };
  }
  return { camera: null, folder: null };
}

/** Folder names of a local file path, outermost first (drive / root not included). */
function foldersOfPath(file) {
  return path.dirname(path.resolve(file)).split(/[\\/]+/).filter((s) => s && !/^[a-z]:$/i.test(s));
}

/** One entry the screen turns into a row. `id` is what is passed back to "analyse". */
function entry(id, name, folders, source, extra = {}) {
  const { camera, folder } = cameraFromFolders(folders);
  return { id, name, source, camera, cameraFolder: folder, folderPath: folders.join('/'), ...extra };
}

/**
 * Local files and folders -> list of video entries. Folders are searched inside (all levels).
 * Files that are not videos are skipped. Sorted by folder, then file name, like a file manager.
 */
async function expandLocal(paths) {
  const out = [];
  const seen = new Set();
  const addFile = (p) => {
    const abs = path.resolve(p);
    if (seen.has(abs) || !isVideo(abs)) return;
    seen.add(abs);
    out.push(entry(abs, path.basename(abs), foldersOfPath(abs), 'local'));
  };
  const walk = async (dir, depth) => {
    if (depth > 12) return;
    let list;
    try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const d of list) {
      if (d.name.startsWith('.')) continue;
      const p = path.join(dir, d.name);
      let isDir = d.isDirectory(), isFile = d.isFile();
      if (d.isSymbolicLink()) {   // shortcuts: follow them (the depth limit stops loops)
        try { const st = await fs.promises.stat(p); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
      }
      if (isDir) await walk(p, depth + 1);
      else if (isFile) addFile(p);
    }
  };
  for (const p of paths) {
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    if (st.isDirectory()) await walk(p, 0);
    else addFile(p);
  }
  return out;
}

// ---- MEGA ------------------------------------------------------------------------------------------
// The user logs in to MEGA (megaAccount.js) and picks folders of their drive. The videos are NOT downloaded:
// while reading a video ffmpeg asks only for the small pieces it needs (start of the file, a few frames).
// Those pieces are fetched from MEGA, decrypted in memory and handed to ffmpeg through a local address
// (see streamBridge.js).
const megaFiles = new Map();   // id -> megajs file (kept while the app runs, so "analyse" can find it)

function friendlyMegaError(err) {
  const s = String((err && err.message) || err);
  if (/Bandwidth|509|EOVERQUOTA|-17\b/i.test(s)) return 'MEGA transfer limit reached. Try again later.';
  if (/ESID|-15\b/.test(s)) return 'Your MEGA login has expired. Please log in again.';
  if (/ENOENT|-9\b|not found/i.test(s)) return 'This video is no longer in MEGA.';
  if (/EAGAIN|-3\b|rate/i.test(s)) return 'MEGA is busy right now. Try again in a minute.';
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(s)) return 'Could not reach MEGA. Check the internet connection.';
  return s;
}

/**
 * All videos inside the chosen MEGA folders (all sub-folders). Folder names give the camera name, exactly like
 * local folders (e.g. "Unit-6 Camera-3" -> "Camera 3").
 */
async function listMegaFolders(ids) {
  const found = await require('./megaAccount').videosIn(ids);
  return found.map(({ node, folders }) => {
    const id = `mega:${node.nodeId}`;
    megaFiles.set(id, node);
    return entry(id, node.name, folders, 'mega', { size: node.size });
  });
}

const getMegaFile = (id) => megaFiles.get(id);

// MEGA files are encrypted with AES-128 in counter mode, so any piece can be decrypted on its own:
// AES key = first half XOR second half of the 32-byte file key; counter starts at nonce (bytes 16..23) + block number.
function decryptPiece(fileKey, start, data) {
  const k = Buffer.from(fileKey);
  const aesKey = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) aesKey[i] = k[i] ^ k[i + 16];
  const iv = Buffer.alloc(16);
  k.copy(iv, 0, 16, 24);
  iv.writeBigUInt64BE(BigInt(Math.floor(start / 16)), 8);
  const d = crypto.createDecipheriv('aes-128-ctr', aesKey, iv);
  const skip = start % 16;   // start in the middle of a 16-byte block: decrypt the whole block, drop the front
  const out = Buffer.concat([d.update(Buffer.concat([Buffer.alloc(skip), data])), d.final()]);
  return out.subarray(skip);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A byte-range reader for one MEGA file, for streamBridge. The temporary download address MEGA hands out
 * is asked for once and reused (asking for it on every piece would hit MEGA's rate limit).
 */
function megaSource(file) {
  let addr = null, addrAt = 0;
  const getAddr = (fresh) => {
    if (addr && !fresh && Date.now() - addrAt < 20 * 60 * 1000) return addr;
    const req = { a: 'g', g: 1, ssl: 2 };
    if (file.nodeId) req.n = file.nodeId;
    else if (Array.isArray(file.downloadId)) { req._querystring = { n: file.downloadId[0] }; req.n = file.downloadId[1]; }
    else req.p = file.downloadId;
    addrAt = Date.now();
    addr = new Promise((ok, fail) => file.api.request(req, (err, r) => {
      if (err) return fail(err);
      if (typeof r.g !== 'string' || !r.g.startsWith('http')) return fail(new Error('MEGA did not give a download address (rate limit?)'));
      ok(r.g);
    }));
    addr.catch(() => { addr = null; });
    return addr;
  };
  return {
    name: file.name,
    size: file.size,
    async read(start, end) {
      let lastErr;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const base = await getAddr(attempt > 0);
          const resp = await fetch(`${base}/${start}-${end}`);
          if (resp.status === 509) throw new Error('Bandwidth limit reached (509)');
          if (!resp.ok) throw new Error(`MEGA returned status ${resp.status}`);
          const data = Buffer.from(await resp.arrayBuffer());
          if (data.length !== end - start + 1) throw new Error('MEGA sent an incomplete piece');
          return decryptPiece(file.key, start, data);
        } catch (err) {
          lastErr = err;
          if (/509|Bandwidth/.test(String(err.message))) break;   // waiting will not help now
          await sleep(400 * 2 ** attempt);
        }
      }
      throw new Error(friendlyMegaError(lastErr));
    },
  };
}

module.exports = { VIDEO_EXT, isVideo, cameraFromName, cameraFromFolders, foldersOfPath, expandLocal, listMegaFolders, getMegaFile, megaSource, decryptPiece, friendlyMegaError };
