import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight, ChevronRight, Cloud, FileVideo, Folder, FolderOpen, FolderPlus, FolderTree, HardDrive, Info, KeyRound,
  Link2, Loader2, LogIn, LogOut, RefreshCw, ShieldCheck, UploadCloud, UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VIDEO_EXT } from './useVideos';
import type { Entry, MegaFolder, MegaStatus, Settings } from './types';

const spring = { type: 'spring', stiffness: 380, damping: 32 } as const;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Shared look of the two source cards (big when the list is empty, one slim row afterwards). */
function SourceCard({ compact, dashed, highlight, icon, title, text, children }: {
  compact: boolean; dashed?: boolean; highlight?: boolean; icon: React.ReactNode; title: React.ReactNode; text: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={compact ? 'compact' : 'big'}
        initial={{ opacity: 0, y: compact ? -6 : 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
        transition={spring}
        className={cn(
          'relative flex w-full items-center justify-center overflow-hidden rounded-xl border-2 text-center transition-colors',
          dashed ? 'border-dashed border-border bg-card/60' : 'border-border/60 bg-card/60',
          highlight && 'border-primary bg-accent/60',
          compact ? 'gap-3 px-4 py-3' : 'flex-1 flex-col gap-4 p-8',
        )}
      >
        <div className={cn('grid shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary', compact ? 'size-9 [&_svg]:size-5' : 'size-16 animate-[float_3s_ease-in-out_infinite] [&_svg]:size-8')}>
          {icon}
        </div>
        <div className={compact ? 'min-w-0 flex-1 text-left' : 'max-w-xl'}>
          <p className={cn('font-semibold', compact ? 'text-sm' : 'text-xl')}>{title}</p>
          <div className={cn('text-muted-foreground', compact ? 'truncate text-xs' : 'mt-1 text-sm')}>{text}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">{children}</div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---- From this computer -----------------------------------------------------------------------------

export function DropZone({ compact, dragging, onFiles, onFolder }: { compact: boolean; dragging: boolean; onFiles: () => void; onFolder: () => void }) {
  return (
    <SourceCard
      compact={compact}
      dashed
      highlight={dragging}
      icon={<UploadCloud />}
      title={compact ? 'Add more videos' : 'Drop videos or folders here'}
      text={compact ? 'Drag files or folders here, or choose them' : (
        <>
          A folder adds every video inside it, also in sub-folders.
          <span className="mt-3 flex flex-wrap justify-center gap-1.5">
            {VIDEO_EXT.map((e) => <span key={e} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium uppercase">{e}</span>)}
          </span>
        </>
      )}
    >
      <Button variant={compact ? 'outline' : 'default'} size={compact ? 'sm' : 'default'} onClick={onFiles} className={compact ? '' : 'shadow-sm shadow-primary/30'}>
        <FileVideo /> Choose videos
      </Button>
      <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={onFolder}>
        <FolderOpen /> Choose folder
      </Button>
    </SourceCard>
  );
}

// ---- MEGA: log in once, then choose folders ---------------------------------------------------------

const NO_ACCOUNT: MegaStatus = { loggedIn: false, email: null, canRemember: false, folders: 'none' };

export function MegaPanel({ compact, onAdd }: { compact: boolean; onAdd: (entries: Entry[], where: string) => void }) {
  const [account, setAccount] = useState<MegaStatus>(NO_ACCOUNT);
  const [checking, setChecking] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const refreshStatus = useCallback(() => window.api.megaStatus().then(setAccount).catch(() => {}), []);
  useEffect(() => { refreshStatus().finally(() => setChecking(false)); }, [refreshStatus]);
  // while the folder list loads in the background, check now and then so the button can show when it is ready
  useEffect(() => {
    if (account.folders !== 'loading') return;
    const t = setInterval(refreshStatus, 1500);
    return () => clearInterval(t);
  }, [account.folders, refreshStatus]);

  const needLogin = useCallback(() => { setBrowserOpen(false); setAccount(NO_ACCOUNT); setLoginOpen(true); }, []);
  const logout = async () => setAccount(await window.api.megaLogout());

  if (checking) {
    return <SourceCard compact={compact} icon={<Loader2 className="animate-spin" />} title="MEGA" text="Checking your MEGA login…"><span /></SourceCard>;
  }

  return (
    <>
      {account.loggedIn ? (
        <SourceCard
          compact={compact}
          icon={<Cloud />}
          title={compact ? 'Add videos from MEGA' : 'Choose folders from your MEGA drive'}
          text={
            <span className={cn('inline-flex items-center gap-1.5', !compact && 'flex-wrap justify-center')}>
              <ShieldCheck className="size-3.5 shrink-0 text-success" /> Logged in as <b className="font-medium text-foreground">{account.email}</b>
              {!compact && <span className="basis-full">Videos are <b className="font-medium text-foreground">not downloaded</b>: the app only reads the few pieces it needs.</span>}
            </span>
          }
        >
          <Button size={compact ? 'sm' : 'default'} onClick={() => setBrowserOpen(true)} className={compact ? '' : 'shadow-sm shadow-primary/30'}>
            {account.folders === 'loading' ? <Loader2 className="animate-spin" /> : <FolderTree />} Choose MEGA folder
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size={compact ? 'sm' : 'default'} onClick={logout}><LogOut /> Log out</Button>
            </TooltipTrigger>
            <TooltipContent>{account.canRemember ? 'The app remembers your login until you log out.' : 'Log out of MEGA'}</TooltipContent>
          </Tooltip>
        </SourceCard>
      ) : (
        <SourceCard
          compact={compact}
          icon={<Cloud />}
          title="Log in to MEGA"
          text={compact ? 'Log in once, then choose folders of your drive' : 'Log in once with your MEGA account. The app remembers it, then you choose folders of your drive. Videos are not downloaded.'}
        >
          <Button size={compact ? 'sm' : 'default'} onClick={() => setLoginOpen(true)} className={compact ? '' : 'shadow-sm shadow-primary/30'}><LogIn /> Log in to MEGA</Button>
        </SourceCard>
      )}
      <LoginDialog open={loginOpen} canRemember={account.canRemember} onOpenChange={setLoginOpen} onLoggedIn={(st) => { setAccount(st); setLoginOpen(false); setBrowserOpen(true); }} />
      <MegaBrowser open={browserOpen} onOpenChange={setBrowserOpen} onNeedLogin={needLogin} onAdd={onAdd} />
    </>
  );
}

function LoginDialog({ open, canRemember, onOpenChange, onLoggedIn }: {
  open: boolean; canRemember: boolean; onOpenChange: (o: boolean) => void; onLoggedIn: (s: MegaStatus) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!open) { setPassword(''); setCode(''); setNeedCode(false); setError(null); } }, [open]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await window.api.megaLogin({ email, password, code: needCode ? code : undefined });
      if (r.ok) { setPassword(''); onLoggedIn(r); return; }
      if (r.needCode) setNeedCode(true);
      setError(r.error || 'Could not log in.');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cloud className="size-5 text-primary" /> Log in to MEGA</DialogTitle>
          <DialogDescription>Log in once. {canRemember ? 'The app remembers your login until you click "Log out".' : 'This computer cannot store the login safely, so you log in again after restarting the app.'}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor="mega-email">Email</Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="mega-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" disabled={busy} autoFocus />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mega-password">Password</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="mega-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-9" disabled={busy} />
            </div>
          </div>
          <AnimatePresence initial={false}>
            {needCode && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid gap-1.5">
                <Label htmlFor="mega-code">6-digit code (2-step login)</Label>
                <Input id="mega-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="tracking-[0.4em] tabular-nums" disabled={busy} autoFocus />
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-destructive">{error}</motion.p>}
          </AnimatePresence>
          <p className="text-xs text-muted-foreground">Your password goes only to MEGA and is never saved.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !email.trim() || !password || (needCode && code.length < 6)}>
              {busy ? <Loader2 className="animate-spin" /> : <LogIn />} {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const LAST_FOLDER_KEY = 'vmeta.megaFolder';

/** Folder browser of the logged-in MEGA drive. "Add" takes every video in the folder and its sub-folders. */
function MegaBrowser({ open, onOpenChange, onNeedLogin, onAdd }: {
  open: boolean; onOpenChange: (o: boolean) => void; onNeedLogin: () => void; onAdd: (entries: Entry[], where: string) => void;
}) {
  const [folder, setFolder] = useState<MegaFolder | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');

  const go = useCallback(async (id: string | null, fallbackToTop = false): Promise<void> => {
    setLoading(true); setError(null);
    try {
      const r = await window.api.megaFolder(id);
      if (r.ok) { setFolder(r); try { localStorage.setItem(LAST_FOLDER_KEY, r.id || ''); } catch { /* ignore */ } return; }
      if (r.needLogin) { onNeedLogin(); return; }
      if (fallbackToTop && id) return go(null);
      setError(r.error);
    } finally { setLoading(false); }
  }, [onNeedLogin]);

  useEffect(() => {
    if (!open) return;
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_FOLDER_KEY) || null; } catch { /* ignore */ }
    go(last, true);
  }, [open, go]);

  const refresh = async () => {
    setLoading(true); setError(null);
    const r = await window.api.megaRefresh();
    if (!r.ok) { setLoading(false); if (r.needLogin) onNeedLogin(); else setError(r.error); return; }
    await go(folder?.id ?? null, true);
  };

  const goAddress = async () => {
    if (!address.trim()) return;
    setLoading(true); setError(null);
    const r = await window.api.megaAddress(address.trim());
    setLoading(false);
    if (r.ok) { setAddress(''); go(r.id); } else if (r.needLogin) onNeedLogin(); else setError(r.error);
  };

  const add = async (id: string, name: string) => {
    setAdding(id); setError(null);
    try {
      const r = await window.api.megaVideos([id]);
      if (!r.ok) { if (r.needLogin) onNeedLogin(); else setError(r.error); return; }
      if (!r.entries.length) { setError(`There are no videos in "${name}".`); return; }
      onAdd(r.entries, `"${name}"`);
      onOpenChange(false);
    } finally { setAdding(null); }
  };

  const here = folder?.path[folder.path.length - 1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FolderTree className="size-5 text-primary" /> Choose a MEGA folder</DialogTitle>
          <DialogDescription>Click a folder to open it. <b className="font-medium text-foreground">Add</b> takes every video inside, also in sub-folders, and names them by camera folder.</DialogDescription>
        </DialogHeader>

        {/* where we are */}
        <div className="flex min-h-9 flex-wrap items-center gap-0.5 rounded-lg bg-muted/60 px-2 py-1 text-sm">
          <button type="button" aria-label="Top" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => go(null)} disabled={loading}>
            <Cloud className="inline size-3.5" />
          </button>
          {folder?.path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-0.5">
              <ChevronRight className="size-3.5 text-muted-foreground" />
              <button type="button" disabled={loading || i === folder.path.length - 1} onClick={() => go(p.id)}
                className={cn('max-w-56 truncate rounded px-1.5 py-0.5', i === folder.path.length - 1 ? 'font-medium' : 'text-muted-foreground hover:bg-background hover:text-foreground')}>
                {p.name}
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={refresh} disabled={loading}><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh</Button>
        </div>

        {/* folders */}
        <div className="min-h-56 flex-1 overflow-auto rounded-lg border">
          {loading && !folder ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              Loading your MEGA folders…
              <span className="text-xs">The first time after starting the app this can take a little while for a big drive. After that it is instant.</span>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={folder?.id || 'top'} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className={cn(loading && 'pointer-events-none opacity-60')}>
                {folder?.folders.map((f) => (
                  <div key={f.id} className="group flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0 hover:bg-muted/50">
                    <button type="button" onClick={() => go(f.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 text-left">
                      <Folder className="size-5 shrink-0 fill-amber-400/80 text-amber-500" />
                      <span className="truncate text-sm font-medium">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{f.videos ? plural(f.videos, 'video') : 'no videos'}</span>
                    </button>
                    <Button variant="outline" size="sm" className="h-7" disabled={!f.videos || !!adding} onClick={() => add(f.id, f.name)}>
                      {adding === f.id ? <Loader2 className="animate-spin" /> : <FolderPlus />} Add
                    </Button>
                  </div>
                ))}
                {folder && !folder.folders.length && (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No folders inside.{folder.videosHere ? ` This folder has ${plural(folder.videosHere, 'video')}.` : ''}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <AnimatePresence>
          {error && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-destructive">{error}</motion.p>}
        </AnimatePresence>

        {/* jump to a folder whose address was copied from the MEGA website */}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); goAddress(); }}>
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Or paste the folder address from the MEGA website (mega.nz/fm/…)" className="h-8 pl-9 text-sm" spellCheck={false} disabled={loading} />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={!address.trim() || loading}>Open</Button>
        </form>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{here && folder ? `“${here.name}”: ${plural(folder.videosTotal, 'video')} in total` : ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            {here && folder && (
              <Button onClick={() => add(here.id, here.name)} disabled={!folder.videosTotal || !!adding || loading} className="shadow-sm shadow-primary/30">
                {adding === here.id ? <Loader2 className="animate-spin" /> : <FolderPlus />} Add this folder ({folder.videosTotal})
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Pop-up: how video_name is made -----------------------------------------------------------------

export function NamingInfoDialog({ open, onOpenChange, settings }: { open: boolean; onOpenChange: (o: boolean) => void; settings: Settings }) {
  const def = settings.camera.trim() || 'Camera 1';
  const on = settings.useFolderCamera;
  const examples: [string, string][] = [
    ['Camera 2 / 00000105.mp4', `${on ? 'Camera 2' : def}_00000105.mp4`],
    ['Yunus Data Nov-9 / Unit-6 Camera-3 / 00000771.mp4', `${on ? 'Camera 3' : def}_00000771.mp4`],
    ['Factory / CAM_04 / Day 1 / clip.mp4', `${on ? 'Camera 4' : def}_clip.mp4`],
    ['Videos / clip.mp4  (no camera folder)', `${def}_clip.mp4`],
  ];
  const steps = [
    <>Put each camera's videos in a folder named after the camera, e.g. <b>Camera 1</b> or <b>Unit-6 Camera-2</b>. Names like <b>CAM 2</b>, <b>camera_02</b> or <b>Cam2</b> also work.</>,
    <>Add the videos: drop the folder, click <b>Choose folder</b>, or pick the folder in <b>MEGA</b>.</>,
    <>The app looks at the folder the video is in, then the folders above it. The closest folder with a camera number gives the name, e.g. <b>Camera 2</b>.</>,
    <>If no folder has a camera number, the <b>default camera name</b> is used (now: <b>{def}</b>). You can change it in <b>Settings</b>.</>,
    <>In Excel, <b>video_name</b> = camera name + <b>_</b> + file name. You can still edit any name in the table before export.</>,
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Info className="size-5 text-primary" /> How the video name is saved in Excel</DialogTitle>
          <DialogDescription>Camera name from the folder + _ + file name. Works the same on this computer and in MEGA.</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-2.5 text-sm">
          {steps.map((t, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }} className="flex gap-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{i + 1}</span>
              <span className="text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{t}</span>
            </motion.li>
          ))}
        </ol>
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FolderTree className="size-3.5" /> Examples{!on && ' (folder names are switched off in Settings)'}
          </p>
          <div className="overflow-hidden rounded-lg border bg-card">
            {examples.map(([from, to]) => (
              <div key={from} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0">
                <span className="truncate text-muted-foreground" title={from}>{from}</span>
                <ArrowRight className="size-3.5 text-primary" />
                <span className="truncate font-medium tabular-nums" title={to}>{to}</span>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><HardDrive className="size-3.5" /><Cloud className="size-3.5" /> Hover the small icon before a name in the table to see which folder gave the camera name.</p>
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Got it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
