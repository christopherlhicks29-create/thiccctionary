/*
 * Thiccctionary browser extension — service worker (MV3)
 *
 * Two surfaces:
 *  1) Right-click any image → "Rate with Thiccctionary" → opens
 *     /rate/?u=<image url> in a new tab; the rate page auto-rates.
 *  2) Click extension icon → opens /rate/.
 *
 * No popup — the rate page IS the UI. This keeps the extension a
 * thin shim and means every UI improvement to /rate/ ships to
 * extension users automatically.
 */

const RATE_URL = 'https://thiccctionary.com/rate/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'thiccctionary-rate-image',
    title: 'Rate with Thiccctionary',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'thiccctionary-rate-image' && info.srcUrl) {
    const target = `${RATE_URL}?u=${encodeURIComponent(info.srcUrl)}`;
    chrome.tabs.create({ url: target });
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: RATE_URL });
});
