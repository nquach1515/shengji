/*
 * Display options: four-colour suits, large card indexes, page background, table and card-back colours. Saved on this
 * device and applied as data attributes on <html> (styles.css does the rest), so they never touch the game itself.
 */
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type Felt = 'red' | 'green' | 'blue' | 'charcoal' | 'rainbow';
export type Back = 'red' | 'blue' | 'green' | 'black' | 'rainbow';
export type Background = 'cherry' | 'midnight' | 'forest' | 'graphite' | 'plum';

/** each background's darkest colour, for the phone's browser bar */
const BAR_COLOUR: Record<Background, string> = {
  cherry: '#120507',
  midnight: '#03060d',
  forest: '#020805',
  graphite: '#050506',
  plum: '#07030a',
};

export interface Display {
  /** ♦ blue and ♣ green, so no two suits share a colour */
  fourColour: boolean;
  /** jumbo index: a big rank and suit in the corners and one large suit symbol in the middle */
  bigCorners: boolean;
  felt: Felt;
  back: Back;
  background: Background;
}

const KEY = 'sj-display';
const DEFAULTS: Display = { fourColour: false, bigCorners: false, felt: 'red', back: 'red', background: 'cherry' };

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
  el.bg = d.background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOUR[d.background] ?? BAR_COLOUR.cherry);
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
      {children}
    </DisplayContext.Provider>
  );
}

export const useDisplay = () => useContext(DisplayContext);
