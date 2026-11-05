/*
 * Display options: four-colour suits, large card corners, table and card-back colours, reduced motion. Saved on this
 * device and applied as data attributes on <html> (styles.css does the rest), so they never touch the game itself.
 */
import { MotionConfig } from 'framer-motion';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type Felt = 'red' | 'green' | 'blue' | 'charcoal';
export type Back = 'red' | 'blue' | 'green' | 'black';

export interface Display {
  /** ♦ blue and ♣ green, so no two suits share a colour */
  fourColour: boolean;
  bigCorners: boolean;
  felt: Felt;
  back: Back;
  reduceMotion: boolean;
}

const KEY = 'sj-display';
const DEFAULTS: Display = { fourColour: false, bigCorners: false, felt: 'red', back: 'red', reduceMotion: false };

function load(): Display {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

function apply(d: Display) {
  const el = document.documentElement.dataset;
  el.suits = d.fourColour ? '4' : '2';
  el.corners = d.bigCorners ? 'large' : 'normal';
  el.felt = d.felt;
  el.back = d.back;
  el.motion = d.reduceMotion ? 'reduced' : 'full';
}

// applied before the first render, so the page never shows the default colours first
apply(load());

const DisplayContext = createContext<{ display: Display; set: (patch: Partial<Display>) => void }>({
  display: DEFAULTS,
  set: () => {},
});

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [display, setDisplay] = useState(load);
  useEffect(() => {
    apply(display);
    try {
      localStorage.setItem(KEY, JSON.stringify(display));
    } catch {
      /* private mode: the choice lasts until the page closes */
    }
  }, [display]);
  return (
    <DisplayContext.Provider value={{ display, set: (patch) => setDisplay((d) => ({ ...d, ...patch })) }}>
      {/* "always": no movement or scaling, fades only; otherwise follow the device's own reduce-motion setting */}
      <MotionConfig reducedMotion={display.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>
    </DisplayContext.Provider>
  );
}

export const useDisplay = () => useContext(DisplayContext);
