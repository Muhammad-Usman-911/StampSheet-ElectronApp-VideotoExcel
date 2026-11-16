<p align="center">
  <img src="build/icon.png" width="96" alt="StampSheet icon" />
</p>

<h1 align="center">StampSheet</h1>

<p align="center">
  <b>Turn CCTV footage into a clean Excel log, automatically.</b><br/>
  Reads the date and time burned into NVR/CCTV videos and writes name, date, start, end and duration to Excel.
</p>

<p align="center">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-2563eb" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-33-47848f" />
  <img alt="Offline OCR" src="https://img.shields.io/badge/OCR-offline-059669" />
</p>

---

## Overview

Factory and site cameras (NVR/DVR) print a clock in the corner of every video. Logging hours of footage by hand
(open the video, read the clock, type the start time, work out the end time) is slow and error-prone.
**StampSheet** does it for whole folders at once:

| video_name | date | start_time | end_time | duration_hh:mm:ss | Usefullness |
|---|---|---|---|---|---|
| Camera 2_00000000105000000.mp4 | 2026-11-01 | 5:56:25 AM | 8:49:55 AM | 02:53:30 | Yes |

### Features

- **Accurate clock reading.** A purpose-built OCR pipeline handles camera text that switches between black and white
  across one line. It checks every value against several frames, and leaves a value empty with a note instead of
  guessing. On the reference set: 50/50 values correct, 0 wrong.
- **Fast.** About 1 second per video, with several videos read in parallel.
- **Works with folders.** Drop a folder (all sub-folders included) or pick one; the camera name is taken from the folder
  name (`Unit-6 Camera-3` → `Camera 3`).
- **Reads straight from MEGA.** Log in once and browse your drive. Videos are **not downloaded**: only the few
  megabytes needed to read the clock are streamed and decrypted in memory.
- **Reads straight from Google Drive.** Connect once in your web browser (read-only access) and browse My Drive,
  *Shared with me* and shared drives. Videos are **not downloaded** either: only the needed pieces are streamed.
- **Excel export.** Write a new `.xlsx` file or append to an existing register. Dates and times are stored as real Excel values.
- **History per device.** Every video read and every Excel file saved is listed in a local history. Rows can be
  re-opened and exported again. There is no account and nothing leaves the computer.
- **Automatic updates.** The installed app gets new versions from GitHub Releases.
- **Light and dark theme**, animated, keyboard friendly (Ctrl+O).

---

## Installation

Download the latest installer from the **[Releases](../../releases/latest)** page:

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `StampSheet-Setup-<version>.exe` |
| Linux (64-bit) | `StampSheet-<version>-x86_64.AppImage` (make it executable, then run) |

The app checks for updates automatically. When a new version is ready, a **Restart to update** button appears
(it also installs by itself when the app is closed).

> Windows may show a SmartScreen notice for a new, unsigned app: click **More info → Run anyway**.

---

## Usage

