// Google Drive account: the user connects once in their normal web browser, the app remembers it, and the user
// picks folders of their drive in the same folder browser as MEGA. Videos are NOT downloaded: ffmpeg reads only the
// pieces it needs through the local stream bridge (streamBridge.js), fetched with HTTP Range requests.
//
// Sign-in = Google's "installed app" OAuth flow (no extra package):
//   1. a tiny local web server listens on 127.0.0.1:<random port>
//   2. the default browser opens Google's sign-in page (PKCE, read-only Drive access)
//   3. Google sends the browser back to the local server with a one-time code, which is exchanged for tokens
// The Google password never touches the app. Only the refresh token (and the email) is kept, encrypted by the
// operating system (Electron safeStorage, see main.js). "Disconnect" withdraws it at Google and deletes it.
//
// Needs an OAuth Client ID of type "Desktop app" from Google Cloud (see README): env GOOGLE_CLIENT_ID +
// GOOGLE_CLIENT_SECRET, or the JSON file Google lets you download, saved as `google-oauth.json` in the app folder.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const VIDEO_RE = /\.(mp4|mkv|avi|mov|ts|dav|wmv|flv|m4v)$/i;
const SHARED_WITH_ME = 'shared-with-me';   // virtual folder in the browser
const EXPIRED = 'Your Google Drive connection has ended. Click "Connect Google Drive" again.';

let store = null;          // { load(), save(obj), clear(), canRemember } (set by main.js)
let openBrowser = null;    // (url) => void (set by main.js: shell.openExternal)
let session = null;        // { refreshToken, email } while connected
let access = null;         // { token, expiresAt }
let pending = null;        // sign-in in progress: { cancel() }

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const needLogin = (msg = EXPIRED) => Object.assign(new Error(msg), { needLogin: true });

// ---- Settings ----------------------------------------------------------------------------------------------

let config;
/** { clientId, clientSecret } or null when Google Drive is not set up. */
function getConfig() {
  if (config !== undefined) return config;
  config = null;
  if (process.env.GOOGLE_CLIENT_ID) {
    config = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' };
    return config;
  }
  for (const file of [path.join(__dirname, '..', 'google-oauth.json'), process.resourcesPath && path.join(process.resourcesPath, 'google-oauth.json')]) {
    try {
      if (!file || !fs.existsSync(file)) continue;
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const c = j.installed || j.web || j;   // the file downloaded from Google Cloud, or { clientId, clientSecret }
      const clientId = c.client_id || c.clientId;
      if (clientId) { config = { clientId, clientSecret: c.client_secret || c.clientSecret || '' }; break; }
    } catch { /* broken file: ignore */ }
  }
  return config;
}

function setStore(s) { store = s; }
function setOpener(fn) { openBrowser = fn; }

function status() {
  return {
    configured: !!getConfig(),
    loggedIn: !!session, email: session ? session.email : null,
    canRemember: !!(store && store.canRemember),
    connecting: !!pending,
  };
}

/** Restores the remembered connection (no request: the token is checked on first use). */
function restore() {
  if (!session && store) {
    const saved = store.load();
    if (saved && saved.refreshToken) session = { refreshToken: saved.refreshToken, email: saved.email || 'Google account' };
  }
  return Promise.resolve(status());
}

// ---- Tokens ------------------------------------------------------------------------------------------------

async function tokenRequest(params) {
  const cfg = getConfig();
  const body = new URLSearchParams({ client_id: cfg.clientId, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}), ...params });
  let r;
  try { r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body }); } catch {
    throw new Error('Could not reach Google. Check the internet connection.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw needLogin();
    if (j.error === 'invalid_client') throw new Error('The Google Client ID / secret of this app is wrong (see README, "Google Drive setup").');
    throw new Error(j.error_description || j.error || `Google returned status ${r.status}`);
  }
  return j;
}

