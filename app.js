/**
 * GIULIA BEAUTY STUDIO — NAILS & MAKEUP
 * Interactive Listino, Beauty Bag, Concierge & Checkout Logic
 */

const STUDIO_CATALOG = [
  {
    id: 'nails',
    column: 'left',
    title: 'NAILS',
    motto: 'MANI E PIEDI SEMPRE PERFETTI',
    subgroups: [
      {
        label: 'Manicure Classica & Spa',
        items: [
          { id: 'nails-1', name: 'Manicure', price: 12, duration: 30, desc: 'Cura delle cuticole, limatura armoniosa e idratazione profonda.' },
          { id: 'nails-2', name: 'Manicure con smalto', price: 15, duration: 40, desc: 'Manicure estetica completa con applicazione smalto classico brillante.' },
          { id: 'nails-3', name: 'Manicure spa', price: 20, duration: 50, desc: 'Rituale esfoliante, maschera nutriente e massaggio distensivo mani.' }
        ]
      },
      {
        label: 'Pedicure Estetica, Spa & Profonda',
        items: [
          { id: 'nails-4', name: 'Pedicure', price: 22, duration: 40, desc: 'Riordino estetico completo dell’unghia e freschezza immediata.' },
          { id: 'nails-5', name: 'Pedicure con smalto', price: 25, duration: 45, desc: 'Pedicure accurata con stesura smalto classico a scelta.' },
          { id: 'nails-6', name: 'Pedicure spa', price: 28, duration: 55, desc: 'Bagno aromatico, scrub levigante, impacco idratante e massaggio.' },
          { id: 'nails-7', name: 'Pedicure spa + smalto', price: 30, duration: 60, desc: 'Percorso benessere Spa completo per i piedi con finitura smalto.' },
          { id: 'nails-8', name: 'Pedicure estetica + semipermanente', price: 34, duration: 60, desc: 'Piedi curati e colore impeccabile a lunga tenuta.' },
          { id: 'nails-9', name: 'Pedicure profonda + semipermanente', price: 39, duration: 75, desc: 'Trattamento intensivo callosità con stesura semipermanente.' },
          { id: 'nails-10', name: 'Pedicure profonda', price: 25, duration: 50, desc: 'Cura intensiva e specifica per il benessere totale del piede.' },
          { id: 'nails-11', name: 'Pedicure profonda + smalto', price: 28, duration: 60, desc: 'Trattamento profondo abbinato a smalto classico luminoso.' }
        ]
      },
      {
        label: 'Semipermanente, Gel & Ricostruzione',
        items: [
          { id: 'nails-12', name: 'Manicure + semipermanente', price: 28, duration: 60, desc: 'Manicure sartoriale e stesura smalto semipermanente ultra-glossy.' },
          { id: 'nails-13', name: 'Manicure + semipermanente rinforzato', price: 33, duration: 70, desc: 'Base strutturata rinforzata per maggiore resistenza e bombatura naturale.' },
          { id: 'nails-14', name: 'Copertura in gel', price: 35, duration: 75, desc: 'Rinforzo in gel su unghia naturale per una tenuta impeccabile.' },
          { id: 'nails-15', name: 'Ritocco (unghie semplici)', price: 38, duration: 80, desc: 'Refill periodico in gel con finitura monocromatica o nude elegante.' },
          { id: 'nails-16', name: 'Ritocco con lavorazioni extra', price: 40, duration: 90, desc: 'Refill in gel con french, babyboomer o nail art ricercate.' },
          { id: 'nails-17', name: 'Ricostruzione', price: 45, duration: 105, desc: 'Allungamento con cartina e architettura su misura in gel.' },
          { id: 'nails-18', name: 'Ricostruzione lunga', price: 50, duration: 120, desc: 'Allungamento importante dal design slanciato e strutturato.' }
        ]
      }
    ]
  },
  {
    id: 'lashes',
    column: 'left',
    title: 'CIGLIA E SOPRACCIGLIA',
    motto: 'UNO SGUARDO CHE VALORIZZA LA TUA BELLEZZA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'lashes-1', name: 'Laminazione ciglia', price: 45, duration: 60, desc: 'Curvatura naturale, tintura e trattamento alla cheratina nutriente.' },
          { id: 'lashes-2', name: 'Laminazione sopracciglia', price: 35, duration: 45, desc: 'Definizione, stiratura e fissaggio per sopracciglia folte e ordinate.' },
          { id: 'lashes-3', name: 'Henné sopracciglia', price: 25, duration: 40, desc: 'Bio-tatuaggio naturale con effetto riempitivo su pelo e pelle.' },
          { id: 'lashes-4', name: 'Laminazione ciglia coreana', price: 50, duration: 70, desc: 'Tecnica avanzata coreana per un sollevamento panoramico ultra-delicato.' },
          { id: 'lashes-5', name: 'Extension ciglia', price: 80, duration: 110, desc: 'Applicazione sartoriale per uno sguardo intenso, magnetico e personalizzato.' },
          { id: 'lashes-6', name: 'Mappatura, forma e definizione sopracciglia + tinta', price: 30, duration: 40, desc: 'Studio dell’arcata sopraccigliare, epilazione di precisione e tintura.' }
        ]
      }
    ]
  },
  {
    id: 'epilazione',
    column: 'right',
    title: 'EPILAZIONE',
    motto: 'PELLE LISCIA, OGNI GIORNO',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'epi-1', name: 'Gamba intera', price: 22, duration: 35, desc: 'Epilazione completa gambe per una pelle liscia e vellutata.' },
          { id: 'epi-2', name: 'Mezza gamba', price: 15, duration: 25, desc: 'Epilazione accurata polpaccio e ginocchio.' },
          { id: 'epi-3', name: 'Inguine parziale', price: 10, duration: 15, desc: 'Definizione delicata della linea bikini.' },
          { id: 'epi-4', name: 'Inguine totale', price: 15, duration: 25, desc: 'Epilazione integrale eseguita con massima cura.' },
          { id: 'epi-5', name: 'Ascelle', price: 5, duration: 10, desc: 'Epilazione rapida e delicata per una freschezza prolungata.' },
          { id: 'epi-6', name: 'Braccia', price: 12, duration: 20, desc: 'Epilazione completa braccia con emulsione lenitiva finale.' },
          { id: 'epi-7', name: 'Baffetti', price: 4, duration: 10, desc: 'Rimozione delicata della peluria del labbro superiore.' },
          { id: 'epi-8', name: 'Sopracciglia', price: 6, duration: 15, desc: 'Pulizia e riordino della linea naturale delle sopracciglia.' }
        ]
      }
    ]
  },
  {
    id: 'brasiliana',
    column: 'right',
    title: 'EPILAZIONE CON BRASILIANA',
    motto: 'DELICATEZZA ED EFFICACIA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'bras-1', name: 'Inguine parziale', price: 13, duration: 20, desc: 'Cera brasiliana tiepida che ingloba il pelo senza aderire alla pelle.' },
          { id: 'bras-2', name: 'Inguine totale', price: 18, duration: 30, desc: 'Trattamento brasiliano integrale ultra-confortevole e duraturo.' },
          { id: 'bras-3', name: 'Ascelle', price: 8, duration: 15, desc: 'Ideale per pelli sensibili, riduce gli arrossamenti e ritarda la ricrescita.' },
          { id: 'bras-4', name: 'Baffetti + sopracciglia', price: 13, duration: 20, desc: 'Combo viso ultra-delicata con resina brasiliana specifica.' },
          { id: 'bras-5', name: 'Resina naso', price: 6, duration: 10, desc: 'Epilazione sicura, rapida e indolore con resina elastica.' },
          { id: 'bras-6', name: 'Resina orecchie', price: 6, duration: 10, desc: 'Finitura precisa e delicata con resina tiepida.' }
        ]
      }
    ]
  },
  {
    id: 'viso',
    column: 'right',
    title: 'VISO',
    motto: 'TRATTAMENTI SU MISURA PER UNA PELLE PIÙ LUMINOSA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'viso-1', name: 'Pulizia viso', price: 45, duration: 60, desc: 'Detersione profonda, esfoliazione, purificazione e maschera illuminante.' },
          { id: 'viso-2', name: 'Trattamento viso relax', price: 40, duration: 50, desc: 'Massaggio olistico viso-collo-décolleté con attivi idratanti e distensivi.' }
        ]
      }
    ]
  },
  {
    id: 'makeup',
    column: 'right',
    title: 'MAKE UP',
    motto: 'PER OGNI OCCASIONE, LA TUA BELLEZZA UNICA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'makeup-1', name: 'Make up sposa', price: 150, duration: 120, desc: 'Studio morfologico, prova dedicata e trucco sposa ad altissima tenuta.' },
          { id: 'makeup-2', name: 'Make up cerimonia', price: 35, duration: 50, desc: 'Trucco sofisticato e fotografico per eventi speciali, gala e cerimonie.' },
          { id: 'makeup-3', name: 'Make up giorno', price: 30, duration: 40, desc: 'Make up luminoso e raffinato per valorizzare i tuoi lineamenti.' }
        ]
      }
    ]
  }
];

