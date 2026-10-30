import { createContext, useContext, useEffect, useState } from 'react';

/** The app is laid out on a virtual canvas at least this big, then scaled uniformly to fill the window. */
export const DESIGN_W = 1440;
export const DESIGN_H = 880;
/** At or below this real width we use the phone layout at 1:1 instead. */
export const PHONE_W = 720;

export interface Stage {
  scale: number;
  /** virtual width / height the layout sees */
  w: number;
  h: number;
}

function measure(): Stage {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = vw <= PHONE_W ? 1 : Math.min(vw / DESIGN_W, vh / DESIGN_H);
  return { scale, w: vw / scale, h: vh / scale };
}

export function useStageSize(): Stage {
  const [stage, setStage] = useState(measure);
  useEffect(() => {
    const onResize = () => setStage(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return stage;
}

export const StageContext = createContext<Stage>({ scale: 1, w: DESIGN_W, h: DESIGN_H });
export const useStage = () => useContext(StageContext);
