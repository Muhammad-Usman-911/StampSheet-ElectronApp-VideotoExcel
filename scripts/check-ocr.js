// Accuracy check for the clock reader.
// Compares the date / start time read from every video in a folder with the values in scripts/ocr-truth.json
// (read by eye from the first frame). Usage:  npm run test:ocr [-- folder]   (default folder: test_videos)
const path = require('path');
const fs = require('fs');
const { analyseVideo, closeWorker, warmUp, limiter, CPUS } = require('../src/videoMeta');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test_videos'));
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, 'ocr-truth.json'), 'utf8'));
const files = Object.keys(truth).filter((f) => fs.existsSync(path.join(dir, f)));
if (!files.length) { console.log(`No videos from ocr-truth.json found in ${dir}`); process.exit(1); }

(async () => {
  const parallel = Math.max(2, Math.min(6, Math.floor(CPUS / 3)));
  const t0 = Date.now();
  await warmUp(parallel);
  const slot = limiter(parallel);
  const res = await Promise.all(files.map((f) => slot(async () => {
    const t = Date.now();
    const r = await analyseVideo(path.join(dir, f), { dateOrder: 'mdy' });
    return { f, r, ms: Date.now() - t };
  })));
  const n = { ok: 0, wrong: 0, empty: 0 };
  for (const { f, r, ms } of res) {
    const want = truth[f];
    const marks = [];
    for (const k of ['date', 'start_time']) {
      if (!r[k]) { n.empty++; marks.push(`${k} EMPTY`); }
      else if (r[k] !== want[k]) { n.wrong++; marks.push(`${k} WRONG (want ${want[k]})`); }
      else n.ok++;
    }
    console.log(`${f}  ${r.date || '----------'}  ${r.start_time || '--------'}  ${String(ms).padStart(6)}ms  ${marks.join(', ')}`);
  }
  console.log(`\n${files.length} videos, ${(Date.now() - t0) / 1000}s. Values correct: ${n.ok}, WRONG: ${n.wrong}, empty: ${n.empty}`);
  await closeWorker();
  process.exit(n.wrong ? 1 : 0);
})();
