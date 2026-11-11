import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { CalendarClock, Camera, Clock, Cloud, Download, FilePlus2, FileSpreadsheet, FolderOpen, HardDrive, History as HistoryIcon, Info, Loader2, Moon, RefreshCw, RotateCw, Settings2, Sun, Trash2, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VideoTable } from './VideoTable';
import { useVideos } from './useVideos';
import { DropZone, MegaPanel, NamingInfoDialog } from './Sources';
import { HistoryDialog } from './History';
import type { Entry, Settings, UpdateState, VideoRow } from './types';

const SETTINGS_KEY = 'vmeta.settings';
const DEFAULTS: Settings = { camera: 'Camera 1', useFolderCamera: true, dateOrder: 'auto', endMode: 'length' };
const TAB_KEY = 'vmeta.sourceTab';
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return DEFAULTS; }
}

const spring = { type: 'spring', stiffness: 380, damping: 32 } as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  return (
    <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Switch light / dark">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? 'm' : 's'} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={{ duration: 0.2 }}>
          {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

function updateText(u: UpdateState) {
  switch (u.state) {
    case 'dev': return 'Updates work in the installed app.';
    case 'checking': return 'Checking for updates…';
    case 'latest': return 'You have the latest version.';
    case 'downloading': return `Downloading v${u.version}… ${u.percent}%`;
    case 'ready': return `v${u.version} is ready to install.`;
    case 'error': return 'Could not check for updates.';
    default: return '';
  }
}

/** New version downloaded: one button in the header to restart into it (otherwise it installs when the app closes). */
function UpdateButton({ update }: { update: UpdateState }) {
  return (
    <AnimatePresence>
      {(update.state === 'ready' || update.state === 'downloading') && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
          {update.state === 'ready' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" className="rounded-full bg-success text-white hover:bg-success/90" onClick={() => window.api.installUpdate()}><RotateCw /> Restart to update</Button>
              </TooltipTrigger>
              <TooltipContent>Version {update.version} is downloaded. It also installs by itself when you close the app.</TooltipContent>
            </Tooltip>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"><Download className="size-3.5" /> Downloading update {update.percent}%</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Settings in a pop-over from the header, so the main screen stays clean. */
function SettingsButton({ settings, onChange, version, update, onCheck }: { settings: Settings; onChange: (s: Settings) => void; version: string; update: UpdateState; onCheck: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full"><Settings2 /> Settings</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-4" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="grid gap-1.5">
          <Label htmlFor="camera" className="flex items-center gap-1.5 text-muted-foreground"><Camera className="size-3.5" /> Default camera name</Label>
          <Input id="camera" value={settings.camera} onChange={(e) => onChange({ ...settings, camera: e.target.value })} placeholder="Camera 1" />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch size="sm" checked={settings.useFolderCamera} onCheckedChange={(v) => onChange({ ...settings, useFolderCamera: v })} />
            Use folder name (Camera 2, CAM_03…) when found
          </label>
        </div>
        <div className="grid gap-1.5">
          <Label className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="size-3.5" /> Date format in video</Label>
          <Select value={settings.dateOrder} onValueChange={(v) => onChange({ ...settings, dateOrder: v as Settings['dateOrder'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (recommended)</SelectItem>
              <SelectItem value="mdy">Mostly MM-DD-YYYY</SelectItem>
              <SelectItem value="dmy">Mostly DD-MM-YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-3.5" /> End time</Label>
          <Select value={settings.endMode} onValueChange={(v) => onChange({ ...settings, endMode: v as Settings['endMode'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="length">Start + video length (fast)</SelectItem>
              <SelectItem value="clock">Read from last frame (slower)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Changes apply to videos you add next. Saved automatically.</p>
        <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>StampSheet {version && `v${version}`}<br />{updateText(update)}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCheck} disabled={update.state === 'checking' || update.state === 'downloading' || update.state === 'dev'}>
            {update.state === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check for updates
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DragOverlay({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <motion.div initial={{ scale: 0.9, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }} transition={spring} className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-16 py-12 shadow-2xl">
            <div className="grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground"><FilePlus2 className="size-8" /></div>
            <p className="text-lg font-semibold">Drop to add videos</p>
            <p className="text-sm text-muted-foreground">Folders work too: the camera name is taken from the folder name.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<'all' | 'check'>('all');
  const [exporting, setExporting] = useState(false);
  const { items, stats, addEntries, addDone, updateRow, remove, restore } = useVideos();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' });
  useEffect(() => { window.api.appInfo().then((i) => { setVersion(i.version); if (!i.packaged) setUpdate({ state: 'dev' }); }); }, []);
  useEffect(() => window.api.onUpdate((u) => {
    setUpdate(u);
    if (u.state === 'ready') toast.success(`StampSheet ${u.version} is ready`, { description: 'Restart to use the new version, or it installs when you close the app.', action: { label: 'Restart now', onClick: () => window.api.installUpdate() }, duration: 15000 });
  }), []);
  const checkUpdate = useCallback(async () => {
    const u = await window.api.checkForUpdate();
    setUpdate(u);
  }, []);
  const loadFromHistory = useCallback((rows: (VideoRow & { folderPath?: string })[], label: string) => {
    const { added, skipped } = addDone(rows);
    setHistoryOpen(false);
    if (added) toast.success(`${added} row${added > 1 ? 's' : ''} put back in the table`, { description: label });
    if (skipped) toast.info(`${skipped} already in the table`);
  }, [addDone]);

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ } }, [settings]);

  const [tab, setTab] = useState<'local' | 'mega'>(() => { try { return localStorage.getItem(TAB_KEY) === 'mega' ? 'mega' : 'local'; } catch { return 'local'; } });
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable */ } }, [tab]);

  const add = useCallback((entries: Entry[], where = 'the selection') => {
    if (!entries.length) { toast.info('No videos found', { description: `There are no video files in ${where}.` }); return; }
    const { added, skipped, fromFolder } = addEntries(entries, settings);
    if (added) {
      const named = fromFolder === added ? 'Camera names taken from the folders.' : fromFolder ? `${fromFolder} named from folders, ${added - fromFolder} use "${settings.camera.trim() || 'Camera 1'}".` : 'Reading the camera clock…';
      toast.success(`${added} video${added > 1 ? 's' : ''} added`, { description: named, duration: 3000 });
    }
    if (skipped) toast.info(`${skipped} video${skipped > 1 ? 's were' : ' was'} skipped`, { description: 'Already in the list.' });
  }, [settings, addEntries]);

  const browse = useCallback(async () => { const e = await window.api.pickVideos(); if (e.length) add(e); }, [add]);
  const browseFolder = useCallback(async () => add(await window.api.pickFolder(), 'that folder'), [add]);
  const [infoOpen, setInfoOpen] = useState(false);

  // drag & drop anywhere in the window
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.types.includes('Files')) { depth++; setDragging(true); } };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = (e: DragEvent) => { e.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); depth = 0; setDragging(false);
      const paths = [...(e.dataTransfer?.files || [])].map((f) => window.api.pathOf(f)).filter(Boolean);
      if (!paths.length) return;
      setTab('local');
      window.api.expandPaths(paths).then((entries) => add(entries, 'what was dropped'));
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop);
    };
  }, [add]);

  // Ctrl+O = browse
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); browse(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [browse]);

  useEffect(() => { if (filter === 'check' && !stats.needsCheck && !stats.pending) setFilter('all'); }, [filter, stats.needsCheck, stats.pending]);

  const removeWithUndo = useCallback((ids: string[], label: string) => {
    const removed = remove(ids);
    if (removed.length) toast(label, { action: { label: 'Undo', onClick: () => restore(removed) } });
  }, [remove, restore]);
  const removeOne = useCallback((id: string) => removeWithUndo([id], 'Video removed'), [removeWithUndo]);

  const doExport = async (mode: 'new' | 'append') => {
    setExporting(true);
    try {
      const res = await window.api.exportExcel(items.map((i) => i.row), mode);
      if (res.ok && res.filePath) {
        const fp = res.filePath;
        toast.success(mode === 'append' ? 'Rows added to your Excel file' : 'Excel file saved', {
          description: fp.split(/[\\/]/).pop(),
          action: { label: 'Show in folder', onClick: () => window.api.showInFolder(fp) },
          duration: 8000,
        });
      } else if (!res.canceled) toast.error('Could not save the Excel file', { description: res.error });
    } finally { setExporting(false); }
  };

  const shown = useMemo(() => (filter === 'check' ? items.filter((i) => i.status === 'done' && i.row.warning) : items), [items, filter]);
  const hasItems = items.length > 0;
  const busy = stats.pending > 0;
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b bg-card/70 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <motion.div initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={spring} className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <FileSpreadsheet className="size-5" />
          </motion.div>
          <div>
            <h1 className="flex items-baseline gap-2 text-base font-semibold leading-tight">StampSheet {version && <span className="text-xs font-normal text-muted-foreground">v{version}</span>}</h1>
            <p className="text-xs text-muted-foreground">Reads the date and time printed on your camera videos and puts them in a sheet.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UpdateButton update={update} />
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setHistoryOpen(true)}><HistoryIcon /> History</Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setInfoOpen(true)}><Info /> How names work</Button>
          <SettingsButton settings={settings} onChange={setSettings} version={version} update={update} onCheck={checkUpdate} />
          <ThemeToggle />
        </div>
      </header>
      <NamingInfoDialog open={infoOpen} onOpenChange={setInfoOpen} settings={settings} />
      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} onLoadRows={loadFromHistory} />

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
        <div className={cn('flex shrink-0 flex-col gap-2', !hasItems && 'min-h-[300px] flex-1')}>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'local' | 'mega')}>
            <TabsList>
              <TabsTrigger value="local" className="px-3"><HardDrive /> From this computer</TabsTrigger>
              <TabsTrigger value="mega" className="px-3"><Cloud /> From MEGA</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'local'
            ? <DropZone compact={hasItems} dragging={dragging} onFiles={browse} onFolder={browseFolder} />
            : <MegaPanel compact={hasItems} onAdd={add} />}
        </div>

        <AnimatePresence>
          {hasItems && (
            <motion.section key="list" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={spring} className="flex min-h-[280px] flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v as 'all' | 'check')}>
                  <ToggleGroupItem value="all" className="gap-1.5 px-3"><Video className="size-3.5" /> All <span className="tabular-nums text-muted-foreground">{stats.total}</span></ToggleGroupItem>
                  <ToggleGroupItem value="check" className="gap-1.5 px-3" disabled={!stats.needsCheck}>
                    Needs check
                    <motion.span key={stats.needsCheck} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className={cn('rounded-full px-1.5 text-xs tabular-nums', stats.needsCheck ? 'bg-warning-soft text-warning' : 'text-muted-foreground')}>{stats.needsCheck}</motion.span>
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">Click any value to edit it. Orange rows need a quick check.</p>
              </div>
              <VideoTable items={shown} onChange={updateRow} onRemove={removeOne} emptyText="No videos need checking." />
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {hasItems && (
          <motion.footer initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={spring} className="flex shrink-0 flex-wrap items-center gap-4 border-t bg-card/80 px-6 py-3 backdrop-blur">
            <div className="min-w-[240px] flex-1">
              <AnimatePresence mode="wait" initial={false}>
                {busy ? (
                  <motion.div key="busy" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="grid gap-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">Reading videos… <span className="text-muted-foreground">{stats.reading} at a time</span></span>
                      <span className="tabular-nums text-muted-foreground">{stats.done} of {stats.total}</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </motion.div>
                ) : (
                  <motion.p key="idle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-sm">
                    <span className="font-medium">{stats.total} video{stats.total > 1 ? 's' : ''} ready.</span>{' '}
                    {stats.needsCheck ? <span className="text-warning">{stats.needsCheck} need{stats.needsCheck > 1 ? '' : 's'} a check before export.</span> : <span className="text-success">Everything was read.</span>}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => removeWithUndo(items.map((i) => i.id), `${items.length} video${items.length > 1 ? 's' : ''} cleared`)}>
                <Trash2 /> Clear all
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={busy ? 0 : -1}>
                    <Button variant="outline" disabled={busy || exporting} onClick={() => doExport('append')}><FolderOpen /> Append to existing Excel</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{busy ? 'Wait until all videos are read' : 'Adds the rows below the last filled row of a file you pick'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={busy ? 0 : -1}>
                    <Button disabled={busy || exporting} onClick={() => doExport('new')} className="shadow-sm shadow-primary/30"><FileSpreadsheet /> Export to new Excel</Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{busy ? 'Wait until all videos are read' : 'Creates a new .xlsx file'}</TooltipContent>
              </Tooltip>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      <DragOverlay show={dragging} />
    </div>
  );
}
