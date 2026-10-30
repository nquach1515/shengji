/// <reference lib="webworker" />
// Runs bot search off the main thread so the host's animations stay smooth while bots think.
import { GameState } from './engine';
import { searchPlay, SEARCH_SAMPLES } from './search';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState; seat: number }>) => {
  const { id, state, seat } = e.data;
  let ids: string[] | null = null;
  try {
    ids = searchPlay(state, seat, SEARCH_SAMPLES, true);
  } catch {
    ids = null;
  }
  (self as unknown as Worker).postMessage({ id, ids });
};
