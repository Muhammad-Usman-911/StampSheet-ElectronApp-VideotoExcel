// Reads videos from a folder of your MEGA drive without the UI (and without downloading them), and times each step.
// usage:
//   MEGA_EMAIL=you@x.com MEGA_PASSWORD=... [MEGA_CODE=123456] npm run test:mega -- "https://mega.nz/fm/<folder id>" [how many videos, default 3] [default camera name]
const account = require('../src/megaAccount');
const { listMegaFolders, megaSource, getMegaFile } = require('../src/sources');
const bridge = require('../src/streamBridge');
const { analyseVideo, closeWorker, warmUp } = require('../src/videoMeta');

const secs = (t) => ((Date.now() - t) / 1000).toFixed(1) + ' s';
const mb = (n) => (n / 1e6).toFixed(1) + ' MB';

(async () => {
  const [address, howMany = '3', def = 'Camera 1'] = process.argv.slice(2);
  if (!address || !process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
    console.log('usage: MEGA_EMAIL=... MEGA_PASSWORD=... [MEGA_CODE=123456] npm run test:mega -- "https://mega.nz/fm/<folder id>" [how many videos] [default camera name]');
    process.exit(1);
  }
  let t = Date.now();
  const r = await account.login({ email: process.env.MEGA_EMAIL, password: process.env.MEGA_PASSWORD, code: process.env.MEGA_CODE });
  if (!r.ok) { console.log('Login failed:', r.error); process.exit(1); }
  console.log(`Logged in as ${r.email} in ${secs(t)}`);

  t = Date.now();
  await account.loadTree();
  console.log(`Folder list of the account loaded in ${secs(t)}`);

  const id = await account.folderFromAddress(address);
  const folder = await account.listFolder(id);
  console.log(`\nFolder: ${folder.path.map((p) => p.name).join(' / ')}  (${folder.videosTotal} videos in total)`);
  for (const f of folder.folders) console.log(`  [${f.name}]  ${f.videos} videos`);

  const entries = await listMegaFolders([id]);
  console.log('\nNames in Excel (first 10):');
  for (const e of entries.slice(0, 10)) console.log(`  ${(e.camera || def)}_${e.name}   ${e.camera ? `(from folder "${e.cameraFolder}")` : '(default name)'}`);

  await warmUp(1);
  for (const e of entries.slice(0, Number(howMany))) {
    t = Date.now();
    const before = bridge.stats.fetchedBytes;
    const src = megaSource(getMegaFile(e.id));
    try {
      const row = await analyseVideo(await bridge.urlFor(e.id, src), { camera: e.camera || def, name: e.name, rowPath: e.id });
      console.log(`\n${row.video_name}\n  date ${row.date || '-'}  start ${row.start_time || '-'}  end ${row.end_time || '-'}  length ${row.duration}${row.warning ? `\n  note: ${row.warning}` : ''}`);
    } catch (err) {
      console.log(`\n${e.name}: FAILED ${src.lastError ? src.lastError.message : err.message}`);
    }
    console.log(`  ${secs(t)}, read ${mb(bridge.stats.fetchedBytes - before)} of ${mb(e.size || 0)}`);
    bridge.forget(e.id);
  }
  await closeWorker(); bridge.stop();
  await account.logout(true);
})().catch((err) => { console.error(err.message || err); process.exit(1); });
