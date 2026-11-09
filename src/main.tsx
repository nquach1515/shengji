import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IN_APP } from './net/site';
import { App } from './ui/App';
import './ui/fonts.css';
import './ui/styles.css';

// In the iOS app the screen is fixed like a native game: no pinch, double-tap or focus zoom. (The website keeps
// pinch zoom; Safari ignores this setting anyway.)
if (IN_APP) {
  document
    .querySelector('meta[name=viewport]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (IN_APP) {
  // self-update (src/net/appUpdate.ts); the website never loads this module
  import('./net/appUpdate')
    .then(async (u) => {
      await u.applyPendingUpdate(); // reloads into a downloaded update, if there is one
      // opened by an invite link: start on that invite (src/net/appLinks.ts)
      await import('./net/appLinks').then((l) => l.applyLaunchLink()).catch(() => {});
      render();
      void u.checkForUpdate();
      // sounds through the native player (src/ui/nativeSound.ts)
      void import('./ui/nativeSound').then((m) => m.setupNativeSound());
    })
    .catch(() => {
      render();
      void import('./ui/nativeSound').then((m) => m.setupNativeSound());
    });
} else {
  render();
}
