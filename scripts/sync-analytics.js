#!/usr/bin/env node
/**
 * sync-analytics.js - Wave 322
 *
 * Three hundred and twenty-one waves of work have gone into this site and not
 * one of its 320 pages has ever reported that anybody read it. No Google
 * Analytics, no Plausible, no Cloudflare beacon, no Search Console
 * verification. Every decision about which entries deserve a better photograph,
 * which article is worth writing again, whether the subscribe block Wave 317
 * put on 88 pages converts at all, and above all whether any of this can ever
 * make money, has been made blind.
 *
 * That is the wrong order of operations. Monetisation is downstream of
 * traffic: an affiliate link on a page nobody lands on earns nothing, and the
 * question of WHICH pages to monetise cannot be answered without knowing which
 * pages people arrive on. Measurement comes first because it is what makes the
 * next decision cheap instead of a guess.
 *
 * Cloudflare Web Analytics is the right fit here and not because it is free.
 * The site is already served by Cloudflare Pages, so this adds no new vendor;
 * it is cookieless and stores no personal data, so it needs no consent banner
 * -- and a consent banner on a joke dictionary is a conversion tax nobody would
 * accept. One deferred script tag, no layout impact.
 *
 * Nothing is authored and nothing is secret: a beacon token is a public site
 * identifier that ships in the HTML of every page, which is why it lives in
 * data/site-config.json in the open rather than in a workflow secret.
 *
 * UNTIL THAT TOKEN IS FILLED IN THIS SCRIPT DOES NOTHING. It is deliberately
 * safe to wire into the reconciler chain before anyone has visited the
 * Cloudflare dashboard: it prints what is missing and exits 0. The day the
 * token lands, the next pipeline run instruments the whole site without anyone
 * touching 320 files.
 *
 * Idempotent, and it updates rather than duplicates: change the token and the
 * existing tag is rewritten in place, so there is never a second beacon.
 *
 * Scope is the sitemap plus 404.html. The sitemap is the site's own list of
 * pages it wants strangers on, which is the same definition sync-subscribe.js
 * and sync-social-cards.js use; 404 is added because "what are people asking
 * for that does not exist" is one of the few genuinely actionable things a
 * small site learns about itself.
 *
 * Usage: node scripts/sync-analytics.js [--check]
 *   --check  report what would change and exit 1, without writing. For CI.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const CHECK = process.argv.includes('--check');

const MARK = 'data-cf-beacon';
// Matches the whole tag however it was written, so re-runs replace rather than
// stack. The token inside is what changes; the tag is what gets swapped.
const TAG_RE = /([ \t]*)<script[^>]*data-cf-beacon[^>]*>\s*<\/script>/i;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site-config.json'), 'utf8'));
  } catch {
    return null;
  }
}

const cfg = readConfig();
// Env wins over the file so a workflow can override without a commit, but the
// file is the normal home: this token is public by construction.
const token = (process.env.CF_BEACON_TOKEN || cfg?.analytics?.cloudflareToken || '').trim();
const googleVerify = (cfg?.verification?.google || '').trim();
const bingVerify = (cfg?.verification?.bing || '').trim();

if (!token && !googleVerify && !bingVerify) {
  console.log('[analytics] not configured, nothing injected.');
  console.log('[analytics] To turn this on: Cloudflare dashboard -> Web Analytics -> thiccctionary.com');
  console.log('[analytics] -> Manage site, copy the token out of the snippet, and paste it into');
  console.log('[analytics] data/site-config.json under analytics.cloudflareToken. One value, one commit.');
  process.exit(0);
}

const beaconTag = token
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ${MARK}='{"token": "${token}"}'></script>`
  : null;

function diskPathFor(loc) {
  if (!loc.startsWith(SITE)) return null;
  const route = loc.slice(SITE.length) || '/';
  if (route === '/') return 'index.html';
  return route.endsWith('/') ? `${route.slice(1)}index.html` : route.slice(1);
}

let sitemap = '';
try { sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'); } catch { /* no sitemap yet */ }

const rels = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => diskPathFor(m[1]))
  .filter(Boolean);
// 404 is not in the sitemap by definition, and it is the page that tells you
// what people are looking for and not finding.
rels.push('404.html');

const seen = new Set();
let added = 0, updated = 0, already = 0, missing = 0;
const notes = [];

for (const rel of rels) {
  if (seen.has(rel)) continue;
  seen.add(rel);

  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { missing++; continue; }

  let html = fs.readFileSync(file, 'utf8');
  if (!/<\/head>/i.test(html)) { missing++; continue; }
  const before = html;

  if (beaconTag) {
    if (TAG_RE.test(html)) {
      // Keep whatever indentation the page already had. Normalising it here is
      // how the first version of this script rewrote one file on every run
      // forever: the tag was identical, the leading spaces were not.
      html = html.replace(TAG_RE, (_m, indent) => `${indent}${beaconTag}`);
    } else {
      html = html.replace(/<\/head>/i, `${beaconTag}\n</head>`);
    }
  }

  // Verification meta tags, same insert-only discipline as everywhere else.
  const addMeta = [];
  if (googleVerify && !/name="google-site-verification"/i.test(html)) {
    addMeta.push(`<meta name="google-site-verification" content="${googleVerify}" />`);
  }
  if (bingVerify && !/name="msvalidate\.01"/i.test(html)) {
    addMeta.push(`<meta name="msvalidate.01" content="${bingVerify}" />`);
  }
  if (addMeta.length) html = html.replace(/<\/head>/i, `${addMeta.join('\n')}\n</head>`);

  if (html === before) { already++; continue; }

  if (!CHECK) fs.writeFileSync(file, html);
  const wasInstrumented = TAG_RE.test(before);
  if (wasInstrumented) { updated++; } else { added++; }
  notes.push(`  ${rel}${wasInstrumented ? ' (token updated)' : ''}`);
}

for (const n of notes.slice(0, 10)) console.log(n);
if (notes.length > 10) console.log(`  ...and ${notes.length - 10} more.`);

const tail = missing ? ` ${missing} not on disk.` : '';
const changed = added + updated;
if (changed === 0) {
  console.log(`[analytics] ${already} page(s), every one already instrumented.${tail}`);
} else if (CHECK) {
  console.log(`[analytics] ${changed} page(s) would change (${added} new, ${updated} retagged).${tail}`);
  process.exit(1);
} else {
  console.log(`[analytics] ${added} page(s) instrumented, ${updated} retagged, ${already} already correct.${tail}`);
}