1. **Add videos**
   - **From this computer:** drop videos or folders anywhere on the window, or use *Choose videos* / *Choose folder*.
   - **From MEGA:** *Log in to MEGA* (once; the login is remembered), then *Choose MEGA folder* and *Add*.
   - **From Google Drive:** *Log in to Google Drive*, type the **Google account email** whose Drive has the videos and
     click *Log in*. Google's page opens in your web browser already on that account: click *Allow* and come back.
     The app only accepts that account (if another one signs in, it is refused). Then *Choose Drive folder* and *Add*
     (or paste a `drive.google.com/drive/folders/…` address). *Switch account* changes to another Google account; the
     login is remembered until *Log out*.
     (Google does not allow its password page inside other apps, so the password is only ever typed on Google's page.)
2. **Check:** values can be edited in place. Orange rows need a look (the note explains why). Click the
   warning icon once a row is checked. *Needs check* filters to those rows.
3. **Export:** *Export to new Excel* or *Append to existing Excel*.

Header buttons: **History** (what this device has done), **How names work**, **Settings** (default camera name,
date format, end-time mode, version and update check) and the theme switch.

### How the video name is built

`video_name` = **camera name** + `_` + **file name**. The closest folder whose name contains `camera`/`cam` followed by a
number gives the camera name. Otherwise the default camera name from Settings is used.

| Video location | video_name |
|---|---|
| `Camera 2/00000105.mp4` | `Camera 2_00000105.mp4` |
| `Yunus Data Nov-9/Unit-6 Camera-3/x.mp4` | `Camera 3_x.mp4` (`Unit-6` is not a camera) |
| `Factory/CAM_03/Day 1/clip.mp4` | `Camera 3_clip.mp4` (closest camera folder wins) |
| `camera_02/`, `Cam2/`, `IPCam 2/`, `NVR CAM 02 Blowroom/` | `Camera 2_…` |
| `Videos/clip.mp4` (no camera folder) | `<default camera name>_clip.mp4` |

Not treated as camera folders: `Webcam5`, `Scam 1`, `Cameras`, `Footage 2026`.

### Privacy and data

| Data | Where it lives |
|---|---|
| History | `history.jsonl` in the app data folder of this computer (`%APPDATA%\StampSheet` on Windows, `~/.config/StampSheet` on Linux) |
| MEGA login | Only the session token, encrypted by the operating system (Windows Credential Manager / Linux keyring). The password is never stored. *Log out* deletes it. |
| Settings | Local app storage |
| Google Drive connection | Only the refresh token (read-only Drive access) and the email, encrypted by the operating system like the MEGA login (`gdrive-session.bin`). The app never sees the Google password. *Log out* withdraws the token at Google and deletes it. |
| Videos | Never uploaded. MEGA and Google Drive videos are streamed piece by piece and never written to disk. |

---

## Development

### Requirements

- Node.js 22+ and npm
- Windows or Linux (macOS should work but is not packaged)

### Commands

```bash
npm install          # install dependencies
npm start            # build the UI and run the app
npm run dev          # run with live reload of the UI (Vite dev server)
npm run typecheck    # TypeScript check of the UI

npm run dist         # build an installer for this system into release/ (no upload)
npm run dist:win     # Windows installer (run on Windows)
npm run dist:linux   # Linux AppImage

npm run test:ocr     # accuracy check against scripts/ocr-truth.json (needs test_videos/, not in the repo)
npm run test:video -- path/to/video.mp4 "Camera 1"            # read one video without the UI
MEGA_EMAIL=… MEGA_PASSWORD=… npm run test:mega -- "https://mega.nz/fm/<folder>" 3   # read from MEGA, with timings
```

Releases are built by GitHub Actions when a version tag is pushed (`.github/workflows/release.yml`).

### Google Drive setup (once, by the developer)

Google only lets an app read Drive files with its own **OAuth Client ID**. No extra npm package is needed (the app
talks to Google with plain HTTPS calls). Without a Client ID the app still works; the Google Drive tab just says it is
not set up.

1. Open [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen:** app name *StampSheet*, user type *External*, add the scope
   `https://www.googleapis.com/auth/drive.readonly`. While the app is in *Testing*, add the client's Google accounts
   under **Test users** (up to 100).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →** application type **Desktop app**.
   Click **Download JSON**.
5. Save that file as **`google-oauth.json`** in the project folder (next to `package.json`). It is git-ignored and is
   packed into the installer by `npm run dist`. Instead of the file you can set the environment variables
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (useful with `npm start`).
6. For GitHub Actions releases add the repository secrets **`GOOGLE_CLIENT_ID`** and **`GOOGLE_CLIENT_SECRET`**; the
   workflow writes `google-oauth.json` before building.

> The "client secret" of a Desktop app is not really secret (Google says so for installed apps); the sign-in is
> protected by PKCE and a one-time local address. `drive.readonly` is a *restricted* scope: for more than 100 users,
> or to remove Google's "unverified app" notice, the app must be verified by Google (OAuth app verification).

### Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 33, electron-builder (NSIS / AppImage), electron-updater (GitHub Releases) |
| UI | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui (Radix), motion, sonner, lucide |
| Video | ffmpeg-static, ffprobe-static |
| OCR | tesseract.js 5 with bundled English data (fully offline) |
| Excel | exceljs |
| MEGA | megajs (login, folder list) + own streaming bridge (range reads, AES-CTR decryption) |
| Google Drive | Google OAuth 2.0 (installed-app flow with PKCE, system browser) + Drive REST API v3 with Range requests, plain `fetch` (no extra package) |

### Project structure

```
main.js                 Electron main process: window, IPC handlers, reading queue, history, updates
preload.js              Safe bridge to the UI (window.api)
src/
  videoMeta.js          Clock reader: frame grabs, colour-independent text cleanup, OCR, voting, parsing
  sources.js            Finds videos (files, folders, MEGA, Google Drive), camera name from folders, MEGA decryption
  megaAccount.js        MEGA login, remembered session, background folder list, folder browser
  driveAccount.js       Google Drive sign-in (browser + PKCE), remembered token, folder browser, range reader
  streamBridge.js       Local HTTP range server so ffmpeg can read MEGA / Drive videos without downloading
  excel.js              New / append Excel export
  history.js            Per-device history (local JSON-lines file)
  updates.js            Auto-update (electron-updater)
ui/src/
  App.tsx               Layout: header, source tabs, table, footer
  Sources.tsx           Drop zone, MEGA and Google Drive panels, login, shared folder browser, "How names work"
  DriveIcon.tsx         Google Drive mark used in the tab, rows and history
  History.tsx           History window
  VideoTable.tsx        Editable, animated results table
  useVideos.ts          List state and reading
  components/ui/        shadcn/ui components
scripts/                Test and debug tools, release check
build/                  Logo (logo.png) and app icon (icon.png, made by scripts/make-icons.py)
.github/workflows/      Release pipeline
```

### How it works

**Flow of one video**

```
 UI (React)                          Main process                                  Tools
 drop / Choose folder ─expand-paths─▶ sources.expandLocal (walk folders)
 MEGA folder browser ──mega-videos──▶ sources.listMegaFolders
 Drive folder browser ─gdrive-videos▶ sources.listDriveFolders
                     ◀── entries ─── { id, name, camera from folder, folderPath }
 analyse(id) per video ────────────▶ queue (2–6 in parallel, by CPU count)
                                      MEGA / Drive ids → local streamBridge URL
                                      videoMeta.analyseVideo ─────────────────────▶ ffprobe, ffmpeg, tesseract
                     ◀──── row ───── { date, start_time, end_time, duration, warning } → history
 Export ──────────── export-excel ─▶ excel.saveRows ────────────────────────────▶ .xlsx → history
```

**Reading the clock** (`src/videoMeta.js`). These cameras draw each character black *or* white depending on the
background, so one line mixes both and ordinary thresholding fails.

1. `ffprobe` gives the duration; `ffmpeg` grabs the top-left corner of a frame as greyscale.
2. *Colour-independent views*: `findTextBand` finds the clock row (most sharp horizontal transitions);
   `polarityFreeInk` keeps pixels that differ strongly from the local background **and** are near pure black or white
   (background = median of a sideways window, or of the rows just above/below the text); the text is cropped, scaled
   to a fixed letter height and read by Tesseract. Five views with different settings vote.
3. Classic filter views are used only when those views disagree.
4. Frames at 0, 1, 2, 3, 5, 8, 12, 20, 30, 60, 120 s cross-check each other: a later frame must show the first-frame
   time plus the elapsed seconds (`chooseStart`). The date is checked against the printed weekday (`parseDate`).
5. Anything not confirmed is left empty with a warning. A wrong value is worse than an empty one.

**MEGA without downloading** (`src/megaAccount.js`, `src/sources.js`, `src/streamBridge.js`). Login only checks the
password; the account's folder list loads in the background and is cached in memory. For each video, ffmpeg gets a
local address (`http://127.0.0.1:<port>/<secret>/<id>`); the bridge fetches only the requested byte ranges from MEGA in
512 KB blocks, decrypts them in memory (AES-128-CTR allows decrypting any block on its own) and caches recent blocks.
Typical traffic: about 6 MB per 1 GB video.

**Google Drive without downloading** (`src/driveAccount.js`). The login box sends the typed email as `login_hint`, and
after sign-in the app asks Drive which account it got; another account is refused (its token is withdrawn) and the
current login stays. *Log in* starts a one-time local web server on
`127.0.0.1:<random port>` and opens Google's sign-in page in the default browser (OAuth 2.0 for installed apps, PKCE,
scope `drive.readonly`). Google sends the browser back to that local address with a code, which is exchanged for an
access token (1 hour, refreshed automatically) and a refresh token (kept encrypted). Folders are listed one at a time
with the Drive API (My Drive, *Shared with me*, shared drives; shortcuts are followed after real folders, so a video
keeps its real camera folder). *Add* walks all sub-folders, asking for up to 40 folders per request. Videos go through
the same stream bridge as MEGA; pieces are fetched with HTTP `Range` requests (`files/<id>?alt=media`), no decryption
needed. Checked against a simulated Drive with the test videos: 11 MB read of 2.1 GB, values identical to local reads.

**History** (`src/history.js`). One JSON line per event (`read` with the row and source folder, `export` with the file
and exported rows) in the app data folder. Capped at 50 000 events.

**Updates** (`src/updates.js`). In the installed app, electron-updater checks GitHub Releases at start and every
6 hours, downloads in the background and offers *Restart to update*.

---

## License

Proprietary. All rights reserved.
