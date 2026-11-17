/**
 * GIULIA BEAUTY STUDIO — NAILS & MAKEUP
 * Interactive Listino, Beauty Bag, Concierge & Proprietary Backend Integration
 */

const API_BASE = 'api';

function publicFetchWithLoader(url, options = {}, loaderOptions = {}) {
  const run = () => fetch(url, options);
  if (window.GBSLoader && typeof window.GBSLoader.track === 'function') {
    return window.GBSLoader.track(run, loaderOptions);
  }
  return run();
}
function getStudioCatalog() {
  return window.STUDIO_CATALOG || [];
}

function getServiceMap() {
  if (window.SERVICE_MAP instanceof Map) return window.SERVICE_MAP;
  return new Map();
}

// Concierge Presets
const CONCIERGE_PRESETS = {
  'mani-sguardo': {
    title: 'Manicure + Semipermanente & Mappatura Sopracciglia + Tinta',
    ids: ['nails-12', 'lashes-6']
  },
  'seta-brasiliana': {
    title: 'Epilazione Brasiliana: Inguine Totale + Ascelle + Baffetti & Sopracciglia',
    ids: ['bras-2', 'bras-3', 'bras-4']
  },
  'cerimonia-glam': {
    title: 'Make up Cerimonia + Copertura in Gel + Laminazione Ciglia Coreana',
    ids: ['makeup-2', 'nails-14', 'lashes-4']
  },
  'pausa-spa': {
    title: 'Manicure Spa + Pedicure Spa + Trattamento Viso Relax',
    ids: ['nails-3', 'nails-6', 'viso-2']
  }
};

// State
let selectedBag = []; // Array of items: { uid, id, name, price, duration, categoryTitle, isGiftCard }
let activeCategory = 'all';
let searchQuery = '';
let activeConciergePreset = 'mani-sguardo';
let selectedGiftAmount = 50;
let purchaseMode = 'booking'; // 'booking' | 'voucher'
let selectedTimeSlot = '11:00';
let selectedPaymentMethod = 'studio';
let publicPromotions = [];
let heroOverridePromo = null;
let publicPaymentConfig = {
  stripe_ready: false,
  stripe_enabled: false,
  stripe_mode: 'test',
  allow_pay_in_studio: true,
  allow_online_full: false,
  allow_online_deposit: false,
  deposit_percent: 30,
};

function escapePublicHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FALLBACK_DEFAULT_PROMOTIONS = [
  {
    id: 'fallback-1',
    title: 'Rituale Semipermanente Completo',
    badge_text: 'Mani & Piedi Perfection',
    month_label: 'Offerta del Mese',
    description: 'Cura impeccabile e brillantezza a lunga durata per mani e piedi sempre perfetti in ogni stagione.',
    services: [
      { id: 'nails-12', name: 'Manicure + semipermanente', price: 28, duration: 45 },
      { id: 'nails-8', name: 'Pedicure estetica + semipermanente', price: 34, duration: 50 },
    ],
    original_price: 62,
    promo_price: 55,
    duration_minutes: 95,
    featured: 0,
    show_on_hero: 0,
  },
  {
    id: 'fallback-2',
    title: 'Rituale Sguardo Magnetico & Glow',
    badge_text: '♡ Sguardo & Viso Radioso',
    month_label: 'Più Richiesta del Mese',
    description:
      'Laminazione completa per ciglia e sopracciglia unita alla pulizia viso su misura per un volto fresco e luminoso senza trucco.',
    services: [
      { id: 'lashes-1', name: 'Laminazione ciglia', price: 45, duration: 60 },
      { id: 'lashes-2', name: 'Laminazione sopracciglia', price: 35, duration: 40 },
      { id: 'viso-1', name: 'Pulizia viso', price: 45, duration: 60 },
    ],
    original_price: 125,
    promo_price: 109,
    duration_minutes: 150,
    featured: 1,
    show_on_hero: 0,
  },
  {
    id: 'fallback-3',
    title: 'Bridal Couture Experience',
    badge_text: 'Speciale Sposa & Grandi Eventi',
    month_label: 'Edizione Esclusiva',
    description:
      'Il pacchetto d’eccellenza per il tuo giorno più bello: preparazione della pelle, manicure spa + semipermanente e make up sposa.',
    services: [
      { id: 'makeup-1', name: 'Make up sposa', price: 150, duration: 120 },
      { id: 'viso-2', name: 'Trattamento viso relax', price: 40, duration: 50 },
      { id: 'nails-13', name: 'Manicure + semipermanente rinforzato', price: 33, duration: 55 },
    ],
    original_price: 223,
    promo_price: 199,
    duration_minutes: 225,
    featured: 0,
    show_on_hero: 0,
  },
];

// DOM Elements
const leftColEl = document.getElementById('listinoLeftCol');
const rightColEl = document.getElementById('listinoRightCol');
const columnsContainerEl = document.getElementById('listinoColumnsContainer');
const categoryPillsEl = document.getElementById('categoryPills');
const searchInputEl = document.getElementById('serviceSearchInput');
const headerBagCountEl = document.getElementById('headerBagCount');
const stickyBottomBarEl = document.getElementById('stickyBottomBar');
const stickyCountTextEl = document.getElementById('stickyCountText');
const stickyTotalTextEl = document.getElementById('stickyTotalText');
const checkoutDrawerEl = document.getElementById('checkoutDrawer');
const drawerBackdropEl = document.getElementById('drawerBackdrop');
const bagItemsListEl = document.getElementById('bagItemsList');
const drawerTotalAmountEl = document.getElementById('drawerTotalAmount');
const drawerTotalDurationEl = document.getElementById('drawerTotalDuration');

/**
 * Render the Two-Column Editorial Listino
 */
function renderListino() {
  leftColEl.innerHTML = '';
  rightColEl.innerHTML = '';

  const q = searchQuery.trim().toLowerCase();
  const isSingleCat = activeCategory !== 'all';

  if (isSingleCat) {
    columnsContainerEl.classList.add('single-col-mode');
  } else {
    columnsContainerEl.classList.remove('single-col-mode');
  }

  let totalRendered = 0;

  getStudioCatalog().forEach((cat) => {
    if (activeCategory !== 'all' && cat.id !== activeCategory) return;

    // Filter subgroups by search query
    const filteredSubgroups = (cat.subgroups || [])
      .map((sg) => {
        const matchingItems = (sg.items || []).filter(
          (item) =>
            !q ||
            String(item.name || '').toLowerCase().includes(q) ||
            String(item.desc || '').toLowerCase().includes(q) ||
            String(cat.title || '').toLowerCase().includes(q)
        );
        return { ...sg, items: matchingItems };
      })
      .filter((sg) => sg.items.length > 0);

    if (filteredSubgroups.length === 0) return;

    const sectionEl = document.createElement('div');
    sectionEl.className = 'category-block';

    sectionEl.innerHTML = `
      <div class="category-header">
        <h3 class="category-title">${cat.title}</h3>
        <p class="category-motto">${cat.motto}</p>
        <div class="category-heart-rule" aria-hidden="true"><span>♡</span></div>
      </div>
    `;

    filteredSubgroups.forEach((sg) => {
      const sgDiv = document.createElement('div');
      sgDiv.className = 'subgroup-block';

      if (sg.label) {
        const labelEl = document.createElement('span');
        labelEl.className = 'subgroup-label';
        labelEl.textContent = sg.label;
        sgDiv.appendChild(labelEl);
      }

      const ul = document.createElement('ul');
      ul.className = 'service-list';

      sg.items.forEach((item) => {
        totalRendered++;
        const isSelected = selectedBag.some((b) => b.id === item.id);
        const li = document.createElement('li');
        li.className = `service-row ${isSelected ? 'selected' : ''}`;
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        li.dataset.serviceId = item.id;

        li.innerHTML = `
          <div class="service-info">
            <div class="service-name-line">
              <span class="service-name">${escapePublicHtml(item.name)}</span>
              <span class="service-duration">${Number(item.duration || 30)} min</span>
            </div>
            <p class="service-desc">${escapePublicHtml(item.desc || '')}</p>
          </div>
          <div class="service-price-action">
            <span class="service-price">${formatEurPublic(item.price)}</span>
            <span class="btn-select-service" aria-hidden="true">${isSelected ? '✓' : '+'}</span>
          </div>
        `;

        li.addEventListener('click', () => toggleServiceInBag(item.id));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleServiceInBag(item.id);
          }
        });

        ul.appendChild(li);
      });

      sgDiv.appendChild(ul);
      sectionEl.appendChild(sgDiv);
    });

    if (isSingleCat || cat.column === 'left') {
      leftColEl.appendChild(sectionEl);
    } else {
      rightColEl.appendChild(sectionEl);
    }
  });

  if (totalRendered === 0) {
    leftColEl.innerHTML = `
      <div class="empty-bag-state">
        <p style="font-family: var(--font-serif); font-size: 1.5rem;">Nessun trattamento trovato per “${searchQuery}”</p>
        <p style="margin-top: 6px; font-size: 0.85rem;">Prova con un'altra parola chiave o mostra tutte le categorie.</p>
      </div>
    `;
  }
}

/**
 * Toggle a service in the Beauty Bag
 */
