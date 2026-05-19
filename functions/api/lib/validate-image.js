/**
 * Wave 181: shared image validation for /api/submit and /api/upload.
 *
 * Defense in depth against:
 *   - Non-image files masquerading as image/* via faked Content-Type
 *   - Files larger than the policy limit
 *   - File extensions outside the allowed set
 *
 * Strategy:
 *   1. Allowlist MIME types (no wildcards)
 *   2. Allowlist extensions
 *   3. Magic-number check on first bytes (the file IS actually a JPEG/PNG/WebP/GIF)
 *
 * Returns { ok: true, ext: 'jpg'|'png'|'webp'|'gif' } or { ok: false, error: string, status: number }.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// Magic-number signatures. First few bytes of each format.
// JPEG: FF D8 FF
// PNG: 89 50 4E 47 0D 0A 1A 0A
// WebP: 'RIFF'....'WEBP'  (bytes 0-3 'RIFF', 8-11 'WEBP')
// GIF: 'GIF87a' or 'GIF89a'
function detectFromMagic(bytes) {
  if (!bytes || bytes.length < 12) return null;
  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
  // WebP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
  return null;
}

export async function validateImageFile(file) {
  // Basic shape check
  if (!file || typeof file === 'string') {
    return { ok: false, error: 'No image file in upload.', status: 400 };
  }
  if (typeof file.size !== 'number') {
    return { ok: false, error: 'Malformed upload (no size).', status: 400 };
  }

  // Size
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'Image too large (10 MB max).', status: 413 };
  }
  if (file.size < 100) {
    return { ok: false, error: 'Image too small to be valid.', status: 400 };
  }

  // Allowlisted MIME (no wildcard, no bare image/svg+xml or image/heic since
  // those break our pipeline or carry abuse risk).
  const mime = String(file.type || '').toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return { ok: false, error: `Unsupported image type: ${mime}. Allowed: JPEG, PNG, WebP, GIF.`, status: 415 };
  }

  // Extension check
  const ext = (file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (!ALLOWED_EXTS.has(ext)) {
    return { ok: false, error: `Unsupported file extension: .${ext}. Allowed: .jpg, .jpeg, .png, .webp, .gif.`, status: 415 };
  }

  // Magic-number sanity check. Read first 16 bytes only.
  // Even if attacker faked Content-Type + extension, file content must START with one of our signatures.
  let firstChunk;
  try {
    const blob = await file.slice(0, 16).arrayBuffer();
    firstChunk = new Uint8Array(blob);
  } catch (e) {
    return { ok: false, error: 'Could not read file contents.', status: 400 };
  }
  const detected = detectFromMagic(firstChunk);
  if (!detected) {
    return { ok: false, error: 'File contents do not match a supported image format. Magic-number check failed.', status: 415 };
  }

  // Cross-check: detected format should match declared MIME family
  // (don't be too strict - e.g. accept 'image/jpeg' for both 'jpg' and 'jpeg' detected)
  const detectedFamily = detected === 'jpg' ? 'jpeg' : detected;
  if (!mime.endsWith('/' + detectedFamily)) {
    return { ok: false, error: `MIME (${mime}) and file contents (${detected}) disagree.`, status: 415 };
  }

  return { ok: true, ext: detected, mime };
}
