# Project memory: StampSheet (formerly "Video Meta to Excel", folder vmeta)

> Claude reads this file automatically at the start of every session in this folder.
> Keep it current: update "Current status" and "Session log" at the end of each work session.

## What the app does
Electron desktop app for factory CCTV/NVR footage. Videos come from this computer (files / folders, drag & drop) or from the user's MEGA drive (login once, pick folders in a browser; read online, NOT downloaded). Share links were REMOVED at the client's request (login only). For each video it:
1. Reads the burned-in camera clock (top-left corner, e.g. `11-05-2026 Wed 05:07:25`) with OCR.
2. Computes start time, end time and duration.
3. Sets **Usefullness** to `Yes` for every video (click to switch Yes/No in the table).
4. Exports the rows to Excel (new file, or appended to an existing sheet).

Excel columns (fixed, keep the client's spelling): `video_name | date | start_time | end_time | duration_hh:mm:ss | Usefullness`
- `video_name` = `<Camera name>_<file name>`. Camera name = `Camera <n>` from the CLOSEST folder named like `Camera 2` / `CAM_03` / `cam-3` / `IPCam 4` (regex `CAMERA_RE` in `src/sources.js`), else the default name from settings ("Camera 1"). Switch "Use folder name" in settings turns it off. Same rule for local and MEGA folders.
- date stored as a real date (`yyyy-mm-dd`), times as Excel time fractions (`h:mm:ss AM/PM`), duration as text.

## Name, releases, history (added 2026-11-10)
- App name **StampSheet** (package `stampsheet`, appId `com.stampsheet.app` - never change appId after first release). Icon: `build/icon.svg` -> `build/icon.png` (rendered with Electron offscreen).
- Releases: electron-builder 26 -> `release/` (Windows NSIS `StampSheet-Setup-<v>.exe`, Linux `StampSheet-<v>-x86_64.AppImage`), publish to GitHub Releases (public repo, user's choice). `build.publish[0].owner` is still the placeholder `YOUR_GITHUB_USER` (repo not created yet); `scripts/check-release.js` blocks `npm run release` until it is set and checks tag == version. CI: `.github/workflows/release.yml` (tags `v*`, windows-latest + ubuntu-latest, `npm run release` with GITHUB_TOKEN). Windows must be built on Windows (ffmpeg-static downloads host binaries).
- `build.files` excludes other-platform ffprobe binaries (`ffprobe-static/bin/${platform}/${arch}` only): AppImage 257 -> 191 MB. Packaged app verified: reads a real video from inside app.asar(.unpacked), starts, userData = ~/.config/StampSheet.
- Auto-update: `src/updates.js` (electron-updater, only when packaged; check at start +8 s and every 6 h, autoDownload, header "Restart to update" + toast; Settings pop-over shows version + "Check for updates").
- History per device (user asked; I recommended NO accounts): `src/history.js`, `history.jsonl` in userData, events `read` (row, source, folderPath, ms, failed) and `export` (mode, file, rows); main records them; IPC `history-list/remove/clear`; UI `ui/src/History.tsx` (tabs Excel files saved / Videos read, search, Show in folder, Open rows -> `useVideos.addDone`, Clear history with 2-click confirm).
- `GUIDE.md` = user's private release guide (git-ignored). `.gitignore` also ignores test_videos/, release/, ui-dist/, *.xlsx, excel_output/, ocr-debug/, .env*, mega-session.bin.

## Stack and run commands
- Main process: Node/Electron 33, `tesseract.js` 5 (bundled `eng` data), `ffmpeg-static`, `ffprobe-static`, `exceljs`, `megajs` 1.3 (plain CommonJS).
- Screen: React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + **shadcn/ui** (new-york style, components in `ui/src/components/ui/`) + `motion` (animations) + `sonner` (toasts) + `next-themes` (light/dark) + lucide icons + Inter font (bundled, works offline). All UI packages are devDependencies (bundled by Vite).
- `npm start`: `vite build` (ui/ -> ui-dist/) then `electron . --no-sandbox`
- `npm run dev`: Vite dev server + Electron with `VITE_DEV_SERVER_URL` (hot reload) via `scripts/dev.js`
- `npm run typecheck` (tsc, TypeScript 7: no `baseUrl` in tsconfig)
- `npm run test:ocr`: accuracy check, all videos in `test_videos/` vs `scripts/ocr-truth.json` (exit 1 if any WRONG value)
- `npm run test:video -- /path/video.mp4 "Camera 1"` analyses one video without the UI
- `MEGA_EMAIL=.. MEGA_PASSWORD=.. [MEGA_CODE=..] npm run test:mega -- "https://mega.nz/fm/<folder>" [n]`: login, times login + folder list, camera names, reads n videos via the bridge
- `node scripts/debug-ocr.js video.mp4 [secs...]` saves the OLD filter views to `ocr-debug/`
- `npm run dist`: vite build + electron-builder (Linux AppImage, Windows NSIS). `build.files` only ships main.js, preload.js, src/, ui-dist/.
- Add shadcn components: `npx shadcn@latest add <name>`. **Gotcha (happens EVERY time):** the CLI writes `import { cn } from "cn"` and installed a bogus `cn` npm package; fix imports to `@/lib/utils` and uninstall `cn`.

## File map
| File | Role |
|---|---|
| `main.js` | Electron main; IPC `pick-videos`, `pick-folder`, `expand-paths` (return entries `{id,name,source,camera,cameraFolder,folderPath}`), MEGA: `mega-status` (restores session), `mega-login`, `mega-logout`, `mega-refresh`, `mega-folder`, `mega-address` (fm URL -> folder id), `mega-videos` (ids -> entries); `analyse` (id = path or `mega:<nodeId>` -> streamBridge URL); `safeStorage` session store |
| `preload.js` | `window.api`: pickVideos, pickFolder, expandPaths, megaStatus/Login/Logout/Refresh/Folder/Address/Videos, analyse, exportExcel, showInFolder, pathOf, onStarted |
| `ui/src/App.tsx` | Screen: header (How names work pop-up, Settings pop-over, theme toggle), source tabs (This computer / MEGA), list, whole-window drag overlay, filter All / Needs check, footer with progress + export, toasts, Ctrl+O |
| `ui/src/Sources.tsx` | SourceCard (big when empty, slim row later), DropZone, MegaPanel (login state, polls while folder list loads), LoginDialog (2-step code), MegaBrowser (breadcrumb, folders with video counts, Add / Add this folder, paste fm address, Refresh, remembers last folder), NamingInfoDialog |
| `ui/src/VideoTable.tsx` | Animated editable rows: status icon (waiting / reading / ok / warning; click warning = mark checked), shimmer while reading, Yes/No toggle, delete on hover |
| `ui/src/useVideos.ts` | List state; sends all files to main at once; keeps finished results so Undo restores complete rows |
| `ui/src/index.css` | Theme tokens (light + dark), incl. custom `success` / `warning` colours |
| `vite.config.ts` | root `ui/`, out `ui-dist/`, `base: './'`, CSP meta injected only in build |
| `src/sources.js` | `expandLocal` (walks folders, follows symlinks), camera-from-folder (`cameraFromName`/`cameraFromFolders`), `listMegaFolders` (account folders -> entries), `megaSource` (range reader, cached temp URL, retries), `decryptPiece` (AES-128-CTR, verified vs megajs), friendly MEGA errors |
| `src/megaAccount.js` | Login with `autoload:false` (fast; client said login was slow because autoload downloaded the whole 13.8 TB account list first). `loadTree()` loads the account list in background after login/restore, kept in memory; `restore()` = one `ug` request. Session {key,sid,user,email,rsa} saved via safeStorage (main.js, userData/mega-session.bin; not saved if backend basic_text). `listFolder`, `folderFromAddress`, `videosIn`. Logout sends `sml` + deletes file |
| `src/streamBridge.js` | Local HTTP server (127.0.0.1, random port + secret path) serving byte ranges to ffmpeg; 512 KB blocks, LRU cache max 160 MB, prefetch 2; `forget(id)` frees a video's cache |
| `src/videoMeta.js` | **Core OCR logic**: worker pool, colour-blind views, old filter views, voting, date/time parsing |
| `src/excel.js` | Writes/appends rows with exceljs |
| `scripts/check-ocr.js`, `scripts/ocr-truth.json` | Accuracy check + ground truth (read by eye from frame 0) |
| `test_videos/` | 25 real test videos (3200x1800) + user screenshots; NOT shipped |

## How the OCR works (src/videoMeta.js)
- **Key fact:** these cameras draw each character black OR white depending on the wall behind it, so one line mixes both colours (even parts of one digit). Single-polarity thresholds fail on that.
- **Colour-blind views first (`PF_VIEWS`, `readFramePF`)**: grab corner as grey PGM -> `findTextBand` (rows with most sharp horizontal jumps) -> `polarityFreeInk`: ink = pixel far from the wall colour AND near pure black/white (`lo`/`hi`); wall = median of a sideways window (`win`) or of the rows just above/below the text (`bg: 'rim'`, cancels poles/door edges) -> `textExtent` -> scale to 34 px letter height -> Tesseract psm 7. Five views with different settings; their errors fall on different videos, so voting works.
- Old filter views (`VARIANTS`: region / legacy / wide) only run when the colour-blind views don't agree on a frame.
- Frames at seconds `0,1,2,3,5,8,12,20,30,60,120`. **Never stops on frame 0 alone**: `chooseStart` scores candidates = 2*votes at sec 0 + 2*consistent later reads - contradicting later reads (views of the same frame make the same mistake, e.g. a cable over a "7" reads as "2"). Stops when agree>=2, consistent>=2 and margin>2. Warning "Camera time not certain" when margin<=1.
- `chooseDate`: majority vote; `parseDate` checks the weekday.
- Unsure values -> empty cell + warning (orange row). End time = start + length, or read from last frames (`endMode: 'clock'`, PF views first).
- One tesseract worker per video being read (`acquireWorker`/`releaseWorker`); `ffmpegSlot` limits parallel ffmpeg processes.

## MEGA (no download)
- ffmpeg/ffprobe get `http://127.0.0.1:<port>/<secret>/<id>` instead of a path; the bridge fetches only requested ranges from MEGA, decrypts in memory. `analyseVideo(file, { name, rowPath })` takes the real file name + row id because the URL has neither.
- Measured with test videos through the bridge (400 ms simulated latency): 25/25 correct, 157 MB read of 26.6 GB, 26 s.
- Client's real MEGA layout (2026-11-10): drive `Yunus Textile Mill YTM-6 / Yunus Data Nov-9 / Unit-6 Camera-1..4` (+ a pdf and xlsx). Folder names map to Camera 1..4 (checked). Client works with drive addresses (`https://mega.nz/fm/AzIjFJqS`); now login-only.
- NOT yet tested against real MEGA servers with the client's real account (no credentials here). Measure with `npm run test:mega` (prints login and folder-list times). MEGA API itself was reachable (fake link -> "does not exist"). First thing to do when a link is available: `npm run test:mega -- "<link>"`.

## Usefulness
- **No AI.** Every video is `Yes` by default. The AI check (`ai/` folder) was removed on 2026-11-10 at the client's request. Do not re-add it unless asked.

## Current status (as of 2026-11-10)
- Accuracy on the 25 test videos: 50/50 values correct (date + start time), 0 wrong, 0 empty. Old code: 13 videos with empty values AND 5 silently wrong times.
- Speed: ~1 s per video, 25 videos in ~18 s with 6 in parallel (old: ~7.6 s per video, one at a time). Video 00000001192000000 is the slow one (~13 s, falls back to old views).
- New shadcn UI done and checked with screenshots (light + dark) and a real end-to-end run in Electron.
- Camera name from folders (local + MEGA), Choose folder, folder drop, MEGA link tab, info box: done 2026-11-10, checked with screenshots and a real-app run on a folder tree (Camera 2 / CAM_05 / no camera folder -> correct names and values).
- No git repository yet.

## Open items / ideas
- Video 1192: first-frame seconds digit sits next to a dark pillar; could add a view that handles that to avoid the slow fallback.
- Unit tests for pure functions (`parseDate`, `parseTime`, `chooseStart`, `chooseDate`, `polarityFreeInk`).
- Possible cross-check: consecutive files of one camera (end of one ≈ start of next).
- Real MEGA test with the client's link (see MEGA section). Watch for: MEGA rate limit (EAGAIN) with 6 parallel videos, transfer quota (509).

## Conventions
- Keep user-facing messages in simple English (the client is not technical).
- Never guess a doubtful read: leave the cell empty and explain in `warning`. A wrong value is worse than an empty one.
- After any change to the reader, run `npm run test:ocr` (must stay at 0 WRONG).

## Session log
- 2026-11-10: Created this memory file.
- 2026-11-10: Removed the AI usefulness feature and deleted `ai/` (user's request). All videos default to Usefullness = Yes.
- 2026-11-10: New React + shadcn/ui animated screen (replaced `renderer/`). Parallel reading (worker pool) + new colour-blind clock views + stricter start-time voting. Append no longer overwrites real rows with empty date. Added `npm run test:ocr` with ground truth for the 25 test videos.
- 2026-11-10: Camera name from folder names (local folders + MEGA folders), "Choose folder" + folder drop, MEGA link input (reads via local streaming bridge, no download), info box explaining the naming, source icon per row, `npm run test:mega`. README rewritten with a full code explanation.
- 2026-11-10: MEGA login for drive addresses (mega.nz/fm/...): login dialog with 2-step code, remembered encrypted session, log out; a drive link waits for login then continues. Checked with screenshots + real app (fake account -> clear error, keyring backend gnome_libsecret).
- 2026-11-10: Client feedback: login slow, login-only (no share links), less clutter. Login no longer loads the account list (background load + memory cache), remembered session restored with one request, MEGA folder browser replaces link input, share-link code removed. Settings moved to a header pop-over and the naming info to a header pop-up ("How names work").
- 2026-11-10: Renamed to StampSheet + icon; per-device History (no accounts); electron-updater + electron-builder 26 GitHub Releases config + CI workflow + release guard; professional README; private GUIDE.md; full .gitignore. Built and smoke-tested the Linux AppImage.