function toggleServiceInBag(serviceId) {
  const existingIdx = selectedBag.findIndex((b) => b.id === serviceId);
  if (existingIdx > -1) {
    selectedBag.splice(existingIdx, 1);
  } else {
    const svc = getServiceMap().get(serviceId);
    if (svc) {
      selectedBag.push({
        uid: `${svc.id}-${Date.now()}`,
        id: svc.id,
        name: svc.name,
        price: svc.price,
        duration: svc.duration,
        categoryTitle: svc.categoryTitle,
        isGiftCard: false
      });
    }
  }
  updateBagUI();
  renderListino();
}

/**
 * Add multiple services at once (from Packages or Concierge)
 */
function addMultipleServices(serviceIds, openDrawerAfter = true) {
  serviceIds.forEach((id) => {
    const alreadyIn = selectedBag.some((b) => b.id === id);
    if (!alreadyIn) {
      const svc = getServiceMap().get(id);
      if (svc) {
        selectedBag.push({
          uid: `${svc.id}-${Date.now()}-${Math.random()}`,
          id: svc.id,
          name: svc.name,
          price: svc.price,
          duration: svc.duration,
          categoryTitle: svc.categoryTitle,
          isGiftCard: false
        });
      }
    }
  });
  updateBagUI();
  renderListino();
  if (openDrawerAfter) {
    openCheckoutDrawer();
  }
}

/**
 * Add a Monthly Promotion directly into the Beauty Bag with promo pricing & duration
 */
function addPromotionToBag(promo, openDrawerAfter = true) {
  if (!promo) return;
  const numericId = Number(promo.id);
  const promoKey = `promo-${promo.id}`;
  const alreadyIn = selectedBag.some((b) => b.id === promoKey);
  if (!alreadyIn) {
    const isPersistentPromo = Number.isFinite(numericId) && numericId > 0;
    selectedBag.push({
      uid: `${promoKey}-${Date.now()}-${Math.random()}`,
      id: promoKey,
      promo_id: isPersistentPromo ? numericId : null,
      is_promotion: isPersistentPromo,
      name: isPersistentPromo ? `Promo: ${promo.title}` : promo.title,
      price: Number(promo.promo_price ?? promo.price ?? 0),
      originalPrice: Number(promo.original_price ?? 0),
      duration: Math.max(10, Number(promo.duration_minutes || 60)),
      categoryTitle: promo.badge_text || 'PROMO DEL MESE',
      isGiftCard: false,
      included_services: Array.isArray(promo.services) ? promo.services : [],
    });
  }
  updateBagUI();
  renderListino();
  const d = document.getElementById('bookingDateInput')?.value;
  if (d && purchaseMode === 'booking') refreshAvailableSlots(d);
  if (openDrawerAfter) {
    openCheckoutDrawer();
  }
}

/**
 * Remove item by UID from drawer
 */
function removeBagItemByUid(uid) {
  selectedBag = selectedBag.filter((item) => item.uid !== uid);
  updateBagUI();
  renderListino();
  const d = document.getElementById('bookingDateInput')?.value;
  if (d && purchaseMode === 'booking') refreshAvailableSlots(d);
}

/**
 * Update Header Badge, Sticky Bar, and Checkout Drawer List
 */
function updateBagUI() {
  const count = selectedBag.length;
  const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
  const totalMin = selectedBag.reduce((acc, item) => acc + (item.duration || 0), 0);

  // Header badge pulse
  headerBagCountEl.textContent = count;
  headerBagCountEl.classList.remove('pulse');
  void headerBagCountEl.offsetWidth;
  headerBagCountEl.classList.add('pulse');

  // Sticky bottom bar
  if (count > 0) {
    stickyBottomBarEl.classList.add('visible');
    stickyCountTextEl.textContent =
      count === 1 ? '1 Trattamento selezionato' : `${count} Trattamenti selezionati`;
    stickyTotalTextEl.textContent = `${totalEuro} €`;
  } else {
    stickyBottomBarEl.classList.remove('visible');
  }

  // Drawer totals
  drawerTotalAmountEl.textContent = `${totalEuro} €`;
  drawerTotalDurationEl.textContent = totalMin > 0 ? `${totalMin} min stimati` : 'Voucher Digitale';
  renderPaymentMethodsGrid();

  // Drawer items list
  if (count === 0) {
    bagItemsListEl.innerHTML = `
      <li class="empty-bag-state">
        <div style="font-size: 1.8rem; color: var(--rose-deep); margin-bottom: 6px;">♡</div>
        <p style="font-family: var(--font-serif); font-size: 1.3rem; color: var(--ink-primary);">
          La tua Beauty Bag è vuota
        </p>
        <p style="font-size: 0.8rem; margin-top: 4px;">
          Seleziona uno o più trattamenti dal listino oppure personalizza una Gift Card.
        </p>
      </li>
    `;
  } else {
    bagItemsListEl.innerHTML = '';
    selectedBag.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'bag-item';
      const hasDiscount = Number(item.originalPrice || 0) > Number(item.price || 0);
      const subNames =
        Array.isArray(item.included_services) && item.included_services.length > 0
          ? `<div class="bag-item-promo-sub">${item.included_services.map((s) => escapePublicHtml(s.name)).join(' + ')}</div>`
          : '';
      li.innerHTML = `
        <div>
          <span class="bag-item-cat">${escapePublicHtml(item.categoryTitle)}</span>
          <div class="bag-item-title">${escapePublicHtml(item.name)}</div>
          ${subNames}
        </div>
        <div class="bag-item-right">
          <span class="bag-item-price">${hasDiscount ? `<del class="bag-item-old-price">${Number(item.originalPrice).toFixed(0)} €</del>` : ''}${item.price} €</span>
          <button type="button" class="btn-remove-item" aria-label="Rimuovi ${escapePublicHtml(item.name)}">✕</button>
        </div>
      `;
      li.querySelector('.btn-remove-item').addEventListener('click', () => removeBagItemByUid(item.uid));
      bagItemsListEl.appendChild(li);
    });
  }
}

/**
 * Drawer Open / Close
 */
function openCheckoutDrawer() {
  checkoutDrawerEl.classList.add('open');
  drawerBackdropEl.classList.add('open');
  const d = document.getElementById('bookingDateInput')?.value;
  if (d) refreshAvailableSlots(d);
}

function closeCheckoutDrawer() {
  checkoutDrawerEl.classList.remove('open');
  drawerBackdropEl.classList.remove('open');
}

/**
 * Initialize Event Listeners
 */
const STUDIO_WHATSAPP = '393315045135';

function isClosedDay(dateStr) {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 = Domenica, 2 = Martedì
  return day === 0 || day === 2;
}

function getLocalRomeDateString(offsetDays = 0) {
  const dt = new Date(Date.now() + offsetDays * 86400000);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt);
  } catch {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}

function getNextOpenDateString() {
  for (let offset = 1; offset <= 14; offset += 1) {
    const iso = getLocalRomeDateString(offset);
    if (!isClosedDay(iso)) return iso;
  }
  return getLocalRomeDateString(1);
}

function buildWhatsAppUrl() {
  const clientName = document.getElementById('clientNameInput')?.value.trim() || '';
  const clientPhone = document.getElementById('clientPhoneInput')?.value.trim() || '';
  const clientNotes = document.getElementById('clientNotesInput')?.value.trim() || '';
  const bookingDate = document.getElementById('bookingDateInput')?.value || '';
  const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
  const listText = selectedBag
    .map((i) => {
      const hasDiscount = Number(i.originalPrice || 0) > Number(i.price || 0);
      return `• ${i.name} (${i.price} €${hasDiscount ? ` anziché ${Number(i.originalPrice).toFixed(0)} €` : ''})`;
    })
    .join('\n');

  const msg = `Ciao *Giulia Beauty Studio* ♡\nVorrei ${
    purchaseMode === 'booking'
      ? `prenotare un appuntamento in studio (Via Principe Amedeo 17, Verdellino) per il giorno *${bookingDate}* alle *${selectedTimeSlot}*`
      : `richiedere un Voucher / Gift Card per`
  } i seguenti trattamenti:\n\n${listText}\n\n*Totale: ${totalEuro} €*${
    clientName ? `\nCliente: ${clientName}` : ''
  }${clientPhone ? `\nRecapito: ${clientPhone}` : ''}${
    clientNotes ? `\nNote: ${clientNotes}` : ''
  }`;

  return `https://wa.me/${STUDIO_WHATSAPP}?text=${encodeURIComponent(msg)}`;
}

function isIosInAppOrStandalone() {
  const ua = navigator.userAgent || '';
  const isInApp = /FBAN|FBAV|Instagram|Line|TikTok|BytedanceWebview|Snapchat/i.test(ua);
  const isStandalone =
    window.navigator.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return isInApp || isStandalone;
}

function openWhatsAppUrl(url) {
  if (!url) return false;
  if (isIosInAppOrStandalone()) {
    window.location.assign(url);
    return true;
  }
  let win = null;
  try {
    win = window.open(url, '_blank');
  } catch (_) {
    win = null;
  }
  if (win) {
    try {
      win.opener = null;
    } catch (_) {}
    return true;
  }
  window.location.assign(url);
  return true;
}

