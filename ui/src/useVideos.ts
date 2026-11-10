import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, Item, Settings, VideoRow } from './types';

export const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'mov', 'ts', 'dav', 'wmv', 'flv', 'm4v'];

/** The camera part of video_name for one video: from its folder (if switched on and found), else the default. */
export function cameraFor(e: Pick<Entry, 'camera'>, s: Settings) {
  return (s.useFolderCamera && e.camera) || s.camera.trim() || 'Camera 1';
}

let nextId = 0;

/**
 * Holds the list of videos and talks to the main process.
 * All files are sent at once; the main process reads several of them in parallel
 * and tells us (onStarted) when each one actually begins.
 */
export function useVideos() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // finished results by id, also for rows that were removed while being read (so "Undo" can restore them complete)
  const results = useRef(new Map<string, Pick<Item, 'row' | 'ms'>>());

  useEffect(() => window.api.onStarted((file) => {
    setItems((prev) => prev.map((i) => (i.row.path === file && i.status === 'queued' ? { ...i, status: 'reading', startedAt: Date.now() } : i)));
  }), []);

  /** Adds videos found by the main process and starts reading them. Videos already in the list are skipped. */
  const addEntries = useCallback((entries: Entry[], settings: Settings) => {
    const known = new Set(itemsRef.current.map((i) => i.row.path));
    const fresh = entries.filter((e) => !known.has(e.id) && (known.add(e.id), true));
    const added: Item[] = fresh.map((e) => {
      const fromFolder = settings.useFolderCamera && !!e.camera;
      return {
        id: String(++nextId),
        status: 'queued',
        fileName: e.name,
        source: e.source,
        cameraFolder: fromFolder ? e.cameraFolder : null,
        folderPath: e.folderPath,
        row: { path: e.id, video_name: `${cameraFor(e, settings)}_${e.name}`, date: '', start_time: '', end_time: '', duration: '', usefulness: 'Yes', warning: '' },
      };
    });
    if (!added.length) return { added: 0, skipped: entries.length, fromFolder: 0 };
    setItems((prev) => [...prev, ...added]);
    for (const item of added) {
      const t0 = Date.now();
      const camera = item.row.video_name.slice(0, -(item.fileName.length + 1));
      window.api.analyse(item.row.path, { ...settings, camera, name: item.fileName, folderPath: item.folderPath }).then((res) => {
        // keep any name the user typed while the video was being read
        const current = itemsRef.current.find((i) => i.id === item.id)?.row.video_name;
        const base: VideoRow = res.ok ? res.row : { ...item.row, warning: res.error };
        const row: VideoRow = current ? { ...base, video_name: current } : base;
        const done = { row, ms: Date.now() - t0 };
        results.current.set(item.id, done);
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'done', row, ms: done.ms } : i)));
      });
    }
    return { added: added.length, skipped: entries.length - added.length, fromFolder: added.filter((i) => i.cameraFolder).length };
  }, []);

  /** Puts finished rows back in the list (e.g. from History) without reading the videos again. */
  const addDone = useCallback((rows: (VideoRow & { folderPath?: string })[]) => {
    const known = new Set(itemsRef.current.map((i) => i.row.path));
    const fresh = rows.filter((r) => !known.has(r.path) && (known.add(r.path), true));
    const added: Item[] = fresh.map(({ folderPath = '', ...row }) => ({
      id: String(++nextId),
      status: 'done',
      fileName: row.video_name.replace(/^.*?_/, ''),
      source: row.path.startsWith('mega:') ? 'mega' : 'local',
      cameraFolder: null,
      folderPath,
      row: { ...row },
    }));
    if (added.length) setItems((prev) => [...prev, ...added]);
    return { added: added.length, skipped: rows.length - added.length };
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<VideoRow>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, row: { ...i.row, ...patch } } : i)));
  }, []);

  const remove = useCallback((ids: string[]) => {
    const removed = itemsRef.current.map((it, index) => ({ it, index })).filter(({ it }) => ids.includes(it.id));
    setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    return removed;
  }, []);

  /** Puts removed rows back where they were, with any result that arrived in the meantime. */
  const restore = useCallback((removed: { it: Item; index: number }[]) => {
    setItems((prev) => {
      const next = [...prev];
      for (const { it, index } of removed) {
        const r = it.status !== 'done' ? results.current.get(it.id) : undefined;
        next.splice(Math.min(index, next.length), 0, r ? { ...it, status: 'done', row: r.row, ms: r.ms } : it);
      }
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === 'done');
    return {
      total: items.length,
      done: done.length,
      reading: items.filter((i) => i.status === 'reading').length,
      pending: items.length - done.length,
      needsCheck: done.filter((i) => i.row.warning).length,
    };
  }, [items]);

  return { items, stats, addEntries, addDone, updateRow, remove, restore };
}