let refreshing = null;
/** A valid access token (refreshed automatically about every hour). */
async function accessToken(fresh = false) {
  if (!session) throw needLogin('Connect Google Drive first.');
  if (!fresh && access && access.expiresAt > Date.now()) return access.token;
  refreshing ||= (async () => {
    try {
      const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
      access = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 - 60_000 };
      return access.token;
    } catch (err) {
      if (err.needLogin) await logout(false);   // withdrawn at Google (or unused for 6 months): connect again
      throw err;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

// ---- Sign-in -----------------------------------------------------------------------------------------------

const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>StampSheet</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#fafafa;color:#111">
<div style="text-align:center;max-width:28rem;padding:2rem"><h2>${title}</h2><p style="color:#555">${text}</p></div></body>`;

/** Opens Google's sign-in page in the default browser and waits (up to 5 minutes) until the user is back. */
async function login() {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: 'Google Drive is not set up in this copy of the app (no Google Client ID, see README).', ...status() };
  if (pending) pending.cancel();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  let server, timer;
  const done = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
      if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end(); return; }
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        res.end(PAGE('Not connected', 'Google Drive was not connected. You can close this tab and try again in StampSheet.'));
        reject(new Error(error === 'access_denied' ? 'You did not allow access in the Google window.' : `Google sign-in failed (${error}).`));
      } else {
        res.end(PAGE('Google Drive connected', 'You can close this tab and go back to StampSheet.'));
        resolve(url.searchParams.get('code'));
      }
    });
    server.on('error', reject);
    timer = setTimeout(() => reject(new Error('The Google sign-in took too long. Try again.')), 5 * 60 * 1000);
    pending = { cancel: () => reject(Object.assign(new Error('Sign-in cancelled.'), { canceled: true })) };
  });
  done.catch(() => {});

  try {
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
      code_challenge: challenge, code_challenge_method: 'S256', state,
      access_type: 'offline', prompt: 'consent select_account',
    }).toString();
    openBrowser(auth.toString());
    const code = await done;
    const j = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    if (!j.refresh_token) throw new Error('Google did not give a lasting login. Try again.');
    if (!String(j.scope || '').split(' ').includes(SCOPE)) throw new Error('Please tick "See and download all your Google Drive files" in the Google window, so the videos can be read.');
    session = { refreshToken: j.refresh_token, email: 'Google account' };
    access = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 - 60_000 };
    try {
      const about = await api('/about', { fields: 'user(emailAddress,displayName)' });
      session.email = (about.user && (about.user.emailAddress || about.user.displayName)) || session.email;
    } catch { /* keep the default name */ }
    if (store && store.canRemember) store.save(session);
    return { ok: true, ...status() };
  } catch (err) {
    return { ok: false, canceled: !!err.canceled, error: String(err.message || err), ...status() };
  } finally {
    clearTimeout(timer);
    pending = null;
    server.close();
    server.closeAllConnections?.();
  }
}

function cancelLogin() { if (pending) pending.cancel(); return status(); }

async function logout(clearSaved = true) {
  const s = session;
  session = null; access = null; rootId = null; folderCache.clear();
  if (clearSaved && store) store.clear();
  if (s && clearSaved) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.refreshToken)}`, { method: 'POST' }); } catch { /* offline */ }
  }
  return status();
}

// ---- Drive REST API ----------------------------------------------------------------------------------------

function friendlyError(status, body) {
  const e = body && body.error;
  const reason = (e && ((e.errors && e.errors[0] && e.errors[0].reason) || e.status)) || '';
  if (status === 401) return EXPIRED;
  if (/downloadQuotaExceeded/i.test(reason)) return 'Google Drive download limit for this file is reached for today. Try again later.';
  if (/rateLimit|userRateLimit|RESOURCE_EXHAUSTED/i.test(reason) || status === 429) return 'Google Drive is busy right now. Try again in a minute.';
  if (/cannotDownload|cannotCopy/i.test(reason)) return 'The owner of this file does not allow downloading, so it cannot be read.';
  if (status === 404 || /notFound/i.test(reason)) return 'Not found in Google Drive (deleted, or this Google account cannot open it).';
  if (/insufficient/i.test(reason)) return 'This Google login cannot read Drive files. Disconnect and connect again, and allow access.';
  return (e && e.message) || `Google Drive returned status ${status}.`;
}

async function api(p, params = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken();
    const url = new URL(API + p);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let r;
    try { r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); } catch {
      throw new Error('Could not reach Google Drive. Check the internet connection.');
    }
    if (r.ok) return r.json();
    const body = await r.json().catch(() => null);
    if (r.status === 401 && attempt === 0) { access = null; continue; }   // token ended early: refresh once
    if (r.status === 401) throw needLogin();
    const msg = friendlyError(r.status, body);
    if ((r.status === 429 || r.status >= 500 || /busy/.test(msg)) && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
    throw new Error(msg);
  }
}

const LIST = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', pageSize: '1000' };
const FILE_FIELDS = 'id,name,mimeType,size,parents,driveId,shortcutDetails(targetId,targetMimeType)';

async function search(q) {
  const out = [];
  let pageToken = '';
  do {
    const r = await api('/files', { ...LIST, q, fields: `nextPageToken,files(${FILE_FIELDS})`, ...(pageToken ? { pageToken } : {}) });
    out.push(...(r.files || []));
    pageToken = r.nextPageToken || '';
  } while (pageToken && out.length < 50000);
  return out;
}

