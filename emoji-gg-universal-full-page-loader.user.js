// ==UserScript==
// @name         Emoji.gg Universal Full Page Loader
// @namespace    emoji.gg.full-page-loader
// @version      1.0
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
  const PROFILE_BURST_PAGES = 20;
  const PROFILE_LATER_PAGES = 5;
  const MAX_CONCURRENT = 10;
  const END_CHECKS_REQUIRED = 3;
  const END_CHECK_WAIT_MS = 1400;
  const ONE_SHOT_KEY = `emoji-gg-full-load:${location.pathname}${location.search}`;
  const isProfile = /^\/user\/[^/]+\/?$/.test(location.pathname);
  const isListing = location.pathname === '/' || /^\/(emojis|stickers)(?:\/|$)/.test(location.pathname);
  if (!isProfile && !isListing) return;

  let running = false;
  let cancelled = false;
  let abortController = null;
  let nextProfilePage = 2;
  let knownIds = new Set();
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const countCards = () => document.querySelectorAll(CARD_SELECTOR).length;

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
  const setMessage = text => { message.textContent = text; };
  const setMessageHtml = html => { message.innerHTML = html; };

  const verifyTrueEnd = async () => {
    let stableChecks = 0;
    while (!cancelled && stableChecks < END_CHECKS_REQUIRED) {
      const before = countCards();
      setMessage(`Checking the bottom for more items… (${stableChecks + 1}/${END_CHECKS_REQUIRED})`);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
      window.dispatchEvent(new Event('scroll'));
      await wait(END_CHECK_WAIT_MS);
      const removed = removeDuplicateItems();
      const after = countCards();
      if (after > before) {
        stableChecks = 0;
        setMessage(`Found more items (${after} loaded); continuing…`);
      } else {
        stableChecks += 1;
        setMessage(`No new items (${stableChecks}/${END_CHECKS_REQUIRED}; ${after} loaded${removed ? `, ${removed} duplicates removed` : ''})`);
      }
    }
    return !cancelled;
  };

  const profilePageUrl = page => {
    const sort = new URLSearchParams(location.search).get('sort') || 'recent';
    return `${location.origin}${location.pathname}&page=${page}&sort=${encodeURIComponent(sort)}`;
  };
  const fetchProfilePage = async page => {
    const response = await fetch(profilePageUrl(page), {
      credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }, signal: abortController.signal
    });
    if (!response.ok) throw new Error(`Page ${page} returned ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    return { page, items: [...parsed.querySelectorAll(ITEM_SELECTOR)] };
  };
  const fetchProfilePages = async pages => {
    const results = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < pages.length && !cancelled) {
        const page = pages[cursor++];
        results.push(await fetchProfilePage(page));
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, pages.length) }, worker));
    return results.sort((a, b) => a.page - b.page);
  };
  const appendProfileResults = results => {
    const grid = document.querySelector(ITEM_SELECTOR)?.parentElement;
    if (!grid) throw new Error('Could not find the profile grid');
    let added = 0;
    for (const result of results) {
      for (const item of result.items) {
        const id = getItemId(item);
        if (!id || knownIds.has(id)) continue;
        knownIds.add(id);
        grid.appendChild(document.importNode(item, true));
        added += 1;
      }
    }
    window.lazyLoadInstance?.update?.();
    return added;
  };
  const loadProfileBurst = async size => {
    const pages = Array.from({ length: size }, (_, index) => nextProfilePage + index);
    setMessage(`Fetching profile pages ${pages[0]}–${pages.at(-1)} in parallel…`);
    const results = await fetchProfilePages(pages);
    if (cancelled) return { added: 0, reachedEnd: false };
    const added = appendProfileResults(results);
    nextProfilePage += size;
    setMessage(`Loaded ${countCards()} items (${added} added in this burst)`);
    return { added, reachedEnd: results.some(result => result.items.length === 0) };
  };
  const runProfile = async (restart = false) => {
    if (running) return;
    if (restart) nextProfilePage = 2;
    running = true;
    cancelled = false;
    abortController = new AbortController();
    rebuildKnownIds();
    try {
      let result = await loadProfileBurst(nextProfilePage === 2 ? PROFILE_BURST_PAGES : PROFILE_LATER_PAGES);
      while (!cancelled && !result.reachedEnd && result.added > 0) result = await loadProfileBurst(PROFILE_LATER_PAGES);
      if (!cancelled && await verifyTrueEnd()) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        setMessage(`Loading complete (${countCards()} loaded)`);
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

  const findLoadMore = () => [...document.querySelectorAll('a.btn, button.btn')]
    .find(element => element.textContent.trim().toLowerCase() === 'load more'
      && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true');
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
      setMessage(`Loading paused (${countCards()} loaded). Use Resume / restart to continue.`);
    });
    resumeButton.addEventListener('click', () => runProfile(false));
    runProfile(true);
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
