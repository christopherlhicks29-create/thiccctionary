/**
 * Wave 190: programmatic SEO. Generates per-subject "Is [X] thiccc?" pages
 * targeting long-tail search intent ("is a kettlebell thiccc", "is a cement
 * truck thick", etc.). One page per catalog entry, plus a hub index at
 * /is-it-thiccc/.
 *
 * URL pattern: /is/<slug>-thiccc/  (e.g. /is/kettlebell-thiccc/)
 *
 * Page surface:
 *   - H1: "Is a [Subject] thiccc?"
 *   - Verdict badge (always YES, every catalogued entry passed the editorial bar)
 *   - One-sentence rationale (pulled from entry definition)
 *   - The entry's photograph
 *   - "Read the full entry" link to /entries/YYYY-MM-DD.html
 *   - FAQ schema + Article schema for rich-snippet eligibility
 *   - Standard masthead/footer/nav for parity with the rest of the site
 *
 * Why not generate from the noun pool too? Thin-content risk. Every page
 * needs to be backed by a real catalog entry with a real verdict.
 *
 * Run from CI on daily.yml after build-entry-pages, so each new entry
 * immediately ships its own /is/ page.
 *
 * Usage: node scripts/build-is-pages.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSlugs } from './lib/is-slug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
const ENTRIES_PATH = path.join(ROOT, 'data', 'entries.json');
const OUT_BASE = path.join(ROOT, 'is');
const HUB_OUT = path.join(ROOT, 'is-it-thiccc');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

function trimText(s, max) {
  s = stripHtml(s).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s\S*$/, '') + '...';
}

function articleFor(word) {
  // "Kettlebell" -> "a", "Avocado" -> "an"
  const first = String(word).split(',')[0].trim();
  return /^[aeiouAEIOU]/.test(first) ? 'an' : 'a';
}

function renderPage(entry) {
  const slug = entry._slug;
  const subject = String(entry.word).split(',')[0].trim();
  const fullWord = entry.word;
  const article = articleFor(subject);
  const rationale = trimText(entry.definitions?.[0] || '', 220);
  const canonical = `${SITE}/is/${slug}-thiccc/`;
  const ogImage = `${SITE}/${(entry.image || '').replace(/^\.?\//, '')}`;
  const description = trimText(
    `Yes, ${article} ${subject.toLowerCase()} is officially thiccc per the Thiccctionary. ${rationale}`,
    155
  );

  const faqs = [
    {
      q: `Is ${article} ${subject.toLowerCase()} thiccc?`,
      a: `Yes. The Thiccctionary catalogued ${fullWord} as a verified entry. ${rationale}`,
    },
    {
      q: `What makes ${article} ${subject.toLowerCase()} thiccc?`,
      a: rationale,
    },
    {
      q: `Is "thiccc" spelled with three c's?`,
      a: `Yes. The Thiccctionary house spelling uses three c's, distinguishing the editorial register from the colloquial "thicc" (two c's) and standard "thick" (one c).`,
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': `${canonical}#article`,
        url: canonical,
        headline: `Is ${article} ${subject} thiccc?`,
        description,
        image: ogImage,
        datePublished: entry.date,
        author: { '@type': 'Organization', name: 'Thiccctionary' },
        publisher: {
          '@type': 'Organization',
          name: 'Thiccctionary',
          logo: { '@type': 'ImageObject', url: `${SITE}/favicon.svg` },
        },
        mainEntityOfPage: canonical,
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#crumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Thiccctionary', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Is It Thiccc?', item: `${SITE}/is-it-thiccc/` },
          { '@type': 'ListItem', position: 3, name: `Is ${article} ${subject} thiccc?`, item: canonical },
        ],
      },
    ],
  };

  const tagChips = Array.isArray(entry.tags)
    ? entry.tags.slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Is ${escapeHtml(article)} ${escapeHtml(subject)} thiccc? &middot; Thiccctionary</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="canonical" href="${canonical}" />

<meta name="theme-color" content="#f5e8c7" />
<meta property="og:locale" content="en_US" />
<meta property="og:site_name" content="Thiccctionary" />
<meta property="og:title" content="Is ${escapeHtml(article)} ${escapeHtml(subject)} thiccc? &middot; Thiccctionary" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@thiccctionary" />
<meta name="twitter:title" content="Is ${escapeHtml(article)} ${escapeHtml(subject)} thiccc? &middot; Thiccctionary" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(ogImage)}" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.min.css?v=67" />
<link rel="alternate" type="application/rss+xml" title="Thiccctionary RSS Feed" href="https://thiccctionary.com/feed.xml" />

<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>

<header class="masthead">
  <div class="masthead-top">
    <span class="meta-line">A Ruling</span>
    <span class="meta-line meta-line--right">The Thiccctionary, Official</span>
  </div>
  <h1 class="wordmark" aria-label="Thiccctionary">
    <a href="/" class="wordmark-link" aria-label="Thiccctionary, home">
      <span class="wordmark-the">The</span>
      <span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
    </a>
  </h1>
  <nav class="nav">
    <a href="/" class="nav-link">Today's Entry</a>
    <a href="/archive.html" class="nav-link">The Archive</a>
    <a href="/a-z.html" class="nav-link">A-Z</a>
    <a href="/articles/" class="nav-link">Articles</a>
    <a href="/about/documents/" class="nav-link">References</a>
    <a href="/cartoons/" class="nav-link">Cartoons</a>
    <a href="/random.html" class="nav-link">Random</a>
    <a href="/compare.html" class="nav-link">Compare</a>
    <a href="/rate/" class="nav-link">Rate</a>
    <a href="/guess/" class="nav-link">Guess</a>
    <a href="/api/" class="nav-link">API</a>
    <a href="/submit.html" class="nav-link">Submit a Thiccc</a>
    <a href="/about/masthead/" class="nav-link">The Editors</a>
    <a href="/about/" class="nav-link">About</a>
  </nav>
</header>

<main id="main-content">
  <a href="/is-it-thiccc/" class="entry-back">&larr; All "Is it thiccc?" rulings</a>

  <article class="entry entry--single">
    <p class="entry-date-stamp">Editorial Ruling &middot; Catalogued ${escapeHtml(entry.date)}</p>

    <h2 class="headword" style="font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.1; margin: 0 0 12px;">
      Is ${escapeHtml(article)} ${escapeHtml(subject)} thi<span class="ccc">ccc</span>?
    </h2>

    <div style="display: inline-block; padding: 14px 28px; border: 2px solid var(--oxblood); border-radius: 4px; background: rgba(139,31,31,0.04); margin: 14px 0 28px; font-family: var(--font-mono); font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--oxblood);">
      Verdict, <strong style="font-size: 16px; letter-spacing: 0.22em;">Yes, Officially Thi<span class="ccc">ccc</span></strong>
    </div>

    <div class="entry-grid">
      <div class="entry-image-wrap">
        <div class="entry-image">
          <picture>
            <source srcset="/${escapeHtml((entry.image || '').replace(/\.(jpe?g)$/i, '.webp'))}" type="image/webp" />
            <img src="/${escapeHtml(entry.image || '')}" alt="${escapeHtml(subject)}, a thiccc subject" width="600" height="600" loading="eager" decoding="async" />
          </picture>
        </div>
        <p class="entry-caption">${escapeHtml(entry.caption || '')}</p>
      </div>

      <div class="entry-text">
        <p style="font-size: 1.15rem; line-height: 1.55;">
          <strong>${escapeHtml(fullWord)}</strong> is officially catalogued in the Thi<span class="ccc">ccc</span>tionary. ${escapeHtml(rationale)}
        </p>

        <p style="margin-top: 24px;">
          <a href="/entries/${escapeHtml(entry.date)}.html" class="btn-primary">Read the full entry &rarr;</a>
        </p>

        ${tagChips ? `<div class="entry-tags" style="margin-top: 22px;">${tagChips}</div>` : ''}
      </div>
    </div>

    <section style="margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--rule);">
      <h3 style="font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 18px;">Frequently asked</h3>
      ${faqs.map((f) => `
      <details style="margin-bottom: 14px; padding: 14px 18px; border: 1px solid var(--rule); border-radius: 4px;">
        <summary style="cursor: pointer; font-weight: 600;">${escapeHtml(f.q)}</summary>
        <p style="margin: 10px 0 0;">${escapeHtml(f.a)}</p>
      </details>`).join('')}
    </section>

    <section style="margin-top: 48px; padding: 28px 24px; border: 1px solid var(--rule); border-radius: 6px; background: rgba(139,31,31,0.03); text-align: center;">
      <p style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0;">Have your own subject?</p>
      <p style="margin: 0.5rem 0 0; font-size: 1.05rem;"><strong>Drop a photograph into our classifier</strong> and receive a verdict in the same editorial register.</p>
      <p style="margin: 18px 0 0;"><a href="/rate/" class="btn-primary">Rate any photograph &rarr;</a></p>
    </section>

    <p style="text-align: center; margin: 40px 0 24px;">
      <a href="/is-it-thiccc/">&larr; Browse all "Is it thiccc?" rulings</a>
    </p>
  </article>
</main>

<footer class="footer">
  <div class="footer-grid">
    <div>
      <p class="footer-wordmark">Thiccctionary<span style="font-size:0.55em; vertical-align:super; margin-left:2px; opacity:0.7;">TM</span></p>
      <p class="footer-tag">Documenting girth, since 2026.</p>
    </div>
    <div>
      <p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/articles/">Articles</a>
      <a href="/about/documents/">References</a>
      <a href="/cartoons/">Cartoons</a>
      <a href="/compare.html">Compare</a>
      <a href="/rate/">Rate</a>
      <a href="/guess/">Guess</a>
      <a href="/submit.html">Submit</a>
      <a href="/embed/">Embed</a>
      <a href="/about/">About</a>
      <a href="https://buymeacoffee.com/Thiccctionary" target="_blank" rel="noopener">Tip jar</a>
    </div>
    <div>
      <p class="footer-head">Follow</p>
      <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X &middot; @thiccctionary</a>
      <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook &middot; /Thiccctionary</a>
      <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram &middot; @ogthiccctionary</a>
      <a href="https://www.tiktok.com/@thethiccctionary" target="_blank" rel="noopener">TikTok &middot; @thethiccctionary</a>
      <a href="/follow/">All handles &rarr;</a>
    </div>
    <div>
      <p class="footer-head">Legal</p>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/press/">Press kit</a>
      <a href="mailto:admin@thiccctionary.com">Contact</a>
    </div>
  </div>
  <p class="copyright">&copy; <span id="year">2026</span> Thiccctionary<sup style="font-size:0.7em;">TM</sup>. All entries fictional. All proportions exaggerated for comedic effect.<br><span style="font-size:0.85em; opacity:0.65;">THICCCTIONARY is a federally trademark-pending word mark, <a href="https://tsdr.uspto.gov/#caseNumber=99827994" rel="noopener" target="_blank" style="color:inherit; text-decoration:underline;">USPTO serial 99827994</a>. Thiccctionary is an independent publication, unaffiliated with any other site or publication using a similar name.</span></p>
</footer>

<script>document.getElementById('year').textContent = new Date().getFullYear();</script>
<script defer src="/scripts/mobile-nav.js?v=66"></script>
<script defer src="/scripts/ccc-highlight.js?v=2"></script>
</body>
</html>
`;
}

function renderHub(entries) {
  const canonical = `${SITE}/is-it-thiccc/`;
  const sorted = [...entries].sort((a, b) => {
    const aw = String(a.word).split(',')[0].trim().toLowerCase();
    const bw = String(b.word).split(',')[0].trim().toLowerCase();
    return aw.localeCompare(bw);
  });

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${canonical}#list`,
    name: 'Is It Thiccc?, Official Rulings',
    numberOfItems: sorted.length,
    itemListElement: sorted.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/is/${e._slug}-thiccc/`,
      name: `Is ${articleFor(e.word)} ${String(e.word).split(',')[0].trim()} thiccc?`,
    })),
  };

  const cards = sorted.map((e) => {
    const subject = String(e.word).split(',')[0].trim();
    const article = articleFor(subject);
    return `<li class="is-hub-card">
      <a href="/is/${escapeHtml(e._slug)}-thiccc/" class="is-hub-link">
        <span class="is-hub-q">Is ${escapeHtml(article)} ${escapeHtml(subject)} thi<span class="ccc">ccc</span>?</span>
        <span class="is-hub-a">Yes &rarr;</span>
      </a>
    </li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Is It Thiccc? &middot; Every Official Ruling &middot; Thiccctionary</title>
<meta name="description" content="The Thiccctionary's official ledger of every ruling on what is and isn't thiccc. ${sorted.length} verdicts and counting." />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="canonical" href="${canonical}" />

<meta name="theme-color" content="#f5e8c7" />
<meta property="og:locale" content="en_US" />
<meta property="og:site_name" content="Thiccctionary" />
<meta property="og:title" content="Is It Thiccc? &middot; Every Official Ruling" />
<meta property="og:description" content="The Thiccctionary's ledger of official rulings on what is and isn't thiccc. ${sorted.length} verdicts and counting." />
<meta property="og:type" content="website" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${SITE}/og-default.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@thiccctionary" />
<meta name="twitter:image" content="${SITE}/og-default.png" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.min.css?v=67" />
<link rel="alternate" type="application/rss+xml" title="Thiccctionary RSS Feed" href="https://thiccctionary.com/feed.xml" />

<style>
.is-hub-grid { list-style: none; padding: 0; margin: 32px 0; display: grid; gap: 12px; }
.is-hub-card { margin: 0; }
.is-hub-link { display: flex; justify-content: space-between; align-items: baseline; padding: 18px 22px; border: 1px solid var(--rule); border-radius: 4px; text-decoration: none; color: var(--ink); transition: border-color 0.15s, background 0.15s; gap: 16px; }
.is-hub-link:hover { border-color: var(--oxblood); background: rgba(139,31,31,0.04); }
.is-hub-q { font-family: var(--font-serif); font-size: 1.15rem; line-height: 1.3; flex: 1; }
.is-hub-a { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--oxblood); white-space: nowrap; }
</style>

<script type="application/ld+json">
${JSON.stringify(itemListJsonLd, null, 2)}
</script>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>

<header class="masthead">
  <div class="masthead-top">
    <span class="meta-line">The Ledger</span>
    <span class="meta-line meta-line--right">Official Rulings</span>
  </div>
  <h1 class="wordmark" aria-label="Thiccctionary">
    <a href="/" class="wordmark-link" aria-label="Thiccctionary, home">
      <span class="wordmark-the">The</span>
      <span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
    </a>
  </h1>
  <nav class="nav">
    <a href="/" class="nav-link">Today's Entry</a>
    <a href="/archive.html" class="nav-link">The Archive</a>
    <a href="/a-z.html" class="nav-link">A-Z</a>
    <a href="/articles/" class="nav-link">Articles</a>
    <a href="/about/documents/" class="nav-link">References</a>
    <a href="/cartoons/" class="nav-link">Cartoons</a>
    <a href="/random.html" class="nav-link">Random</a>
    <a href="/compare.html" class="nav-link">Compare</a>
    <a href="/rate/" class="nav-link">Rate</a>
    <a href="/guess/" class="nav-link">Guess</a>
    <a href="/api/" class="nav-link">API</a>
    <a href="/submit.html" class="nav-link">Submit a Thiccc</a>
    <a href="/about/masthead/" class="nav-link">The Editors</a>
    <a href="/about/" class="nav-link">About</a>
  </nav>
</header>

<main id="main-content">
  <h2 class="headword" style="font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.1; margin: 24px 0 8px;">Is It Thi<span class="ccc">ccc</span>?</h2>
  <p style="font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 18px;">${sorted.length} Official Rulings</p>

  <p style="max-width: 640px; font-size: 1.05rem; line-height: 1.6;">
    Every subject in the Thi<span class="ccc">ccc</span>tionary has earned its catalogue position by editorial verdict. Below: the complete ledger, alphabetical. Each ruling is permanent.
  </p>

  <p style="margin-top: 22px;">
    <a href="/rate/" class="btn-primary">Rate a subject of your own &rarr;</a>
  </p>

  <ul class="is-hub-grid">
${cards}
  </ul>

  <p style="text-align: center; margin: 48px 0 32px;">
    <a href="/archive.html">Browse the dated archive &rarr;</a>
  </p>
</main>

<footer class="footer">
  <div class="footer-grid">
    <div>
      <p class="footer-wordmark">Thiccctionary<span style="font-size:0.55em; vertical-align:super; margin-left:2px; opacity:0.7;">TM</span></p>
      <p class="footer-tag">Documenting girth, since 2026.</p>
    </div>
    <div>
      <p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/articles/">Articles</a>
      <a href="/about/documents/">References</a>
      <a href="/cartoons/">Cartoons</a>
      <a href="/compare.html">Compare</a>
      <a href="/rate/">Rate</a>
      <a href="/guess/">Guess</a>
      <a href="/submit.html">Submit</a>
      <a href="/embed/">Embed</a>
      <a href="/about/">About</a>
      <a href="https://buymeacoffee.com/Thiccctionary" target="_blank" rel="noopener">Tip jar</a>
    </div>
    <div>
      <p class="footer-head">Follow</p>
      <a href="https://x.com/thiccctionary" target="_blank" rel="noopener">X &middot; @thiccctionary</a>
      <a href="https://www.facebook.com/Thiccctionary/" target="_blank" rel="noopener">Facebook &middot; /Thiccctionary</a>
      <a href="https://www.instagram.com/ogthiccctionary/" target="_blank" rel="noopener">Instagram &middot; @ogthiccctionary</a>
      <a href="https://www.tiktok.com/@thethiccctionary" target="_blank" rel="noopener">TikTok &middot; @thethiccctionary</a>
      <a href="/follow/">All handles &rarr;</a>
    </div>
    <div>
      <p class="footer-head">Legal</p>
      <a href="/legal/terms.html">Terms</a>
      <a href="/legal/privacy.html">Privacy</a>
      <a href="/press/">Press kit</a>
      <a href="mailto:admin@thiccctionary.com">Contact</a>
    </div>
  </div>
  <p class="copyright">&copy; <span id="year">2026</span> Thiccctionary<sup style="font-size:0.7em;">TM</sup>. All entries fictional. All proportions exaggerated for comedic effect.<br><span style="font-size:0.85em; opacity:0.65;">THICCCTIONARY is a federally trademark-pending word mark, <a href="https://tsdr.uspto.gov/#caseNumber=99827994" rel="noopener" target="_blank" style="color:inherit; text-decoration:underline;">USPTO serial 99827994</a>. Thiccctionary is an independent publication, unaffiliated with any other site or publication using a similar name.</span></p>
</footer>

<script>document.getElementById('year').textContent = new Date().getFullYear();</script>
<script defer src="/scripts/mobile-nav.js?v=66"></script>
<script defer src="/scripts/ccc-highlight.js?v=2"></script>
</body>
</html>
`;
}

async function main() {
  const raw = await fs.readFile(ENTRIES_PATH, 'utf8');
  const entries = JSON.parse(raw);
  assignSlugs(entries);

  await fs.mkdir(OUT_BASE, { recursive: true });
  let built = 0;
  for (const e of entries) {
    const dir = path.join(OUT_BASE, `${e._slug}-thiccc`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), renderPage(e));
    built++;
  }

  // Wave 252: prune orphan /is/ pages whose subject is no longer in the catalog.
  // Regenerated/renamed entries used to leave stale pages live (duplicate-content
  // junk + broken images). Safety guard: skip if the catalog looks suspiciously
  // small, so a bad entries.json read cannot wipe every page.
  const validSlugs = new Set(entries.map((e) => `${e._slug}-thiccc`));
  let pruned = 0;
  if (entries.length >= 20) {
    const existing = await fs.readdir(OUT_BASE).catch(() => []);
    for (const name of existing) {
      if (!name.endsWith('-thiccc') || validSlugs.has(name)) continue;
      await fs.rm(path.join(OUT_BASE, name), { recursive: true, force: true });
      console.log(`Pruned orphan /is/ page: ${name}`);
      pruned++;
    }
  } else {
    console.warn(`Skipping /is/ prune: only ${entries.length} entries (guard).`);
  }

  await fs.mkdir(HUB_OUT, { recursive: true });
  await fs.writeFile(path.join(HUB_OUT, 'index.html'), renderHub(entries));

  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  try {
    let sitemap = await fs.readFile(sitemapPath, 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    const newUrls = [
      `${SITE}/is-it-thiccc/`,
      ...entries.map((e) => `${SITE}/is/${e._slug}-thiccc/`),
    ];
    const additions = [];
    for (const url of newUrls) {
      if (!sitemap.includes(`<loc>${url}</loc>`)) {
        additions.push(`  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`);
      }
    }
    // Drop stale /is/ urls (pruned subjects) from the sitemap.
    const validIsUrls = new Set(entries.map((e) => `${SITE}/is/${e._slug}-thiccc/`));
    let smChanged = false;
    sitemap = sitemap.replace(/\s*<url>(?:(?!<\/url>)[\s\S])*?<\/url>/g, (block) => {
      const m = block.match(/<loc>([^<]+)<\/loc>/);
      if (m && /\/is\/[^/]+-thiccc\/$/.test(m[1]) && !validIsUrls.has(m[1])) {
        smChanged = true;
        return '';
      }
      return block;
    });
    if (additions.length > 0) {
      sitemap = sitemap.replace(/<\/urlset>\s*$/i, additions.join('\n') + '\n</urlset>\n');
      smChanged = true;
      console.log(`Added ${additions.length} URLs to sitemap.xml`);
    }
    if (smChanged) {
      await fs.writeFile(sitemapPath, sitemap);
    } else {
      console.log('Sitemap already in sync for /is/ URLs.');
    }
  } catch (err) {
    console.warn('Could not update sitemap.xml:', err.message);
  }

  console.log(`Built ${built} /is/ pages + hub at /is-it-thiccc/ (pruned ${pruned} orphan(s)).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
