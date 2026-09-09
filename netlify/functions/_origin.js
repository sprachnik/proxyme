// Shared origin guard for the /api/* functions.
//
// The endpoints are unauthenticated and /api/vessels spends the site's single
// AISStream connection, so a page on someone else's domain must not be able to
// point a browser at them. Same-origin fetches send no Origin header at all —
// the normal path for both builds — so only a *foreign* browser origin is
// rejected. curl sends no Origin either: this is a speed bump against
// hotlinking, not authentication.
//
// Allowed origins come from the environment, never a hardcoded site name.
// Netlify injects URL (canonical) and DEPLOY_PRIME_URL (branch/preview);
// ALLOWED_ORIGINS is an optional comma-separated list for anything else.
const originOf = (u) => {
  try { return new URL(u.trim()).origin; } catch { return null; }
};

const allowlist = () => {
  const raw = [process.env.URL, process.env.DEPLOY_PRIME_URL,
    ...(process.env.ALLOWED_ORIGINS || '').split(',')];
  return new Set(raw.filter(Boolean).map(originOf).filter(Boolean));
};

// true = reject. Absent header (same-origin fetch, netlify dev) always passes.
export const badOrigin = (req) => {
  const o = req.headers.get('origin');
  if (!o) return false;
  if (o === 'null') return true; // sandboxed iframe / file://
  const ok = allowlist();
  if (!ok.size) return false; // unconfigured, e.g. bare local dev — don't lock out
  return !ok.has(o);
};

export const forbidden = () =>
  new Response(JSON.stringify({ error: 'origin not allowed' }), {
    status: 403,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
