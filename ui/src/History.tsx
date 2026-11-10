import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Cloud, FileSpreadsheet, FolderOpen, HardDrive, History as HistoryIcon, ListPlus, Monitor, Search, Trash2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { HistoryEvent, HistoryList, VideoRow } from './types';

type Kind = 'export' | 'read';
type Read = Extract<HistoryEvent, { type: 'read' }>;
type Exp = Extract<HistoryEvent, { type: 'export' }>;

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string) {
  const d = new Date(iso); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

/** Groups events by day, newest first (they already arrive newest first). */
function byDay<T extends HistoryEvent>(events: T[]) {
  const out: { day: string; items: T[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.at);
    if (out.length && out[out.length - 1].day === day) out[out.length - 1].items.push(e);
    else out.push({ day, items: [e] });
  }
  return out;
}

/**
 * What this app did on this device: Excel files saved and videos read. Stored in a local file
 * (no account). Rows can be put back in the table to export them again.
 */
export function HistoryDialog({ open, onOpenChange, onLoadRows }: {
  open: boolean; onOpenChange: (o: boolean) => void; onLoadRows: (rows: (VideoRow & { folderPath?: string })[], label: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('export');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<HistoryList | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setData(await window.api.historyList({ type: kind, query, limit: 400 }));
  }, [kind, query]);

  useEffect(() => { if (open) { const t = setTimeout(load, query ? 200 : 0); return () => clearTimeout(t); } }, [open, load, query]);
  useEffect(() => { if (!open) { setConfirmClear(false); setQuery(''); } }, [open]);

  const remove = async (id: string) => { await window.api.historyRemove(id); load(); };
  const clearAll = async () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); return; }
    await window.api.historyClear(); setConfirmClear(false); load();
  };

  const groups = useMemo(() => byDay(data?.events || []), [data]);
  const reads = (data?.events || []).filter((e): e is Read => e.type === 'read' && !e.failed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HistoryIcon className="size-5 text-primary" /> History</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Monitor className="size-3.5" /> This device: <b className="font-medium text-foreground">{data?.device || '…'}</b></span>
            {data && <span>{data.totals.reads} videos read · {data.totals.exports} Excel files saved{data.since ? ` · since ${new Date(data.since).toLocaleDateString()}` : ''}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <TabsList>
              <TabsTrigger value="export" className="px-3"><FileSpreadsheet /> Excel files saved</TabsTrigger>
              <TabsTrigger value="read" className="px-3"><HardDrive /> Videos read</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === 'export' ? 'Search file or video name…' : 'Search video, folder or date…'} className="h-9 pl-9" />
          </div>
        </div>

        <div className="min-h-64 flex-1 overflow-auto rounded-lg border">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={kind} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {!groups.length && (
                <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-muted-foreground">
                  <HistoryIcon className="size-7 opacity-50" />
                  {query ? 'Nothing found.' : kind === 'export' ? 'No Excel files saved yet on this device.' : 'No videos read yet on this device.'}
                </div>
              )}
              {groups.map((g) => (
                <div key={g.day}>
                  <div className="sticky top-0 z-10 border-b bg-muted/90 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">{g.day}</div>
                  {g.items.map((e) => (e.type === 'export'
                    ? <ExportRow key={e.id} e={e} onLoad={() => { onLoadRows(e.rows, baseName(e.file)); }} onRemove={() => remove(e.id)} />
                    : <ReadRow key={e.id} e={e} onLoad={() => onLoadRows([{ ...e.row, folderPath: e.folderPath }], e.row.video_name)} onRemove={() => remove(e.id)} />))}
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="ghost" size="sm" onClick={clearAll} className={cn(confirmClear ? 'text-destructive hover:text-destructive' : 'text-muted-foreground')} disabled={!data?.totals.reads && !data?.totals.exports}>
            <Trash2 /> {confirmClear ? 'Click again to delete all history' : 'Clear history'}
          </Button>
          <div className="flex gap-2">
            {kind === 'read' && reads.length > 0 && (
              <Button variant="outline" onClick={() => onLoadRows(reads.map((r) => ({ ...r.row, folderPath: r.folderPath })), `${reads.length} videos from history`)}>
                <ListPlus /> Put all shown in the table ({reads.length})
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ children, onRemove }: { children?: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive" onClick={onRemove} aria-label="Remove from history"><Trash2 className="size-3.5" /></Button>
        </TooltipTrigger>
        <TooltipContent>Remove from history (the Excel file is not touched)</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ExportRow({ e, onLoad, onRemove }: { e: Exp; onLoad: () => void; onRemove: () => void }) {
  return (
    <div className="group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success"><FileSpreadsheet className="size-4.5" /></div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate" title={e.file}>{baseName(e.file)}</span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', e.mode === 'append' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{e.mode === 'append' ? 'Appended' : 'New file'}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground" title={e.file}>{fmtTime(e.at)} · {e.count} row{e.count === 1 ? '' : 's'} · {e.fileExists === false ? 'file was moved or deleted' : e.file}</p>
      </div>
      <RowActions onRemove={onRemove}>
        <Button variant="ghost" size="sm" className="h-7" disabled={e.fileExists === false} onClick={() => window.api.showInFolder(e.file)}><FolderOpen /> Show</Button>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="outline" size="sm" className="h-7" onClick={onLoad}><ListPlus /> Open rows</Button></TooltipTrigger>
          <TooltipContent>Put these {e.count} rows back in the table, e.g. to export them again</TooltipContent>
        </Tooltip>
      </RowActions>
    </div>
  );
}

function ReadRow({ e, onLoad, onRemove }: { e: Read; onLoad: () => void; onRemove: () => void }) {
  const r = e.row;
  const Icon = e.failed ? XCircle : r.warning ? AlertTriangle : CheckCircle2;
  return (
    <div className="group grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/40">
      <Tooltip>
        <TooltipTrigger asChild><Icon className={cn('size-4', e.failed ? 'text-destructive' : r.warning ? 'text-warning' : 'text-success')} /></TooltipTrigger>
        <TooltipContent className="max-w-xs">{r.warning || 'All values read.'}</TooltipContent>
      </Tooltip>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm">
          {e.source === 'mega' ? <Cloud className="size-3.5 shrink-0 text-muted-foreground" /> : <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate font-medium" title={r.video_name}>{r.video_name}</span>
        </p>
        <p className="truncate text-xs tabular-nums text-muted-foreground" title={e.folderPath}>
          {fmtTime(e.at)} · {e.failed ? 'could not be read' : `${r.date || '—'}  ${r.start_time || '—'} → ${r.end_time || '—'}  (${r.duration})`}{e.folderPath ? ` · ${e.folderPath.split('/').slice(-2).join(' / ')}` : ''}
        </p>
      </div>
      <RowActions onRemove={onRemove}>
        {!e.failed && <Button variant="ghost" size="sm" className="h-7" onClick={onLoad}><ListPlus /> Add</Button>}
      </RowActions>
    </div>
  );
}