function renderGroupedFreeSlots(slotsGrid, freeSlots) {
  const groups = [
    { label: 'Mattina', items: freeSlots.filter((t) => t < '13:00') },
    { label: 'Pomeriggio', items: freeSlots.filter((t) => t >= '13:00' && t < '18:00') },
    { label: 'Sera', items: freeSlots.filter((t) => t >= '18:00') },
  ].filter((g) => g.items.length > 0);

  slotsGrid.classList.add('is-grouped');
  slotsGrid.innerHTML = groups
    .map(
      (grp) => `
        <div class="time-slot-group">
          <div class="time-slot-group-label">${grp.label}</div>
          <div class="time-slot-group-grid">
            ${grp.items
              .map((t) => `<button type="button" class="time-slot-btn${t === selectedTimeSlot ? ' active' : ''}" data-time="${t}">${t}</button>`)
              .join('')}
          </div>
        </div>`
    )
    .join('');
}

async function jumpToNextAvailableDay(fromDateStr) {
  const dateInput = document.getElementById('bookingDateInput');
  const closedWarningEl = document.getElementById('closedDayWarning');
  const totalMin = selectedBag.reduce((acc, item) => acc + (item.duration || 0), 0) || 60;
  const operatorId = Number.parseInt(document.getElementById('bookingOperatorSelect')?.value || '0', 10) || 0;
  try {
    const res = await publicFetchWithLoader(
      `${API_BASE}/public/next-available?from=${encodeURIComponent(fromDateStr)}&duration=${totalMin}&operator_id=${operatorId}`,
      {},
      { label: 'Ricerca prossimo giorno libero…', blocking: false, delayMs: 60 }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.ok && data.found && data.date && dateInput) {
      dateInput.value = data.date;
      if (data.first_slot) selectedTimeSlot = data.first_slot;
      if (closedWarningEl) closedWarningEl.hidden = true;
      await refreshAvailableSlots(data.date);
    }
  } catch (_) {}
}

async function refreshAvailableSlots(dateStr) {
  const slotsGrid = document.getElementById('timeSlotsGrid');
  const statusEl = document.getElementById('slotsLiveStatus');
  const closedWarningEl = document.getElementById('closedDayWarning');
  if (!slotsGrid || !dateStr) return;

  const totalMin = selectedBag.reduce((acc, item) => acc + (item.duration || 0), 0) || 60;
  const operatorId = Number.parseInt(document.getElementById('bookingOperatorSelect')?.value || '0', 10) || 0;
  const fallbackButtons = Array.from(slotsGrid.querySelectorAll('.time-slot-btn'));

  try {
    const res = await publicFetchWithLoader(
      `${API_BASE}/public/slots?date=${encodeURIComponent(dateStr)}&duration=${totalMin}&operator_id=${operatorId}`,
      {},
      { label: 'Verifica orari disponibili…', blocking: false, delayMs: 70 }
    );
    if (!res.ok) throw new Error('API offline');
    const data = await res.json();
    if (!data.ok) throw new Error('API error');

    if (closedWarningEl) {
      closedWarningEl.hidden = !data.closed;
    }

    const freeSlots = Array.isArray(data.free_slots)
      ? data.free_slots
      : Array.isArray(data.day_slots)
        ? data.day_slots.filter((s) => s.available).map((s) => String(s.time || ''))
        : [];

    if (data.closed || freeSlots.length === 0) {
      selectedTimeSlot = '';
      slotsGrid.classList.add('is-grouped');
      const reasonText = data.closed
        ? 'Studio chiuso in questa data.'
        : dateStr === getLocalRomeDateString(0)
          ? `Nessun orario disponibile per oggi (${totalMin} min, preavviso min ${data.min_lead_minutes || 60} min).`
          : `Nessun orario libero per ${totalMin} min in questa data.`;
      slotsGrid.innerHTML = `
        <div class="slots-empty-box">
          <p>${reasonText}</p>
          <button type="button" class="btn-find-next-day" id="findNextAvailableDayBtn">Trova prossimo giorno disponibile →</button>
        </div>
      `;
      document.getElementById('findNextAvailableDayBtn')?.addEventListener('click', () => {
        jumpToNextAvailableDay(dateStr);
      });
      if (statusEl) {
        statusEl.textContent = data.closed ? 'Studio chiuso' : 'Nessuno slot libero';
      }
      return;
    }

    if (!freeSlots.includes(selectedTimeSlot)) {
      selectedTimeSlot = freeSlots[0];
    }

    renderGroupedFreeSlots(slotsGrid, freeSlots);

    if (statusEl) {
      const stepLabel = Number(data.step_minutes || 15);
      statusEl.textContent = `${freeSlots.length} orari liberi • ogni ${stepLabel} min`;
    }
  } catch (_) {
    // Graceful fallback if static preview without Node backend
    slotsGrid.classList.remove('is-grouped');
    fallbackButtons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('is-booked');
      btn.textContent = btn.dataset.time;
    });
    if (statusEl) statusEl.textContent = '';
  }
}

async function loadPublicOperators() {
  const groupEl = document.getElementById('bookingOperatorGroup');
  const selEl = document.getElementById('bookingOperatorSelect');
  if (!groupEl || !selEl) return;
  try {
    const res = await publicFetchWithLoader(`${API_BASE}/public/operators`, {}, {
      label: 'Caricamento operatori…',
      blocking: false,
      delayMs: 140,
    });
    if (!res.ok) return;
    const data = await res.json();
    const ops = data.operators || [];
    if (ops.length > 1) {
      selEl.innerHTML = `<option value="0">Qualsiasi disponibile (consigliato)</option>${ops
        .map((o) => `<option value="${o.id}">${o.name}${o.role ? ` (${o.role})` : ''}</option>`)
        .join('')}`;
      groupEl.hidden = false;
    } else {
      groupEl.hidden = true;
    }
  } catch (_) {
    // Graceful fallback when API offline
  }
}

function formatPromoValidityLabel(promo) {
  if (!promo) return '';
  if (promo.valid_until) {
    const parts = String(promo.valid_until).split('-');
    if (parts.length === 3) return `Fino al ${parts[2]}/${parts[1]}`;
  }
  return promo.month_label || '';
}

function syncHeroPromoSpotlight() {
  const tagEl = document.getElementById('heroFloatingTag');
  const titleEl = document.getElementById('heroFloatingTitle');
  const metaEl = document.getElementById('heroFloatingMeta');
  const priceEl = document.getElementById('heroFloatingPrice');
  const btnEl = document.getElementById('heroQuickAddBtn');
  if (!tagEl || !titleEl || !metaEl || !priceEl || !btnEl) return;

  heroOverridePromo = publicPromotions.find((p) => Number(p.show_on_hero) === 1) || null;
  if (!heroOverridePromo) {
    tagEl.textContent = 'Più Richiesto in Studio';
    titleEl.textContent = 'Manicure + Semipermanente & Laminazione Ciglia';
    metaEl.textContent = 'Rituale Completo • 105 min';
    priceEl.textContent = '73 €';
    btnEl.textContent = '+ Aggiungi entrambi al Riepilogo';
    return;
  }

  const orig = Number(heroOverridePromo.original_price || 0);
  const val = Number(heroOverridePromo.promo_price || 0);
  const dur = Number(heroOverridePromo.duration_minutes || 60);
  const tagText = heroOverridePromo.badge_text || heroOverridePromo.month_label || 'Promo del Mese';

  tagEl.textContent = tagText;
  titleEl.textContent = heroOverridePromo.title;
  metaEl.textContent = `${heroOverridePromo.month_label || 'Offerta Mese'} • ${dur} min`;
  priceEl.innerHTML =
    orig > val
      ? `<del class="hero-floating-price-old">${orig.toFixed(0)} €</del>${val.toFixed(0)} €`
      : `${val.toFixed(0)} €`;
  btnEl.textContent = '+ Seleziona Promo al Riepilogo';
}

