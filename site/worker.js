// The game site on Cloudflare (shengji-tractor.com): serves the built app from dist/, and hands /room/* (the
// multiplayer WebSocket) to the relay Worker through a service binding. The page and its game connection then share
// one hostname, so a network that lets the page load lets the game connect too.
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/room/')) return env.RELAY.fetch(request);
    return env.ASSETS.fetch(request);
  },
};
