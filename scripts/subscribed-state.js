/**
 * Wave 187: subscribe-state awareness.
 *
 * Hides the inline + entry subscribe sections when the user has set the
 * 'thiccctionary-subscribed' localStorage flag (via clicking Subscribe).
 * Adds a small "You're subscribed - thanks." acknowledgment instead.
 *
 * Doesn't run on the homepage hero or block any other UI. Pure progressive
 * enhancement.
 */
(function() {
  function isSubscribed() {
    try { return localStorage.getItem('thiccctionary-subscribed') === '1'; }
    catch { return false; }
  }
  function setSubscribed() {
    try { localStorage.setItem('thiccctionary-subscribed', '1'); } catch {}
  }
  function hideSubscribeBlocks() {
    const blocks = document.querySelectorAll('.inline-signup, .entry-subscribe');
    for (const b of blocks) {
      const ack = document.createElement('p');
      ack.style.cssText = 'text-align:center; padding:24px; font-family: var(--font-mono); font-size:12px; letter-spacing:0.15em; text-transform:uppercase; color: var(--ink-soft); opacity:0.7;';
      ack.textContent = "You're subscribed. A new entry lands each morning.";
      b.replaceWith(ack);
    }
  }
  if (isSubscribed()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideSubscribeBlocks);
    } else {
      hideSubscribeBlocks();
    }
  }
  // Mark as subscribed when any subscribe form is submitted
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form && form.action && form.action.includes('buttondown.email')) {
      setSubscribed();
    }
  });
})();
