// ==UserScript==
// @name         Emoji.gg Full Page Loader & Collection Manager
// @namespace    emoji.gg.full-page-loader
// @version      1.0.1
// @description  Fast full-page loading for Emoji.gg profiles and listings, with previews, cross-tab collection management, and efficient pack submission.
// @author       Chase (itschase)
// @license      MIT
// @homepageURL  https://github.com/itschase/emoji-gg-full-page-loader-collection-manager
// @supportURL   https://github.com/itschase/emoji-gg-full-page-loader-collection-manager/issues
// @downloadURL  https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/emoji-gg-universal-full-page-loader.user.js
// @updateURL    https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/emoji-gg-universal-full-page-loader.user.js
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
  const COLLECTION_STORAGE_KEY = 'collection';
  const COLLECTION_SYNC_CHANNEL = 'emoji-gg-loader-collection';
  const ONE_SHOT_KEY = `emoji-gg-full-load:${location.pathname}${location.search}`;
  const isProfile = /^\/user\/[^/]+\/?$/.test(location.pathname);
  const isListing = location.pathname === '/' || /^\/(emojis|stickers|category)(?:\/|$)/.test(location.pathname);
  const hasLoader = isProfile || isListing;

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

  const makeButton = label => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      minHeight: '32px', padding: '7px 12px', border: '1px solid rgba(255,255,255,.16)',
      borderRadius: '7px', background: 'rgba(255,255,255,.12)', color: '#fff',
      font: '600 12px/1 system-ui,sans-serif', cursor: 'pointer', transition: 'background .15s ease'
    });
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,.2)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'rgba(255,255,255,.12)'; });
    return button;
  };
  const panel = document.createElement('div');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Emoji.gg full-page loader');
  Object.assign(panel.style, {
    position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
    width: 'min(320px, calc(100vw - 24px))', boxSizing: 'border-box', padding: '12px',
    border: '1px solid rgba(255,255,255,.12)', borderRadius: '10px',
    background: 'rgba(0,0,0,.78)', color: '#fff', font: '500 13px/1.4 system-ui,sans-serif',
    boxShadow: '0 8px 28px rgba(0,0,0,.38)', backdropFilter: 'blur(12px) saturate(120%)',
    webkitBackdropFilter: 'blur(12px) saturate(120%)'
  });
  const title = document.createElement('div');
  title.textContent = 'Emoji.gg Loader';
  Object.assign(title.style, {
    marginBottom: '5px', color: 'rgba(255,255,255,.62)', font: '700 10px/1.2 system-ui,sans-serif',
    letterSpacing: '.08em', textTransform: 'uppercase'
  });
  const message = document.createElement('div');
  message.setAttribute('aria-live', 'polite');
  message.style.marginBottom = '10px';
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '7px' });
  const primaryButton = makeButton(isProfile ? 'Load full profile' : 'Load full page');
  const clearCollectionButton = makeButton('Clear collection');
  clearCollectionButton.title = 'Clear the saved collection and reset selected icons in every open Emoji.gg tab';
  if (hasLoader) controls.append(primaryButton);
  panel.append(title, message, controls);
  const collectionSection = document.createElement('section');
  collectionSection.setAttribute('aria-label', 'Saved collection');
  collectionSection.style.cssText = 'margin-top:10px;border-top:1px solid rgba(255,255,255,.15);padding-top:10px';
  const collectionToggle = makeButton('Collection');
  collectionToggle.style.width = '100%';
  collectionToggle.setAttribute('aria-expanded', 'false');
  const collectionPreview = document.createElement('div');
  collectionPreview.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:9px 0;max-height:180px;overflow:auto';
  const previewStyles = document.createElement('style');
  previewStyles.textContent = `
    .emoji-loader-preview { position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0; }
    .emoji-loader-remove { position:absolute;top:0;right:0;width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.5);border-radius:50%;background:#171717;color:white;font:700 17px/18px system-ui,sans-serif;cursor:pointer;opacity:0;transition:opacity .12s; }
    .emoji-loader-preview:hover .emoji-loader-remove, .emoji-loader-preview:focus-within .emoji-loader-remove { opacity:1; }
    .emoji-loader-remove:focus-visible { outline:2px solid white;outline-offset:2px; }
    @media (hover:none), (pointer:coarse) { .emoji-loader-remove { opacity:1; } }
    @media (prefers-reduced-motion:reduce) { .emoji-loader-remove { transition:none; } }
  `;
  panel.append(previewStyles);
  const collectionActions = document.createElement('div');
  collectionActions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap';
  const submitCollectionButton = makeButton('Submit collection ↗');
  collectionActions.append(clearCollectionButton, submitCollectionButton);
  const collectionStatus = document.createElement('div');
  collectionStatus.style.cssText = 'font-size:11px;color:rgba(255,255,255,.7);margin-top:6px';
  collectionStatus.setAttribute('aria-live', 'polite');
  collectionSection.append(collectionToggle, collectionPreview, collectionActions, collectionStatus);
  panel.append(collectionSection);
  const minimizeKey = 'emoji-gg-widget-minimized';
  const panelContents = document.createElement('div');
  panelContents.id = 'emoji-loader-panel-contents';
  panelContents.append(title, message, controls, collectionSection);
  title.style.marginRight = '30px';
  const minimizeButton = makeButton('›');
  minimizeButton.setAttribute('aria-controls', panelContents.id);
  Object.assign(minimizeButton.style, { minHeight: '28px', width: '28px', padding: '0', fontSize: '20px' });
  panel.append(panelContents, minimizeButton);
  const applyMinimized = minimized => {
    panelContents.hidden = minimized;
    panel.style.width = minimized ? '40px' : 'min(320px, calc(100vw - 24px))';
    panel.style.padding = minimized ? '5px' : '12px';
    panel.style.right = minimized ? '0' : '12px';
    minimizeButton.style.position = minimized ? 'relative' : 'absolute';
    minimizeButton.style.top = minimized ? '0' : '6px';
    minimizeButton.style.right = minimized ? '0' : '6px';
    minimizeButton.textContent = minimized ? '‹' : '›';
    minimizeButton.title = minimized ? 'Show Emoji.gg tools' : 'Minimize Emoji.gg tools';
    minimizeButton.setAttribute('aria-label', minimizeButton.title);
    minimizeButton.setAttribute('aria-expanded', String(!minimized));
  };
  let initiallyMinimized = false;
  try { initiallyMinimized = localStorage.getItem(minimizeKey) === '1'; } catch { /* Keep the panel usable if storage is unavailable. */ }
  applyMinimized(initiallyMinimized);
  minimizeButton.addEventListener('click', () => {
    const minimized = !panelContents.hidden;
    applyMinimized(minimized);
    try { localStorage.setItem(minimizeKey, minimized ? '1' : '0'); } catch { /* Current-page toggling still works. */ }
  });
  window.addEventListener('storage', event => {
    if (event.key === minimizeKey) applyMinimized(event.newValue === '1');
  });
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

  const emptyCollectionMarkup = () => '<div class="col-12 text-center py-4">'
    + '<p class="small mb-1">Your collection is empty.</p>'
    + '<p class="small">Click the <i class="fa-solid fa-folder-plus"></i> to save items.</p>'
    + '</div>';

  const resetCollectionButton = button => {
    const hadToggleClasses = button.classList.contains('btn-success') || button.classList.contains('btn-default');
    button.classList.remove('btn-success', 'active', 'selected', 'is-selected');
    button.removeAttribute('aria-pressed');
    button.removeAttribute('data-selected');
    if (hadToggleClasses) {
      button.classList.add('btn-default');
      button.innerHTML = '<i class="far fa-bookmark"></i>';
    } else if (button.classList.contains('badge-ext')) {
      button.innerHTML = '<i class="far fa-bookmark"></i>';
    } else {
      button.innerHTML = '<i class="fa-solid fa-folder-plus text-dark"></i>';
    }
  };

  let collectionExpanded = false;
  let lastCollectionSignature = null;
  const readCollection = () => {
    try {
      const value = JSON.parse(localStorage.getItem(COLLECTION_STORAGE_KEY) || '[]');
      return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[\w.-]+$/.test(id)))] : [];
    } catch { return []; }
  };
  const refreshCollection = (force = false) => {
    const items = readCollection();
    const signature = JSON.stringify(items);
    if (!force && signature === lastCollectionSignature) return;
    lastCollectionSignature = signature;
    // Do not call setCollection here: writing from storage listeners can cause tab feedback loops.
    if (window.App) {
      window.App.collection = items.slice();
      window.App.loadCollectionItems?.();
    } else if (!items.length) {
      document.querySelectorAll('.collection-items').forEach(el => { el.innerHTML = emptyCollectionMarkup(); });
    }
    const selected = new Set(items);
    document.querySelectorAll('.collection[data-id]').forEach(button => {
      if (selected.has(button.dataset.id)) {
        button.innerHTML = '<i class="fas fa-check"></i>';
        button.setAttribute('aria-pressed', 'true');
      } else resetCollectionButton(button);
    });
    const count = document.querySelector('#collection-count');
    if (count) {
      count.textContent = String(items.length);
      count.style.display = items.length ? '' : 'none';
    }
    collectionSection.hidden = !items.length;
    panel.hidden = !hasLoader && !items.length;
    message.hidden = !hasLoader;
    controls.hidden = !hasLoader;
    collectionToggle.textContent = `Collection · ${items.length}/32 ${collectionExpanded ? '▴' : '▾'}`;
    collectionToggle.setAttribute('aria-expanded', String(collectionExpanded));
    collectionPreview.replaceChildren();
    for (const id of items.slice(0, collectionExpanded ? items.length : 5)) {
      const preview = document.createElement('span');
      preview.className = 'emoji-loader-preview';
      const image = document.createElement('img');
      image.src = `https://cdn3.emoji.gg/emojis/${encodeURIComponent(id)}`;
      image.width = image.height = 34;
      image.alt = id.replace(/^[0-9]+-/, '').replace(/\.[^.]+$/, '');
      image.title = image.alt;
      image.loading = 'lazy';
      image.style.cssText = 'object-fit:contain;background:rgba(255,255,255,.04);border-radius:5px';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'emoji-loader-remove';
      remove.textContent = '×';
      remove.title = `Remove ${image.alt} from collection`;
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => {
        const index = [...collectionPreview.querySelectorAll('.emoji-loader-remove')].indexOf(remove);
        const keepKeyboardFocus = document.activeElement === remove;
        saveCollection(readCollection().filter(item => item !== id));
        if (keepKeyboardFocus) {
          const remaining = collectionPreview.querySelectorAll('.emoji-loader-remove');
          (remaining[Math.min(index, remaining.length - 1)] || collectionToggle).focus();
        }
      });
      preview.append(image, remove);
      collectionPreview.append(preview);
    }
    if (!collectionExpanded && items.length > 5) {
      const more = document.createElement('span');
      more.textContent = `+${items.length - 5}`;
      collectionPreview.append(more);
    }
    submitCollectionButton.disabled = items.length === 0 || items.length > 32;
    collectionStatus.textContent = items.length > 32 ? 'Reduce to 32 items before submitting.' : 'Clears automatically after a successful pack submission.';
  };
  let collectionChannel = null;
  if ('BroadcastChannel' in window) {
    collectionChannel = new BroadcastChannel(COLLECTION_SYNC_CHANNEL);
    collectionChannel.addEventListener('message', () => refreshCollection(true));
  }
  const saveCollection = items => {
    localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(items));
    refreshCollection(true);
    collectionChannel?.postMessage({ type: 'collection-changed' });
  };
  window.addEventListener('storage', event => {
    if (event.key === COLLECTION_STORAGE_KEY || event.key === null) refreshCollection(true);
  });
  window.addEventListener('focus', () => refreshCollection(true));
  collectionToggle.addEventListener('click', () => {
    collectionExpanded = !collectionExpanded;
    refreshCollection(true);
  });
  clearCollectionButton.addEventListener('click', () => saveCollection([]));
  submitCollectionButton.addEventListener('click', () => {
    if (!submitCollectionButton.disabled) window.open(`${location.origin}/submit/pack`, '_blank', 'noopener');
  });
  // Re-read shared state before the site's delegated add/remove/submit handler runs.
  document.addEventListener('click', event => {
    if (event.target.closest?.('.collection, .remove-collection, .clear-collection, .item-submit') && window.App) {
      window.App.collection = readCollection();
    }
  }, true);

  let hookedApp = null;
  let hookedAjax = false;
  const submittedCollections = new WeakMap();
  const installCollectionHooks = () => {
    const app = window.App;
    if (app?.setCollection && hookedApp !== app) {
      hookedApp = app;
      const originalSet = app.setCollection;
      app.setCollection = function (...args) {
        const result = originalSet.apply(this, args);
        refreshCollection(true);
        collectionChannel?.postMessage({ type: 'collection-changed' });
        return result;
      };
      refreshCollection(true);
    }
    if (!hookedAjax && window.jQuery) {
      hookedAjax = true;
      window.jQuery(document).on('ajaxSend.emojiLoaderCollection', (_event, xhr, settings) => {
        if (new URL(settings.url, location.href).pathname !== '/api/submit/pack') return;
        // Snapshot the actual submitted IDs; retain items added while the request was in flight.
        const raw = settings.data?.get?.('items');
        if (typeof raw === 'string') submittedCollections.set(xhr, raw.split(',').filter(Boolean));
      }).on('ajaxSuccess.emojiLoaderCollection', (_event, xhr, _settings, response) => {
        const submitted = submittedCollections.get(xhr);
        if (!submitted) return;
        submittedCollections.delete(xhr);
        let result = response;
        try { if (typeof result === 'string') result = JSON.parse(result); } catch { return; }
        if (result?.status !== 'success') return;
        const completed = new Set(submitted);
        saveCollection(readCollection().filter(id => !completed.has(id)));
      });
    }
  };
  installCollectionHooks();
  refreshCollection(true);
  // Lightweight fallback for delayed site startup or older background tabs returning to focus.
  window.setInterval(() => { installCollectionHooks(); refreshCollection(); }, 1000);

  if (!hasLoader) {
    return;
  }

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
        setMessage(`Paused after an error (${countCards()} loaded). Click Load full profile to continue.`);
      }
    } finally {
      running = false;
      primaryButton.textContent = 'Load full profile';
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
