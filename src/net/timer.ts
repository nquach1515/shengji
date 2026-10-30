/**
 * setTimeout that keeps running at full speed when the host's tab is in the background.
 * Browsers throttle main-thread timers in hidden tabs (to ~1/s, or worse); dedicated worker timers aren't.
 */
type Cancel = () => void;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    const src = 'onmessage=e=>{const{id,ms}=e.data;setTimeout(()=>postMessage(id),ms)}';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = (e: MessageEvent<number>) => {
      const fn = pending.get(e.data);
      pending.delete(e.data);
      fn?.();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function reliableTimeout(fn: () => void, ms: number): Cancel {
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }
  const id = ++seq;
  pending.set(id, fn);
  w.postMessage({ id, ms });
  return () => pending.delete(id);
}
