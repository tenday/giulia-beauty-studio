/**
 * GIULIA BEAUTY STUDIO — CUSTOM API LOADER
 * Indicatori grafici coordinati allo stile atelier durante tutte le chiamate API
 * (top progress shimmer + pillola non bloccante per letture + card modale per salvataggi).
 */
(function initGbsApiLoader(global) {
  if (!global || !global.document) return;
  if (global.GBSLoader) return;

  const STYLE_ID = 'gbsApiLoaderStyle';
  const ROOT_ID = 'gbsApiLoaderRoot';
  const MIN_PILL_MS = 220;

  let nextTokenId = 1;
  const activeEntries = new Map();
  let uiShownAt = 0;
  let hideGraceTimer = null;
  let pillVisible = false;
  let blockingVisible = false;
  let lastLabel = 'Caricamento in corso…';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 9990;
        font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      #${ROOT_ID} .gbs-top-progress {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        opacity: 0;
        overflow: hidden;
        transition: opacity 0.18s ease;
        z-index: 9999;
        background: rgba(181, 88, 107, 0.14);
      }

      #${ROOT_ID} .gbs-top-progress.is-active {
        opacity: 1;
      }

      #${ROOT_ID} .gbs-top-progress-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 42%;
        border-radius: 999px;
        background: linear-gradient(90deg, transparent, #e48fa0, #b5586b, #3d1218, #b5586b, transparent);
        animation: gbsShimmerSlide 1.15s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }

      /* Non-blocking floating pill for GET / background syncs */
      #${ROOT_ID} .gbs-loader-pill {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translate(-50%, -14px) scale(0.96);
        opacity: 0;
        pointer-events: none;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 9px 18px 9px 12px;
        border-radius: 999px;
        background: rgba(255, 250, 249, 0.96);
        border: 1px solid rgba(181, 88, 107, 0.36);
        box-shadow: 0 14px 36px -10px rgba(61, 18, 24, 0.25);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #3d1218;
        font-size: 0.77rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        white-space: nowrap;
        max-width: calc(100vw - 32px);
        transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
        z-index: 9998;
      }

      #${ROOT_ID} .gbs-loader-pill.is-visible {
        opacity: 1;
        transform: translate(-50%, 0) scale(1);
      }

      /* Blocking signature atelier overlay for writes, checkout, AI & OTP */
      #${ROOT_ID} .gbs-loader-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(61, 18, 24, 0.24);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s ease;
        z-index: 9997;
      }

      #${ROOT_ID} .gbs-loader-backdrop.is-visible {
        opacity: 1;
        pointer-events: auto;
      }

      #${ROOT_ID} .gbs-loader-card {
        min-width: 248px;
        max-width: min(340px, calc(100vw - 40px));
        padding: 24px 26px 22px;
        border-radius: 22px;
        background: linear-gradient(180deg, rgba(255, 252, 251, 0.99), rgba(253, 244, 242, 0.97));
        border: 1px solid rgba(181, 88, 107, 0.38);
        box-shadow: 0 26px 64px -14px rgba(61, 18, 24, 0.32);
        text-align: center;
        transform: scale(0.94) translateY(6px);
        transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }

      #${ROOT_ID} .gbs-loader-backdrop.is-visible .gbs-loader-card {
        transform: scale(1) translateY(0);
      }

      /* Shared Monogram + Dual Halo Ring */
      #${ROOT_ID} .gbs-halo-spinner {
        position: relative;
        width: 58px;
        height: 58px;
        margin: 0 auto 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      #${ROOT_ID} .gbs-loader-pill .gbs-halo-spinner {
        width: 26px;
        height: 26px;
        margin: 0;
      }

      #${ROOT_ID} .gbs-halo-ring-outer,
      #${ROOT_ID} .gbs-halo-ring-inner {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        pointer-events: none;
      }

      #${ROOT_ID} .gbs-halo-ring-outer {
        border: 2.5px solid rgba(216, 122, 141, 0.22);
        border-top-color: #b5586b;
        border-right-color: #3d1218;
        animation: gbsSpinCW 0.95s cubic-bezier(0.55, 0.2, 0.45, 0.8) infinite;
      }

      #${ROOT_ID} .gbs-halo-ring-inner {
        inset: 5px;
        border: 1.5px solid transparent;
        border-bottom-color: #c28d85;
        border-left-color: #d87a8d;
        animation: gbsSpinCCW 1.45s linear infinite;
      }

      #${ROOT_ID} .gbs-loader-pill .gbs-halo-ring-outer {
        border-width: 2px;
      }

      #${ROOT_ID} .gbs-loader-pill .gbs-halo-ring-inner {
        inset: 3px;
        border-width: 1.5px;
      }

      #${ROOT_ID} .gbs-halo-logo {
        width: 28px;
        height: 28px;
        object-fit: contain;
        border-radius: 50%;
        animation: gbsBreathe 1.8s ease-in-out infinite;
      }

      #${ROOT_ID} .gbs-loader-pill .gbs-halo-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #b5586b;
        animation: gbsBreathe 1.2s ease-in-out infinite;
      }

      #${ROOT_ID} .gbs-loader-eyebrow {
        display: block;
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: #b5586b;
        margin-bottom: 5px;
      }

      #${ROOT_ID} .gbs-loader-label {
        font-family: 'Cormorant Garamond', Georgia, serif;
        font-size: 1.24rem;
        font-weight: 600;
        color: #3d1218;
        line-height: 1.25;
      }

      #${ROOT_ID} .gbs-loader-pill-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      @keyframes gbsShimmerSlide {
        0% { left: -45%; }
        100% { left: 105%; }
      }

      @keyframes gbsSpinCW {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      @keyframes gbsSpinCCW {
        0% { transform: rotate(360deg); }
        100% { transform: rotate(0deg); }
      }

      @keyframes gbsBreathe {
        0%, 100% { transform: scale(0.94); opacity: 0.85; }
        50% { transform: scale(1.06); opacity: 1; }
      }

      @media (prefers-reduced-motion: reduce) {
        #${ROOT_ID} .gbs-top-progress-bar,
        #${ROOT_ID} .gbs-halo-ring-outer,
        #${ROOT_ID} .gbs-halo-ring-inner,
        #${ROOT_ID} .gbs-halo-logo {
          animation-duration: 3s;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureDom() {
    injectStyles();
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
      <div class="gbs-top-progress" aria-hidden="true">
        <div class="gbs-top-progress-bar"></div>
      </div>
      <div class="gbs-loader-pill" role="status" aria-hidden="true">
        <span class="gbs-halo-spinner">
          <span class="gbs-halo-ring-outer"></span>
          <span class="gbs-halo-ring-inner"></span>
          <span class="gbs-halo-dot"></span>
        </span>
        <span class="gbs-loader-pill-text">Caricamento…</span>
      </div>
      <div class="gbs-loader-backdrop" role="status" aria-hidden="true">
        <div class="gbs-loader-card">
          <div class="gbs-halo-spinner">
            <span class="gbs-halo-ring-outer"></span>
            <span class="gbs-halo-ring-inner"></span>
            <img src="assets/logo-monogram.png" alt="" class="gbs-halo-logo" onerror="this.style.display='none'" />
          </div>
          <span class="gbs-loader-eyebrow">Giulia Beauty Studio</span>
          <div class="gbs-loader-label">Caricamento in corso…</div>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function syncUi() {
    const root = ensureDom();
    const topBar = root.querySelector('.gbs-top-progress');
    const pillEl = root.querySelector('.gbs-loader-pill');
    const pillTextEl = root.querySelector('.gbs-loader-pill-text');
    const backdropEl = root.querySelector('.gbs-loader-backdrop');
    const cardLabelEl = root.querySelector('.gbs-loader-label');

    const visibleEntries = Array.from(activeEntries.values()).filter((e) => e.visible);
    const anyActive = activeEntries.size > 0;
    const blockingEntry = visibleEntries.slice().reverse().find((e) => e.blocking);
    const pillEntry = visibleEntries.slice().reverse()[0];

    topBar.classList.toggle('is-active', anyActive);

    if (blockingEntry) {
      clearTimeout(hideGraceTimer);
      hideGraceTimer = null;
      lastLabel = blockingEntry.label || lastLabel;
      cardLabelEl.textContent = lastLabel;
      if (!blockingVisible) {
        blockingVisible = true;
        uiShownAt = Date.now();
      }
      pillVisible = false;
      pillEl.classList.remove('is-visible');
      pillEl.setAttribute('aria-hidden', 'true');
      backdropEl.classList.add('is-visible');
      backdropEl.setAttribute('aria-hidden', 'false');
      return;
    }

    if (blockingVisible) {
      blockingVisible = false;
      backdropEl.classList.remove('is-visible');
      backdropEl.setAttribute('aria-hidden', 'true');
    }

    if (pillEntry) {
      clearTimeout(hideGraceTimer);
      hideGraceTimer = null;
      lastLabel = pillEntry.label || lastLabel;
      pillTextEl.textContent = lastLabel;
      if (!pillVisible) {
        pillVisible = true;
        uiShownAt = Date.now();
      }
      pillEl.classList.add('is-visible');
      pillEl.setAttribute('aria-hidden', 'false');
      return;
    }

    if (pillVisible && !hideGraceTimer) {
      const elapsed = Date.now() - uiShownAt;
      const waitMs = Math.max(80, MIN_PILL_MS - elapsed);
      hideGraceTimer = setTimeout(() => {
        hideGraceTimer = null;
        const stillVisible = Array.from(activeEntries.values()).some((e) => e.visible);
        if (!stillVisible && !blockingVisible) {
          pillVisible = false;
          pillEl.classList.remove('is-visible');
          pillEl.setAttribute('aria-hidden', 'true');
          if (activeEntries.size === 0) {
            topBar.classList.remove('is-active');
          }
        }
      }, waitMs);
    }
  }

  function begin(options = {}) {
    const id = nextTokenId++;
    const blocking = Boolean(options.blocking);
    const label = String(options.label || (blocking ? 'Elaborazione in corso…' : 'Sincronizzazione dati…'));
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : blocking ? 0 : 45;

    const entry = {
      id,
      blocking,
      label,
      visible: delayMs === 0,
      timer: null,
    };
    activeEntries.set(id, entry);

    if (delayMs > 0) {
      entry.timer = setTimeout(() => {
        const cur = activeEntries.get(id);
        if (!cur) return;
        cur.timer = null;
        cur.visible = true;
        syncUi();
      }, delayMs);
    }

    syncUi();
    return id;
  }

  function end(id) {
    const entry = activeEntries.get(id);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    activeEntries.delete(id);
    syncUi();
  }

  async function track(promiseOrFn, options = {}) {
    const token = begin(options);
    try {
      const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
      return await promise;
    } finally {
      end(token);
    }
  }

  global.GBSLoader = {
    begin,
    end,
    track,
    getActiveCount() {
      return activeEntries.size;
    },
  };
})(typeof window !== 'undefined' ? window : null);
