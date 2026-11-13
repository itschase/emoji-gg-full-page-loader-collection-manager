// ==UserScript==
// @name         Emoji.gg Full Page Loader & Collection Manager
// @namespace    emoji.gg.full-page-loader
// @version      1.2.12
// @description  Fast full-page loading for Emoji.gg profiles and listings, with previews, cross-tab collection management, and efficient pack submission.
// @author       Chase (itschase)
// @license      MIT
// @homepageURL  https://github.com/itschase/emoji-gg-full-page-loader-collection-manager
// @supportURL   https://github.com/itschase/emoji-gg-full-page-loader-collection-manager/issues
// @downloadURL  https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/emoji-gg-universal-full-page-loader.user.js
// @updateURL    https://raw.githubusercontent.com/itschase/emoji-gg-full-page-loader-collection-manager/main/emoji-gg-universal-full-page-loader.user.js
// @match        https://emoji.gg/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const CARD_SELECTOR = '.card-image.asset:not(.product)';
  const ITEM_SELECTOR = `.item:has(${CARD_SELECTOR})`;
  const PROFILE_PAGES_PER_BATCH = 20;
  const LISTING_PAGES_PER_BATCH = 8;
  const END_CHECKS_REQUIRED = 3;
  const END_CHECK_WAIT_MS = 1400;
  const PROFILE_END_CHECK_WAIT_MS = 400;
  const COLLECTION_STORAGE_KEY = 'collection';
  const COLLECTION_SYNC_CHANNEL = 'emoji-gg-loader-collection';
  const ONE_SHOT_KEY = `emoji-gg-full-load:${location.pathname}${location.search}`;
  const LISTING_READY_KEY = `${ONE_SHOT_KEY}:ready`;
  const isProfile = /^\/user\/[^/]+\/?$/.test(location.pathname);
  const isProfilePacks = /^\/user\/[^/]+\/packs\/?$/.test(location.pathname);
  const isParallelProfile = isProfile || isProfilePacks;
  const isListing = isProfilePacks || location.pathname === '/' || /^\/(emojis|stickers|category|packs|search)(?:\/|$)/.test(location.pathname);
  const hasLoader = isProfile || isListing;

  let running = false;
  let cancelled = false;
  let abortController = null;
  let knownIds = new Set();
  let nextProfilePage = 1;
  let profileComplete = false;
  let nextListingPage = null;
  let listingComplete = false;
  let profileDuplicateObserver = null;
  let timerWorker = null;
  let timerSequence = 0;
  const timerResolvers = new Map();
  try {
    timerWorker = new Worker(URL.createObjectURL(new Blob([
      'self.onmessage=e=>setTimeout(()=>self.postMessage(e.data.id),e.data.delay)'
    ], { type: 'text/javascript' })));
    timerWorker.onmessage = event => {
      timerResolvers.get(event.data)?.();
      timerResolvers.delete(event.data);
    };
  } catch { /* Normal timers remain available if blob workers are unavailable. */ }
  const wait = milliseconds => {
    if (!timerWorker) return new Promise(resolve => setTimeout(resolve, milliseconds));
    const id = ++timerSequence;
    return new Promise(resolve => {
      timerResolvers.set(id, resolve);
      timerWorker.postMessage({ id, delay: milliseconds });
    });
  };
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
    const view = item.querySelector('a[href*="/emoji/"], a[href*="/sticker/"], a[href*="/pack/"]');
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
  const watchProfileDuplicates = () => {
    if (profileDuplicateObserver) return;
    const grid = document.querySelector('#items');
    if (!grid) return;
    profileDuplicateObserver = new MutationObserver(records => {
      if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.(ITEM_SELECTOR) || node.querySelector?.(ITEM_SELECTOR))))) return;
      removeDuplicateItems();
      if (running || profileComplete) document.querySelector('#pagination')?.remove();
    });
    profileDuplicateObserver.observe(grid, { childList: true });
  };
  const PROMOTION_SELECTOR = '.card-image.asset.product, .item > a.tool-card, .feature-row';
  const removePromotionalCards = root => {
    const removePromotion = element => {
      if (element.matches('.feature-row')) {
        (element.closest('.row.g-3.mb-5.mobile-hide') || element).remove();
      } else {
        (element.closest('.item') || element.closest('.asset-card') || element).remove();
      }
    };
    if (root.matches?.(PROMOTION_SELECTOR)) removePromotion(root);
    root.querySelectorAll?.(PROMOTION_SELECTOR).forEach(removePromotion);
  };
  removePromotionalCards(document);
  const productObserver = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) removePromotionalCards(node);
      }
    }
  });
  productObserver.observe(document.body, { childList: true, subtree: true });

  const makeButton = (label, textOnly = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    Object.assign(button.style, {
      minHeight: '32px', padding: '7px 12px', border: '1px solid rgba(255,255,255,.16)',
      borderRadius: '7px', background: '#111214', color: '#ddd',
      font: '600 12px/1 system-ui,sans-serif', cursor: 'pointer', transition: 'background .15s ease'
    });
    button.addEventListener('mouseenter', () => { if (!textOnly) button.style.background = '#1b1d20'; });
    button.addEventListener('mouseleave', () => { if (!textOnly) button.style.background = '#111214'; });
    return button;
  };
  const addButtonIcon = (button, path) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    svg.style.cssText = 'vertical-align:-2px;margin-right:6px;opacity:.8;pointer-events:none';
    button.prepend(svg);
  };
  const panel = document.createElement('div');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Emoji.gg full-page loader');
  panel.style.userSelect = 'none';
  panel.style.webkitUserSelect = 'none';
  Object.assign(panel.style, {
    position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
    width: 'min(320px, calc(100vw - 24px))', boxSizing: 'border-box', padding: '12px',
    border: '1px solid rgba(255,255,255,.12)', borderRadius: '10px',
    background: 'rgba(0,0,0,.78)', color: '#fff', font: '500 13px/1.4 system-ui,sans-serif',
    boxShadow: '0 8px 28px rgba(0,0,0,.38)', backdropFilter: 'blur(12px) saturate(120%)',
    webkitBackdropFilter: 'blur(12px) saturate(120%)'
  });
  const title = document.createElement('div');
  title.textContent = 'EMOJI.GG Loader & Collection Manager';
  Object.assign(title.style, {
    marginBottom: '5px', color: 'rgba(255,255,255,.62)', font: '700 10px/1.2 system-ui,sans-serif',
    letterSpacing: '.08em', textTransform: 'uppercase'
  });
  const message = document.createElement('div');
  message.setAttribute('aria-live', 'polite');
  message.style.marginBottom = '10px';
  const controls = document.createElement('div');
  Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '7px' });
  const primaryButton = makeButton(isParallelProfile ? 'Load full profile' : 'Load full page');
  const settingsButton = makeButton('');
  settingsButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l1.7-1.3-1.7-2.9-2 .8a7.8 7.8 0 0 0-2.6-1.5l-.3-2.1h-3.4l-.3 2.1a7.8 7.8 0 0 0-2.6 1.5l-2-.8-1.7 2.9 1.7 1.3a7.8 7.8 0 0 0 0 3l-1.7 1.3 1.7 2.9 2-.8a7.8 7.8 0 0 0 2.6 1.5l.3 2.1h3.4l.3-2.1a7.8 7.8 0 0 0 2.6-1.5l2 .8 1.7-2.9-1.7-1.3Z"/></svg>';
  settingsButton.title = 'Settings';
  settingsButton.setAttribute('aria-label', 'Settings');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.style.cssText = 'width:26px;height:26px;min-height:26px;padding:0;border:0;background:transparent;color:#aaa;display:inline-flex;align-items:center;justify-content:center;flex:none';
  const settingsPanel = document.createElement('div');
  settingsPanel.hidden = true;
  settingsPanel.style.cssText = 'position:absolute;bottom:42px;left:12px;right:12px;z-index:2;padding:10px;border:1px solid #333;border-radius:8px;background:#101216;box-shadow:0 8px 24px rgba(0,0,0,.6)';
  const settingKey = 'emoji-gg-widget-settings';
  let settings = { hideView: false, showCollectionActions: true, darker: false, hideSupplement: false };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(settingKey) || '{}') }; } catch { /* Defaults remain usable. */ }
  const makeSetting = (label, key) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;margin:5px 0;cursor:pointer';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(settings[key]);
    row.append(input, document.createTextNode(label));
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      localStorage.setItem(settingKey, JSON.stringify(settings));
      applySitePreferences();
      refreshSupplementVisibility();
    });
    settingsPanel.append(row);
    return input;
  };
  const hideViewInput = makeSetting('Hide View buttons', 'hideView');
  const showActionsInput = makeSetting('Keep collection controls visible', 'showCollectionActions');
  const darkerInput = makeSetting('Darker styling', 'darker');
  const hideSupplementInput = makeSetting('Hide Unwanted Content', 'hideSupplement');
  hideSupplementInput.closest('label').title = 'Hides footers, related sections, and tag lists. Promotional cards are removed automatically.';
  const supplementHint = document.createElement('div');
  supplementHint.textContent = 'Hides footers and related sections. Promotional cards are filtered automatically.';
  supplementHint.style.cssText = 'margin:0 0 7px 22px;color:#aaa;font-size:11px;line-height:1.3';
  settingsPanel.append(supplementHint);
  const settingsHint = document.createElement('div');
  settingsHint.style.cssText = 'color:#d99;font-size:11px';
  settingsHint.textContent = 'Asset links open in a new tab while a collection is active.';
  settingsPanel.append(settingsHint);
  settingsButton.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  });
  const clearCollectionButton = makeButton('Clear collection');
  addButtonIcon(clearCollectionButton, 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');
  clearCollectionButton.title = 'Clear the saved collection and reset selected icons in every open Emoji.gg tab';
  if (hasLoader) controls.append(primaryButton);
  const jumpControls = document.createElement('div');
  jumpControls.style.cssText = 'display:none;align-items:center;gap:4px;flex:none';
  const topButton = makeButton('↑');
  const bottomButton = makeButton('↓');
  topButton.title = 'Scroll to the top of this page';
  bottomButton.title = 'Scroll to the bottom of this page';
  topButton.setAttribute('aria-label', 'Scroll to top');
  bottomButton.setAttribute('aria-label', 'Scroll to bottom');
  for (const button of [topButton, bottomButton]) {
    Object.assign(button.style, { width: '24px', height: '24px', minHeight: '24px', padding: '0', fontSize: '15px' });
  }
  topButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  bottomButton.addEventListener('click', () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
  jumpControls.append(topButton, bottomButton);
  const updateJumpControls = () => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const position = Math.max(0, window.scrollY || window.pageYOffset || 0);
    const topHidden = position <= 8;
    const bottomHidden = position >= maxScroll - 8;
    const display = !panelContents.hidden && maxScroll > 8 ? 'flex' : 'none';
    if (topButton.hidden !== topHidden) topButton.hidden = topHidden;
    if (bottomButton.hidden !== bottomHidden) bottomButton.hidden = bottomHidden;
    if (jumpControls.style.display !== display) jumpControls.style.display = display;
  };
  let jumpUpdateQueued = false;
  const scheduleJumpControls = () => {
    if (jumpUpdateQueued) return;
    jumpUpdateQueued = true;
    (window.requestAnimationFrame || (callback => window.setTimeout(callback, 16)))(() => {
      jumpUpdateQueued = false;
      updateJumpControls();
    });
  };
  window.addEventListener('scroll', updateJumpControls, { passive: true });
  window.addEventListener('resize', scheduleJumpControls);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleJumpControls).observe(document.body);
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-right:28px;margin-bottom:5px;min-height:24px';
  title.style.cssText += ';margin:0;min-width:0;flex:1';
  header.append(title, jumpControls);
  panel.append(header, message, controls);
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
  const submitCollectionButton = makeButton('Submit collection');
  addButtonIcon(submitCollectionButton, 'M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7');
  submitCollectionButton.title = 'Opens collection submission in a new tab';
  const inlineSubmitButton = makeButton('Submit Collection (beta)');
  addButtonIcon(inlineSubmitButton, 'M3 4h18v16H3zM3 8h18M7 6h.01M10 6h.01');
  inlineSubmitButton.title = 'Opens a submission dialog in the same tab';
  Object.assign(inlineSubmitButton.style, { color: '#bbb', lineHeight: '1.4' });
  const submitActions = document.createElement('div');
  submitActions.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:3px;margin-left:auto';
  submitActions.append(submitCollectionButton, inlineSubmitButton);
  const exportCollectionButton = makeButton('Export ZIP');
  addButtonIcon(exportCollectionButton, 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5');
  exportCollectionButton.title = 'Download all selected items, including collections larger than 32 items';
  const submitRow = document.createElement('div');
  submitRow.style.cssText = 'display:flex;justify-content:flex-end;flex-basis:100%';
  submitRow.append(submitActions);
  collectionActions.append(clearCollectionButton, exportCollectionButton, submitRow);
  const collectionStatus = document.createElement('div');
  collectionStatus.style.cssText = 'font-size:11px;color:rgba(255,255,255,.7);margin-top:6px';
  collectionStatus.setAttribute('aria-live', 'polite');
  collectionSection.append(collectionToggle, collectionPreview, collectionActions);
  panel.append(collectionSection);
  const footerControls = document.createElement('div');
  footerControls.style.cssText = 'display:flex;align-items:flex-start;gap:5px;margin-top:6px';
  collectionStatus.style.marginTop = '4px';
  footerControls.append(settingsButton, collectionStatus);
  const minimizeKey = 'emoji-gg-widget-minimized';
  const panelContents = document.createElement('div');
  panelContents.id = 'emoji-loader-panel-contents';
  panelContents.append(header, message, controls, collectionSection, footerControls, settingsPanel);
  const minimizeButton = makeButton('›');
  minimizeButton.setAttribute('aria-controls', panelContents.id);
  Object.assign(minimizeButton.style, { height: '28px', minHeight: '28px', width: '28px', padding: '0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  panel.append(panelContents, minimizeButton);
  const applyMinimized = minimized => {
    panelContents.hidden = minimized;
    panel.style.width = minimized ? '40px' : 'min(320px, calc(100vw - 24px))';
    panel.style.padding = minimized ? '5px' : '12px';
    panel.style.right = minimized ? '0' : '12px';
    minimizeButton.style.position = minimized ? 'relative' : 'absolute';
    minimizeButton.style.top = minimized ? '0' : '6px';
    minimizeButton.style.right = minimized ? '0' : '6px';
    minimizeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${minimized ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}"/></svg>`;
    minimizeButton.title = minimized ? 'Show Emoji.gg tools' : 'Minimize Emoji.gg tools';
    minimizeButton.setAttribute('aria-label', minimizeButton.title);
    minimizeButton.setAttribute('aria-expanded', String(!minimized));
    updateJumpControls();
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
  const siteStyles = document.createElement('style');
  siteStyles.textContent = `
    html.emoji-loader-hide-view .card-image.asset .buttons a[href*="/emoji/"],
    html.emoji-loader-hide-view .card-image.asset .buttons a[href*="/sticker/"],
    html.emoji-loader-hide-view .card-image.asset .buttons a[href*="/pack/"] { display:none!important; }
    html.emoji-loader-collection-active .card-image.asset:not(.pack) .buttons a,
    html.emoji-loader-collection-active .card-image.asset:not(.pack) .buttons .collection {
      opacity:1!important;transform:scale(1)!important;color:rgba(255,255,255,.9)!important;
    }
    html.emoji-loader-collection-active .card-image.asset:not(.pack) .ovrly { opacity:.35!important;pointer-events:none; }
    html.emoji-loader-darker body, html.emoji-loader-darker main,
    html.emoji-loader-darker #submit-page { background-color:#000!important;color:#e6e6e6!important; }
    html.emoji-loader-darker .container.content,
    html.emoji-loader-darker .scrollable,
    html.emoji-loader-darker .profile-header.bg-body,
    html.emoji-loader-darker .hero-search,
    html.emoji-loader-darker .listing-preview { background-color:#000!important; }
    html.emoji-loader-darker nav, html.emoji-loader-darker footer,
    html.emoji-loader-darker .offcanvas { background-color:#000!important;color:#e6e6e6!important; }
    html.emoji-loader-darker .asset-card {
      background-color:#000!important;color:#e6e6e6!important;border:0!important;box-shadow:none!important;
    }
    html.emoji-loader-darker .asset-card .card-image.asset,
    html.emoji-loader-darker .asset-card .card-body { background-color:#000!important; }
    html.emoji-loader-darker .card-image.asset .buttons .collection {
      background-color:#262626!important;color:#eee!important;border-color:#363636!important;
    }
    html.emoji-loader-darker .card-image.asset .buttons .collection:hover,
    html.emoji-loader-darker .card-image.asset .buttons .collection:focus-visible {
      background-color:#343434!important;
    }
    html.emoji-loader-darker .card-image.asset .buttons .collection i { color:#eee!important; }
    html.emoji-loader-darker .gradient-placeholder-wrapper .form-control {
      background:#000!important;color:#e6e6e6!important;border-color:#222!important;
    }
    html.emoji-loader-darker .gradient-placeholder-wrapper .input-group-text,
    html.emoji-loader-darker .gradient-placeholder-wrapper .collection-link {
      background:#1b1b1b!important;color:#e6e6e6!important;border-color:#222!important;
    }
    html.emoji-loader-darker .gradient-placeholder-wrapper .placeholder-overlay-text { color:#bcbcbc!important; }
    html.emoji-loader-darker .card:not(.asset-card), html.emoji-loader-darker .dropdown-menu,
    html.emoji-loader-darker .modal-content { background-color:#000!important;color:#e6e6e6!important;border-color:#222!important; }
    html.emoji-loader-darker .btn-secondary, html.emoji-loader-darker .bg-secondary {
      background-color:#1b1b1b!important;color:#e6e6e6!important;border-color:#292929!important;
    }
    html.emoji-loader-darker .btn {
      background-color:#1b1b1b!important;color:#e6e6e6!important;border-color:#292929!important;
    }
    html.emoji-loader-darker .btn:hover, html.emoji-loader-darker .btn:focus-visible {
      background-color:#292929!important;color:#fff!important;border-color:#3a3a3a!important;
    }
    html.emoji-loader-darker #submit-page .nav-link.active,
    html.emoji-loader-darker .badge.bg-primary,
    html.emoji-loader-darker .badge.text-bg-primary {
      background-color:#1b1b1b!important;color:#eee!important;border-color:#292929!important;
    }
    html.emoji-loader-darker input, html.emoji-loader-darker select,
    html.emoji-loader-darker textarea, html.emoji-loader-darker .form-control {
      background-color:#000!important;color:#f2f2f2!important;border-color:#303030!important;
    }
    html.emoji-loader-darker .text-muted { color:#aaa!important; }
  `;
  document.head.append(siteStyles);
  const applySitePreferences = () => {
    document.documentElement.classList.toggle('emoji-loader-hide-view', Boolean(settings.hideView));
    document.documentElement.classList.toggle('emoji-loader-darker', Boolean(settings.darker));
    document.documentElement.classList.toggle('emoji-loader-collection-active', Boolean(settings.showCollectionActions && localStorage.getItem(COLLECTION_STORAGE_KEY) !== '[]' && localStorage.getItem(COLLECTION_STORAGE_KEY)));
  };
  applySitePreferences();
  document.body.appendChild(panel);
  updateJumpControls();
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
  const setMessageLines = (...lines) => {
    ensurePanel();
    message.replaceChildren(...lines.map(text => {
      const line = document.createElement('div');
      line.textContent = text;
      return line;
    }));
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
    document.documentElement.classList.toggle('emoji-loader-collection-active', Boolean(items.length && settings.showCollectionActions));
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
    inlineSubmitButton.disabled = submitCollectionButton.disabled;
    inlineSubmitButton.style.opacity = inlineSubmitButton.disabled ? '.45' : '1';
    exportCollectionButton.disabled = items.length === 0;
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
    if (event.key === settingKey) {
      try { settings = { ...settings, ...JSON.parse(event.newValue || '{}') }; } catch { /* Keep current settings. */ }
      hideViewInput.checked = Boolean(settings.hideView);
      showActionsInput.checked = Boolean(settings.showCollectionActions);
      darkerInput.checked = Boolean(settings.darker);
      hideSupplementInput.checked = Boolean(settings.hideSupplement);
      applySitePreferences();
      refreshSupplementVisibility();
    }
  });
  window.addEventListener('focus', () => refreshCollection(true));
  collectionToggle.addEventListener('click', () => {
    collectionExpanded = !collectionExpanded;
    refreshCollection(true);
  });
  clearCollectionButton.addEventListener('click', () => saveCollection([]));
  exportCollectionButton.addEventListener('click', () => {
    const items = readCollection();
    if (!items.length) return;
    if (window.App?.downloadCollectionItems) {
      window.App.collection = items.slice();
      window.App.downloadCollectionItems();
      return;
    }
    setMessage('ZIP export is unavailable until Emoji.gg finishes loading its download tools.');
  });
  submitCollectionButton.addEventListener('click', () => {
    if (!submitCollectionButton.disabled) window.open(`${location.origin}/submit/pack`, '_blank', 'noopener');
  });
  let submitDialog = null;
  let completionToast = null;
  let completionToastTimer = null;
  const showCollectionCompletion = () => {
    completionToast?.remove();
    clearTimeout(completionToastTimer);
    completionToast = document.createElement('button');
    completionToast.type = 'button';
    completionToast.textContent = 'Collection submitted successfully';
    completionToast.title = 'Click to dismiss';
    completionToast.setAttribute('aria-live', 'polite');
    completionToast.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 24px);padding:12px 18px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:rgba(0,0,0,.88);color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.38);backdrop-filter:blur(12px);cursor:pointer';
    const toast = completionToast;
    const dismiss = () => {
      clearTimeout(completionToastTimer);
      toast.remove();
      if (completionToast === toast) completionToast = null;
    };
    toast.addEventListener('click', dismiss);
    document.body.append(toast);
    completionToastTimer = setTimeout(dismiss, 10000);
  };
  inlineSubmitButton.addEventListener('click', () => {
    if (inlineSubmitButton.disabled) return;
    if (!submitDialog) {
      submitDialog = document.createElement('dialog');
      const dialog = submitDialog;
      let submittedSuccessfully = false;
      submitDialog.setAttribute('aria-label', 'Submit collection');
      submitDialog.style.cssText = 'width:min(900px,94vw);height:min(850px,90vh);max-width:94vw;max-height:90vh;padding:0;border:1px solid #444;border-radius:12px;background:#101216;color:white;overflow:hidden';
      const dialogStyles = document.createElement('style');
      dialogStyles.textContent = 'dialog[aria-label="Submit collection"]::backdrop{background:rgba(0,0,0,.7)}';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid #333';
      bar.style.userSelect = 'none';
      bar.style.webkitUserSelect = 'none';
      const label = document.createElement('span');
      label.textContent = 'Submit Collection (beta)';
      const close = makeButton('Close');
      close.addEventListener('click', () => submitDialog.close());
      bar.append(label, close);
      const frame = document.createElement('iframe');
      frame.title = 'Emoji.gg collection submission';
      frame.style.cssText = 'display:block;width:100%;height:calc(100% - 45px);border:0;background:#101216';
      frame.addEventListener('load', () => {
        try {
          const doc = frame.contentDocument;
          if (!doc?.querySelector('#submit-form')) return;
          const style = doc.createElement('style');
          style.textContent = 'nav,footer,.hero-search,[aria-label="Emoji.gg full-page loader"],#submit-page > ul{display:none!important} #submit-page{padding-top:12px!important}';
          doc.head.append(style);
          // Keep the native form, tag autocomplete, validation, and success response.
          let pending = false;
          doc.addEventListener('click', event => {
            if (!event.target.closest?.('.item-submit[data-type="pack"]')) return;
            if (pending) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            pending = true;
            frame.contentWindow.jQuery?.(doc).one('ajaxComplete.emojiLoaderDialog', () => { pending = false; });
            frame.contentWindow.setTimeout(() => { pending = false; }, 15000);
          }, true);
          frame.contentWindow.jQuery?.(doc)?.on('ajaxSuccess.emojiLoaderDialog', (_event, _xhr, settings, response) => {
            if (new URL(settings.url, location.href).pathname !== '/api/submit/pack') return;
            let result = response;
            try { if (typeof result === 'string') result = JSON.parse(result); } catch { return; }
            if (result?.status !== 'success' || submittedSuccessfully) return;
            submittedSuccessfully = true;
            // Let the site's and the userscript's success handlers clear the submitted selection first.
            frame.contentWindow.setTimeout(() => {
              if (submitDialog !== dialog) return;
              if (dialog.open) dialog.close();
              showCollectionCompletion();
            }, 0);
          });
        } catch { /* Leave native page messages visible if embedding is unavailable. */ }
      });
      frame.src = `${location.origin}/submit/pack`;
      submitDialog.append(dialogStyles, bar, frame);
      document.body.append(submitDialog);
      submitDialog.addEventListener('close', () => {
        inlineSubmitButton.focus();
        const success = frame.contentDocument?.querySelector('#success-page');
        if (submittedSuccessfully || (success && frame.contentWindow.getComputedStyle(success).display !== 'none')) {
          dialog.remove();
          if (submitDialog === dialog) submitDialog = null;
        }
      });
    }
    submitDialog.showModal();
  });
  // Re-read shared state before the site's delegated add/remove/submit handler runs.
  document.addEventListener('click', event => {
    const assetLink = event.target.closest?.('.asset-card a[href]');
    if (assetLink && readCollection().length && /^\/(emoji|sticker|pack)\//.test(new URL(assetLink.href, location.href).pathname)) {
      assetLink.target = '_blank';
      assetLink.rel = 'noopener noreferrer';
    }
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

  const hiddenSupplement = new Map();
  let autoHideSupplement = false;
  const refreshSupplementVisibility = () => {
    const hide = Boolean(settings.hideSupplement || autoHideSupplement);
    if (!hide) {
      for (const [element, original] of hiddenSupplement) {
        if (!element.isConnected) continue;
        element.hidden = original.hidden;
        if (original.display) element.style.setProperty('display', original.display, original.priority);
        else element.style.removeProperty('display');
      }
      hiddenSupplement.clear();
      return;
    }
    const targets = [...document.querySelectorAll('footer')];
    const grid = document.querySelector('#items');
    if (grid && isListing) {
      targets.push(...grid.parentElement.querySelectorAll(':scope > .tag-row'));
      // Keep the results, pagination, and loading control visible.
      for (let element = grid.nextElementSibling; element; element = element.nextElementSibling) {
        if (!element.matches('#pagination,.next-page,script,style,dialog')
          && !element.querySelector('#pagination,.next-page,.card-image.asset')) targets.push(element);
      }
    }
    for (const element of targets) {
      if (!hiddenSupplement.has(element)) hiddenSupplement.set(element, {
        hidden: element.hidden,
        display: element.style.getPropertyValue('display'),
        priority: element.style.getPropertyPriority('display')
      });
      element.hidden = true;
      element.style.setProperty('display', 'none', 'important');
    }
  };
  refreshSupplementVisibility();
  const supplementObserver = new MutationObserver(() => {
    if (settings.hideSupplement || autoHideSupplement) refreshSupplementVisibility();
  });
  supplementObserver.observe(document.body, { childList: true, subtree: false });

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
    const url = new URL(location.href);
    url.searchParams.set('page', String(page));
    url.searchParams.set('sort', sort);
    return url.href;
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
    watchProfileDuplicates();
    rebuildKnownIds();
    try {
      const expected = getProfileExpectedCount();
      let emptyChecks = 0;
      document.querySelector('#pagination')?.remove();
      while (!cancelled && emptyChecks < END_CHECKS_REQUIRED) {
        const firstPage = nextProfilePage;
        const likelyPages = expected ? Math.ceil(Math.max(1, expected - countCards()) / 25) + 1 : PROFILE_PAGES_PER_BATCH;
        const pagesThisPass = emptyChecks === 0 ? Math.min(isProfilePacks ? 10 : PROFILE_PAGES_PER_BATCH, likelyPages) : 1;
        const lastPage = firstPage + pagesThisPass - 1;
        setMessage(`Fetching profile pages ${firstPage}–${lastPage} in parallel (${countCards()}${expected ? `; profile reports ${expected}` : ''} visible)…`);
        const pages = Array.from({ length: pagesThisPass }, (_, index) => firstPage + index);
        const results = await Promise.all(pages.map(fetchProfilePage));
        const appended = appendProfileItems(results);
        const nonEmptyPages = results.filter(result => result.items.length);
        if (appended > 0) {
          nextProfilePage = Math.max(...nonEmptyPages.map(result => result.page)) + 1;
          emptyChecks = 0;
          setMessage(`Loaded ${appended} new items (${countCards()} visible); continuing…`);
          continue;
        }
        nextProfilePage = lastPage + 1;
        emptyChecks += 1;
        setMessage(`No new items from page ${firstPage} (${emptyChecks}/${END_CHECKS_REQUIRED}; ${countCards()} visible)`);
        await wait(PROFILE_END_CHECK_WAIT_MS);
      }
      if (!cancelled && emptyChecks >= END_CHECKS_REQUIRED) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        removeDuplicateItems();
        profileComplete = true;
        setMessage(`Loading complete (${countCards()} visible; three page batches without new items confirmed)`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Emoji.gg full-page loader]', error);
        setMessageLines(`Paused after an error (${countCards()} loaded).`, 'Click Load full profile to continue.');
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
    for (let attempt = 0; attempt < (location.pathname === '/' ? 30 : 2) && !cancelled; attempt += 1) {
      const loadMore = findLoadMore();
      if (loadMore) {
        loadMore.scrollIntoView({ block: 'center', behavior: 'auto' });
        loadMore.click();
        return true;
      }
      await wait(75);
    }
    return false;
  };
  const listingPageTemplate = document.querySelector('#pagination .next-page')?.href || '';
  const listingPageMatch = listingPageTemplate.match(/([?&]page=)(\d+)/);
  if (listingPageMatch) nextListingPage = Number(listingPageMatch[2]);
  const getListingPageUrl = page => listingPageTemplate.replace(/([?&]page=)\d+/, (_match, prefix) => `${prefix}${page}`);
  const fetchListingPage = async page => {
    const response = await fetch(getListingPageUrl(page), {
      credentials: 'same-origin', signal: abortController?.signal
    });
    if (!response.ok) throw new Error(`Listing page ${page} returned ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    return { page, items: [...parsed.querySelectorAll(ITEM_SELECTOR)] };
  };
  const runListingParallel = async () => {
    if (running) return;
    running = true;
    cancelled = false;
    abortController = new AbortController();
    primaryButton.textContent = 'Stop full load';
    autoHideSupplement = true;
    refreshSupplementVisibility();
    watchProfileDuplicates();
    rebuildKnownIds();
    document.querySelector('#pagination')?.remove();
    let emptyChecks = 0;
    try {
      while (!cancelled && emptyChecks < END_CHECKS_REQUIRED) {
        const firstPage = nextListingPage;
        const pagesThisPass = emptyChecks === 0 ? LISTING_PAGES_PER_BATCH : 1;
        const lastPage = firstPage + pagesThisPass - 1;
        setMessage(`Fetching listing pages ${firstPage}–${lastPage} in parallel (${countCards()} loaded)…`);
        const pages = Array.from({ length: pagesThisPass }, (_, index) => firstPage + index);
        const results = await Promise.all(pages.map(fetchListingPage));
        if (cancelled) break;
        const appended = appendProfileItems(results);
        removeDuplicateItems();
        nextListingPage = lastPage + 1;
        if (appended) {
          emptyChecks = 0;
          setMessage(`Loaded ${appended} new items (${countCards()} visible); continuing…`);
        } else {
          emptyChecks += 1;
          setMessage(`No new items from page ${firstPage} (${emptyChecks}/${END_CHECKS_REQUIRED})`);
          await wait(250);
        }
      }
      if (!cancelled && emptyChecks >= END_CHECKS_REQUIRED) {
        listingComplete = true;
        window.scrollTo({ top: 0, behavior: 'auto' });
        setMessage(`Loading complete (${countCards()} visible)`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[Emoji.gg full-page loader]', error);
        setMessageLines(`Paused after an error (${countCards()} loaded).`, 'Click Load full page to continue.');
      }
    } finally {
      running = false;
      primaryButton.textContent = 'Load full page';
      if (cancelled) {
        autoHideSupplement = false;
        refreshSupplementVisibility();
      }
    }
  };
  const waitForGrowth = async before => {
    if (countCards() > before) return true;
    return new Promise(resolve => {
      let settled = false;
      const finish = grew => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(grew);
      };
      const observer = new MutationObserver(() => {
        if (cancelled || countCards() > before) finish(countCards() > before);
      });
      observer.observe(document.querySelector('#items') || document.body, { childList: true, subtree: true });
      wait(3000).then(() => finish(countCards() > before));
    });
  };
  const runListingNative = async () => {
    if (running) return;
    running = true;
    cancelled = false;
    primaryButton.textContent = 'Stop full load';
    autoHideSupplement = true;
    refreshSupplementVisibility();
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
          await wait(document.hidden ? 700 : END_CHECK_WAIT_MS);
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
      if (cancelled) {
        autoHideSupplement = false;
        refreshSupplementVisibility();
      }
    }
  };
  const runListing = () => nextListingPage !== null ? runListingParallel() : runListingNative();

  if (isParallelProfile) {
    primaryButton.addEventListener('click', () => {
      if (running) {
        cancelled = true;
        abortController?.abort();
        setMessageLines(`Cancel load accepted (${countCards()} loaded).`, 'Click Load full profile to continue.');
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

  setMessage('Full-page loading is off.');
  primaryButton.addEventListener('click', () => {
    if (running) {
      cancelled = true;
      abortController?.abort();
      setMessageLines(`Loading paused (${countCards()} loaded).`, 'Click Load full page to continue.');
      return;
    }
    if (nextListingPage !== null) {
      if (listingComplete) {
        nextListingPage = Number(listingPageMatch[2]);
        listingComplete = false;
      }
      runListingParallel();
      return;
    }
    if (sessionStorage.getItem(LISTING_READY_KEY) === '1') {
      runListing();
      return;
    }
    sessionStorage.setItem(ONE_SHOT_KEY, '1');
    sessionStorage.setItem(LISTING_READY_KEY, '1');
    location.reload();
  });
  if (sessionStorage.getItem(ONE_SHOT_KEY) === '1') {
    sessionStorage.removeItem(ONE_SHOT_KEY);
    runListing();
  }
})();
