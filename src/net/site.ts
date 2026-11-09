/** The public site, and whether we're running inside the iOS app (served from capacitor://localhost, not the site). */
export const SITE_DOMAIN = 'shengji-tractor.com';
export const IN_APP = typeof location !== 'undefined' && location.protocol === 'capacitor:';

/** Link friends can open to join a table: the real site when in the app, else wherever this page is hosted. */
export function inviteLink(code: string): string {
  // on our own domain (and from the app) /join/CODE: it opens the iOS app when installed, else the site redirects to
  // /?room=CODE; elsewhere (e.g. the GitHub Pages copy) only the query form works
  const ours = IN_APP || location.hostname === SITE_DOMAIN || location.hostname.endsWith(`.${SITE_DOMAIN}`);
  if (ours) return `https://${IN_APP ? SITE_DOMAIN : location.host}/join/${code}`;
  return `${location.origin}${location.pathname}?room=${code}`;
}
