// Automatic updates from GitHub Releases (electron-updater).
//
// Only active in the installed app (Windows setup / Linux AppImage). It checks at start and every 6 hours,
// downloads a new version in the background, and the screen offers "Restart to update". If the user ignores it,
// the update is installed when the app is closed. Where the releases are is set in package.json -> build.publish.
const { app } = require('electron');

let getWin = () => null;
let updater = null;
let last = { state: 'idle' };

function send(st) {
  last = st;
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send('update-status', st);
}

function start(winGetter) {
  getWin = winGetter;
  if (!app.isPackaged) return;            // `npm start` / `npm run dev`: nothing to update
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('checking-for-update', () => send({ state: 'checking' }));
  updater.on('update-available', (i) => send({ state: 'downloading', version: i.version, percent: 0 }));
  updater.on('update-not-available', () => send({ state: 'latest', version: app.getVersion() }));
  updater.on('download-progress', (p) => send({ ...last, state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }));
  // no internet, no release yet, GitHub down...: never bother the user with it at start
  updater.on('error', (err) => send({ state: 'error', error: String((err && err.message) || err).split('\n')[0] }));
  setTimeout(() => check(false), 8000);
  setInterval(() => check(false), 6 * 60 * 60 * 1000);
}

/** Checks now. Returns the current state (for the "Check for updates" button). */
async function check() {
  if (!updater) return { state: 'dev', version: app.getVersion() };
  if (last.state === 'downloading' || last.state === 'ready') return last;
  try { await updater.checkForUpdates(); } catch { /* reported through the 'error' event */ }
  return last;
}

function install() {
  if (updater && last.state === 'ready') setImmediate(() => updater.quitAndInstall(false, true));
  return last.state === 'ready';
}

module.exports = { start, check, install };
