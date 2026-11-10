// The game site on Cloudflare (shengji-tractor.com): serves the built app from dist/, and hands /room/* (the
// multiplayer WebSocket) to the relay Worker through a service binding. The page and its game connection then share
// one hostname, so a network that lets the page load lets the game connect too.
// iOS Universal Links: lets the Shengji app (team SW836UR33S) open invite links (/join/CODE) and the main page when it's installed;
// without the app they open the site as usual. iOS reads this when the app is installed or updated.
const APPLE_APP_SITE_ASSOCIATION = JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: ['SW836UR33S.com.shengjitractor.app'],
        components: [
          // always the website: policy pages and the app's own update files
          { '/': '/privacy*', exclude: true },
          { '/': '/support*', exclude: true },
          { '/': '/app/*', exclude: true },
          { '/': '/join/????', comment: 'invite links' },
          { '/': '/', comment: 'the main page (and older /?room=CODE invite links)' },
        ],
      },
    ],
  },
});

/** Invite links (/join/CODE redirects to /?room=CODE): the preview says whose table it is, not just the game's name. */
function invitePreview(response, code) {
  const set = (content) => ({ element: (e) => e.setAttribute('content', content) });
  const title = `Join my Shengji table · ${code}`;
  const text = 'Tap to take a seat — play in your browser or the Shengji app. The classic Chinese partnership card game.';
  return new HTMLRewriter()
    .on('meta[property="og:title"]', set(title))
    .on('meta[name="description"]', set(text))
    .on('meta[property="og:description"]', set(text))
    .on('meta[property="og:url"]', set(`https://shengji-tractor.com/join/${code}`))
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/.well-known/apple-app-site-association' || path === '/apple-app-site-association') {
      return new Response(APPLE_APP_SITE_ASSOCIATION, { headers: { 'content-type': 'application/json' } });
    }
    if (path.startsWith('/room/')) return env.RELAY.fetch(request);
    // invite links: /join/CODE opens the app when it's installed (above); otherwise the site's invite screen
    const join = /^\/join\/([a-z]{4})\/?$/i.exec(path);
    if (join) return Response.redirect(new URL(`/?room=${join[1].toUpperCase()}`, request.url).href, 302);
    const room = url.searchParams.get('room');
    if ((path === '/' || path === '/index.html') && room && /^[a-z]{4}$/i.test(room)) {
      return invitePreview(await env.ASSETS.fetch(request), room.toUpperCase());
    }
    return env.ASSETS.fetch(request);
  },
};
