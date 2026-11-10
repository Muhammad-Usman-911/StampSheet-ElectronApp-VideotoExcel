import { memo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Cloud, Clock3, Folder, HardDrive, Loader2, PartyPopper, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Item, VideoRow } from './types';

const COLS = 'grid-cols-[44px_minmax(220px,2.2fr)_minmax(118px,1fr)_minmax(104px,0.9fr)_minmax(104px,0.9fr)_minmax(104px,0.9fr)_92px_44px]';

function StatusIcon({ item, onMarkChecked }: { item: Item; onMarkChecked: () => void }) {
  const warn = item.status === 'done' && !!item.row.warning;
  const key = item.status === 'done' ? (warn ? 'warn' : 'ok') : item.status;
  const secs = item.ms ? (item.ms / 1000).toFixed(1) : null;
  const icon = {
    queued: <Clock3 className="size-4 text-muted-foreground" />,
    reading: <Loader2 className="size-4 animate-spin text-primary" />,
    ok: <CheckCircle2 className="size-4 text-success" />,
    warn: <AlertTriangle className="size-4 text-warning" />,
  }[key];
  const tip = {
    queued: 'Waiting in line…',
    reading: 'Reading the camera clock…',
    ok: `All values read${secs ? ` in ${secs}s` : ''}.`,
    warn: item.row.warning,
  }[key];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={warn ? onMarkChecked : undefined}
          className={cn('grid size-8 place-items-center rounded-full transition-colors', warn && 'cursor-pointer hover:bg-warning-soft')}
          aria-label={tip}
        >
          {/* re-mounts when the state changes, so the new icon pops in (no exit step that could get stuck) */}
          <motion.span key={key} initial={{ scale: 0.4, opacity: 0, rotate: -30 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 28 }} className="grid place-items-center">
            {icon}
          </motion.span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p>{tip}</p>
        {warn && <p className="mt-1 opacity-70">Fix the values, then click to mark as checked.</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Small icon before the name: where the video is (computer / MEGA) and where its camera name came from. */
function SourceIcon({ item }: { item: Item }) {
  const mega = item.source === 'mega';
  const Icon = item.cameraFolder ? Folder : mega ? Cloud : HardDrive;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', item.cameraFolder ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
          <Icon className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-sm">
        <p className="font-medium">{mega ? 'Video on MEGA (read online, not downloaded)' : 'Video on this computer'}</p>
        <p className="mt-1 opacity-80">{item.cameraFolder ? <>Camera name taken from folder “{item.cameraFolder}”.</> : 'No camera folder found: the default camera name was used.'}</p>
        {item.folderPath && <p className="mt-1 break-all opacity-60">{item.folderPath}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function Cell({ value, onChange, placeholder, missing, disabled, mono = true }: { value: string; onChange: (v: string) => void; placeholder?: string; missing?: boolean; disabled?: boolean; mono?: boolean }) {
  return (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-all',
        mono && 'tabular-nums',
        'hover:border-input focus:border-ring focus:bg-card focus:ring-3 focus:ring-ring/20',
        'placeholder:text-muted-foreground/50 disabled:cursor-default',
        missing && 'border-dashed border-warning/70 bg-warning-soft/60',
      )}
    />
  );
}

function Shimmer() {
  return <div className="mx-2 h-3 overflow-hidden rounded bg-muted"><div className="h-full w-1/2 animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/10 to-transparent" /></div>;
}

const Row = memo(function Row({ item, index, onChange, onRemove }: { item: Item; index: number; onChange: (id: string, patch: Partial<VideoRow>) => void; onRemove: (id: string) => void }) {
  const busy = item.status !== 'done';
  const warn = !busy && !!item.row.warning;
  const set = (k: keyof VideoRow) => (v: string) => onChange(item.id, { [k]: v });
  const field = (k: 'date' | 'start_time' | 'end_time' | 'duration', ph: string) =>
    busy ? <Shimmer /> : <Cell value={item.row[k]} onChange={set(k)} placeholder={ph} missing={warn && !item.row[k]} />;
  const useful = item.row.usefulness !== 'No';
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, delay: Math.min(index, 12) * 0.025 }}
      className={cn('group grid items-center gap-1 border-b px-2 py-1.5 transition-colors last:border-b-0', COLS, warn ? 'bg-warning-soft/40 hover:bg-warning-soft/70' : 'hover:bg-muted/50')}
    >
      <div className="grid place-items-center"><StatusIcon item={item} onMarkChecked={() => onChange(item.id, { warning: '' })} /></div>
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <SourceIcon item={item} />
          <Cell value={item.row.video_name} onChange={set('video_name')} mono={false} />
        </div>
        <AnimatePresence initial={false}>
          {warn && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="truncate pr-2 pl-9 text-xs text-warning" title={item.row.warning}>
              {item.row.warning}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {field('date', 'YYYY-MM-DD')}
      {field('start_time', 'HH:MM:SS')}
      {field('end_time', 'HH:MM:SS')}
      {field('duration', 'HH:MM:SS')}
      <div className="px-1">
        <button
          type="button"
          onClick={() => onChange(item.id, { usefulness: useful ? 'No' : 'Yes' })}
          className={cn('relative h-7 w-[72px] rounded-full text-xs font-medium transition-colors', useful ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground')}
          title="Click to switch Yes / No"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={useful ? 'y' : 'n'} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="inline-block">
              {useful ? 'Yes' : 'No'}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
      <div className="grid place-items-center">
        <button type="button" onClick={() => onRemove(item.id)} className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100" aria-label="Remove row">
          <Trash2 className="size-4" />
        </button>
      </div>
    </motion.div>
  );
});

export function VideoTable({ items, onChange, onRemove, emptyText }: { items: Item[]; onChange: (id: string, patch: Partial<VideoRow>) => void; onRemove: (id: string) => void; emptyText: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className={cn('grid shrink-0 gap-1 border-b bg-muted/60 px-2 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground', COLS)}>
        <span />
        <span className="px-2">Video name</span>
        <span className="px-2">Date</span>
        <span className="px-2">Start time</span>
        <span className="px-2">End time</span>
        <span className="px-2">Duration</span>
        <span className="px-2">Useful</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <AnimatePresence initial={false}>
          {items.map((it, i) => <Row key={it.id} item={it} index={i} onChange={onChange} onRemove={onRemove} />)}
        </AnimatePresence>
        {!items.length && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
            <PartyPopper className="size-6 text-success" />
            {emptyText}
          </motion.div>
        )}
      </div>
    </div>
  );
}