function renderPublicPromotions() {
  const sectionEl = document.getElementById('percorsi-esclusivi');
  const gridEl = document.getElementById('promotionsGrid');
  const navLinkEl = document.getElementById('navPromotionsLink');
  const mobLinkEl = document.getElementById('mobileNavPromotionsLink');
  const bannerWrapEl = document.getElementById('listinoPromoBannerWrap');
  const bannerTextEl = document.getElementById('listinoPromoBannerText');

  const activeList = Array.isArray(publicPromotions) ? publicPromotions : [];
  const hasAny = activeList.length > 0;

  if (sectionEl) sectionEl.hidden = !hasAny;
  if (navLinkEl) navLinkEl.hidden = !hasAny;
  if (mobLinkEl) mobLinkEl.hidden = !hasAny;
  if (bannerWrapEl) bannerWrapEl.hidden = !hasAny;

  if (!hasAny) {
    if (gridEl) gridEl.innerHTML = '';
    syncHeroPromoSpotlight();
    return;
  }

  if (bannerTextEl) {
    bannerTextEl.textContent =
      activeList.length === 1
        ? `Promo del Mese: ${activeList[0].title} (${Number(activeList[0].promo_price || 0).toFixed(0)} €)`
        : `${activeList.length} Promozioni del Mese attive — Scopri le offerte`;
  }

  if (!gridEl) return;
  gridEl.classList.remove('has-1', 'has-2');
  if (activeList.length === 1) gridEl.classList.add('has-1');
  else if (activeList.length === 2) gridEl.classList.add('has-2');

  gridEl.innerHTML = activeList
    .map((p) => {
      const orig = Number(p.original_price || 0);
      const val = Number(p.promo_price || 0);
      const dur = Number(p.duration_minutes || 60);
      const hasDiscount = orig > val && orig > 0;
      const pct = hasDiscount ? Math.round(((orig - val) / orig) * 100) : 0;
      const validityLabel = formatPromoValidityLabel(p);
      const itemsHtml =
        Array.isArray(p.services) && p.services.length > 0
          ? `<ul class="package-includes">${p.services
              .map(
                (it) =>
                  `<li><span>${escapePublicHtml(it.name)}</span> <span class="inc-price">${Number(it.price || 0) > 0 ? `${Number(it.price).toFixed(0)} €` : 'Incluso'}</span></li>`
              )
              .join('')}</ul>`
          : '';

      return `
        <article class="package-card ${Number(p.featured) === 1 ? 'featured' : ''}">
          <div>
            <div class="package-badges-row">
              <span class="package-badge">${escapePublicHtml(p.badge_text || 'Offerta del Mese')}</span>
              ${validityLabel ? `<span class="package-month-tag">${escapePublicHtml(validityLabel)}</span>` : ''}
              ${pct > 0 ? `<span class="package-discount-pill">-${pct}%</span>` : ''}
            </div>
            <h3 class="package-title">${escapePublicHtml(p.title)}</h3>
            ${p.description ? `<p class="package-desc">${escapePublicHtml(p.description)}</p>` : ''}
            ${itemsHtml}
          </div>
          <div class="package-footer">
            <div class="package-price-block">
              <span class="package-total-label">${hasDiscount ? 'Prezzo Promo' : 'Prezzo Offerta'}</span>
              <div class="package-price-row">
                ${hasDiscount ? `<span class="package-price-old">${orig.toFixed(0)} €</span>` : ''}
                <span class="package-total-price">${val.toFixed(0)} €</span>
              </div>
              <span class="package-duration-note">${dur} min stimati</span>
            </div>
            <button type="button" class="btn-primary-luxury pkg-add-btn" data-promo-id="${escapePublicHtml(p.id)}">
              + Seleziona Promo
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  gridEl.querySelectorAll('.pkg-add-btn[data-promo-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const promo = activeList.find((item) => String(item.id) === String(btn.dataset.promoId));
      if (promo) addPromotionToBag(promo, true);
    });
  });

  syncHeroPromoSpotlight();
}

async function loadPublicPromotions() {
  try {
    const res = await publicFetchWithLoader(`${API_BASE}/public/promotions`, {}, {
      label: 'Caricamento promozioni…',
      blocking: false,
      delayMs: 260,
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.promotions)) {
        publicPromotions = data.promotions;
        renderPublicPromotions();
        return;
      }
    }
  } catch (_) {
    // Fallback below if static environment without Node backend
  }
  publicPromotions = FALLBACK_DEFAULT_PROMOTIONS;
  renderPublicPromotions();
}

function formatCategoryPillLabel(title) {
  const words = String(title || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Categoria';
  return words.map((w) => (w === 'e' ? '&' : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

function renderPublicCategoryPills() {
  if (!categoryPillsEl) return;
  const catalog = getStudioCatalog();
  if (activeCategory !== 'all' && !catalog.some((c) => c.id === activeCategory)) {
    activeCategory = 'all';
  }
  const totalCount = catalog.reduce(
    (sum, cat) => sum + (cat.subgroups || []).reduce((s2, sg) => s2 + (sg.items || []).length, 0),
    0
  );
  const pills = [
    `<button type="button" class="cat-pill${activeCategory === 'all' ? ' active' : ''}" data-cat="all">Tutti (${totalCount})</button>`,
  ];
  catalog.forEach((cat) => {
    const count = (cat.subgroups || []).reduce((s, sg) => s + (sg.items || []).length, 0);
    if (count === 0) return;
    pills.push(
      `<button type="button" class="cat-pill${activeCategory === cat.id ? ' active' : ''}" data-cat="${escapePublicHtml(
        cat.id
      )}">${escapePublicHtml(formatCategoryPillLabel(cat.title))} (${count})</button>`
    );
  });
  categoryPillsEl.innerHTML = pills.join('');
}

function updateConciergeMetaUi() {
  const conciergeTitleEl = document.getElementById('conciergeTitle');
  const conciergeMetaEl = document.getElementById('conciergeMeta');
  const preset = CONCIERGE_PRESETS[activeConciergePreset];
  if (!preset || !conciergeTitleEl || !conciergeMetaEl) return;
  const map = getServiceMap();
  const matched = preset.ids.filter((id) => map.has(id));
  const idsToUse = matched.length > 0 ? matched : [];
  const total = idsToUse.reduce((sum, id) => sum + Number(map.get(id)?.price || 0), 0);
  conciergeTitleEl.textContent = preset.title;
  conciergeMetaEl.innerHTML = `${idsToUse.length || preset.ids.length} Trattamenti • Totale <strong>${formatEurPublic(total)}</strong>`;
}

async function loadPublicCatalog() {
  try {
    const res = await fetch(`${API_BASE}/public/catalog`);
    const data = await res.json();
    if (res.ok && data && data.ok && Array.isArray(data.catalog)) {
      if (typeof window.rebuildServiceMap === 'function') {
        window.rebuildServiceMap(data.catalog);
      } else {
        window.STUDIO_CATALOG = data.catalog;
      }
      renderPublicCategoryPills();
      renderListino();
      updateConciergeMetaUi();
      reconcileStorefrontBagPromotions();
      updateBagUI();
    }
  } catch {
    // Fallback static catalog.js already active
  }
}

