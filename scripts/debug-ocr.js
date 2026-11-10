// Usage: node scripts/debug-ocr.js /path/to/video.mp4 [second1 second2 ...]
// Saves every processed image into ./ocr-debug/ and prints what the OCR read on each one.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { grabRaw, applyVariant, ocrText, getWorker, closeWorker, parseDate, parseTime, fmtHMS, FFMPEG, getDurationSeconds, VARIANTS } = require('../src/videoMeta');

(async () => {
  const file = process.argv[2];
  if (!file) { console.log('Usage: node scripts/debug-ocr.js video.mp4 [seconds...]'); return; }
  const secs = process.argv.slice(3).map(Number);
  if (!secs.length) secs.push(0, 1, 2, 3);
  const out = path.join(process.cwd(), 'ocr-debug');
  fs.mkdirSync(out, { recursive: true });
  console.log('Video duration (s):', await getDurationSeconds(file));
  const worker = await getWorker();
  for (const sec of secs) {
    // the full frame (what the camera really shows) and the raw top-left corner the reader starts from
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(sec), '-i', file, '-frames:v', '1', path.join(out, `s${sec}_full.png`)]);
    const raw = await grabRaw(file, sec);
    fs.writeFileSync(path.join(out, `s${sec}_corner_raw.png`), raw);
    for (let v = 0; v < VARIANTS.length; v++) {
      let png;
      try { png = await applyVariant(raw, v); } catch (e) { console.log(`sec ${sec} view ${v} (${VARIANTS[v].name}): ffmpeg failed`); continue; }
      fs.writeFileSync(path.join(out, `s${sec}_v${v}.png`), png);
      let text = '';
      try { text = (await ocrText(worker, png, VARIANTS[v])).replace(/\s+/g, ' ').trim(); } catch {}
      const dt = parseDate(text, 'auto'), tm = parseTime(text);
      console.log(`sec ${sec} view ${v} [${VARIANTS[v].name}]: OCR="${text}"  ->  date=${dt || '-'}  time=${tm === null ? '-' : fmtHMS(tm)}`);
    }
  }
  console.log('\nImages saved in:', out);
  await closeWorker();
})();