const isFolder = (f) => f.mimeType === FOLDER || (f.mimeType === SHORTCUT && f.shortcutDetails && f.shortcutDetails.targetMimeType === FOLDER);
const isVideoFile = (f) => f.mimeType !== FOLDER && VIDEO_RE.test(f.name || '') && (f.mimeType !== SHORTCUT || !!(f.shortcutDetails && f.shortcutDetails.targetId));
const realId = (f) => (f.mimeType === SHORTCUT ? f.shortcutDetails && f.shortcutDetails.targetId : f.id);
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
const quote = (id) => `'${String(id).replace(/['\\]/g, '')}'`;

let rootId = null;
async function myDriveId() { return (rootId ||= (await api('/files/root', { fields: 'id' })).id); }

const folderCache = new Map();   // id -> { id, name, parents, driveId }
async function folderInfo(id) {
  let f = folderCache.get(id);
  if (f) return f;
  const r = await api(`/files/${encodeURIComponent(id)}`, { supportsAllDrives: 'true', fields: FILE_FIELDS });
  let name = r.name;
  if (r.id === await myDriveId()) name = 'My Drive';
  else if (r.driveId && r.driveId === r.id) { try { name = (await api(`/drives/${encodeURIComponent(r.id)}`, { fields: 'name' })).name; } catch { /* keep */ } }
  f = { id: r.id, name, parents: r.parents || [], driveId: r.driveId };
  folderCache.set(id, f);
  return f;
}

/** Folders from the top of the drive down to `id` (its own name last). */
async function pathTo(id) {
  const out = [];
  let cur = id;
  for (let depth = 0; cur && depth < 30; depth++) {
    let f;
    try { f = await folderInfo(cur); } catch (e) { if (depth === 0) throw e; break; }   // parent not visible to this account
    out.unshift({ id: f.id, name: f.name });
    cur = f.parents[0];
  }
  const top = out[0];
  const mine = await myDriveId();
  const sharedDrive = top && folderCache.get(top.id) && folderCache.get(top.id).driveId === top.id;
  if (top && top.id !== mine && !sharedDrive) out.unshift({ id: SHARED_WITH_ME, name: 'Shared with me' });
  return out;
}

async function topFolders() {
  const tops = [
    { id: await myDriveId(), name: 'My Drive', videos: null, folders: null },
    { id: SHARED_WITH_ME, name: 'Shared with me', videos: null, folders: null },
  ];
  try {
    const r = await api('/drives', { pageSize: '100', fields: 'drives(id,name)' });
    for (const d of r.drives || []) tops.push({ id: d.id, name: d.name, videos: null, folders: null });
  } catch { /* no shared drives */ }
  return tops;
}

const childrenOf = (id) => search(id === SHARED_WITH_ME ? 'sharedWithMe = true and trashed = false' : `${quote(id)} in parents and trashed = false`);

/** One folder for the browser: its path, sub-folders and how many videos are directly in it. */
async function listFolder(id) {
  if (!id) return { id: null, path: [], folders: await topFolders(), videosHere: 0, videosTotal: null };
  if (id === 'root') id = await myDriveId();
  const [p, kids] = await Promise.all([
    id === SHARED_WITH_ME ? [{ id: SHARED_WITH_ME, name: 'Shared with me' }] : pathTo(id),
    childrenOf(id),
  ]);
  const seen = new Set();
  const folders = kids.filter(isFolder).map((f) => ({ id: realId(f), name: f.name || '(no name)', videos: null, folders: null }))
    .filter((f) => f.id && !seen.has(f.id) && (seen.add(f.id), true)).sort(byName);
  return { id, path: p, folders, videosHere: kids.filter(isVideoFile).length, videosTotal: null };
}

/** Folder id from a Google Drive web address (https://drive.google.com/drive/folders/<id>). */
async function folderFromAddress(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { throw new Error('This is not a Google Drive address.'); }
  if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/i.test(url.hostname)) throw new Error('This is not a Google Drive address.');
  const p = url.pathname;
  if (/\/my-drive\/?$/.test(p)) return myDriveId();
  if (/\/shared-with-me\/?$/.test(p)) return SHARED_WITH_ME;
  const m = /\/folders\/([\w-]{10,})/.exec(p) || /\/d\/([\w-]{10,})/.exec(p);
  const id = (m && m[1]) || url.searchParams.get('id');
  if (!id) throw new Error('Use the address of a folder in Google Drive (it looks like https://drive.google.com/drive/folders/…).');
  let f;
  try { f = await api(`/files/${encodeURIComponent(id)}`, { supportsAllDrives: 'true', fields: FILE_FIELDS }); } catch (e) {
    if (e.needLogin) throw e;
    throw new Error('This folder was not found, or this Google account cannot open it.');
  }
  if (isFolder(f)) return realId(f);
  if (f.parents && f.parents[0]) return f.parents[0];
  throw new Error('This is a file, not a folder. Paste the address of the folder that holds the videos.');
}

