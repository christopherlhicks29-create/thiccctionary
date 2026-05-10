// POST /api/upload — accepts multipart image, stores in R2, returns public URL
// Requires Cloudflare Pages binding: SUBMISSIONS_BUCKET → R2 bucket (public access enabled)

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUBMISSIONS_BUCKET) {
    return new Response(JSON.stringify({
      error: 'R2 bucket not configured. Cloudflare Pages → Settings → Functions → Variables and Secrets → add SUBMISSIONS_BUCKET binding to your R2 bucket.'
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid multipart upload.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const file = formData.get('image');
  if (!file || typeof file === 'string') {
    return new Response(JSON.stringify({ error: 'No image file in upload.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Size limit: 10 MB
  if (file.size > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'Image too large (10 MB max).' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
  }

  // Type check: only images
  if (!file.type.startsWith('image/')) {
    return new Response(JSON.stringify({ error: 'Only image files accepted.' }), { status: 415, headers: { 'Content-Type': 'application/json' } });
  }

  // Generate a stable filename from current timestamp + random nonce + original extension
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
  const nonce = Math.random().toString(36).slice(2, 10);
  const key = `submissions/${timestamp}-${nonce}.${ext}`;

  try {
    await env.SUBMISSIONS_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: {
        originalName: file.name.slice(0, 100),
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Storage failed: ' + e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Return the public URL — assumes the R2 bucket has a public custom domain
  // configured. If not, falls back to the r2.dev path which works only if
  // public access is enabled on the bucket.
  const publicBase = env.SUBMISSIONS_PUBLIC_URL || 'https://thiccctionary-submissions.pages.dev';
  const url = `${publicBase}/${key}`;

  return new Response(JSON.stringify({ url, key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Block other methods
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'POST' } });
  }
  return onRequestPost(context);
}
