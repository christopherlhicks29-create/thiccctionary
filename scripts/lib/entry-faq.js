/**
 * entry-faq.js - Wave 323. One place where an entry's "Is X thiccc?" Q&A lives.
 *
 * Wave 190 built 106 /is/<slug>-thiccc/ pages to catch long-tail queries ("is a
 * kettlebell thiccc", "is a cement truck thick"). Wave 303 then discovered those
 * pages were near-duplicates of their parent entry, pointed every one of them at
 * the entry with <link rel="canonical">, and dropped them from the sitemap. Both
 * decisions were right on their own terms. Together they left the site telling
 * Google, on 106 pages, "do not index this, index the entry instead" -- while the
 * entry carried none of the question-shaped text the /is/ page was written to
 * rank for. The targeting was aimed at a page that had been switched off.
 *
 * So the Q&A moves to the canonical target. This module derives it once and both
 * generators import it: build-is-pages.js for the human-facing ruling page, and
 * build-entry-pages.js for the page that is actually eligible to rank.
 *
 * On the schema, honestly: Google restricted FAQPage rich results to
 * authoritative government and health sources in 2023, so the JSON-LD below will
 * not draw an accordion under the search result for a joke dictionary. It is
 * emitted because it is free and correctly describes the page. The value of this
 * wave is the VISIBLE text -- an indexable page that contains the literal
 * sentence a person types into a search box.
 *
 * The answers are deliberately built from different fields than the ones already
 * rendered above them on the entry page. Q1 is catalogue metadata, Q2 is the
 * colloquial second definition rather than the primary one printed at the top,
 * Q3 is house style. An FAQ that restates the paragraph above it is padding, and
 * padding on 106 pages is the thin-content problem Wave 303 was fixing.
 */

export function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

// Wave 303: this used to hard-slice at `max` and glue on an ellipsis, which
// shipped visible fragments like "...when viewed astern in raking..." three
// times on every page. Prefer the last complete sentence that fits; only fall
// back to a word-boundary elision when no sentence fits inside the budget.
export function trimText(s, max) {
  s = stripHtml(s).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const window = s.slice(0, max);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (lastStop > max * 0.5) return window.slice(0, lastStop + 1).trim();
  return window.replace(/\s\S*$/, '').replace(/[\s,;:]+$/, '') + '…';
}

export function articleFor(word) {
  // "Kettlebell" -> "a", "Avocado" -> "an"
  const first = String(word).split(',')[0].trim();
  return /^[aeiouAEIOU]/.test(first) ? 'an' : 'a';
}

export function headNoun(word) {
  return String(word).split(',')[0].trim();
}

/**
 * Catalogue headwords are stored in dictionary inversion, "Head Noun,
 * Qualifier": "Kettle, Cast Iron Tea". Nobody searches in that order. The FAQ
 * question is the one string on the page whose whole job is to match what a
 * person types, so it gets the un-inverted form: "cast iron tea kettle".
 *
 * Two exceptions, both derived rather than listed:
 *
 *   A qualifier that already contains the head noun. Reversing "Loaf, Meatloaf"
 *   gives "meatloaf loaf"; the qualifier IS the common name, so use it alone.
 *
 *   A head noun carrying a model number ("Hummer H2", "Ram 3500"). Those are
 *   product names, not nouns being modified, and English puts the modifier
 *   after them: "Hummer H2 limousine", not "limousine Hummer H2".
 *
 * It is a heuristic and it is not perfect. "Ever Given, Suez Container Ship"
 * comes out backwards because the head noun is a ship's name and nothing in the
 * string says so. Roughly four of 106 read oddly, against ninety that go from
 * an order nobody types to the order everybody does. An exception list would
 * fix those four by writing the same fact down in a second place, which is the
 * bug this codebase keeps paying for.
 */
export function naturalName(word) {
  const parts = String(word).split(',').map((s) => s.trim()).filter(Boolean);
  const head = parts[0] || String(word).trim();
  if (parts.length < 2) return head;
  const qualifier = parts.slice(1).join(' ');
  if (/\d/.test(head)) return `${head} ${qualifier}`;
  const re = new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (re.test(qualifier)) return qualifier;
  return `${qualifier} ${head}`;
}

/**
 * definitions[1] opens with an italic register label on 103 of 106 entries
 * ("<em>colloq.</em> A kitchen heavyweight..."). Stripping tags leaves a bare
 * "colloq." sitting at the front of a sentence, which reads as a typo rather
 * than as apparatus once it is outside the definition list it belongs to.
 */
function withoutRegisterLabel(def) {
  // Matched against the raw HTML, not the stripped text, so only an actual
  // <em> label is removed and a definition that merely happens to start with an
  // abbreviation is left alone. The label must look like one: short, and ending
  // in a period. "The platonic ideal of thicccness:" is not a label and stays.
  const stripped = String(def || '').replace(/^\s*<em>\s*([a-z]{2,10}\.)\s*<\/em>\s*/i, '');
  return stripHtml(stripped).trim();
}

function humanDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/**
 * The three questions, derived from the entry and nothing else. Same array on
 * the /is/ page and the entry page, because it is the same fact either way.
 */
export function faqsFor(entry) {
  const subject = naturalName(entry.word).toLowerCase();
  const article = /^[aeiou]/.test(subject) ? 'an' : 'a';
  const primary = trimText(entry.definitions?.[0] || '', 220);
  // definitions[1] is the colloquial gloss. Every entry has one, and using it
  // here keeps the FAQ from being a second printing of the paragraph above.
  const colloquial = trimText(withoutRegisterLabel(entry.definitions?.[1]), 260);
  const cat = entry.category ? ` in the ${entry.category} section` : '';

  return [
    {
      q: `Is ${article} ${subject} thiccc?`,
      a: `Yes. ${entry.word} is a catalogued Thiccctionary entry, ruled on ${humanDate(entry.date)} and filed${cat}. Every subject in the catalogue has cleared the editorial bar for girth.`,
    },
    {
      q: `What makes ${article} ${subject} thiccc?`,
      a: colloquial || primary,
    },
    {
      q: `Is "thiccc" spelled with three c's?`,
      a: `Yes. The Thiccctionary house spelling uses three c's, distinguishing the editorial register from the colloquial "thicc" (two c's) and standard "thick" (one c).`,
    },
  ];
}

/**
 * The schema.org node. `id` is the page it belongs to, so the /is/ page and the
 * entry page each claim their own rather than colliding on one @id.
 */
export function faqPageNode(faqs, id) {
  return {
    '@type': 'FAQPage',
    '@id': id,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The visible block. Rendered open-by-default is tempting for crawlers but
 * <details> content is in the DOM either way and Google has said so; keeping it
 * collapsed is what the /is/ pages already do and it does not cost indexing.
 */
export function renderFaqSection(faqs, { heading = 'Frequently asked' } = {}) {
  return `<section class="entry-faq" aria-label="Frequently asked questions" style="margin: 56px 0 0; padding-top: 32px; border-top: 1px solid var(--rule);">
      <h3 style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--oxblood); margin: 0 0 18px; font-weight: 600;">${esc(heading)}</h3>
${faqs.map((f) => `      <details style="margin-bottom: 14px; padding: 14px 18px; border: 1px solid var(--rule); border-radius: 4px;">
        <summary style="cursor: pointer; font-weight: 600;">${esc(f.q)}</summary>
        <p style="margin: 10px 0 0;">${esc(f.a)}</p>
      </details>`).join('\n')}
    </section>`;
}
