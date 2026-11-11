/*
 * Every update from the host is a brand-new PlayerView (rebuilt locally, or parsed from JSON online), so even parts
 * that didn't change are new objects and React can't tell them apart. shareEqual() keeps the previous object for every
 * part that is deeply equal, at any depth, so an unchanged part keeps its identity and components can skip it.
 */
import { useRef } from 'react';
import { PlayerView } from '../net/protocol';

/** `next`, with every part that is deeply equal to the same part of `prev` replaced by prev's (structural sharing). */
export function shareEqual<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const p = prev as unknown as unknown[];
    let same = p.length === next.length;
    const out = next.map((v, i) => {
      const s = i < p.length ? shareEqual(p[i], v) : v;
      if (s !== p[i]) same = false;
      return s;
    });
    return (same ? prev : out) as T;
  }
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const s = k in p ? shareEqual(p[k], n[k]) : n[k];
    if (s !== p[k]) same = false;
    out[k] = s;
  }
  return (same ? prev : out) as T;
}

/** The view, with unchanged parts keeping their identity from one update to the next. */
export function useSharedView(view: PlayerView): PlayerView {
  const prev = useRef<PlayerView | null>(null);
  const shared = prev.current ? shareEqual(prev.current, view) : view;
  prev.current = shared;
  return shared;
}

type ViewProps = { view: PlayerView };

/**
 * A React.memo comparator for a component that takes `view`: it re-renders only when one of `keys` of the view
 * changed (by identity, so use with useSharedView), when `extra` picks a different value, or when any other prop
 * changed. `keys` must list every view field the component (and anything it passes `view` to) reads.
 */
export function viewProps<P extends ViewProps>(keys: (keyof PlayerView)[], extra?: (v: PlayerView) => unknown[]) {
  return (a: P, b: P): boolean => {
    for (const k of Object.keys(b) as (keyof P)[]) if (k !== 'view' && a[k] !== b[k]) return false;
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const k of keys) if (a.view[k] !== b.view[k]) return false;
    if (extra) {
      const x = extra(a.view);
      const y = extra(b.view);
      for (let i = 0; i < y.length; i++) if (x[i] !== y[i]) return false;
    }
    return true;
  };
}

/** Seat names and status, without card counts (which change with every card dealt). */
export const seatNames = (v: PlayerView) => [v.seats.map((s) => (s ? `${s.name}|${s.isBot}|${s.isHost}|${s.online}` : '')).join(',')];
