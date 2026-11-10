// MEGA account: the user logs in once, the app remembers the login, and the user picks folders of their drive
// in a folder browser. (Share links are not used.)
//
// Speed: logging in only checks the password (a few seconds at most). The list of all folders/files of the
// account is a separate, bigger download (MEGA sends the whole account in one go); it is loaded in the background
// right after login / app start and kept in memory, so the folder browser is instant afterwards.
//
// The password is never stored. Only the MEGA session (like a browser cookie) is saved, encrypted by the
// operating system (Electron safeStorage, see main.js). "Log out" ends the session at MEGA and deletes it.
let megajs;
const mega = () => (megajs ||= require('megajs'));

let storage = null;        // megajs Storage while logged in
let email = null;
let store = null;          // { load(), save(obj), clear(), canRemember } (set by main.js)
let restoring = null;
const tree = { promise: null, ready: false, error: null, loadedAt: 0, ms: 0 };

const e64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

function setStore(s) { store = s; }

function friendlyError(err) {
  const s = String((err && err.message) || err);
  if (/EMFAREQUIRED|-26\b/.test(s)) return { needCode: true, error: 'Enter the 6-digit code from your authenticator app.' };
  if (/EFAILED|-11\b|-9\b|ENOENT|invalid credentials|EACCESS/i.test(s)) return { error: 'Email or password is wrong (or the 6-digit code is wrong).' };
  if (/ESID|-15\b/.test(s)) return { needLogin: true, error: 'Your MEGA login has expired. Please log in again.' };
  if (/ETOOMANY|-6\b|EBLOCKED|-16\b/.test(s)) return { error: 'MEGA has blocked logins for now (too many tries). Try again later.' };
  if (/EAGAIN|-3\b/.test(s)) return { error: 'MEGA is busy right now. Try again in a minute.' };
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(s)) return { error: 'Could not reach MEGA. Check the internet connection.' };
  return { error: s };
}

function status() {
  return {
    loggedIn: !!storage, email, canRemember: !!(store && store.canRemember),
    folders: tree.ready ? 'ready' : tree.error ? 'error' : storage ? 'loading' : 'none',
    foldersError: tree.error,
  };
}

/** Loads (or reloads) the folder list of the account in the background. */
function loadTree(force = false) {
  if (!storage) return Promise.reject(Object.assign(new Error('Not logged in'), { needLogin: true }));
  if (tree.promise && !force) return tree.promise;
  const s = storage;
  const t0 = Date.now();
  tree.ready = false; tree.error = null;
  if (force) { s.files = {}; s.mounts = []; s.root = undefined; s.api.removeAllListeners('sc'); }   // fresh list (removed files go away)
  tree.promise = s.reload(true).then(() => {
    if (s !== storage) return;
    tree.ready = true; tree.loadedAt = Date.now(); tree.ms = Date.now() - t0;
  }, async (err) => {
    if (s !== storage) return;
    const f = friendlyError(err);
    tree.error = f.error; tree.promise = null;
    if (f.needLogin) await logout(true);
    throw Object.assign(new Error(f.error), { needLogin: !!f.needLogin });
  });
  tree.promise.catch(() => {});
  return tree.promise;
}

function resetTree() { tree.promise = null; tree.ready = false; tree.error = null; }

/** Logs in (password check only; the folder list then loads in the background). */
async function login({ email: mail, password, code }) {
  if (!mail || !password) return { ok: false, error: 'Type your MEGA email and password.', ...status() };
  await logout(false);
  try {
    const Storage = mega().Storage;
    const s = await new Storage({ email: mail.trim(), password, secondFactorCode: code ? String(code).trim() : undefined, keepalive: false, autoload: false }).ready;
    storage = s; email = s.email || mail.trim().toLowerCase();
    if (store && store.canRemember) store.save({ key: e64(s.key), sid: s.sid, name: s.name, user: s.user, email, rsa: s.RSAPrivateKey });
    loadTree();
    return { ok: true, ...status() };
  } catch (err) {
    storage = null; email = null;
    return { ok: false, ...friendlyError(err), ...status() };
  }
}

/** Restores the remembered login (once). Only a quick "who am I" check; the folder list loads in the background. */
function restore() {
  if (storage || !store) return Promise.resolve(status());
  return (restoring ||= (async () => {
    const saved = store.load();
    if (!saved) return status();
    const s = mega().Storage.fromJSON({ key: saved.key, sid: saved.sid, name: saved.name, user: saved.user, options: { email: saved.email, keepalive: false } });
    s.RSAPrivateKey = saved.rsa;
    s.email = saved.email;
    try {
      await new Promise((ok, fail) => s.api.request({ a: 'ug' }, (err) => (err ? fail(err) : ok())));
    } catch (err) {
      if (friendlyError(err).needLogin) store.clear();       // session ended: log in again
      else return { ...status(), foldersError: friendlyError(err).error };   // offline etc.: keep it for next time
      return status();
    }
    storage = s; email = saved.email;
    loadTree();
    return status();
  })().finally(() => { restoring = null; }));
}

