import { readFileSync } from 'node:fs';
import type { CapacitorConfig } from '@capacitor/cli';

// Native app level: updates from the site that need a newer level are skipped (see src/net/appUpdate.ts).
const nativeLevel = JSON.parse(readFileSync('package.json', 'utf8')).iosNativeLevel as number;

// iOS app wrapper: the web build (dist/) is bundled into the app. See ios/ for the Xcode project.
const config: CapacitorConfig = {
  appId: 'com.shengjitractor.app',
  appName: 'Shengji',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#120507',
  },
  plugins: {
    // manual mode: the app checks shengji-tractor.com/app/version.json itself and switches only at launch
    // statsUrl '' keeps the plugin from reporting to Capgo's servers (we don't use their service)
    CapacitorUpdater: { autoUpdate: false, version: String(nativeLevel), statsUrl: '', updateUrl: '', channelUrl: '' },
  },
};

export default config;
