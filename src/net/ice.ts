/*
 * ICE servers for WebRTC. Direct connections use STUN. Two cases need a TURN relay: strict NATs, and — confirmed
 * by players — devices on the *same* Wi-Fi as the host (routers that can't hairpin, or can't resolve browsers'
 * mDNS local-address aliases). PeerJS's built-in free relays don't currently work, so a relay is only used if
 * one is configured below.
 *
 * To enable one (free tier): create an app at https://www.metered.ca/stun-turn, then set METERED_APP to its name
 * (the part before .metered.live) and METERED_API_KEY to its API key. The key is meant for client-side use.
 */
const METERED_APP = '';
const METERED_API_KEY = '';

const STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let cached: Promise<RTCIceServer[]> | null = null;

export function iceServers(): Promise<RTCIceServer[]> {
  if (!cached) {
    cached = (async () => {
      if (!METERED_APP || !METERED_API_KEY) return STUN;
      try {
        const res = await fetch(`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`);
        const turn = (await res.json()) as RTCIceServer[];
        return [...STUN, ...turn];
      } catch {
        return STUN;
      }
    })();
  }
  return cached;
}

export const relayConfigured = () => !!(METERED_APP && METERED_API_KEY);
