// The game site on Cloudflare (shengji-tractor.com): serves the built app from dist/, and hands /room/* (the
// multiplayer WebSocket) to the relay Worker through a service binding. The page and its game connection then share
// one hostname, so a network that lets the page load lets the game connect too.
// iOS Universal Links: lets the Shengji app (team SW836UR33S) open invite links (/?room=CODE) when it's installed;
// without the app they open the site as usual. iOS reads this when the app is installed or updated.
const APPLE_APP_SITE_ASSOCIATION = JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: ['SW836UR33S.com.shengjitractor.app'],
        components: [{ '/': '/', '?': { room: '????' }, comment: 'invite links' }],
      },
    ],
  },
});

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/.well-known/apple-app-site-association' || path === '/apple-app-site-association') {
      return new Response(APPLE_APP_SITE_ASSOCIATION, { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/room/')) return env.RELAY.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
