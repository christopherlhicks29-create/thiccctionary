/**
 * Mobile hamburger nav — Wave 61.
 *
 * Adds a toggle button before the .nav element on narrow viewports.
 * Pure DOM injection so no HTML edits across 30+ pages were needed.
 *
 * Triggers via CSS media query at <= 720px:
 *   - Hamburger button becomes visible
 *   - .nav becomes display:none by default
 *   - Clicking the button toggles .nav--open class which displays the nav
 *
 * Closes itself on any nav-link click (mobile UX standard).
 */
(function() {
  'use strict';
  if (document.querySelector('.nav-toggle')) return; // already injected

  const nav = document.querySelector('.nav');
  if (!nav) return;

  const btn = document.createElement('button');
  btn.className = 'nav-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Toggle navigation menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'main-nav');
  btn.textContent = '☰ Menu';

  // Give the nav an id so aria-controls works
  if (!nav.id) nav.id = 'main-nav';

  nav.parentNode.insertBefore(btn, nav);

  function setOpen(open) {
    nav.classList.toggle('nav--open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? '✕ Close' : '☰ Menu';
  }

  btn.addEventListener('click', function() {
    setOpen(!nav.classList.contains('nav--open'));
  });

  // Close on any nav-link click
  nav.addEventListener('click', function(e) {
    const target = e.target;
    if (target && target.classList && target.classList.contains('nav-link')) {
      setOpen(false);
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && nav.classList.contains('nav--open')) {
      setOpen(false);
      btn.focus();
    }
  });
})();