// Flat lookup map for all services
const SERVICE_MAP = new Map();
STUDIO_CATALOG.forEach((cat) => {
  cat.subgroups.forEach((sg) => {
    sg.items.forEach((item) => {
      SERVICE_MAP.set(item.id, { ...item, categoryId: cat.id, categoryTitle: cat.title });
    });
  });
});

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
}

function closeCheckoutDrawer() {
  checkoutDrawerEl.classList.remove('open');
  drawerBackdropEl.classList.remove('open');
}

/**
 * Initialize Event Listeners
 */
function initApp() {
  // Set default date in booking calendar to tomorrow
  const dateInput = document.getElementById('bookingDateInput');
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
    dateInput.min = new Date().toISOString().split('T')[0];
  }

  // Category filter pills
  categoryPillsEl.querySelectorAll('.cat-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      categoryPillsEl.querySelectorAll('.cat-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
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
  document.getElementById('openFlyerTopBtn').addEventListener('click', () => flyerModal.classList.add('open'));
  document.getElementById('openFlyerHeaderBtn').addEventListener('click', () => flyerModal.classList.add('open'));
  document.getElementById('closeFlyerModalBtn').addEventListener('click', () => flyerModal.classList.remove('open'));
  flyerModal.addEventListener('click', (e) => {
    if (e.target === flyerModal) flyerModal.classList.remove('open');
  });

  // Confirm Order & Booking Receipt Modal
  const confirmModal = document.getElementById('confirmationModal');
  const receiptContent = document.getElementById('confirmationReceiptContent');

  document.getElementById('confirmOrderBtn').addEventListener('click', () => {
    if (selectedBag.length === 0) {
      alert('Seleziona almeno un trattamento dal listino prima di confermare.');
      return;
    }

    const clientName = document.getElementById('clientNameInput').value.trim() || 'Cliente Ospite';
    const bookingDate = document.getElementById('bookingDateInput').value;
    const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
    const orderCode = `GBS-${Math.floor(100000 + Math.random() * 900000)}`;

    const itemsHtml = selectedBag
      .map(
        (item) =>
          `<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(145,78,86,0.2);">
            <span>${item.name}</span>
            <strong>${item.price} €</strong>
          </li>`
      )
      .join('');

    receiptContent.innerHTML = `
      <div style="font-size: 2.2rem; color: var(--rose-deep); margin-bottom: 4px;">♡</div>
      <span style="font-size: 0.68rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--rose-deep); font-weight: 600;">
        Richiesta Registrata con Successo
      </span>
      <h3 id="confirmModalTitle" style="font-family: var(--font-serif); font-size: 2rem; color: var(--ink-primary); margin: 6px 0;">
        Grazie, ${clientName}!
      </h3>
      <p style="font-size: 0.86rem; color: var(--ink-secondary); margin-bottom: 18px;">
        Codice Riepilogo: <strong>${orderCode}</strong> • ${
      purchaseMode === 'booking'
        ? `Appuntamento richiesto per il <strong>${bookingDate}</strong> alle <strong>${selectedTimeSlot}</strong>`
        : 'Voucher / Gift Card Digitale'
    }
      </p>
      <ul style="list-style:none; text-align:left; background:#fff; padding:16px 20px; border-radius:12px; border:1px solid var(--rose-gold-hairline); margin-bottom:18px; font-size:0.88rem;">
        ${itemsHtml}
        <li style="display:flex;justify-content:space-between;padding-top:10px;font-family:var(--font-serif);font-size:1.35rem;font-weight:600;color:var(--ink-primary);">
          <span>Totale Complessivo</span>
          <span>${totalEuro} €</span>
        </li>
      </ul>
      <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="btn-primary-luxury" id="closeReceiptBtn" style="padding:12px 28px;">
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

  // WhatsApp Quick Summary Generator
  document.getElementById('whatsappDirectBtn').addEventListener('click', () => {
    if (selectedBag.length === 0) {
      alert('Aggiungi almeno un trattamento dal listino per inviare il riepilogo su WhatsApp.');
      return;
    }
    const clientName = document.getElementById('clientNameInput').value.trim() || '';
    const bookingDate = document.getElementById('bookingDateInput').value;
    const totalEuro = selectedBag.reduce((acc, item) => acc + item.price, 0);
    const listText = selectedBag.map((i) => `• ${i.name} (${i.price} €)`).join('\n');

    const msg = `Ciao *Giulia Beauty Studio* ♡\nVorrei ${
      purchaseMode === 'booking'
        ? `prenotare per il giorno *${bookingDate}* alle *${selectedTimeSlot}*`
        : `acquistare un Voucher / Gift Card per`
    } i seguenti trattamenti:\n\n${listText}\n\n*Totale: ${totalEuro} €*${
      clientName ? `\nNome: ${clientName}` : ''
    }`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener');
  });

  // Initial Render
  renderListino();
  updateBagUI();
}

document.addEventListener('DOMContentLoaded', initApp);
