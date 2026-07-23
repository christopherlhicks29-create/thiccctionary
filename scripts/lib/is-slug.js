/**
 * Single source of truth for /is/<slug>-thiccc/ slug assignment.
 *
 * build-is-pages.js uses this to decide what directories to write under
 * is/, and build-entry-pages.js's buildSitemap() uses it to decide what
 * /is/ URLs belong in sitemap.xml. Before this module existed, each file
 * kept its own copy of the slug logic; build-entry-pages.js's copy never
 * learned about the category-suffix disambiguation used for collisions
 * (e.g. two entries whose first word is "Pickup Truck"), so a rebuilt
 * sitemap could list a plain slug that build-is-pages.js had already
 * renamed to a disambiguated one on disk, or vice versa. Sharing one
 * implementation keeps the sitemap and the actual generated pages from
 * ever drifting apart again.
 */

function slugify(word) {
  let primary = String(word).split(',')[0].trim().toLowerCase();
  // Strip a leading "thiccc " prefix from quirky early entries (e.g. "Thiccc Boeing")
  primary = primary.replace(/^thiccc\s+/, '');
  return primary
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function categoryToken(category) {
  if (!category) return '';
  return String(category).split('&')[0].trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Mutates each entry with a `_slug` property and returns the same array.
 * Collisions on the primary slug are disambiguated with a category suffix
 * (falling back to the entry date if the category suffix also collides).
 */
function assignSlugs(entries) {
  const used = new Map();
  for (const e of entries) {
    let s = slugify(e.word);
    if (!s) s = `entry-${e.date}`;
    if (used.has(s)) {
      const cat = categoryToken(e.category);
      const alt = cat ? `${s}-${cat}` : `${s}-${e.date}`;
      s = used.has(alt) ? `${s}-${e.date}` : alt;
    }
    used.set(s, e);
    e._slug = s;
  }
  return entries;
}

export { slugify, categoryToken, assignSlugs };
