import { createContext, useContext, useEffect, useState } from 'react';

/** The app is laid out on a virtual canvas at least this big, then scaled uniformly to fill the window. */
export const DESIGN_W = 1440;
export const DESIGN_H = 880;
/** At or below this real width we use the phone layout at 1:1 instead. */
export const PHONE_W = 720;
/** Tall (portrait) screens wider than PHONE_W use the phone layout on a canvas about this size, scaled up. */
const TALL_MIN_W = 480;
const TALL_H = 860;

export interface Stage {
  scale: number;
  /** virtual width / height the layout sees */
  w: number;
  h: number;
}

function measure(): Stage {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // tall screens wider than a phone (iPad held upright): the phone layout, enlarged, on a canvas of at least
  // TALL_H — the wide layout shrunk to the width left tiny controls and a long thin table
  const scale =
    vw <= PHONE_W ? 1 : vh > vw * 1.1 ? Math.min(vw / TALL_MIN_W, vh / TALL_H) : Math.min(vw / DESIGN_W, vh / DESIGN_H);
  return { scale, w: vw / scale, h: vh / scale };
}

export function useStageSize(): Stage {
  const [stage, setStage] = useState(measure);
  useEffect(() => {
    const onResize = () => setStage(measure());
    // iOS Safari often changes the visible height (keyboard, toolbars) without a window resize event once they go
    // away again, which left the stage at a stale, shorter height: listen to the visual viewport too, and check
    // again shortly after the keyboard closes or the phone turns
    const later = () => setTimeout(onResize, 350);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', later);
    window.addEventListener('focusout', later);
    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', later);
      window.removeEventListener('focusout', later);
    };
  }, []);
  return stage;
}

export const StageContext = createContext<Stage>({ scale: 1, w: DESIGN_W, h: DESIGN_H });
export const useStage = () => useContext(StageContext);