/** All video files inside the given folders (all levels): [{ file: { id, name, size }, folders }]. */
async function videosIn(ids) {
  const out = [];
  const seenFiles = new Set();
  const seenFolders = new Set();
  const addVideo = (f, folders) => {
    const id = realId(f);
    if (!id || seenFiles.has(id)) return;
    seenFiles.add(id);
    out.push({ file: { id, name: f.name, size: Number(f.size) || 0 }, folders });
  };
  const level = [];
  for (const raw of ids) {
    const id = raw === 'root' ? await myDriveId() : raw;
    if (id === SHARED_WITH_ME) {
      for (const f of await childrenOf(SHARED_WITH_ME)) {
        if (isFolder(f)) level.push({ id: realId(f), folders: [f.name] });
        else if (isVideoFile(f)) addVideo(f, []);
      }
      continue;
    }
    const p = await pathTo(id);
    level.push({ id, folders: p.slice(1).map((x) => x.name) });   // without the top ("My Drive" etc.)
  }
  // One level at a time; many folders are asked for in one request. Shortcuts to folders are followed only after
  // all real folders, so a video keeps its real folder path (and camera name) when a shortcut also points to it.
  const shortcuts = [];
  const walk = async (start) => {
    for (let depth = 0, cur = start; cur.length && depth <= 30; depth++) {
      const next = [];
      cur = cur.filter((l) => l.id && !seenFolders.has(l.id) && (seenFolders.add(l.id), true));
      for (let i = 0; i < cur.length; i += 40) {
        const batch = cur.slice(i, i + 40);
        const byId = new Map(batch.map((b) => [b.id, b]));
        const kids = await search(`(${batch.map((b) => `${quote(b.id)} in parents`).join(' or ')}) and trashed = false`);
        for (const f of kids.sort(byName)) {
          const parent = byId.get((f.parents || []).find((x) => byId.has(x)) || batch[0].id);
          if (f.mimeType === SHORTCUT && isFolder(f)) shortcuts.push({ id: realId(f), folders: parent.folders });
          else if (isFolder(f)) next.push({ id: f.id, folders: [...parent.folders, f.name] });
          else if (isVideoFile(f)) addVideo(f, parent.folders);
        }
      }
      cur = next;
    }
  };
  await walk(level);
  for (let round = 0; shortcuts.length && round < 5; round++) {
    const list = shortcuts.splice(0).filter((s) => !seenFolders.has(s.id));
    const named = [];
    for (const s of list) {
      try { named.push({ id: s.id, folders: [...s.folders, (await folderInfo(s.id)).name] }); } catch { /* target gone */ }
    }
    await walk(named);
  }
  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return out.sort((a, b) => cmp(a.folders.join('/'), b.folders.join('/')) || cmp(a.file.name, b.file.name));
}

/** Byte-range reader for one Drive file, for streamBridge (read(start, endInclusive) -> Buffer). */
function driveSource(file) {
  return {
    name: file.name,
    size: file.size,
    async read(start, end) {
      let lastErr = 'Could not read this video from Google Drive.';
      for (let attempt = 0; attempt < 4; attempt++) {
        const token = await accessToken();
        let r;
        try {
          r = await fetch(`${API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${token}`, Range: `bytes=${start}-${end}` },
          });
        } catch {
          lastErr = 'Could not reach Google Drive. Check the internet connection.';
          await sleep(400 * 2 ** attempt);
          continue;
        }
        if (r.status === 401) { access = null; lastErr = EXPIRED; continue; }   // refresh the token and try again
        if (r.status === 206 || (r.status === 200 && start === 0 && end >= file.size - 1)) {
          const data = Buffer.from(await r.arrayBuffer());
          if (data.length === end - start + 1) return data;
          lastErr = 'Google Drive sent an incomplete piece.';
          continue;
        }
        if (r.ok) { try { await r.body.cancel(); } catch { /* ignore */ } throw new Error('Google Drive sent the whole file instead of a piece.'); }
        lastErr = friendlyError(r.status, await r.json().catch(() => null));
        if (!(r.status === 429 || r.status >= 500 || /busy/.test(lastErr))) break;   // waiting will not help
        await sleep(400 * 2 ** attempt);
      }
      throw new Error(lastErr);
    },
  };
}

module.exports = { setStore, setOpener, getConfig, status, restore, login, cancelLogin, logout, listFolder, folderFromAddress, videosIn, driveSource, SHARED_WITH_ME };
