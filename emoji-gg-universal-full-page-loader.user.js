// ==UserScript==
// @name         Emoji.gg Universal Full Page Loader
// @namespace    emoji.gg.full-page-loader
// @version      1.2
// @description  Fast-loads complete Emoji.gg profiles and adds an opt-in full-page loader to emoji and sticker listings.
// @author       Chase (itschase)
// @license      MIT
// @homepageURL  https://github.com/itschase/emoji-gg-universal-full-page-loader
// @supportURL   https://github.com/itschase/emoji-gg-universal-full-page-loader/issues
// @downloadURL  https://raw.githubusercontent.com/itschase/emoji-gg-universal-full-page-loader/main/emoji-gg-universal-full-page-loader.user.js
// @updateURL    https://raw.githubusercontent.com/itschase/emoji-gg-universal-full-page-loader/main/emoji-gg-universal-full-page-loader.user.js
// @match        https://emoji.gg/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CARD_SELECTOR = '.card-image.asset';
  const ITEM_SELECTOR = `.item:has(${CARD_SELECTOR})`;
  const PROFILE_BATCH_SIZE = 500;
  const END_CHECKS_REQUIRED = 3;
  const END_CHECK_WAIT_MS = 1400;
  const ONE_SHOT_KEY = `emoji-gg-full-load:${location.pathname}${location.search}`;
  const isProfile = /^\/user\/[^/]+\/?$/.test(location.pathname);
  const isListing = location.pathname === '/' || /^\/(emojis|stickers|category)(?:\/|$)/.test(location.pathname);
  if (!isProfile && !isListing) return;

  let running = false;
  let cancelled = false;
  let abortController = null;
  let knownIds = new Set();
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const countCards = () => document.querySelectorAll(CARD_SELECTOR).length;
  const getProfileExpectedCount = () => {
    if (!isProfile) return null;
    const profilePath = location.pathname.replace(/\/$/, '');
    const emojiTab = [...document.querySelectorAll('a.nav-link')].find(link => {
      try {
        return new URL(link.href, location.href).pathname.replace(/\/$/, '') === profilePath
          && /^\s*Emojis\b/i.test(link.textContent)
          && Boolean(link.querySelector('.badge'));
      } catch {
        return false;
      }
    });
    const value = Number.parseInt(emojiTab?.querySelector('.badge')?.textContent.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(value) ? value : null;
  };

  const getItemId = item => {
    const collection = item.querySelector('.collection[data-id]');
    if (collection?.dataset.id) return collection.dataset.id;
    const view = item.querySelector('a[href*="/emoji/"], a[href*="/sticker/"]');
    return view?.href || item.querySelector('img')?.src || '';
  };
  const rebuildKnownIds = () => {
    knownIds = new Set([...document.querySelectorAll(ITEM_SELECTOR)].map(getItemId).filter(Boolean));
  };
  const removeDuplicateItems = () => {
    const seen = new Set();
    let removed = 0;
    for (const item of document.querySelectorAll(ITEM_SELECTOR)) {
      const id = getItemId(item);
      if (!id || !seen.has(id)) {
        if (id) seen.add(id);
        continue;
      }
      item.remove();
      removed += 1;
    }
    knownIds = seen;
    return removed;
  };

  const makeButton = (label, color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      padding: '7px 11px', border: '0', borderRadius: '6px', background: color,
      color: '#fff', font: '600 12px system-ui,sans-serif', cursor: 'pointer'
    });
    return button;
  };
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
    minWidth: '280px', maxWidth: '380px', padding: '11px 12px', borderRadius: '9px',
    background: 'rgba(20,20,26,.96)', color: '#fff', font: '600 13px/1.3 system-ui,sans-serif',
    boxShadow: '0 4px 18px rgba(0,0,0,.35)'
  });
  const message = document.createElement('div');
  message.style.marginBottom = '9px';
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', gap: '7px' });
  const primaryButton = makeButton(isProfile ? 'Cancel loading' : 'Load full page', isProfile ? '#c63c4f' : '#5865f2');
  const resumeButton = makeButton('Resume / restart', '#5865f2');
  controls.append(primaryButton);
  if (isProfile) controls.append(resumeButton);
  panel.append(message, controls);
  document.body.appendChild(panel);
  const ensurePanel = () => {
    if (!panel.isConnected && document.body) document.body.appendChild(panel);
  };
  const setMessage = text => {
    ensurePanel();
    message.textContent = text;
  };
  const setMessageHtml = html => {
    ensurePanel();
    message.innerHTML = html;
  };

  const findLoadMore = () => [...document.querySelectorAll('a.btn, button.btn')]
    .find(element => element.textContent.trim().toLowerCase() === 'load more'
      && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true');

  const loadProfileStep = async () => {
    const before = countCards();
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll'));

    // Emoji.gg may recreate this control after earlier loads, so always query
    // it after reaching the current bottom instead of caching the element.
    let clicked = false;
    for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
      const loadMore = findLoadMore();
      if (loadMore) {
        loadMore.scrollIntoView({ block: 'center', behavior: 'auto' });
        loadMore.click();
        clicked = true;
        break;
      }
      await wait(150);
    }

    for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
      await wait(250);
      removeDuplicateItems();
      if (countCards() > before) break;
    }

    // One more bottom pass catches a button inserted after the growth check.
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll'));
    await wait(250);
    removeDuplicateItems();
    return { before, after: countCards(), clicked, hasLoadMore: Boolean(findLoadMore()) };
  };
  const runProfile = async () => {
    if (running) return;
    running = true;
    cancelled = false;
    abortController = new AbortController();
    rebuildKnownIds();
    try {
      let noChangeChecks = 0;
      let batchStart = countCards();
      const expected = getProfileExpectedCount();
      while (!cancelled && noChangeChecks < END_CHECKS_REQUIRED) {
        const loaded = countCards();
        const batchProgress = loaded - batchStart;
        setMessage(`Loading profile batch (${Math.min(batchProgress, PROFILE_BATCH_SIZE)}/${PROFILE_BATCH_SIZE}; ${loaded}${expected ? ` of ${expected}` : ''} loaded)…`);
        const result = await loadProfileStep();
        if (result.after > result.before || result.hasLoadMore) {
          noChangeChecks = 0;
        } else {
          noChangeChecks += 1;
          setMessage(`Bottom produced no new items and no Load more control (${noChangeChecks}/${END_CHECKS_REQUIRED}; ${result.after}${expected ? ` of ${expected}` : ''} loaded)`);
        }
        if (result.after - batchStart >= PROFILE_BATCH_SIZE) {
          batchStart = result.after;
          setMessage(`Completed a ${PROFILE_BATCH_SIZE}-item profile batch (${result.after}${expected ? ` of ${expected}` : ''} loaded); continuing…`);
        }
      }
      if (!cancelled && noChangeChecks >= END_CHECKS_REQUIRED && !findLoadMore()) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        await wait(600);
        removeDuplicateItems();
        setMessage(`Loading complete (${countCards()}${expected ? ` of ${expected}` : ''} loaded; bottom unchanged 3 times)`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Emoji.gg full-page loader]', error);
        setMessage(`Paused after an error (${countCards()} loaded) — click Resume`);
      }
    } finally {
      running = false;
    }
  };

  const clickNextLoadMore = async () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll'));

    // The site sometimes creates the button only after reaching the bottom.
    // Re-query it rather than relying on a reference captured before scrolling.
    for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
      const loadMore = findLoadMore();
      if (loadMore) {
        loadMore.scrollIntoView({ block: 'center', behavior: 'auto' });
        loadMore.click();
        return true;
      }
      await wait(150);
    }
    return false;
  };
  const waitForGrowth = async before => {
    for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
      await wait(250);
      if (countCards() > before) return true;
    }
    return false;
  };
  const runListing = async () => {
    if (running) return;
    running = true;
    cancelled = false;
    primaryButton.textContent = 'Stop full load';
    primaryButton.style.background = '#c63c4f';
    let stableChecks = 0;
    try {
      while (!cancelled && stableChecks < END_CHECKS_REQUIRED) {
        const before = countCards();
        setMessage(`Loading the full listing… (${before} loaded)`);
        const clicked = await clickNextLoadMore();
        const grew = await waitForGrowth(before);
        removeDuplicateItems();
        stableChecks = grew ? 0 : stableChecks + 1;
        if (!grew) {
          setMessage(`${clicked ? 'Load more produced no new items' : 'No Load more control found'} (${stableChecks}/${END_CHECKS_REQUIRED})`);
          await wait(END_CHECK_WAIT_MS);
        }
      }
      if (!cancelled) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        setMessage(`Loading complete (${countCards()} loaded)`);
      }
    } catch (error) {
      console.error('[Emoji.gg full-page loader]', error);
      setMessage(`Stopped after an error (${countCards()} loaded)`);
    } finally {
      running = false;
      primaryButton.textContent = 'Load full page';
      primaryButton.style.background = '#5865f2';
    }
  };

  if (isProfile) {
    primaryButton.addEventListener('click', () => {
      cancelled = true;
      abortController?.abort();
      setMessage(`Cancel load accepted (${countCards()} loaded). Use Resume / restart to continue.`);
    });
    resumeButton.addEventListener('click', runProfile);
    runProfile();
    return;
  }

  setMessageHtml('Full-page loading is off.<br>Click to load everything once.');
  primaryButton.addEventListener('click', () => {
    if (running) {
      cancelled = true;
      setMessage(`Loading paused (${countCards()} loaded). Click Load full page to continue.`);
      return;
    }
    sessionStorage.setItem(ONE_SHOT_KEY, '1');
    location.reload();
  });
  if (sessionStorage.getItem(ONE_SHOT_KEY) === '1') {
    sessionStorage.removeItem(ONE_SHOT_KEY);
    runListing();
  }
})();
