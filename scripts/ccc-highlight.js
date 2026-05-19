/**
 * Wave 174: shared ccc-highlighter.
 * Wraps every "ccc" cluster in body text with <span class="ccc"> so the
 * red-italic brand styling renders. Skips elements that already carry
 * the .wordmark or .ccc class (those handle their own styling).
 *
 * Loaded site-wide via <script defer src="/scripts/ccc-highlight.js?v=N">.
 */
(function () {
  function highlightCcc(root) {
    const skipTags = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA']);
    const skipClasses = ['wordmark', 'wordmark-extra', 'wordmark-main', 'ccc'];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p) {
          if (skipTags.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          for (const c of skipClasses) if (p.classList && p.classList.contains(c)) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return /ccc/i.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    for (const node of targets) {
      const frag = document.createDocumentFragment();
      // Match exactly 3 c's (case-insensitive). Don't double-wrap if more.
      const parts = node.nodeValue.split(/((?<![cC])[cC]{3}(?![cC]))/);
      parts.forEach(part => {
        if (/^[cC]{3}$/.test(part)) {
          const span = document.createElement('span');
          span.className = 'ccc';
          span.textContent = part;
          frag.appendChild(span);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
      node.parentNode.replaceChild(frag, node);
    }
  }
  // Run once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => highlightCcc(document.body));
  } else {
    highlightCcc(document.body);
  }
  // Re-run when later script injects content (entries hydrate, etc.)
  window.__highlightCcc = highlightCcc;
})();
