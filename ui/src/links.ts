// Public pages on the ocrXtrack website that the desktop app links to (also used on Google's OAuth consent screen).
// Change WEBSITE once the site has its final address.
export const WEBSITE = 'https://ocrxtrack.vercel.app';
export const PRIVACY_URL = `${WEBSITE}/privacy`;
export const TERMS_URL = `${WEBSITE}/terms`;
/** Page where people ask to be added as Google Drive testers (emails the owner). */
export const requestAccessUrl = (email?: string) => `${WEBSITE}/request-access?from=desktop${email ? `&email=${encodeURIComponent(email)}` : ''}`;
