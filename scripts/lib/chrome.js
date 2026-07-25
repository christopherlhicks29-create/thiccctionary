/**
 * Wave 304: the shared page chrome (head, masthead, footer) as one module.
 *
 * Every generator on this site carries its own 120-line copy of the <head>,
 * masthead nav and footer. That is how the nav drifted out of sync between
 * page families and how 49 pages ended up pinned to styles.min.css?v=72 while
 * the rest moved to v73. New generators should import from here instead of
 * pasting another copy; the existing ones can migrate opportunistically.
 */

export const SITE = (process.env.SITE_BASE_URL || 'https://thiccctionary.com').replace(/\/$/, '');
export const CSS_VERSION = '73';

export const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

const NAV = [
  ['/', "Today's Entry"],
  ['/archive.html', 'The Archive'],
  ['/a-z.html', 'A-Z'],
  ['/articles/', 'Articles'],
  ['/about/documents/', 'References'],
  ['/cartoons/', 'Cartoons'],
  ['/random.html', 'Random'],
  ['/compare.html', 'Compare'],
  ['/rate/', 'Rate'],
  ['/guess/', 'Guess'],
  ['/api/', 'API'],
  ['/submit.html', 'Submit a Thiccc'],
  ['/about/masthead/', 'The Editors'],
  ['/about/', 'About'],
];

/**
 * @param {object} o
 * @param {string} o.title      full <title>, already brand-suffixed by caller
 * @param {string} o.description meta description, plain text
 * @param {string} o.canonical  absolute URL
 * @param {string} [o.ogTitle]  defaults to title
 * @param {string} [o.image]    absolute URL, defaults to og-default.png
 * @param {string} [o.extraCss] raw CSS for a <style> block
 * @param {object[]} [o.jsonLd] array of JSON-LD objects
 */
export function head({ title, description, canonical, ogTitle, image, extraCss = '', jsonLd = [] }) {
  const img = image || `${SITE}/og-default.png`;
  const ogT = ogTitle || title;
  return `<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="canonical" href="${canonical}" />

<meta name="theme-color" content="#f5e8c7" />
<meta property="og:locale" content="en_US" />
<meta property="og:site_name" content="Thiccctionary" />
<meta property="og:title" content="${escapeHtml(ogT)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@thiccctionary" />
<meta name="twitter:title" content="${escapeHtml(ogT)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${img}" />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.min.css?v=${CSS_VERSION}" />
<link rel="alternate" type="application/rss+xml" title="Thiccctionary RSS Feed" href="${SITE}/feed.xml" />
${extraCss ? `\n<style>\n${extraCss}\n</style>\n` : ''}${jsonLd.map(o => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`).join('\n')}`;
}

export function masthead({ left = 'The Thiccctionary', right = '' } = {}) {
  return `<header class="masthead">
  <div class="masthead-top">
    <span class="meta-line">${escapeHtml(left)}</span>
    <span class="meta-line meta-line--right">${escapeHtml(right)}</span>
  </div>
  <div class="wordmark" aria-label="Thiccctionary">
    <a href="/" class="wordmark-link" aria-label="Thiccctionary, home">
      <span class="wordmark-the">The</span>
      <span class="wordmark-main">Thi<span class="wordmark-extra">ccc</span>tionary</span>
    </a>
  </div>
  <nav class="nav">
${NAV.map(([h, l]) => `    <a href="${h}" class="nav-link">${l}</a>`).join('\n')}
  </nav>
</header>`;
}

export function footer() {
  return `<footer class="footer">
  <div class="footer-grid">
    <div>
      <p class="footer-wordmark">Thiccctionary<span style="font-size:0.55em; vertical-align:super; margin-left:2px; opacity:0.7;">TM</span></p>
      <p class="footer-tag">Documenting girth, since 2026.</p>
    </div>
    <div>
      <p class="footer-head">Sections</p>
      <a href="/archive.html">Archive</a>
      <a href="/a-z.html">A-Z</a>
      <a href="/category/">Categories</a>
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
<script defer src="/scripts/ccc-highlight.js?v=2"></script>`;
}

export function page({ headHtml, bodyHtml, mastheadOpts }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${headHtml}
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>

${masthead(mastheadOpts)}

<main id="main-content">
${bodyHtml}
</main>

${footer()}
</body>
</html>
`;
}
