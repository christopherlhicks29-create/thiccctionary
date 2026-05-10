/**
 * Admin auth middleware.
 *
 * Checks Cloudflare Access has authenticated the request by looking for
 * the Cf-Access-Authenticated-User-Email header (Cloudflare sets this
 * automatically when CF Access is configured and a user passes through).
 *
 * If absent, returns 401 with setup instructions. This means /admin/*
 * endpoints are inert until Christopher sets up CF Access.
 *
 * Allowed email is hardcoded — single-user admin.
 */

const ALLOWED_EMAILS = [
  'chicks@thiccctionary.com',
  'admin@thiccctionary.com',
];

function isAllowed(email) {
  if (!email) return false;
  return ALLOWED_EMAILS.some(a => a.toLowerCase() === email.toLowerCase());
}

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');

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