async function logout(clearSaved = true) {
  const s = storage;
  storage = null; email = null; resetTree();
  if (clearSaved && store) store.clear();
  if (s && clearSaved) await new Promise((ok) => s.api.request({ a: 'sml' }, () => ok()));   // end the session at MEGA
  if (s) await s.close().catch(() => {});
  return status();
}

// ---- Folder browser ----------------------------------------------------------------------------------

const VIDEO_RE = /\.(mp4|mkv|avi|mov|ts|dav|wmv|flv|m4v)$/i;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
const countCache = new WeakMap();
function videoCount(node, depth = 0) {
  if (!node.directory) return VIDEO_RE.test(node.name || '') ? 1 : 0;
  if (countCache.has(node)) return countCache.get(node);
  let n = 0;
  if (depth < 30) for (const c of node.children || []) n += videoCount(c, depth + 1);
  countCache.set(node, n);
  return n;
}

async function ready() {
  await restore();
  if (!storage) throw Object.assign(new Error('Log in to MEGA first.'), { needLogin: true });
  await loadTree();
}

/** Top folders: the Cloud drive and folders other people shared with this account. */
function topNodes() {
  const out = [];
  if (storage.root) out.push(storage.root);
  for (const f of Object.values(storage.files)) {
    if (f.directory && !f.parent && f !== storage.root && f !== storage.trash && f !== storage.inbox && f.name) out.push(f);
  }
  return out;
}

const describe = (n) => ({ id: n.nodeId, name: n.name || '(no name)', videos: videoCount(n), folders: (n.children || []).filter((c) => c.directory).length });

/** One folder for the browser: its path, sub-folders (with video counts) and how many videos it holds in total. */
async function listFolder(id) {
  await ready();
  if (!id) {
    const tops = topNodes();
    // only the Cloud drive: open it directly
    if (tops.length === 1) id = tops[0].nodeId;
    else return { id: null, path: [], folders: tops.map(describe), videosHere: 0, videosTotal: 0 };
  }
  const node = storage.files[id];
  if (!node || !node.directory) throw new Error('This folder is not in your MEGA drive any more. Click "Refresh".');
  const path = [];
  for (let p = node; p; p = p.parent) path.unshift({ id: p.nodeId, name: p.name || '(no name)' });
  const kids = [...(node.children || [])].sort(byName);
  return {
    id: node.nodeId, path,
    folders: kids.filter((c) => c.directory).map(describe),
    videosHere: kids.filter((c) => !c.directory && VIDEO_RE.test(c.name || '')).length,
    videosTotal: videoCount(node),
  };
}

/** Folder id from a MEGA web address (https://mega.nz/fm/<id>) the user copied from the browser. */
async function folderFromAddress(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { throw new Error('This is not a MEGA address.'); }
  if (!/(^|\.)mega(\.co)?\.nz$|(^|\.)mega\.io$/i.test(url.hostname)) throw new Error('This is not a MEGA address.');
  if (!/^\/fm(\/|$)/.test(url.pathname)) throw new Error('Use the address of a folder in your MEGA drive (it looks like https://mega.nz/fm/…).');
  await ready();
  const ids = url.pathname.split('/').filter((p) => /^[\w-]{8}$/.test(p));
  const id = ids[ids.length - 1];
  const node = id ? storage.files[id] : storage.root;
  if (!node) throw new Error('This folder was not found in your MEGA drive (maybe it belongs to another account).');
  return node.directory ? node.nodeId : node.parent && node.parent.nodeId;
}

/** All video files inside the given folders (all levels), with their folder names (outermost first). */
async function videosIn(ids) {
  await ready();
  const out = [];
  const seen = new Set();
  const visit = (node, folders, depth) => {
    if (depth > 30) return;
    if (node.directory) {
      const inner = [...folders, node.name];
      for (const k of [...(node.children || [])].sort(byName)) visit(k, inner, depth + 1);
    } else if (VIDEO_RE.test(node.name || '') && node.key && !seen.has(node.nodeId)) {
      seen.add(node.nodeId);
      out.push({ node, folders });
    }
  };
  for (const id of ids) {
    const node = storage.files[id];
    if (!node) continue;
    const parents = [];
    for (let p = node.parent; p && p.parent; p = p.parent) parents.unshift(p.name);   // skip the "Cloud Drive" top
    if (node.directory) visit(node, node.parent ? parents : [], 0); else visit(node, parents, 0);
  }
  return out;
}

module.exports = { setStore, status, login, restore, logout, loadTree, listFolder, folderFromAddress, videosIn, friendlyError };
