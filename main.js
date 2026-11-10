const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { analyseVideo, closeWorker, warmUp, limiter, CPUS } = require('./src/videoMeta');
const { saveRows } = require('./src/excel');
const { expandLocal, listMegaFolders, getMegaFile, megaSource, VIDEO_EXT } = require('./src/sources');
const bridge = require('./src/streamBridge');
const megaAccount = require('./src/megaAccount');
const history = require('./src/history');
const updates = require('./src/updates');

// The MEGA login is remembered: only the session (never the password), encrypted by the operating system
// (Windows/macOS keychain, Linux keyring). Without real encryption (Linux without a keyring) it is not saved,
// and the user logs in again after restarting the app.
function sessionStore() {
  const file = path.join(app.getPath('userData'), 'mega-session.bin');
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '';
  const canRemember = safeStorage.isEncryptionAvailable() && backend !== 'basic_text';
  return {
    canRemember,
    load() {
      try { return canRemember && fs.existsSync(file) ? JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) : null; } catch { return null; }
    },
    save(obj) { if (canRemember) fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(obj)), { mode: 0o600 }); },
    clear() { try { fs.rmSync(file, { force: true }); } catch { /* ignore */ } },
  };
}

// How many videos are read at the same time. Each one uses its own OCR engine and a few ffmpeg processes.
const PARALLEL = Math.max(2, Math.min(6, Math.floor(CPUS / 3)));
const analyseSlot = limiter(PARALLEL);

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: app.getName(),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#fafafa',
    ...(fs.existsSync(path.join(__dirname, 'build', 'icon.png')) ? { icon: path.join(__dirname, 'build', 'icon.png') } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, 'ui-dist', 'index.html'));
}

// Every way of adding videos returns the same list of entries: { id, name, source, camera, cameraFolder, folderPath }.
// camera = "Camera <n>" taken from the closest folder named like "Camera 2", or null (screen then uses the default).
ipcMain.handle('pick-videos', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select video files', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: VIDEO_EXT }],
  });
  return r.canceled ? [] : expandLocal(r.filePaths);
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Select a folder with videos (sub-folders are included)', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : expandLocal(r.filePaths);
});

// dropped files and folders
ipcMain.handle('expand-paths', (_e, paths) => expandLocal(paths));

// ---- MEGA account (login once, then pick folders of the drive) ----
const megaCall = (fn) => async (_e, ...args) => {
  try { return { ok: true, ...(await fn(...args)) }; }
  catch (err) { return { ok: false, needLogin: !!err.needLogin, error: String(err.message || err) }; }
};
ipcMain.handle('mega-status', () => megaAccount.restore());
ipcMain.handle('mega-login', (_e, form) => megaAccount.login(form));
ipcMain.handle('mega-logout', () => megaAccount.logout(true));
ipcMain.handle('mega-refresh', megaCall(async () => { await megaAccount.loadTree(true); return {}; }));
ipcMain.handle('mega-folder', megaCall((id) => megaAccount.listFolder(id)));
ipcMain.handle('mega-address', megaCall(async (text) => ({ id: await megaAccount.folderFromAddress(text) })));
ipcMain.handle('mega-videos', megaCall(async (ids) => ({ entries: await listMegaFolders(ids) })));

ipcMain.handle('analyse', (e, id, opts) => analyseSlot(async () => {
  if (!e.sender.isDestroyed()) e.sender.send('analyse-started', id);
  const isMega = id.startsWith('mega:');
  let src;
  try {
    let file = id;
    if (isMega) {
      const node = getMegaFile(id);
      if (!node) throw new Error('This MEGA video is no longer available. Open the link again.');
      src = megaSource(node);
      file = await bridge.urlFor(id, src);   // ffmpeg reads only the pieces it needs, nothing is saved to disk
    }
    const t0 = Date.now();
    const row = await analyseVideo(file, { ...opts, rowPath: id });
    history.add({ type: 'read', source: isMega ? 'mega' : 'local', folderPath: opts.folderPath || '', ms: Date.now() - t0, row });
    return { ok: true, row };
  } catch (err) {
    const msg = String(err.message || err);
    // a MEGA problem (limit, network) is more useful to the user than ffmpeg's own message
    const error = src && src.lastError ? `Could not read this video from MEGA: ${src.lastError.message}` : msg;
    history.add({ type: 'read', source: isMega ? 'mega' : 'local', folderPath: opts.folderPath || '', failed: true,
      row: { path: id, video_name: `${opts.camera || 'Camera 1'}_${opts.name || path.basename(id)}`, date: '', start_time: '', end_time: '', duration: '', usefulness: 'Yes', warning: error } });
    return { ok: false, error };
  } finally {
    if (isMega) bridge.forget(id);
  }
}));

ipcMain.handle('export-excel', async (_e, rows, mode) => {
  let filePath;
  if (mode === 'append') {
    const r = await dialog.showOpenDialog(win, { title: 'Select existing Excel file', properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled) return { ok: false, canceled: true };
    filePath = r.filePaths[0];
  } else {
    const r = await dialog.showSaveDialog(win, { title: 'Save Excel file', defaultPath: 'video_metadata.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled) return { ok: false, canceled: true };
    filePath = r.filePath;
  }
  try {
    await saveRows(filePath, rows, mode === 'append');
    history.add({ type: 'export', mode, file: filePath, count: rows.length, rows });
    return { ok: true, filePath };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// ---- History of this device (local file, no account) ----
ipcMain.handle('history-list', (_e, opts) => {
  const res = history.list(opts);
  for (const e of res.events) if (e.type === 'export') e.fileExists = fs.existsSync(e.file);
  return res;
});
ipcMain.handle('history-remove', (_e, id) => history.remove(id));
ipcMain.handle('history-clear', () => { history.clear(); return true; });

// ---- App version + updates (GitHub Releases) ----
ipcMain.handle('app-info', () => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('update-check', () => updates.check(true));
ipcMain.handle('update-install', () => updates.install());

ipcMain.handle('show-in-folder', (_e, filePath) => { shell.showItemInFolder(filePath); });

app.whenReady().then(() => {
  megaAccount.setStore(sessionStore());
  history.init(path.join(app.getPath('userData'), 'history.jsonl'));
  createWindow();
  updates.start(() => win);   // only in the installed app: checks GitHub for a new version
  warmUp(PARALLEL);   // load the OCR engines in the background so the first videos start immediately
});
app.on('window-all-closed', async () => { bridge.stop(); await closeWorker().catch(() => {}); app.quit(); });