function initApp() {
  renderPublicCategoryPills();
  updateConciergeMetaUi();
  loadPublicCatalog();
  loadPublicOperators();
  loadPublicPromotions();
  const opSel = document.getElementById('bookingOperatorSelect');
  if (opSel) {
    opSel.addEventListener('change', () => {
      const d = document.getElementById('bookingDateInput')?.value;
      if (d) refreshAvailableSlots(d);
    });
  }

  // Set default date in booking calendar to next open studio day (skipping Tuesday & Sunday)
  const dateInput = document.getElementById('bookingDateInput');
  const closedWarningEl = document.getElementById('closedDayWarning');
  if (dateInput) {
    dateInput.value = getNextOpenDateString();
    dateInput.min = getLocalRomeDateString(0);
    refreshAvailableSlots(dateInput.value);
    dateInput.addEventListener('change', () => {
      if (closedWarningEl) {
        closedWarningEl.hidden = !isClosedDay(dateInput.value);
      }
      refreshAvailableSlots(dateInput.value);
    });
  }

  // Category filter pills (delegated so dynamically added categories work)
  categoryPillsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-pill');
    if (!btn) return;
    categoryPillsEl.querySelectorAll('.cat-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    activeCategory = btn.dataset.cat || 'all';
    renderListino();
  });

  // Instant search
  searchInputEl.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderListino();
  });

  // Hero Quick Add Button (dynamic Promo spotlight or classic duo fallback)
  document.getElementById('heroQuickAddBtn').addEventListener('click', () => {
    if (heroOverridePromo) {
      addPromotionToBag(heroOverridePromo, true);
      return;
    }
    addMultipleServices(['nails-12', 'lashes-1'], true);
  });

  // Concierge Quiz Logic
  const conciergeOptionsEl = document.getElementById('conciergeOptions');
  const conciergeTitleEl = document.getElementById('conciergeTitle');
  const conciergeMetaEl = document.getElementById('conciergeMeta');
  const conciergeAddBtn = document.getElementById('conciergeAddBtn');

  conciergeOptionsEl.querySelectorAll('.quiz-option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      conciergeOptionsEl.querySelectorAll('.quiz-option-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeConciergePreset = btn.dataset.preset;
      updateConciergeMetaUi();
    });
  });

  conciergeAddBtn.addEventListener('click', () => {
    const preset = CONCIERGE_PRESETS[activeConciergePreset];
    if (preset) {
      addMultipleServices(preset.ids, true);
    }
  });

  // Gift Card Live Customizer
  const gcAmountChips = document.getElementById('gcAmountChips');
  const gcDisplayAmount = document.getElementById('gcDisplayAmount');
  const gcBtnPrice = document.getElementById('gcBtnPrice');
  const gcRecipientInput = document.getElementById('gcRecipientInput');
  const gcDisplayRecipient = document.getElementById('gcDisplayRecipient');
  const gcMessageInput = document.getElementById('gcMessageInput');
  const gcDisplayMessage = document.getElementById('gcDisplayMessage');

  gcAmountChips.querySelectorAll('.amount-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      gcAmountChips.querySelectorAll('.amount-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      selectedGiftAmount = parseInt(chip.dataset.amount, 10);
      gcDisplayAmount.textContent = `${selectedGiftAmount} €`;
      gcBtnPrice.textContent = `${selectedGiftAmount} €`;
    });
  });

  gcRecipientInput.addEventListener('input', (e) => {
    gcDisplayRecipient.textContent = e.target.value.trim() || 'Chiara';
  });

  gcMessageInput.addEventListener('input', (e) => {
    const msg = e.target.value.trim() || 'Un momento di pura bellezza e relax pensato solo per te.';
    gcDisplayMessage.textContent = `“${msg}”`;
  });

  document.getElementById('addGiftCardToBagBtn').addEventListener('click', () => {
    const recipient = gcRecipientInput.value.trim() || 'Persona Speciale';
    selectedBag.push({
      uid: `giftcard-${Date.now()}`,
      id: `giftcard-${selectedGiftAmount}`,
      name: `Gift Card per ${recipient}`,
      price: selectedGiftAmount,
      duration: 0,
      categoryTitle: 'GIFT CARD DIGITALE',
      isGiftCard: true
    });
    setPurchaseMode('voucher');
    updateBagUI();
    openCheckoutDrawer();
  });

  // Drawer Triggers
  document.getElementById('openBagBtn').addEventListener('click', openCheckoutDrawer);
  document.getElementById('stickyOpenDrawerBtn').addEventListener('click', openCheckoutDrawer);
  document.getElementById('closeDrawerBtn').addEventListener('click', closeCheckoutDrawer);
  drawerBackdropEl.addEventListener('click', closeCheckoutDrawer);

  // Purchase Mode Tabs (Booking vs Voucher)
  const tabBooking = document.getElementById('tabModeBooking');
  const tabVoucher = document.getElementById('tabModeVoucher');
  const scheduleSection = document.getElementById('bookingScheduleSection');
  const clientDetailsTitle = document.getElementById('clientDetailsStepTitle');

  function setPurchaseMode(mode) {
    purchaseMode = mode;
    if (mode === 'booking') {
      tabBooking.classList.add('active');
      tabVoucher.classList.remove('active');
      scheduleSection.style.display = 'block';
      clientDetailsTitle.textContent = '2. I Tuoi Dati';
    } else {
      tabVoucher.classList.add('active');
      tabBooking.classList.remove('active');
      scheduleSection.style.display = 'none';
      clientDetailsTitle.textContent = '1. Dati Acquirente & Destinatario';
    }
  }

  tabBooking.addEventListener('click', () => setPurchaseMode('booking'));
  tabVoucher.addEventListener('click', () => setPurchaseMode('voucher'));

  // Time Slots Selection (delegated so dynamically updated per-day slots work cleanly)
  const timeSlotsGrid = document.getElementById('timeSlotsGrid');
  timeSlotsGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.time-slot-btn');
    if (!btn || btn.disabled) return;
    timeSlotsGrid.querySelectorAll('.time-slot-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTimeSlot = btn.dataset.time;
  });

  // Payment Method Selection (delegated, dynamic Stripe + Studio options)
  const paymentMethodsGrid = document.getElementById('paymentMethodsGrid');
  if (paymentMethodsGrid) {
    paymentMethodsGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.payment-option-card');
      if (!card) return;
      selectedPaymentMethod = card.dataset.pay || 'studio';
      paymentMethodsGrid.querySelectorAll('.payment-option-card').forEach((c) => {
        c.classList.toggle('active', c === card);
      });
      updatePaymentChoiceUi();
    });
  }
  loadPublicPaymentConfig();

  // Original Flyer Modal
  const flyerModal = document.getElementById('flyerModal');
  document.getElementById('openFlyerTopBtn')?.addEventListener('click', () => flyerModal.classList.add('open'));
  document.getElementById('openFlyerHeaderBtn')?.addEventListener('click', () => flyerModal.classList.add('open'));
  document.getElementById('openFlyerMobileNavBtn')?.addEventListener('click', () => flyerModal.classList.add('open'));
  document.getElementById('closeFlyerModalBtn')?.addEventListener('click', () => flyerModal.classList.remove('open'));
  flyerModal.addEventListener('click', (e) => {
    if (e.target === flyerModal) flyerModal.classList.remove('open');
  });

  // Legal Modal (Privacy GDPR, Terms & Conditions, Cookie Policy)
  const legalModal = document.getElementById('legalModal');
  const legalTabBtns = document.querySelectorAll('.legal-tab-btn');
  const legalPanels = {
    privacy: document.getElementById('legalPanelPrivacy'),
    terms: document.getElementById('legalPanelTerms'),
    cookies: document.getElementById('legalPanelCookies')
  };
  const selectLegalTab = window.initLegalPanels
    ? window.initLegalPanels({ tabButtons: legalTabBtns, panels: legalPanels })
    : (tabKey = 'privacy') => {
        legalTabBtns.forEach((btn) => {
          const isMatch = btn.dataset.legalTab === tabKey;
          btn.classList.toggle('active', isMatch);
          btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });
        Object.entries(legalPanels).forEach(([key, panel]) => {
          if (panel) panel.classList.toggle('active', key === tabKey);
        });
      };

  function openLegalModal(tabKey = 'privacy') {
    selectLegalTab(tabKey);
    legalModal?.classList.add('open');
  }

  document.querySelectorAll('[data-open-legal]').forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openLegalModal(trigger.dataset.openLegal);
    });
  });

  document.getElementById('closeLegalModalBtn')?.addEventListener('click', () => {
    legalModal?.classList.remove('open');
  });

  legalModal?.addEventListener('click', (e) => {
    if (e.target === legalModal) legalModal.classList.remove('open');
  });

  // Privacy Consent Checkbox in Checkout Drawer
  const privacyCheckbox = document.getElementById('privacyConsentCheckbox');
  const privacyErrorEl = document.getElementById('privacyConsentError');

  privacyCheckbox?.addEventListener('change', () => {
    if (privacyCheckbox.checked && privacyErrorEl) {
      privacyErrorEl.hidden = true;
    }
  });

  document.getElementById('acceptLegalFromModalBtn')?.addEventListener('click', () => {
    if (privacyCheckbox) {
      privacyCheckbox.checked = true;
    }
    if (privacyErrorEl) {
      privacyErrorEl.hidden = true;
    }
    try {
      localStorage.setItem('gbs_privacy_consent_v1', 'accepted');
    } catch (_) {}
    document.getElementById('cookieBanner')?.setAttribute('hidden', '');
    legalModal?.classList.remove('open');
  });

  // Cookie & Privacy Banner
  const cookieBanner = document.getElementById('cookieBanner');
  try {
    const savedConsent = localStorage.getItem('gbs_privacy_consent_v1');
    if (!savedConsent && cookieBanner) {
      cookieBanner.removeAttribute('hidden');
    }
  } catch (_) {
    cookieBanner?.removeAttribute('hidden');
  }

  document.getElementById('cookieAcceptBtn')?.addEventListener('click', () => {
    try {
      localStorage.setItem('gbs_privacy_consent_v1', 'accepted');
    } catch (_) {}
    cookieBanner?.setAttribute('hidden', '');
  });

  document.getElementById('cookieEssentialBtn')?.addEventListener('click', () => {
    try {
      localStorage.setItem('gbs_privacy_consent_v1', 'essential');
    } catch (_) {}
    cookieBanner?.setAttribute('hidden', '');
  });

  function validateCheckoutLegalConsent() {
    if (privacyCheckbox && !privacyCheckbox.checked) {
      if (privacyErrorEl) {
        privacyErrorEl.hidden = false;
        privacyErrorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return false;
    }
    if (privacyErrorEl) privacyErrorEl.hidden = true;
    return true;
  }

  // Confirm Order & Save Appointment + Client + GDPR Log in MySQL Backend
  const confirmModal = document.getElementById('confirmationModal');
  const receiptContent = document.getElementById('confirmationReceiptContent');
  const confirmBtn = document.getElementById('confirmOrderBtn');

  confirmBtn.addEventListener('click', async () => {
    if (selectedBag.length === 0) {
      alert('Seleziona almeno un trattamento dal listino prima di confermare.');
      return;
    }

    const clientName = document.getElementById('clientNameInput').value.trim();
    const clientPhone = document.getElementById('clientPhoneInput').value.trim();
    const clientEmail = document.getElementById('clientEmailInput')?.value.trim() || '';
    const clientNotes = document.getElementById('clientNotesInput').value.trim();
    const bookingDate = document.getElementById('bookingDateInput').value;
    const operatorId = Number.parseInt(document.getElementById('bookingOperatorSelect')?.value || '0', 10) || 0;

    if (!clientName) {
      alert('Inserisci Nome e Cognome per completare la prenotazione.');
      document.getElementById('clientNameInput').focus();
      return;
    }
    if (!clientPhone) {
      alert('Inserisci il tuo numero di Telefono / WhatsApp.');
      document.getElementById('clientPhoneInput').focus();
      return;
    }
    if (purchaseMode === 'booking' && !selectedTimeSlot) {
      alert('Seleziona un orario disponibile (o cambia data) prima di confermare.');
      document.getElementById('bookingDateInput')?.focus();
      return;
    }
    if (!validateCheckoutLegalConsent()) {
      return;
    }

    const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
    const totalMin = selectedBag.reduce((acc, item) => acc + (item.duration || 0), 0);
    let orderCode = `GBS-${Math.floor(100000 + Math.random() * 900000)}`;
    let savedToDb = false;

    const originalBtnText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Salvataggio in corso...';

    try {
      const res = await publicFetchWithLoader(`${API_BASE}/public/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: purchaseMode,
          appointment_date: bookingDate,
          start_time: selectedTimeSlot,
          duration_minutes: totalMin,
          operator_id: operatorId,
          services: selectedBag,
          total_price: totalEuro,
          client_name: clientName,
          client_phone: clientPhone,
          client_email: clientEmail,
          notes: clientNotes,
          payment_method: selectedPaymentMethod,
          privacy_accepted: Boolean(privacyCheckbox?.checked),
        }),
      }, { label: 'Conferma prenotazione in corso…', blocking: true, delayMs: 0 });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          alert(data.error || 'Errore durante il salvataggio della prenotazione.');
          confirmBtn.disabled = false;
          confirmBtn.textContent = originalBtnText;
          if (data.code === 'SLOT_OCCUPIED' || data.code === 'SLOT_TOO_SOON') {
            refreshAvailableSlots(bookingDate);
          } else if (data.code === 'PROMO_UNAVAILABLE') {
            loadPublicPromotions();
          }
          return;
        }
        orderCode = data.booking_code || orderCode;
        savedToDb = true;
        refreshAvailableSlots(bookingDate);

        if ((data.requires_payment_redirect || data.requires_stripe_redirect) && data.checkout_url) {
          confirmBtn.textContent =
            data.payment_provider === 'paypal'
              ? 'Reindirizzamento a PayPal…'
              : 'Reindirizzamento a Stripe…';
          window.location.assign(data.checkout_url);
          return;
        }
      }
    } catch (_) {
      // Static environment fallback (no PHP server running)
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalBtnText;
    }

    const itemsHtml = selectedBag
      .map(
        (item) =>
          `<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(145,78,86,0.2);">
            <span>${item.name}</span>
            <strong>${item.price} €</strong>
          </li>`
      )
      .join('');

    const waUrl = buildWhatsAppUrl();

    receiptContent.innerHTML = `
      <div style="font-size: 2.2rem; color: var(--rose-deep); margin-bottom: 4px;">♡</div>
      <span style="font-size: 0.68rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--rose-deep); font-weight: 600;">
        ${savedToDb ? 'Prenotazione Registrata nell’Agenda Studio' : 'Riepilogo Pronto — Giulia Beauty Studio'}
      </span>
      <h3 id="confirmModalTitle" style="font-family: var(--font-serif); font-size: 2rem; color: var(--ink-primary); margin: 6px 0;">
        Grazie, ${clientName}!
      </h3>
      <p style="font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 6px;">
        Codice: <strong>${orderCode}</strong> • ${
      purchaseMode === 'booking'
        ? `Appuntamento richiesto per il <strong>${bookingDate}</strong> alle <strong>${selectedTimeSlot}</strong>`
        : 'Voucher / Gift Card Digitale'
    }
      </p>
      <p style="font-size: 0.78rem; color: var(--ink-muted); margin-bottom: 16px;">
        📍 Via Principe Amedeo, 17 - Verdellino (BG) • Tel: +39 331 504 5135
      </p>
      <ul style="list-style:none; text-align:left; background:#fff; padding:16px 20px; border-radius:12px; border:1px solid var(--rose-gold-hairline); margin-bottom:18px; font-size:0.88rem;">
        ${itemsHtml}
        <li style="display:flex;justify-content:space-between;padding-top:10px;font-family:var(--font-serif);font-size:1.35rem;font-weight:600;color:var(--ink-primary);">
          <span>Totale Complessivo</span>
          <span>${totalEuro} €</span>
        </li>
      </ul>
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <a href="${waUrl}" target="_blank" rel="noopener" class="btn-primary-luxury" style="padding:12px 24px;">
          Invia Conferma su WhatsApp a Giulia
        </a>
        <button type="button" class="btn-secondary-luxury" id="closeReceiptBtn" style="padding:12px 22px;">
          Torna alla Boutique
        </button>
      </div>
    `;

    closeCheckoutDrawer();
    confirmModal.classList.add('open');

    document.getElementById('closeReceiptBtn').addEventListener('click', () => {
      confirmModal.classList.remove('open');
    });
  });

  // WhatsApp Quick Summary Generator (Direct to +39 331 504 5135)
  document.getElementById('whatsappDirectBtn').addEventListener('click', () => {
    if (selectedBag.length === 0) {
      alert('Aggiungi almeno un trattamento dal listino per inviare la richiesta su WhatsApp.');
      return;
    }
    if (purchaseMode === 'booking') {
      const closedWarnEl = document.getElementById('closedDayWarning');
      if (closedWarnEl && !closedWarnEl.hidden) {
        alert('Lo studio risulta chiuso nella data selezionata. Scegli un giorno di apertura prima di procedere.');
        document.getElementById('bookingDateInput')?.focus();
        return;
      }
      if (!selectedTimeSlot) {
        alert('Seleziona un orario disponibile (o cambia data) prima di inviare la richiesta.');
        document.getElementById('bookingDateInput')?.focus();
        return;
      }
    }
    if (!validateCheckoutLegalConsent()) {
      return;
    }
    openWhatsAppUrl(buildWhatsAppUrl());
  });

  // Ensure wa.me links also work inside iOS/iPadOS in-app browsers (Instagram/Facebook) and standalone PWA
  document.addEventListener('click', (e) => {
    const waAnchor = e.target.closest('a[href^="https://wa.me/"]');
    if (!waAnchor) return;
    if (isIosInAppOrStandalone()) {
      e.preventDefault();
      window.location.assign(waAnchor.href);
    }
  });

  // Initial Render
  installStorefrontPromoCartSync();
  renderPaymentMethodsGrid();
  renderListino();
  updateBagUI();
  handleStripeReturnFromQuery();
}

function getSelectedBagTotalEuro() {
  return selectedBag.reduce((acc, item) => acc + Number(item?.price || 0), 0);
}

function computeClientOnlineCharge(totalEuro, scope = 'full') {
  const total = Math.round((Number(totalEuro || 0) + Number.EPSILON) * 100) / 100;
  if (total <= 0) return 0;
  if (scope === 'deposit') {
    const pct = Math.min(90, Math.max(10, Number(publicPaymentConfig.deposit_percent || 30)));
    return Math.min(total, Math.max(1, Math.round(((total * pct) / 100 + Number.EPSILON) * 100) / 100));
  }
  return total;
}

function formatEurPublic(amount) {
  const num = Number(amount || 0);
  if (Math.abs(num - Math.round(num)) < 0.005) return `${Math.round(num)} €`;
  return `${num.toFixed(2).replace('.', ',')} €`;
}

async function loadPublicPaymentConfig() {
  try {
    const res = await fetch(`${API_BASE}/public/payment-config`);
    const data = await res.json();
    if (res.ok && data && data.config) {
      publicPaymentConfig = data.config;
      renderPaymentMethodsGrid();
    }
  } catch {
    // fallback static options
  }
}

function renderPaymentMethodsGrid() {
  const grid = document.getElementById('paymentMethodsGrid');
  if (!grid) return;

  const total = getSelectedBagTotalEuro();
  const cfg = publicPaymentConfig || {};
  const hasOnlineProvider = Boolean(cfg.stripe_ready || cfg.paypal_ready);
  const pct = Number(cfg.deposit_percent || 30);
  const dep = computeClientOnlineCharge(total, 'deposit');
  const cards = [];

  if (hasOnlineProvider) {
    if (cfg.allow_pay_in_studio !== false) {
      cards.push({
        pay: 'studio',
        title: 'Salda in Studio',
        desc: 'Conferma ora e paga in atelier a Verdellino',
        pill: 'Nessun addebito ora',
      });
    }
    if (cfg.stripe_ready) {
      if (cfg.allow_online_full) {
        cards.push({
          pay: 'stripe_full',
          title: cfg.paypal_ready ? 'Carta / Apple Pay (100%)' : 'Paga Online (100%)',
          desc: total > 0 ? `Saldo immediato ${formatEurPublic(total)}` : 'Carta, Apple Pay, Google Pay',
          pill: 'Stripe Sicuro',
        });
      }
      if (cfg.allow_online_deposit) {
        cards.push({
          pay: 'stripe_deposit',
          title: cfg.paypal_ready ? `Acconto ${pct}% Carta` : `Acconto ${pct}% Online`,
          desc: total > 0 ? `Paga ora ${formatEurPublic(dep)} • resto in studio` : `Blocca slot col ${pct}% online`,
          pill: 'Stripe Acconto',
        });
      }
    }
    if (cfg.paypal_ready) {
      if (cfg.allow_online_full) {
        cards.push({
          pay: 'paypal_full',
          title: 'PayPal (100%)',
          desc: total > 0 ? `Paga ora ${formatEurPublic(total)} con PayPal` : 'Conto PayPal o Paga in 3 rate',
          pill: 'PayPal Checkout',
        });
      }
      if (cfg.allow_online_deposit) {
        cards.push({
          pay: 'paypal_deposit',
          title: `Acconto ${pct}% PayPal`,
          desc: total > 0 ? `Paga ora ${formatEurPublic(dep)} • resto in studio` : `Blocca slot col ${pct}% su PayPal`,
          pill: 'PayPal Acconto',
        });
      }
    }
  }

  if (cards.length === 0) {
    cards.push(
      {
        pay: 'studio',
        title: 'Salda in Studio',
        desc: 'Conferma ora, paga in atelier a Verdellino',
        pill: '',
      },
      {
        pay: 'carta',
        title: 'Acquisto / Regalo',
        desc: 'Richiedi pagamento digitale o Gift Card',
        pill: '',
      }
    );
  }

  if (!cards.some((c) => c.pay === selectedPaymentMethod)) {
    selectedPaymentMethod = cards[0].pay;
  }

  grid.innerHTML = cards
    .map(
      (c) => `
      <button type="button" class="payment-option-card${c.pay === selectedPaymentMethod ? ' active' : ''}" data-pay="${escapePublicHtml(c.pay)}">
        <strong>${escapePublicHtml(c.title)}</strong>
        <span>${escapePublicHtml(c.desc)}</span>
        ${c.pill ? `<em class="payment-badge-pill">${escapePublicHtml(c.pill)}</em>` : ''}
      </button>
    `
    )
    .join('');

  updatePaymentChoiceUi();
}

function updatePaymentChoiceUi() {
  const hintEl = document.getElementById('paymentOnlineHint');
  const confirmBtn = document.getElementById('confirmOrderBtn');
  const total = getSelectedBagTotalEuro();
  const pct = Number(publicPaymentConfig.deposit_percent || 30);

  const isPaypal = selectedPaymentMethod === 'paypal_full' || selectedPaymentMethod === 'paypal_deposit';
  const isFull = selectedPaymentMethod === 'stripe_full' || selectedPaymentMethod === 'paypal_full';
  const isDeposit = selectedPaymentMethod === 'stripe_deposit' || selectedPaymentMethod === 'paypal_deposit';
  const providerName = isPaypal ? 'PayPal' : 'Stripe';
  const fullMethodDesc = isPaypal ? 'con il tuo conto PayPal o in 3 rate' : 'con Carta, Apple Pay o Google Pay';

  if (isFull) {
    if (hintEl) {
      hintEl.hidden = false;
      hintEl.innerHTML =
        total > 0
          ? `🔒 Checkout sicuro ${providerName}: pagherai <strong>${formatEurPublic(total)}</strong> ora ${fullMethodDesc}.`
          : `🔒 Checkout sicuro ${providerName} ${fullMethodDesc}.`;
    }
    if (confirmBtn) {
      confirmBtn.textContent =
        total > 0 ? `Paga Ora con ${providerName} (${formatEurPublic(total)})` : `Procedi su ${providerName}`;
    }
  } else if (isDeposit) {
    const dep = computeClientOnlineCharge(total, 'deposit');
    const rem = Math.max(0, Math.round((total - dep) * 100) / 100);
    if (hintEl) {
      hintEl.hidden = false;
      hintEl.innerHTML =
        total > 0
          ? `🔒 Versi un acconto del ${pct}% (<strong>${formatEurPublic(dep)}</strong>) online su ${providerName}. Resteranno <strong>${formatEurPublic(rem)}</strong> da saldare in studio.`
          : `🔒 Versi un acconto del ${pct}% online tramite ${providerName} Checkout.`;
    }
    if (confirmBtn) {
      confirmBtn.textContent =
        total > 0 ? `Paga Acconto ${formatEurPublic(dep)} (${providerName})` : `Paga Acconto ${pct}% (${providerName})`;
    }
  } else {
    if (hintEl) {
      hintEl.hidden = true;
      hintEl.textContent = '';
    }
    if (confirmBtn) {
      confirmBtn.textContent = 'Conferma e Prenota in Agenda';
    }
  }
}

async function handleStripeReturnFromQuery() {
  const params = new URLSearchParams(window.location.search || '');
  const payState = params.get('payment');
  const sessionId = params.get('session_id') || '';
  const paypalToken = params.get('token') || params.get('order_id') || '';
  const code = params.get('code') || '';
  if (!payState) return;

  const confirmModal = document.getElementById('confirmationModal');
  const receiptContent = document.getElementById('confirmationReceiptContent');
  if (!confirmModal || !receiptContent) return;

  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, '', window.location.pathname || '/');
  }

  const isStripeSuccess = payState === 'success' && sessionId;
  const isPaypalSuccess = payState === 'paypal_success' && paypalToken;

  if (isStripeSuccess || isPaypalSuccess) {
    const providerLabel = isPaypalSuccess ? 'PayPal' : 'Stripe';
    const endpoint = isPaypalSuccess
      ? `${API_BASE}/public/paypal/capture-order`
      : `${API_BASE}/public/stripe/verify-session`;
    const reqPayload = isPaypalSuccess
      ? { order_id: paypalToken, booking_code: code }
      : { session_id: sessionId, booking_code: code };

    try {
      const res = await publicFetchWithLoader(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        },
        { label: `Verifica pagamento ${providerLabel} in corso…`, blocking: true, delayMs: 0 }
      );
      const data = await res.json();
      if (!res.ok || !data.receipt) {
        receiptContent.innerHTML = `
          <h3 class="modal-title">Verifica Pagamento</h3>
          <p style="margin:10px 0 18px;font-size:0.9rem;color:var(--ink-secondary);">${escapePublicHtml(
            data?.error || `Non è stato possibile verificare la ricevuta ${providerLabel}.`
          )}</p>
          <button type="button" class="btn-primary-luxury" id="closeStripeReceiptBtn">Chiudi</button>
        `;
      } else {
        const r = data.receipt;
        const isPartial = r.payment_status === 'partial';
        const badgeClass = data.paid ? (isPartial ? 'partial' : 'paid') : 'cancelled';
        const badgeText = data.paid
          ? isPartial
            ? `Acconto Versato (${formatEurPublic(r.paid_amount)})`
            : 'Pagamento Completato'
          : 'Pagamento In Elaborazione';
        const receiptProvider = r.payment_method === 'paypal_online' ? 'PayPal' : providerLabel;
        receiptContent.innerHTML = `
          <div style="font-size: 2rem; color: var(--rose-deep); margin-bottom: 6px;">♡</div>
          <span class="stripe-receipt-badge ${badgeClass}">${escapePublicHtml(badgeText)}</span>
          <h3 id="confirmModalTitle" style="font-family: var(--font-serif); font-size: 2rem; color: var(--ink-primary); margin: 6px 0;">
            Grazie, ${escapePublicHtml(r.client_name || 'Cliente')}!
          </h3>
          <p style="font-size: 0.85rem; color: var(--ink-secondary); margin-bottom: 10px;">
            Codice: <strong>${escapePublicHtml(r.booking_code)}</strong> • ${
              r.mode === 'booking'
                ? `Appuntamento per il <strong>${escapePublicHtml(r.appointment_date)}</strong> alle <strong>${escapePublicHtml(r.start_time)}</strong>`
                : 'Voucher / Gift Card Digitale'
            }
          </p>
          <ul style="list-style:none; text-align:left; background:#fff; padding:16px 20px; border-radius:12px; border:1px solid var(--rose-gold-hairline); margin-bottom:18px; font-size:0.88rem;">
            <li style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed rgba(145,78,86,0.2);">
              <span>Trattamenti</span>
              <strong>${escapePublicHtml(r.services_summary)}</strong>
            </li>
            <li style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed rgba(145,78,86,0.2);">
              <span>Totale Appuntamento</span>
              <strong>${formatEurPublic(r.total_price)}</strong>
            </li>
            <li style="display:flex;justify-content:space-between;padding:5px 0;color:#166534;">
              <span>Pagato Online (${escapePublicHtml(receiptProvider)})</span>
              <strong>${formatEurPublic(r.paid_amount)}</strong>
            </li>
            ${
              Number(r.remaining_amount || 0) > 0
                ? `<li style="display:flex;justify-content:space-between;padding-top:8px;font-weight:700;color:var(--rose-deep);">
                    <span>Saldo Residuo in Studio</span>
                    <span>${formatEurPublic(r.remaining_amount)}</span>
                  </li>`
                : ''
            }
          </ul>
          <button type="button" class="btn-primary-luxury" id="closeStripeReceiptBtn" style="padding:12px 24px;">
            Torna alla Boutique
          </button>
        `;
      }
      confirmModal.classList.add('open');
      document.getElementById('closeStripeReceiptBtn')?.addEventListener('click', () => {
        confirmModal.classList.remove('open');
      });
    } catch {
      // ignore network interruption
    }
    return;
  }

  if ((payState === 'cancelled' || payState === 'paypal_cancelled') && code) {
    const providerName = payState === 'paypal_cancelled' ? 'PayPal' : 'Stripe';
    receiptContent.innerHTML = `
      <span class="stripe-receipt-badge cancelled">Pagamento Online Interrotto</span>
      <h3 id="confirmModalTitle" style="font-family: var(--font-serif); font-size: 1.9rem; color: var(--ink-primary); margin: 8px 0;">
        Checkout ${providerName} annullato
      </h3>
      <p style="font-size: 0.88rem; color: var(--ink-secondary); margin-bottom: 16px;">
        La prenotazione <strong>${escapePublicHtml(code)}</strong> non è ancora stata pagata.
        Vuoi confermare lo stesso l'appuntamento pagando direttamente in studio, oppure annullare la richiesta?
      </p>
      <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-primary-luxury" id="fallbackStudioPayBtn" style="padding:12px 20px;">
          Conferma e Salda in Studio
        </button>
        <button type="button" class="btn-secondary-luxury" id="cancelPendingStripeBtn" style="padding:12px 20px;">
          Annulla Prenotazione
        </button>
      </div>
    `;
    confirmModal.classList.add('open');

    const cancelBody = JSON.stringify({
      booking_code: code,
      session_id: sessionId || undefined,
      order_id: paypalToken || undefined,
    });

    document.getElementById('fallbackStudioPayBtn')?.addEventListener('click', async () => {
      const r = await fetch(`${API_BASE}/public/payment-fallback-studio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cancelBody,
      });
      const resJson = await r.json();
      if (r.ok && resJson.receipt) {
        receiptContent.innerHTML = `
          <span class="stripe-receipt-badge paid">Prenotazione Confermata</span>
          <h3 style="font-family: var(--font-serif); font-size: 1.9rem; color: var(--ink-primary); margin: 8px 0;">
            Perfetto, ti aspettiamo in studio!
          </h3>
          <p style="font-size: 0.88rem; color: var(--ink-secondary); margin-bottom: 16px;">
            Codice: <strong>${escapePublicHtml(resJson.receipt.booking_code)}</strong> • ${escapePublicHtml(
          resJson.receipt.appointment_date
        )} ore <strong>${escapePublicHtml(resJson.receipt.start_time)}</strong><br/>
            Modalità: <strong>Salda in Studio (${formatEurPublic(resJson.receipt.total_price)})</strong>
          </p>
          <button type="button" class="btn-primary-luxury" id="closeFallbackConfirmBtn" style="padding:12px 24px;">
            Torna alla Boutique
          </button>
        `;
        document.getElementById('closeFallbackConfirmBtn')?.addEventListener('click', () => {
          confirmModal.classList.remove('open');
        });
      }
    });

    document.getElementById('cancelPendingStripeBtn')?.addEventListener('click', async () => {
      await fetch(`${API_BASE}/public/payment-cancel-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cancelBody,
      });
      confirmModal.classList.remove('open');
      const d = document.getElementById('bookingDateInput')?.value;
      if (d) refreshAvailableSlots(d);
    });
  }
}

let storefrontActivePromosCache = [];
let __reconcilingStorefrontBag = false;

function isStorefrontPromoActiveForDate(promo, targetDate = '') {
  if (!promo || Number(promo.active ?? 1) !== 1) return false;
  const ref = String(targetDate || '').trim() || getLocalRomeDateString(0);
  if (promo.valid_from && ref < String(promo.valid_from)) return false;
  if (promo.valid_until && ref > String(promo.valid_until)) return false;
  return true;
}

function getPromoCatalogIdsForStorefront(promo) {
  const map = getServiceMap();
  return (promo?.services || [])
    .map((s) => String(s?.id || '').trim())
    .filter((id) => id && map.has(id));
}

function reconcileStorefrontBagPromotions() {
  if (__reconcilingStorefrontBag || !Array.isArray(selectedBag) || storefrontActivePromosCache.length === 0) {
    return;
  }
  __reconcilingStorefrontBag = true;
  try {
    const bookingDate = document.getElementById('bookingDateInput')?.value || getLocalRomeDateString(0);
    const eligiblePromos = storefrontActivePromosCache.filter((p) =>
      purchaseMode === 'booking' ? isStorefrontPromoActiveForDate(p, bookingDate) : isStorefrontPromoActiveForDate(p, '')
    );

    // Unbundle any previously auto-applied promo that is no longer eligible on the chosen date
    const nextBag = [];
    selectedBag.forEach((item) => {
      if (item && item.autoAppliedPromo) {
        const stillEligible = eligiblePromos.some((p) => Number(p.id) === Number(item.promo_id));
        if (!stillEligible && Array.isArray(item.includedServiceIds)) {
          item.includedServiceIds.forEach((sid) => {
            const srv = getServiceMap().get(sid);
            if (srv) {
              nextBag.push({
                uid: `${srv.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                ...srv,
              });
            }
          });
          return;
        }
      }
      nextBag.push(item);
    });

    const workingBag = nextBag.slice();
    const rankedPromos = eligiblePromos
      .map((promo) => {
        const promoIds = getPromoCatalogIdsForStorefront(promo);
        const origSum = Number(promo.original_price || 0) > 0
          ? Number(promo.original_price)
          : promoIds.reduce((sum, id) => sum + Number(getServiceMap().get(id)?.price || 0), 0);
        const savings = Math.max(0, origSum - Number(promo.promo_price || 0));
        return { promo, promoIds, origSum, savings };
      })
      .filter((entry) => entry.promoIds.length > 0 && entry.savings >= 0)
      .sort((a, b) => (b.savings - a.savings) || (b.promoIds.length - a.promoIds.length));

    let matchedAny = true;
    while (matchedAny) {
      matchedAny = false;
      for (const candidate of rankedPromos) {
        const idIndices = [];
        const usedIdx = new Set();
        let allPresent = true;

        for (const reqId of candidate.promoIds) {
          const foundIdx = workingBag.findIndex(
            (it, idx) => !usedIdx.has(idx) && it && !it.is_promotion && !it.isGiftCard && String(it.id) === String(reqId)
          );
          if (foundIdx === -1) {
            allPresent = false;
            break;
          }
          usedIdx.add(foundIdx);
          idIndices.push(foundIdx);
        }

        if (allPresent && idIndices.length > 0) {
          const matchedItems = idIndices.map((idx) => workingBag[idx]);
          const matchedOrig = Math.round(matchedItems.reduce((s, it) => s + Number(it.price || 0), 0) * 100) / 100;
          const matchedDur = matchedItems.reduce((s, it) => s + Number(it.duration || 30), 0);
          const idxSet = new Set(idIndices);
          const insertAt = Math.min(...idIndices);
          const remaining = workingBag.filter((_, idx) => !idxSet.has(idx));
          const promoObj = {
            uid: `promo-auto-${candidate.promo.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            id: `promo-${candidate.promo.id}`,
            name: `Promo: ${candidate.promo.title}`,
            price: Number(candidate.promo.promo_price || 0),
            originalPrice: Math.max(Number(candidate.promo.original_price || 0), matchedOrig),
            duration: Number(candidate.promo.duration_minutes || matchedDur || 60),
            categoryTitle: candidate.promo.badge_text || 'Promozione del Mese',
            is_promotion: true,
            promo_id: Number(candidate.promo.id),
            includedServices: candidate.promo.services || [],
            includedServiceIds: candidate.promoIds.slice(),
            autoAppliedPromo: true,
          };
          remaining.splice(Math.min(insertAt, remaining.length), 0, promoObj);
          workingBag.length = 0;
          workingBag.push(...remaining);
          matchedAny = true;
          break;
        }
      }
    }

    selectedBag.length = 0;
    selectedBag.push(...workingBag);
  } finally {
    __reconcilingStorefrontBag = false;
  }
}

function installStorefrontPromoCartSync() {
  if (typeof updateBagUI === 'function' && !updateBagUI.__gbsPromoWrapped) {
    const origUpdateBagUI = updateBagUI;
    const wrappedUpdate = function () {
      reconcileStorefrontBagPromotions();
      return origUpdateBagUI.apply(this, arguments);
    };
    wrappedUpdate.__gbsPromoWrapped = true;
    updateBagUI = wrappedUpdate;
  }

  if (typeof toggleServiceInBag === 'function' && !toggleServiceInBag.__gbsPromoWrapped) {
    const origToggleService = toggleServiceInBag;
    const wrappedToggle = function (serviceId) {
      const bundleIdx = selectedBag.findIndex(
        (it) => it && it.autoAppliedPromo && Array.isArray(it.includedServiceIds) && it.includedServiceIds.includes(serviceId)
      );
      if (bundleIdx !== -1) {
        const bundled = selectedBag[bundleIdx];
        const restIds = bundled.includedServiceIds.filter((id) => id !== serviceId);
        selectedBag.splice(bundleIdx, 1);
        restIds.forEach((id) => {
          const srv = getServiceMap().get(id);
          if (srv) {
            selectedBag.push({
              uid: `${srv.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
              ...srv,
            });
          }
        });
        renderListino();
        updateBagUI();
        return;
      }
      return origToggleService.apply(this, arguments);
    };
    wrappedToggle.__gbsPromoWrapped = true;
    toggleServiceInBag = wrappedToggle;
  }

  const bookingDateEl = document.getElementById('bookingDateInput');
  if (bookingDateEl && bookingDateEl.dataset.promoSyncBound !== '1') {
    bookingDateEl.dataset.promoSyncBound = '1';
    bookingDateEl.addEventListener('change', () => {
      updateBagUI();
    });
  }

  fetch(`${API_BASE}/public/promotions`)
    .then((r) => r.json())
    .then((data) => {
      if (data && Array.isArray(data.promotions)) {
        storefrontActivePromosCache = data.promotions;
        updateBagUI();
      }
    })
    .catch(() => {});
}

document.addEventListener('DOMContentLoaded', initApp);
