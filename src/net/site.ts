/** The public site, and whether we're running inside the iOS app (served from capacitor://localhost, not the site). */
export const SITE_DOMAIN = 'shengji-tractor.com';
export const IN_APP = typeof location !== 'undefined' && location.protocol === 'capacitor:';

/** Link friends can open to join a table: the real site when in the app, else wherever this page is hosted. */
export function inviteLink(code: string): string {
  const base = IN_APP ? `https://${SITE_DOMAIN}/` : `${location.origin}${location.pathname}`;
  return `${base}?room=${code}`;
}
