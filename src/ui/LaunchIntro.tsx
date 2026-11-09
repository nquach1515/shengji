/*
 * iOS app launch: the native launch screen shows public/launch-logo.png (the home screen's card fan and 升级) centered
 * on a flat background, and a native cover keeps it up until we draw the identical picture here. Then the native cover
 * goes, and the picture glides and shrinks into the home screen's own logo while the rest of the page fades in.
 *
 * public/launch-logo.png, launchLogo.json and the iOS LaunchLogo asset are made together by
 * scripts/ios/launch-logo.mjs from the phone home screen; logoRect() below is the box both sides agree on.
 */
import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';
import size from './launchLogo.json';

/** Flat launch-screen color (ios/App/App/Base.lproj/LaunchScreen.storyboard, capacitor.config.ts backgroundColor). */
export const LAUNCH_BG = '#120507';
/** Space around the art in the captured picture, so shadows aren't cut off; more below, where the brush strokes and
 *  the title's shadow hang past its line box. */
export const LOGO_PAD = 16;
export const LOGO_PAD_BOTTOM = 34;

/** The home screen logo's box in the viewport: the fanned cards and the 升级 title's element box, plus padding. (The
 *  element box, fixed by CSS, rather than the glyphs' box, which iOS and desktop WebKit measure differently.) */
export function logoRect(): { left: number; top: number; width: number; height: number } | null {
  const cards = [...document.querySelectorAll('.logo-fan > div')];
  const zh = document.querySelector('.wordmark .zh');
  if (!cards.length || !zh) return null;
  // width from the cards (the title sits within them; its element is as wide as the line below it)
  const cs = cards.map((c) => c.getBoundingClientRect());
  const z = zh.getBoundingClientRect();
  const left = Math.min(...cs.map((r) => r.left)) - LOGO_PAD;
  const right = Math.max(...cs.map((r) => r.right)) + LOGO_PAD;
  const top = Math.min(z.top, ...cs.map((r) => r.top)) - LOGO_PAD;
  const bottom = Math.max(z.bottom, ...cs.map((r) => r.bottom)) + LOGO_PAD_BOTTOM;
  return { left, top, width: right - left, height: bottom - top };
}

async function hideNativeCover() {
  try {
    const { registerPlugin } = await import('@capacitor/core');
    await registerPlugin<{ hide(): Promise<void> }>('LaunchCover').hide();
  } catch {
    /* an app build without the cover: nothing to hide */
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function LaunchIntro({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const back = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const el = img.current!;
      await el.decode().catch(() => {});
      await frame();
      await frame(); // our copy is on screen under the native cover
      await hideNativeCover();
      if (cancelled) return;
      await document.fonts.ready; // the title's box depends on its font
      await wait(120);
      const to = logoRect();
      const from = el.getBoundingClientRect();
      // the picture is the phone home screen's logo; elsewhere (iPad: the larger layout's title) the shapes differ
      const sameShape = to && Math.abs(to.width / to.height / (from.width / from.height) - 1) < 0.02;
      if (!to || !sameShape) {
        // no matching logo on this screen (an invite link, an iPad): fade instead of moving
        onReveal();
        await animate(back.current!, { opacity: 0 }, { duration: 0.4 });
        onDone();
        return;
      }
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const ease = [0.65, 0, 0.35, 1] as const;
      await Promise.all([
        animate(el, { x: dx, y: dy, scaleX: to.width / from.width, scaleY: to.height / from.height }, { duration: 0.65, ease }),
        animate(back.current!, { backgroundColor: 'rgba(18, 5, 7, 0)' }, { duration: 0.6, ease: 'easeOut' }),
      ]);
      onReveal(); // the real logo is now exactly under the picture
      await animate(el, { opacity: 0 }, { duration: 0.15 });
      onDone();
    })();
    return () => {
      cancelled = true;
    };
    // run once, on the first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={back} className="launch-intro" style={{ backgroundColor: LAUNCH_BG }}>
      <img
        ref={img}
        src="./launch-logo.png"
        alt=""
        style={{ width: size.width, height: size.height, marginLeft: -size.width / 2, marginTop: -size.height / 2 }}
      />
    </div>
  );
}
