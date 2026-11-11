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
  const PROFILE_PAGES_PER_BATCH = 20;
  const END_CHECKS_REQUIRED = 3;
  const END_CHECK_WAIT_MS = 1400;
  const PROFILE_END_CHECK_WAIT_MS = 400;
  const ONE_SHOT_KEY = `emoji-gg-full-load:${location.pathname}${location.search}`;
  const isProfile = /^\/user\/[^/]+\/?$/.test(location.pathname);
  const isListing = location.pathname === '/' || /^\/(emojis|stickers|category)(?:\/|$)/.test(location.pathname);
  if (!isProfile && !isListing) return;

  let running = false;
  let cancelled = false;
  let abortController = null;
  let knownIds = new Set();
  let nextProfilePage = 1;
  let profileComplete = false;
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
  const primaryButton = makeButton(isProfile ? 'Load full profile' : 'Load full page', '#5865f2');
  controls.append(primaryButton);
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

  const findLoadMore = () => [...document.querySelectorAll('a, button')]
    .find(element => element.textContent.trim().toLowerCase() === 'load more'
      && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true'
      && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length));

  const getProfilePageUrl = page => {
    const sort = new URL(location.href).searchParams.get('sort') || 'recent';
    return `${location.origin}${location.pathname}&page=${page}&sort=${encodeURIComponent(sort)}`;
  };
  const fetchProfilePage = async page => {
    const response = await fetch(getProfilePageUrl(page), {
      credentials: 'same-origin',
      signal: abortController?.signal
    });
    if (!response.ok) throw new Error(`Profile page ${page} returned ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    return { page, items: [...parsed.querySelectorAll(ITEM_SELECTOR)] };
  };
  const appendProfileItems = results => {
    const container = document.querySelector('#items') || document.querySelector(ITEM_SELECTOR)?.parentElement;
    if (!container) throw new Error('Profile item container was not found');
    document.querySelector('#pagination')?.remove();
    let appended = 0;
    for (const result of results.sort((left, right) => left.page - right.page)) {
      for (const sourceItem of result.items) {
        const id = getItemId(sourceItem);
        if (!id || knownIds.has(id)) continue;
        const item = document.importNode(sourceItem, true);
        for (const image of item.querySelectorAll('img[data-src]')) {
          image.src = image.dataset.src;
          image.loading = 'lazy';
        }
        container.appendChild(item);
        knownIds.add(id);
        appended += 1;
      }
    }
    return appended;
  };
  const runProfile = async () => {
    if (running) return;
    running = true;
    cancelled = false;
    abortController = new AbortController();
    primaryButton.textContent = 'Cancel loading';
    primaryButton.style.background = '#c63c4f';
    rebuildKnownIds();
    try {
      const expected = getProfileExpectedCount();
      let emptyChecks = 0;
      document.querySelector('#pagination')?.remove();
      while (!cancelled && emptyChecks < END_CHECKS_REQUIRED) {
        const firstPage = nextProfilePage;
        const pagesThisPass = emptyChecks === 0 ? PROFILE_PAGES_PER_BATCH : 1;
        const lastPage = firstPage + pagesThisPass - 1;
        setMessage(`Fetching profile pages ${firstPage}–${lastPage} in parallel (${countCards()}${expected ? `; profile reports ${expected}` : ''} visible)…`);
        const pages = Array.from({ length: pagesThisPass }, (_, index) => firstPage + index);
        const results = await Promise.all(pages.map(fetchProfilePage));
        const returned = results.reduce((total, result) => total + result.items.length, 0);
        const appended = appendProfileItems(results);
        const nonEmptyPages = results.filter(result => result.items.length);
        if (returned > 0) {
          nextProfilePage = Math.max(...nonEmptyPages.map(result => result.page)) + 1;
          emptyChecks = 0;
          setMessage(`Loaded ${appended} new items from a ${PROFILE_BATCH_SIZE}-item page batch (${countCards()} visible); continuing…`);
          continue;
        }
        emptyChecks += 1;
        setMessage(`No items returned at page ${firstPage} (${emptyChecks}/${END_CHECKS_REQUIRED}; ${countCards()} visible)`);
        await wait(PROFILE_END_CHECK_WAIT_MS);
      }
      if (!cancelled && emptyChecks >= END_CHECKS_REQUIRED) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        removeDuplicateItems();
        profileComplete = true;
        setMessage(`Loading complete (${countCards()} visible; three empty page batches confirmed)`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Emoji.gg full-page loader]', error);
        setMessage(`Paused after an error (${countCards()} loaded) — click Resume`);
      }
    } finally {
      running = false;
      primaryButton.textContent = 'Load full profile';
      primaryButton.style.background = '#5865f2';
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
      if (running) {
        cancelled = true;
        abortController?.abort();
        setMessage(`Cancel load accepted (${countCards()} loaded). Click Load full profile to continue.`);
        return;
      }
      if (profileComplete) {
        nextProfilePage = 1;
        profileComplete = false;
      }
      runProfile();
    });
    setMessageHtml('Full-profile loading is off.<br>Click to load every profile item.');
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
