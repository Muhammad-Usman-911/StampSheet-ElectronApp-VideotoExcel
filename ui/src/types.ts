export type DateOrder = 'mdy' | 'dmy' | 'auto';
export type EndMode = 'length' | 'clock';

export interface Settings {
  /** Used when no folder name has a camera number (or when folder names are switched off). */
  camera: string;
  /** Take "Camera <n>" from folder names like "Camera 2" / "CAM_02". */
  useFolderCamera: boolean;
  dateOrder: DateOrder;
  endMode: EndMode;
}

/** One row of the Excel sheet, as returned by the analyser (src/videoMeta.js). */
export interface VideoRow {
  path: string;
  video_name: string;
  date: string;
  start_time: string;
  end_time: string;
  duration: string;
  usefulness: 'Yes' | 'No';
  warning: string;
}

/** MEGA login state. `folders` = state of the account's folder list (loads in the background after login). */
export interface MegaStatus {
  loggedIn: boolean;
  email: string | null;
  /** false when this computer cannot store the login encrypted (it is then not remembered after a restart). */
  canRemember: boolean;
  folders: 'none' | 'loading' | 'ready' | 'error';
  foldersError?: string | null;
}

export type MegaResult<T> = ({ ok: true } & T) | { ok: false; error: string; needLogin?: boolean };

export interface MegaFolderInfo { id: string; name: string; videos: number; folders: number }

/** One folder in the MEGA folder browser. */
export interface MegaFolder {
  id: string | null;
  path: { id: string; name: string }[];
  folders: MegaFolderInfo[];
  /** videos directly in this folder / in this folder and all sub-folders */
  videosHere: number;
  videosTotal: number;
}

/** One thing the app did on this device (src/history.js). */
export type HistoryEvent =
  | { id: string; at: string; device: string; type: 'read'; source: Source; folderPath: string; ms?: number; failed?: boolean; row: VideoRow }
  | { id: string; at: string; device: string; type: 'export'; mode: 'new' | 'append'; file: string; count: number; rows: VideoRow[]; fileExists?: boolean };

export interface HistoryList {
  device: string;
  since: string | null;
  totals: { reads: number; exports: number; needCheck: number };
  events: HistoryEvent[];
}

export type UpdateState =
  | { state: 'idle' | 'checking' | 'dev' }
  | { state: 'latest'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; error: string };

export type Status = 'queued' | 'reading' | 'done';
export type Source = 'local' | 'mega';

/** A video found by the main process (picked files, a folder, dropped items or a MEGA link). See src/sources.js. */
export interface Entry {
  /** Local file path, or "mega:<id>" for a MEGA video. */
  id: string;
  name: string;
  source: Source;
  /** "Camera <n>" from the closest folder named like a camera, or null. */
  camera: string | null;
  cameraFolder: string | null;
  /** Folders above the video, joined with "/". */
  folderPath: string;
  size?: number;
}

export interface Item {
  id: string;
  status: Status;
  fileName: string;
  source: Source;
  /** Folder the camera name was taken from (null = default camera name was used). */
  cameraFolder: string | null;
  folderPath: string;
  row: VideoRow;
  startedAt?: number;
  ms?: number;
}

declare global {
  interface Window {
    api: {
      pickVideos: () => Promise<Entry[]>;
      pickFolder: () => Promise<Entry[]>;
      expandPaths: (paths: string[]) => Promise<Entry[]>;
      megaStatus: () => Promise<MegaStatus>;
      megaLogin: (form: { email: string; password: string; code?: string }) => Promise<MegaStatus & { ok: boolean; needCode?: boolean; error?: string }>;
      megaLogout: () => Promise<MegaStatus>;
      megaRefresh: () => Promise<MegaResult<object>>;
      megaFolder: (id: string | null) => Promise<MegaResult<MegaFolder>>;
      megaAddress: (text: string) => Promise<MegaResult<{ id: string }>>;
      megaVideos: (ids: string[]) => Promise<MegaResult<{ entries: Entry[] }>>;
      analyse: (id: string, opts: Settings & { name: string; folderPath: string }) => Promise<{ ok: true; row: VideoRow } | { ok: false; error: string }>;
      exportExcel: (rows: VideoRow[], mode: 'new' | 'append') => Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>;
      showInFolder: (filePath: string) => Promise<void>;
      pathOf: (file: File) => string;
      historyList: (opts: { type?: 'read' | 'export'; query?: string; limit?: number }) => Promise<HistoryList>;
      historyRemove: (id: string) => Promise<boolean>;
      historyClear: () => Promise<boolean>;
      appInfo: () => Promise<{ name: string; version: string; packaged: boolean }>;
      checkForUpdate: () => Promise<UpdateState>;
      installUpdate: () => Promise<boolean>;
      onUpdate: (cb: (s: UpdateState) => void) => () => void;
      onStarted: (cb: (file: string) => void) => () => void;
    };
  }
}
