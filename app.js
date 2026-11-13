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
const STUDIO_CATALOG = window.STUDIO_CATALOG || [];
const SERVICE_MAP = window.SERVICE_MAP || new Map();

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
let selectedPaymentMethod = 'carta';

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

  STUDIO_CATALOG.forEach((cat) => {
    if (activeCategory !== 'all' && cat.id !== activeCategory) return;

    // Filter subgroups by search query
    const filteredSubgroups = cat.subgroups
      .map((sg) => {
        const matchingItems = sg.items.filter(
          (item) =>
            !q ||
            item.name.toLowerCase().includes(q) ||
            item.desc.toLowerCase().includes(q) ||
            cat.title.toLowerCase().includes(q)
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
              <span class="service-name">${item.name}</span>
              <span class="service-duration">${item.duration} min</span>
            </div>
            <p class="service-desc">${item.desc}</p>
          </div>
          <div class="service-price-action">
            <span class="service-price">${item.price} €</span>
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
    const svc = SERVICE_MAP.get(serviceId);
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
      const svc = SERVICE_MAP.get(id);
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
 * Remove item by UID from drawer
 */
function removeBagItemByUid(uid) {
  selectedBag = selectedBag.filter((item) => item.uid !== uid);
  updateBagUI();
  renderListino();
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
      li.innerHTML = `
        <div>
          <span class="bag-item-cat">${item.categoryTitle}</span>
          <div class="bag-item-title">${item.name}</div>
        </div>
        <div class="bag-item-right">
          <span class="bag-item-price">${item.price} €</span>
          <button type="button" class="btn-remove-item" aria-label="Rimuovi ${item.name}">✕</button>
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

function getNextOpenDateString() {
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  while (dt.getDay() === 0 || dt.getDay() === 2) {
    dt.setDate(dt.getDate() + 1);
  }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildWhatsAppUrl() {
  const clientName = document.getElementById('clientNameInput')?.value.trim() || '';
  const clientPhone = document.getElementById('clientPhoneInput')?.value.trim() || '';
  const clientNotes = document.getElementById('clientNotesInput')?.value.trim() || '';
  const bookingDate = document.getElementById('bookingDateInput')?.value || '';
  const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
  const listText = selectedBag.map((i) => `• ${i.name} (${i.price} €)`).join('\n');

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

async function refreshAvailableSlots(dateStr) {
  const slotsGrid = document.getElementById('timeSlotsGrid');
  const statusEl = document.getElementById('slotsLiveStatus');
  if (!slotsGrid || !dateStr) return;

  const totalMin = selectedBag.reduce((acc, item) => acc + (item.duration || 0), 0) || 60;
  const operatorId = Number.parseInt(document.getElementById('bookingOperatorSelect')?.value || '0', 10) || 0;
  const buttons = Array.from(slotsGrid.querySelectorAll('.time-slot-btn'));

  try {
    const res = await publicFetchWithLoader(
      `${API_BASE}/public/slots?date=${encodeURIComponent(dateStr)}&duration=${totalMin}&operator_id=${operatorId}`,
      {},
      { label: 'Verifica orari disponibili…', blocking: false, delayMs: 70 }
    );
    if (!res.ok) throw new Error('API offline');
    const data = await res.json();
    if (!data.ok) throw new Error('API error');

    const booked = new Set(data.booked_slots || []);
    let firstFreeBtn = null;

    buttons.forEach((btn) => {
      const t = btn.dataset.time;
      const isBusy = data.closed || booked.has(t);
      btn.disabled = isBusy;
      btn.classList.toggle('is-booked', isBusy);
      btn.textContent = isBusy ? `${t} (Occupato)` : t;
      if (isBusy && btn.classList.contains('active')) {
        btn.classList.remove('active');
      }
      if (!isBusy && !firstFreeBtn) {
        firstFreeBtn = btn;
      }
    });

    if (!slotsGrid.querySelector('.time-slot-btn.active') && firstFreeBtn) {
      firstFreeBtn.classList.add('active');
      selectedTimeSlot = firstFreeBtn.dataset.time;
    }

    if (statusEl) {
      statusEl.textContent = data.closed
        ? 'Studio chiuso'
        : booked.size > 0
          ? 'Disponibilità in tempo reale'
          : 'Tutti gli orari liberi';
    }
  } catch (_) {
    // Graceful fallback if static preview without PHP backend
    buttons.forEach((btn) => {
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

function initApp() {
  loadPublicOperators();
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
    dateInput.min = new Date().toISOString().split('T')[0];
    refreshAvailableSlots(dateInput.value);
    dateInput.addEventListener('change', () => {
      if (closedWarningEl) {
        closedWarningEl.hidden = !isClosedDay(dateInput.value);
      }
      refreshAvailableSlots(dateInput.value);
    });
  }

  // Category filter pills
  categoryPillsEl.querySelectorAll('.cat-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryPillsEl.querySelectorAll('.cat-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      activeCategory = btn.dataset.cat;
      renderListino();
    });
  });

  // Instant search
  searchInputEl.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderListino();
  });

  // Hero Quick Add Button
  document.getElementById('heroQuickAddBtn').addEventListener('click', () => {
    addMultipleServices(['nails-12', 'lashes-1'], true);
  });

  // Curated Packages Buttons
  document.querySelectorAll('.pkg-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ids = btn.dataset.services.split(',');
      addMultipleServices(ids, true);
    });
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
      const preset = CONCIERGE_PRESETS[activeConciergePreset];
      const total = preset.ids.reduce((sum, id) => sum + (SERVICE_MAP.get(id)?.price || 0), 0);
      conciergeTitleEl.textContent = preset.title;
      conciergeMetaEl.innerHTML = `${preset.ids.length} Trattamenti • Totale <strong>${total} €</strong>`;
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

  // Time Slots Selection
  const timeSlotsGrid = document.getElementById('timeSlotsGrid');
  timeSlotsGrid.querySelectorAll('.time-slot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      timeSlotsGrid.querySelectorAll('.time-slot-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedTimeSlot = btn.dataset.time;
    });
  });

  // Payment Method Selection
  const paymentMethodsGrid = document.getElementById('paymentMethodsGrid');
  paymentMethodsGrid.querySelectorAll('.payment-option-card').forEach((card) => {
    card.addEventListener('click', () => {
      paymentMethodsGrid.querySelectorAll('.payment-option-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      selectedPaymentMethod = card.dataset.pay;
    });
  });

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

  function openLegalModal(tabKey = 'privacy') {
    legalTabBtns.forEach((btn) => {
      const isMatch = btn.dataset.legalTab === tabKey;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    Object.entries(legalPanels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('active', key === tabKey);
    });
    legalModal?.classList.add('open');
  }

  legalTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => openLegalModal(btn.dataset.legalTab));
  });

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
          if (data.code === 'SLOT_OCCUPIED') {
            refreshAvailableSlots(bookingDate);
          }
          return;
        }
        orderCode = data.booking_code || orderCode;
        savedToDb = true;
        refreshAvailableSlots(bookingDate);
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
      const bookingDate = document.getElementById('bookingDateInput')?.value;
      if (isClosedDay(bookingDate)) {
        alert('Nota: Il Martedì e la Domenica lo studio è chiuso. Seleziona un giorno di apertura (Lun, Mer, Gio, Ven, Sab) prima di procedere.');
        return;
      }
    }
    if (!validateCheckoutLegalConsent()) {
      return;
    }
    window.open(buildWhatsAppUrl(), '_blank', 'noopener');
  });

  // Initial Render
  renderListino();
  updateBagUI();
}

document.addEventListener('DOMContentLoaded', initApp);
