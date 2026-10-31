/// <reference lib="webworker" />
// Runs bot search off the main thread so the host's animations stay smooth while bots think.
// Both modes only ever receive a redacted state (other hands and the face-down kitty blanked out).
import { GameState } from './engine';
import { learnedPlay } from './policy';
import { HINT_SAMPLES, searchPlay, SEARCH_SAMPLES } from './search';

type Request = { id: number; state: GameState; seat: number; mode: 'bot' | 'hint' };

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, state, seat, mode } = e.data;
  let ids: string[] | null = null;
  try {
    if (mode === 'hint') {
      // Best available move: the trained model proposes, then a deep search checks it against every alternative.
      ids = searchPlay(state, seat, HINT_SAMPLES, false, learnedPlay(state, seat));
    } else {
      ids = searchPlay(state, seat, SEARCH_SAMPLES, true);
    }
  } catch {
    ids = null;
  }
  (self as unknown as Worker).postMessage({ id, ids });
};
