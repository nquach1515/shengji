import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Version info shown on the home screen: package version, commit, and build date.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = pkg.version as string;
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

const BUILD_ID = `${version}-${commit()}-${Date.now().toString(36)}`;

/**
 * iOS app self-update (src/net/appUpdate.ts): after each build, zip the game into dist/app/ and write
 * dist/app/version.json, so deploying the site also publishes the update. iosNativeLevel in package.json is the native
 * app level this build needs; bump it (and ship an App Store update) when native code or plugins change.
 */
function appUpdateBundle(): Plugin {
  return {
    name: 'app-update-bundle',
    apply: 'build',
    closeBundle() {
      const dist = new URL('./dist/', import.meta.url).pathname;
      const zip = `app/bundle-${BUILD_ID}.zip`;
      mkdirSync(`${dist}app`, { recursive: true });
      execSync(`zip -qr ${zip} . -x 'app/*'`, { cwd: dist });
      const sha256 = createHash('sha256').update(readFileSync(dist + zip)).digest('hex'); // the app verifies the download
      writeFileSync(`${dist}app/version.json`, JSON.stringify({ id: BUILD_ID, native: pkg.iosNativeLevel, zip, sha256 }));
    },
  };
}

// Relative base so the build works on GitHub Pages (/repo-name/) or any static host.
export default defineConfig({
  base: './',
  plugins: [react(), appUpdateBundle()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_SHA__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
});
