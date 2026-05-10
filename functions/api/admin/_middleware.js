/**
 * Admin auth middleware.
 *
 * Reads the email from the CF_Authorization JWT cookie directly,
 * since the Cf-Access-Authenticated-User-Email header is only injected
 * when CF Access and the zone are in the same Cloudflare account.
 *
 * Falls back to the header if present (future-proof).
 */

const ALLOWED_EMAILS = [
    'chicks@thiccctionary.com',
    'admin@thiccctionary.com',
    'christopher.l.hicks29@gmail.com',
  ];

const CF_ACCESS_TEAMS = [
    'thiccctionary',
    'thiccctionary-admin',
  ];

function getEmailFromJwt(token) {
    try {
          const payload = token.split('.')[1];
          const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          // Verify issuer is a known CF Access team
      const iss = decoded.iss || '';
          const validIss = CF_ACCESS_TEAMS.some(t => iss === `https://${t}.cloudflareaccess.com`);
          if (!validIss) return null;
          return decoded.email || null;
    } catch {
          return null;
    }
}

function getEmail(request) {
    // Prefer the server-injected header (works when zone + Access are same account)
  const headerEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
    if (headerEmail) return headerEmail;

  // Fall back to reading the JWT cookie directly
  const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
    if (match) return getEmailFromJwt(match[1]);

  return null;
}

function isAllowed(email) {
    if (!email) return false;
    return ALLOWED_EMAILS.some(a => a.toLowerCase() === email.toLowerCase());
}

export async function onRequest({ request, next }) {
    const url = new URL(request.url);
    const email = getEmail(request);

  if (!email) {
        return new Response(JSON.stringify({
                error: 'unauthorized',
                reason: 'Cloudflare Access is not configured for /admin/. Visit https://dash.cloudflare.com → Zero Trust → Access → Applications → Add → Self-hosted, application name "Thiccctionary Admin", domain "thiccctionary.com", path "/admin/*". Add policy allowing emails: ' + ALLOWED_EMAILS.join(', ') + '.',
                requestedPath: url.pathname,
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (!isAllowed(email)) {
        return new Response(JSON.stringify({
                error: 'forbidden',
                reason: `Access restricted to: ${ALLOWED_EMAILS.join(', ')}. You are authenticated as ${email}.`,
        }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  return await next();
}
