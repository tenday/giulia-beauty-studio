/**
 * GIULIA BEAUTY STUDIO — Autonomous Studio AI Agent (Tool Calling)
 * Allows Giulia to inspect and execute any Studio management action
 * via natural language across Agenda, CRM, Payments, Inventory, Promo, Catalog, Gift Cards & WhatsApp.
 */

const crypto = require('crypto');
const { computeStudioInsights, answerStudioQuestion, summarizeAppointmentsForAi } = require('./analytics');
const { computeDateSlotAvailability, buildDefaultSchedule, parseOperatorSchedule } = require('./availability');
const {
  PAYMENT_METHOD_LABELS,
  roundMoney,
  normalizePaymentStatus,
  normalizePaymentMethod,
  derivePaymentStatus,
  resolveStripeConfig,
  resolvePayPalConfig,
  createStripeRefund,
  createPayPalRefund,
} = require('./payments');
const { dispatchWhatsAppMessage, formatShortItDate } = require('./jobs');
const { buildWaMeUrl } = require('./whatsapp');
const { normalizePhone, isValidIsoDate, formatRomeNow } = require('./helpers');

const ALLOWED_APPT_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
const ALLOWED_ADMIN_VIEWS = [
  'agenda',
  'clients',
  'inventory',
  'messages',
  'giftcards',
  'promotions',
  'catalog',
  'insights',
  'settings',
];

function normText(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeTimeHHMM(raw) {
  const s = String(raw || '').trim().replace('.', ':');
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    m = s.match(/^(\d{1,2})$/);
    if (m) m = [s, m[1], '00'];
  }
  if (!m) return '';
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function shiftIsoDate(isoDate, deltaDays) {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function generateGiftCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  return `GBS-${suffix}`;
}

function defaultGiftCardExpiry(fromDateIso) {
  const [y, m, d] = String(fromDateIso || '2026-01-01').split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}

async function resolveClientMatch(store, { clientId, clientName, clientPhone }) {
  const cid = Number.parseInt(clientId || '0', 10) || 0;
  const clients = await store.listClients('');
  if (cid > 0) {
    const found = clients.find((c) => Number(c.id) === cid);
    return found ? { found } : { error: `Nessuna cliente trovata con ID ${cid}.` };
  }
  const normPhone = normalizePhone(clientPhone || '');
  if (normPhone && normPhone.replace(/\D/g, '').length >= 7) {
    const phoneMatch = clients.find((c) => normalizePhone(c.phone) === normPhone);
    if (phoneMatch) return { found: phoneMatch };
  }
  const q = normText(clientName);
  if (q) {
    const exact = clients.filter((c) => normText(c.full_name) === q);
    if (exact.length === 1) return { found: exact[0] };
    const partial = clients.filter((c) => normText(c.full_name).includes(q));
    if (partial.length === 1) return { found: partial[0] };
    if (partial.length > 1) {
      return {
        ambiguous: partial.slice(0, 6).map((c) => ({
          id: Number(c.id),
          full_name: c.full_name,
          phone: c.phone,
        })),
      };
    }
  }
  return { found: null };
}

async function resolveOperatorId(store, operatorId, operatorName) {
  const operators = await store.listOperators(false);
  const oid = Number.parseInt(operatorId || '0', 10) || 0;
  if (oid > 0) {
    const found = operators.find((o) => Number(o.id) === oid);
    if (found) return found;
  }
  const q = normText(operatorName);
  if (q) {
    const exact = operators.find((o) => normText(o.name) === q);
    if (exact) return exact;
    const partial = operators.find((o) => normText(o.name).includes(q));
    if (partial) return partial;
  }
  return operators.find((o) => Number(o.active) === 1) || operators[0] || null;
}

async function resolveAppointmentMatch(store, { appointmentId, bookingCode, date, clientQuery }) {
  const aid = Number.parseInt(appointmentId || '0', 10) || 0;
  if (aid > 0) {
    const appt = await store.getAppointmentById(aid);
    return appt ? { appt } : { error: `Appuntamento ID ${aid} non trovato.` };
  }
  const code = String(bookingCode || '').trim();
  if (code) {
    const appt = await store.getAppointmentByCode(code);
    return appt ? { appt } : { error: `Appuntamento con codice ${code} non trovato.` };
  }
  const appts = await store.listAppointments({
    startDate: isValidIsoDate(date) ? date : '',
    endDate: isValidIsoDate(date) ? date : '',
  });
  const q = normText(clientQuery);
  const filtered = appts.filter((a) => (!q || normText(a.client_name).includes(q)) && a.status !== 'cancelled');
  if (filtered.length === 1) return { appt: filtered[0] };
  if (filtered.length > 1) {
    return {
      ambiguous: filtered.slice(0, 6).map((a) => ({
        id: Number(a.id),
        booking_code: a.booking_code,
        date: a.appointment_date,
        time: String(a.start_time || '').slice(0, 5),
        client_name: a.client_name,
        services: a.services_summary,
      })),
    };
  }
  return { error: 'Appuntamento non trovato. Specifica ID, codice prenotazione oppure data e nome cliente.' };
}

async function resolveServicesForBooking(store, { serviceNames, servicesSummary, totalPrice, durationMinutes, todayIso, promoQuery }) {
  const catalogData = await store.listCatalogData();
  const catalogServices = catalogData?.services || [];
  const rawNames = Array.isArray(serviceNames)
    ? serviceNames
    : typeof serviceNames === 'string' && serviceNames.trim()
    ? serviceNames.split(/\+|,/)
    : typeof servicesSummary === 'string' && servicesSummary.trim()
    ? servicesSummary.split(/\+|,/)
    : [];

  const matchedServices = [];
  for (const rawName of rawNames) {
    const q = normText(rawName);
    if (!q) continue;
    const exact = catalogServices.find((s) => normText(s.name) === q);
    const partial =
      exact ||
      catalogServices.find((s) => normText(s.name).includes(q) || q.includes(normText(s.name)));
    if (partial) {
      matchedServices.push({
        id: String(partial.service_key || `srv-${partial.id}`),
        catalog_id: Number(partial.id),
        name: partial.name,
        price: Number(partial.price || 0),
        duration: Number(partial.duration_minutes || 30),
      });
    } else {
      matchedServices.push({
        id: `custom-${Date.now()}-${matchedServices.length}`,
        name: String(rawName).trim(),
        price: 0,
        duration: 30,
      });
    }
  }

  let promoApplied = null;
  if (promoQuery) {
    const activePromos = await store.listPromotions({ activeOnly: true, todayIso });
    const pq = normText(promoQuery);
    promoApplied = activePromos.find((p) => Number(p.id) === Number(promoQuery) || normText(p.title).includes(pq));
  }

  let finalServices = matchedServices;
  if (promoApplied) {
    finalServices = [
      {
        id: `promo-${promoApplied.id}`,
        promo_id: promoApplied.id,
        is_promotion: true,
        name: `Promo: ${promoApplied.title}`,
        price: Number(promoApplied.promo_price || 0),
        duration: Number(promoApplied.duration_minutes || 60),
      },
    ];
  }

  const computedPrice = finalServices.reduce((sum, s) => sum + Number(s.price || 0), 0);
  const computedDuration = finalServices.reduce((sum, s) => sum + Math.max(0, Number(s.duration || 0)), 0);

  const finalPrice =
    totalPrice !== undefined && totalPrice !== null && Number.isFinite(Number(totalPrice))
      ? Math.max(0, Number(totalPrice))
      : Number(computedPrice.toFixed(2));
  const finalDuration =
    durationMinutes !== undefined && durationMinutes !== null && Number.isFinite(Number(durationMinutes))
      ? Math.max(10, Math.min(600, Number.parseInt(durationMinutes, 10)))
      : Math.max(15, computedDuration || 60);

  const summary =
    String(servicesSummary || '').trim() ||
    finalServices.map((s) => s.name).filter(Boolean).join(' + ') ||
    'Trattamento Studio';

  return {
    services: finalServices,
    servicesSummary: summary.slice(0, 490),
    totalPrice: roundMoney(finalPrice),
    durationMinutes: finalDuration,
    promoApplied,
  };
}

const AI_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Controlla gli orari liberi reali (ogni 15 minuti) per una data specifica, operatore e durata.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Data YYYY-MM-DD' },
          duration_minutes: { type: 'integer', description: 'Durata trattamento in minuti (default 60)' },
          operator_name: { type: 'string', description: 'Nome operatore opzionale' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_appointments',
      description: 'Cerca appuntamenti in agenda filtrati per data/intervallo, nome cliente o stato.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Data inizio YYYY-MM-DD' },
          end_date: { type: 'string', description: 'Data fine YYYY-MM-DD' },
          client_query: { type: 'string', description: 'Nome o parte del nome cliente' },
          status: { type: 'string', enum: ALLOWED_APPT_STATUSES },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment',
      description:
        'Crea un nuovo appuntamento in agenda (o voucher). Risolve automaticamente cliente in rubrica, trattamenti dal listino, prezzi/durate, operatore e pagamento iniziale.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'integer' },
          client_name: { type: 'string', description: 'Nome e cognome cliente' },
          client_phone: { type: 'string', description: 'Telefono (obbligatorio solo se nuova cliente non in archivio)' },
          client_email: { type: 'string' },
          date: { type: 'string', description: 'Data appuntamento YYYY-MM-DD' },
          time: { type: 'string', description: 'Orario HH:MM (es. 15:00)' },
          service_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Nomi trattamenti dal listino (es. ["Manicure spa", "Pedicure estetico"])',
          },
          services_summary: { type: 'string', description: 'Descrizione trattamenti se personalizzata' },
          promo_query: { type: 'string', description: 'Nome o ID promo attiva del mese se richiesta' },
          total_price: { type: 'number', description: 'Prezzo totale EUR (opzionale: se omesso lo calcola dal listino)' },
          duration_minutes: { type: 'integer', description: 'Durata minuti (opzionale: se omessa la calcola dal listino)' },
          operator_name: { type: 'string', description: 'Operatore (es. Giulia)' },
          status: { type: 'string', enum: ALLOWED_APPT_STATUSES, description: 'Default confirmed' },
          payment_status: { type: 'string', enum: ['unpaid', 'partial', 'paid'] },
          payment_method: {
            type: 'string',
            enum: ['studio', 'contanti', 'pos', 'satispay', 'bonifico', 'gift_card', 'carta'],
          },
          paid_amount: { type: 'number' },
          notes: { type: 'string' },
          privacy_accepted: { type: 'boolean', description: 'Default false salvo conferma esplicita firma privacy' },
          send_whatsapp: { type: 'boolean', description: 'True per preparare link conferma WhatsApp' },
        },
        required: ['date', 'time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_appointment',
      description: 'Modifica o sposta un appuntamento esistente (data, ora, durata, stato, operatore, trattamenti, prezzo, note).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'integer' },
          booking_code: { type: 'string' },
          client_query: { type: 'string' },
          search_date: { type: 'string', description: 'Data attuale dell appuntamento da trovare YYYY-MM-DD' },
          new_date: { type: 'string', description: 'Nuova data YYYY-MM-DD' },
          new_time: { type: 'string', description: 'Nuovo orario HH:MM' },
          duration_minutes: { type: 'integer' },
          operator_name: { type: 'string' },
          status: { type: 'string', enum: ALLOWED_APPT_STATUSES },
          service_names: { type: 'array', items: { type: 'string' } },
          services_summary: { type: 'string' },
          total_price: { type: 'number' },
          notes: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_appointment',
      description: 'Elimina definitivamente un appuntamento dall agenda. Usa solo se richiesto esplicitamente.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'integer' },
          booking_code: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_payment_or_refund',
      description: 'Registra un incasso, acconto, saldo o rimborso su un appuntamento.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'integer' },
          booking_code: { type: 'string' },
          client_query: { type: 'string' },
          date: { type: 'string' },
          direction: { type: 'string', enum: ['payment', 'refund'] },
          payment_method: {
            type: 'string',
            enum: ['contanti', 'pos', 'satispay', 'bonifico', 'gift_card', 'studio', 'stripe_online', 'paypal_online'],
          },
          payment_status: { type: 'string', enum: ['unpaid', 'partial', 'paid'] },
          amount: { type: 'number', description: 'Importo incassato o rimborsato in EUR' },
          notes: { type: 'string' },
          confirm_appointment: { type: 'boolean' },
          call_online_provider: { type: 'boolean', description: 'Per refund Stripe/PayPal se pagato online' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clients',
      description: 'Cerca clienti nel CRM per nome/telefono/ID e mostra dettagli, visite, pacchetti attivi e stato privacy.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nome o telefono' },
          client_id: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_client',
      description: 'Crea una nuova cliente nel CRM, aggiorna dati anagrafici/allergie/preferenze oppure elimina una cliente.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['save', 'delete'] },
          client_id: { type: 'integer' },
          full_name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          birth_date: { type: 'string', description: 'YYYY-MM-DD' },
          allergies_notes: { type: 'string' },
          preferences_notes: { type: 'string' },
          privacy_accepted: { type: 'boolean', description: 'Default false salvo firma esplicita' },
          marketing_consent: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_client_card',
      description: 'Aggiunge una tessera/pacchetto sedute a una cliente oppure scala una seduta/credito o la elimina.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'use', 'delete'] },
          client_id: { type: 'integer' },
          client_name: { type: 'string' },
          card_id: { type: 'integer' },
          title: { type: 'string' },
          card_type: { type: 'string', enum: ['package', 'fidelity', 'prepaid'] },
          total_sessions: { type: 'integer' },
          remaining_credit: { type: 'number' },
          sessions_delta: { type: 'integer', description: 'Sedute da scalare con action=use (default 1)' },
          credit_delta: { type: 'number' },
          expires_at: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_privacy_otp_link',
      description: 'Genera link di firma Privacy GDPR con codice OTP e link WhatsApp pronto per la cliente.',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'integer' },
          client_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_staff_and_absences',
      description: 'Elenca operatori, crea/aggiorna operatore, oppure aggiunge/elimina ferie, permessi o assenze.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'save_operator', 'add_absence', 'delete_absence'] },
          operator_id: { type: 'integer' },
          operator_name: { type: 'string' },
          role: { type: 'string' },
          color: { type: 'string' },
          active: { type: 'boolean' },
          absence_id: { type: 'integer' },
          start_date: { type: 'string', description: 'YYYY-MM-DD' },
          end_date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: 'string', description: 'HH:MM opzionale (vuoto = intera giornata)' },
          end_time: { type: 'string' },
          absence_type: { type: 'string', enum: ['ferie', 'permesso', 'malattia', 'formazione', 'altro'] },
          notes: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_inventory',
      description: 'Consulta prodotti/scorte, crea/modifica prodotto o fornitore, o registra movimento carico/scarico/vendita.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['search', 'save_product', 'delete_product', 'save_supplier', 'record_movement'] },
          query: { type: 'string' },
          product_id: { type: 'integer' },
          product_name: { type: 'string' },
          sku: { type: 'string' },
          category: { type: 'string' },
          cost_price: { type: 'number' },
          sell_price: { type: 'number' },
          stock_qty: { type: 'integer' },
          min_stock_qty: { type: 'integer' },
          supplier_name: { type: 'string' },
          supplier_phone: { type: 'string' },
          movement_type: { type: 'string', enum: ['sale', 'restock', 'cabin_use', 'adjustment'] },
          quantity: { type: 'integer' },
          notes: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_promotions_and_catalog',
      description: 'Gestisce Promozioni del Mese (crea/attiva/disattiva/elimina) e Listino Trattamenti/Categorie (crea/modifica/nascondi/elimina).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'list_promotions',
              'save_promotion',
              'toggle_promotion',
              'delete_promotion',
              'list_catalog',
              'save_category',
              'save_service',
              'toggle_service',
              'delete_service',
            ],
          },
          id: { type: 'integer' },
          title: { type: 'string', description: 'Titolo promo o categoria' },
          service_names: { type: 'array', items: { type: 'string' }, description: 'Servizi inclusi nella promo' },
          promo_price: { type: 'number' },
          original_price: { type: 'number' },
          duration_minutes: { type: 'integer' },
          valid_from: { type: 'string' },
          valid_until: { type: 'string' },
          badge_text: { type: 'string' },
          month_label: { type: 'string' },
          description: { type: 'string' },
          active: { type: 'boolean' },
          featured: { type: 'boolean' },
          category_slug: { type: 'string' },
          category_title: { type: 'string' },
          subgroup_label: { type: 'string' },
          service_name: { type: 'string' },
          price: { type: 'number' },
          show_in_storefront: { type: 'boolean' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_gift_cards',
      description: 'Elenca Gift Card, ne emette una nuova, registra un riscatto totale/parziale oppure la annulla/elimina.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'redeem', 'cancel', 'delete'] },
          id: { type: 'integer' },
          code: { type: 'string' },
          recipient_name: { type: 'string' },
          sender_name: { type: 'string' },
          recipient_phone: { type: 'string' },
          gift_mode: { type: 'string', enum: ['amount', 'treatment'] },
          amount: { type: 'number' },
          service_title: { type: 'string' },
          theme: { type: 'string', enum: ['rose', 'bordeaux', 'pearl'] },
          redeem_amount: { type: 'number' },
          mark_full: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_whatsapp_message',
      description: 'Prepara e registra un link WhatsApp pronto da inviare per una cliente (con template o testo personalizzato).',
      parameters: {
        type: 'object',
        properties: {
          client_id: { type: 'integer' },
          client_name: { type: 'string' },
          recipient_phone: { type: 'string' },
          template_code: { type: 'string', description: 'Es. reminder_tomorrow, booking_confirmed, winback_inactive, birthday_wish' },
          message_text: { type: 'string', description: 'Testo personalizzato del messaggio WhatsApp' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_admin_view',
      description: 'Apre una specifica sezione del gestionale o posiziona il calendario agenda su una data specifica.',
      parameters: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ALLOWED_ADMIN_VIEWS },
          focus_date: { type: 'string', description: 'Data YYYY-MM-DD su cui posizionare il calendario' },
        },
      },
    },
  },
];

async function executeAiTool(name, args = {}, ctx = {}) {
  const { store, adminId, origin, todayIso, privacyVersion, actionsExecuted, uiDirectives } = ctx;
  const nowStr = formatRomeNow();

  const markAction = (summary, view = null, extra = {}) => {
    actionsExecuted.push({
      tool: name,
      mutating: Boolean(extra.mutating !== false),
      summary,
      view,
      ...extra,
    });
  };

  if (name === 'check_availability') {
    const dateStr = String(args.date || todayIso).trim();
    if (!isValidIsoDate(dateStr)) return { ok: false, error: 'Data non valida (atteso YYYY-MM-DD).' };
    const duration = Math.max(15, Math.min(300, Number.parseInt(args.duration_minutes || '60', 10) || 60));
    const op = args.operator_name ? await resolveOperatorId(store, 0, args.operator_name) : null;
    const availCtx = await store.getPublicAvailabilityContext(dateStr);
    const avail = computeDateSlotAvailability({
      dateStr,
      durationMinutes: duration,
      operators: availCtx.operators,
      absences: availCtx.absences,
      bookedRows: availCtx.bookedRows,
      requestedOperatorId: op ? Number(op.id) : 0,
    });
    return {
      ok: true,
      date: dateStr,
      closed: Boolean(avail.closed),
      duration_minutes: duration,
      free_slots: avail.freeSlots || [],
      booked_count: (avail.bookedSlots || []).length,
    };
  }

  if (name === 'search_appointments') {
    const startDate = isValidIsoDate(args.start_date) ? args.start_date : '';
    const endDate = isValidIsoDate(args.end_date) ? args.end_date : startDate;
    const list = await store.listAppointments({
      startDate,
      endDate,
      status: ALLOWED_APPT_STATUSES.includes(args.status) ? args.status : '',
    });
    const q = normText(args.client_query);
    const filtered = list.filter((a) => !q || normText(a.client_name).includes(q));
    return {
      ok: true,
      count: filtered.length,
      appointments: filtered.slice(0, 30).map((a) => ({
        id: Number(a.id),
        booking_code: a.booking_code,
        date: a.appointment_date,
        time: String(a.start_time || '').slice(0, 5),
        duration: a.duration_minutes,
        client_id: Number(a.client_id),
        client_name: a.client_name,
        client_phone: a.client_phone,
        operator_name: a.operator_name,
        services: a.services_summary,
        total_price: Number(a.total_price || 0),
        status: a.status,
        payment_status: a.payment_status,
        paid_amount: Number(a.paid_amount || 0),
        payment_method: a.payment_method,
        notes: a.notes || '',
      })),
    };
  }

  if (name === 'create_appointment') {
    const date = String(args.date || '').trim();
    const time = normalizeTimeHHMM(args.time);
    if (!isValidIsoDate(date) || !time) {
      return { ok: false, error: 'Data (YYYY-MM-DD) o orario (HH:MM) mancanti o non validi.' };
    }

    const clientRes = await resolveClientMatch(store, {
      clientId: args.client_id,
      clientName: args.client_name,
      clientPhone: args.client_phone,
    });
    if (clientRes.error) return { ok: false, error: clientRes.error };
    if (clientRes.ambiguous) {
      return {
        ok: false,
        ambiguous_client: true,
        candidates: clientRes.ambiguous,
        message: 'Trovate più clienti omonime: chiedi a Giulia quale intende.',
      };
    }

    const matchedClient = clientRes.found;
    const finalName = matchedClient?.full_name || String(args.client_name || '').trim();
    const finalPhone = matchedClient?.phone || String(args.client_phone || '').trim();
    if (!matchedClient && (!finalName || !finalPhone)) {
      return {
        ok: false,
        missing_client_phone: true,
        message: `La cliente "${finalName || 'nuova'}" non è ancora in rubrica: chiedi a Giulia il suo numero di telefono (WhatsApp) per registrarla e fissare l'appuntamento.`,
      };
    }

    const op = await resolveOperatorId(store, args.operator_id, args.operator_name);
    const resolvedSrv = await resolveServicesForBooking(store, {
      serviceNames: args.service_names,
      servicesSummary: args.services_summary,
      totalPrice: args.total_price,
      durationMinutes: args.duration_minutes,
      todayIso,
      promoQuery: args.promo_query,
    });

    const payMethod = normalizePaymentMethod(args.payment_method, 'studio');
    let paidAmt =
      args.paid_amount !== undefined && args.paid_amount !== null ? Math.max(0, roundMoney(args.paid_amount)) : 0;
    let payStatus = normalizePaymentStatus(args.payment_status, 'unpaid');
    if (payStatus === 'paid' && paidAmt <= 0 && resolvedSrv.totalPrice > 0) {
      paidAmt = resolvedSrv.totalPrice;
    }
    payStatus = derivePaymentStatus({
      totalPrice: resolvedSrv.totalPrice,
      paidAmount: paidAmt,
      requestedStatus: payStatus,
    });

    const apptStatus = ALLOWED_APPT_STATUSES.includes(args.status) ? args.status : 'confirmed';
    const created = await store.createAdminAppointment({
      clientId: matchedClient ? Number(matchedClient.id) : 0,
      clientName: finalName,
      clientPhone: finalPhone,
      phoneNorm: normalizePhone(finalPhone),
      clientEmail: matchedClient?.email || String(args.client_email || '').trim(),
      clientBirthDate: null,
      clientNotes: '',
      privacyAccepted: args.privacy_accepted === true ? 1 : 0,
      privacyVersion,
      nowStr,
      date,
      time,
      duration: resolvedSrv.durationMinutes,
      operatorId: op ? Number(op.id) : null,
      servicesJson: JSON.stringify(resolvedSrv.services),
      servicesSummary: resolvedSrv.servicesSummary,
      totalPrice: resolvedSrv.totalPrice,
      mode: 'booking',
      paymentMethod: payMethod,
      paymentStatus: payStatus,
      paidAmount: paidAmt,
      paymentNotes: null,
      paidAt: payStatus !== 'unpaid' ? nowStr : null,
      adminId: adminId || null,
      status: apptStatus,
      notes: String(args.notes || '').trim(),
      ipHash: 'ai-agent',
    });

    let waDispatch = null;
    if (args.send_whatsapp && apptStatus === 'confirmed' && finalPhone) {
      waDispatch = await dispatchWhatsAppMessage({
        store,
        toPhone: finalPhone,
        recipientName: finalName,
        clientId: created.clientId,
        appointmentId: created.id,
        templateCode: 'booking_confirmed',
        vars: {
          nome: finalName,
          data: formatShortItDate(date),
          ora: time,
          trattamenti: resolvedSrv.servicesSummary,
          servizi: resolvedSrv.servicesSummary,
          operatore: op?.name || 'Giulia',
          codice: created.bookingCode,
        },
        adminId: adminId || null,
        triggerSource: 'ai_assistant',
      });
    }

    uiDirectives.focus_date = date;
    markAction(`Creato app. ${finalName} (${formatShortItDate(date)} ${time})`, 'agenda', {
      focus_date: date,
      wa_url: waDispatch?.wa_url || waDispatch?.fallback_url || null,
    });

    return {
      ok: true,
      appointment_id: created.id,
      booking_code: created.bookingCode,
      client_id: created.clientId,
      client_name: finalName,
      date,
      time,
      duration_minutes: resolvedSrv.durationMinutes,
      services_summary: resolvedSrv.servicesSummary,
      total_price: resolvedSrv.totalPrice,
      operator_name: op?.name || 'Giulia',
      status: apptStatus,
      payment_status: payStatus,
      paid_amount: paidAmt,
      client_privacy_accepted: Boolean(matchedClient?.privacy_accepted || args.privacy_accepted === true),
      wa_url: waDispatch?.wa_url || waDispatch?.fallback_url || null,
    };
  }

  if (name === 'update_appointment') {
    const found = await resolveAppointmentMatch(store, {
      appointmentId: args.appointment_id,
      bookingCode: args.booking_code,
      date: args.search_date,
      clientQuery: args.client_query,
    });
    if (found.error) return { ok: false, error: found.error };
    if (found.ambiguous) {
      return { ok: false, ambiguous_appointment: true, candidates: found.ambiguous };
    }
    const appt = found.appt;
    const nextDate = isValidIsoDate(args.new_date) ? args.new_date : appt.appointment_date;
    const nextTime = normalizeTimeHHMM(args.new_time) || String(appt.start_time || '').slice(0, 5);
    const nextStatus = ALLOWED_APPT_STATUSES.includes(args.status) ? args.status : appt.status;
    const op =
      args.operator_name || args.operator_id
        ? await resolveOperatorId(store, args.operator_id, args.operator_name)
        : null;
    const nextOperatorId = op ? Number(op.id) : appt.operator_id;

    let nextServicesJson = null;
    let nextSummary = appt.services_summary;
    let nextPrice = Number(appt.total_price || 0);
    let nextDuration = Number(appt.duration_minutes || 60);

    if ((Array.isArray(args.service_names) && args.service_names.length > 0) || args.services_summary) {
      const resolvedSrv = await resolveServicesForBooking(store, {
        serviceNames: args.service_names,
        servicesSummary: args.services_summary,
        totalPrice: args.total_price,
        durationMinutes: args.duration_minutes,
        todayIso,
      });
      nextServicesJson = JSON.stringify(resolvedSrv.services);
      nextSummary = resolvedSrv.servicesSummary;
      nextPrice = resolvedSrv.totalPrice;
      nextDuration = resolvedSrv.durationMinutes;
    } else {
      if (args.total_price !== undefined) nextPrice = roundMoney(args.total_price);
      if (args.duration_minutes !== undefined) {
        nextDuration = Math.max(10, Number.parseInt(args.duration_minutes, 10) || nextDuration);
      }
    }

    const nextNotes = args.notes !== undefined ? String(args.notes || '').trim() : appt.notes || '';
    await store.updateAppointment(appt.id, {
      date: nextDate,
      time: nextTime,
      duration: nextDuration,
      operatorId: nextOperatorId,
      servicesJson: nextServicesJson,
      servicesSummary: nextSummary,
      totalPrice: nextPrice,
      status: nextStatus,
      notes: nextNotes,
    });

    uiDirectives.focus_date = nextDate;
    markAction(`Aggiornato app. ${appt.client_name} (${formatShortItDate(nextDate)} ${nextTime})`, 'agenda', {
      focus_date: nextDate,
    });

    return {
      ok: true,
      appointment_id: Number(appt.id),
      booking_code: appt.booking_code,
      date: nextDate,
      time: nextTime,
      duration_minutes: nextDuration,
      status: nextStatus,
      services_summary: nextSummary,
      total_price: nextPrice,
    };
  }

  if (name === 'delete_appointment') {
    const id = Number.parseInt(args.appointment_id || '0', 10) || 0;
    const found = await resolveAppointmentMatch(store, {
      appointmentId: id,
      bookingCode: args.booking_code,
    });
    if (found.error) return { ok: false, error: found.error };
    if (found.ambiguous) return { ok: false, candidates: found.ambiguous };
    await store.deleteAppointment(found.appt.id);
    markAction(`Eliminato app. ${found.appt.booking_code} (${found.appt.client_name})`, 'agenda');
    return { ok: true, deleted_id: Number(found.appt.id), booking_code: found.appt.booking_code };
  }

  if (name === 'record_payment_or_refund') {
    const found = await resolveAppointmentMatch(store, {
      appointmentId: args.appointment_id,
      bookingCode: args.booking_code,
      date: args.date,
      clientQuery: args.client_query,
    });
    if (found.error) return { ok: false, error: found.error };
    if (found.ambiguous) return { ok: false, candidates: found.ambiguous };
    const appt = found.appt;

    if (args.direction === 'refund') {
      const currentPaid = roundMoney(appt.paid_amount);
      if (currentPaid <= 0) return { ok: false, error: 'Nessun importo incassato da rimborsare.' };
      const reqAmt = args.amount !== undefined ? roundMoney(args.amount) : currentPaid;
      const refundAmt = Math.min(currentPaid, Math.max(0.01, reqAmt));
      const notes = String(args.notes || '').trim() || 'Rimborso registrato via giul IA';
      let stripeRefund = null;
      let paypalRefund = null;
      if (args.call_online_provider !== false && appt.stripe_payment_intent) {
        const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
        const stripeCfg = resolveStripeConfig(rawSettings);
        if (stripeCfg.configured) {
          stripeRefund = await createStripeRefund({
            config: stripeCfg,
            paymentIntentId: appt.stripe_payment_intent,
            amountEur: refundAmt,
          });
        }
      } else if (args.call_online_provider !== false && appt.paypal_capture_id) {
        const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
        const paypalCfg = resolvePayPalConfig(rawSettings);
        if (paypalCfg.configured) {
          paypalRefund = await createPayPalRefund({
            config: paypalCfg,
            captureId: appt.paypal_capture_id,
            amountEur: refundAmt,
            note: notes,
          });
        }
      }
      const recorded = await store.recordAppointmentPayment({
        appointmentId: appt.id,
        paymentMethod: stripeRefund ? 'stripe_online' : paypalRefund ? 'paypal_online' : appt.payment_method,
        transactionAmount: refundAmt,
        direction: 'refund',
        stripePaymentIntent: appt.stripe_payment_intent || null,
        paypalOrderId: appt.paypal_order_id || null,
        paypalCaptureId: appt.paypal_capture_id || null,
        paymentNotes: notes,
        transactionNotes: stripeRefund
          ? `Rimborso Stripe (${stripeRefund.id})`
          : paypalRefund
          ? `Rimborso PayPal (${paypalRefund.id})`
          : notes,
        adminId: adminId || null,
        nowStr,
      });
      markAction(`Rimborso ${refundAmt.toFixed(2)} € per ${appt.client_name}`, 'agenda');
      return { ok: true, appointment: recorded.appointment, refunded_amount: refundAmt };
    }

    const total = roundMoney(appt.total_price);
    const method = normalizePaymentMethod(args.payment_method, appt.payment_method || 'contanti');
    const reqStatus = args.payment_status ? normalizePaymentStatus(args.payment_status) : null;
    let targetPaid = args.amount !== undefined ? roundMoney(args.amount) : null;
    if (targetPaid === null) {
      if (reqStatus === 'paid') targetPaid = total;
      else if (reqStatus === 'unpaid') targetPaid = 0;
      else targetPaid = total;
    }
    const finalStatus = reqStatus || derivePaymentStatus({ totalPrice: total, paidAmount: targetPaid });
    const statusOverride =
      args.confirm_appointment !== false && appt.status === 'pending' && finalStatus !== 'unpaid' ? 'confirmed' : null;
    const recorded = await store.recordAppointmentPayment({
      appointmentId: appt.id,
      paymentStatus: finalStatus,
      paymentMethod: method,
      paidAmount: targetPaid,
      direction: 'payment',
      paymentNotes: args.notes ? String(args.notes).trim() : null,
      transactionNotes: `Incasso registrato via giul IA (${PAYMENT_METHOD_LABELS[method] || method})`,
      statusOverride,
      adminId: adminId || null,
      nowStr,
    });
    markAction(
      `Incasso ${Number(recorded.appointment?.paid_amount || 0).toFixed(2)} € (${PAYMENT_METHOD_LABELS[method] || method})`,
      'agenda'
    );
    return {
      ok: true,
      appointment_id: Number(appt.id),
      payment_status: recorded.appointment?.payment_status,
      paid_amount: Number(recorded.appointment?.paid_amount || 0),
      payment_method: recorded.appointment?.payment_method,
    };
  }

  if (name === 'search_clients') {
    const cid = Number.parseInt(args.client_id || '0', 10) || 0;
    if (cid > 0) {
      const dossier = await store.getClientDossier(cid);
      if (!dossier) return { ok: false, error: 'Cliente non trovata.' };
      return {
        ok: true,
        client: dossier.client,
        cards: dossier.cards || [],
        recent_appointments: (dossier.appointments || []).slice(0, 10),
        morpho_count: (dossier.morpho_records || []).length,
      };
    }
    const matches = await store.listClients(String(args.query || '').trim());
    return {
      ok: true,
      count: matches.length,
      clients: matches.slice(0, 20).map((c) => ({
        id: Number(c.id),
        full_name: c.full_name,
        phone: c.phone,
        email: c.email,
        birth_date: c.birth_date,
        allergies_notes: c.allergies_notes,
        preferences_notes: c.preferences_notes,
        privacy_accepted: Boolean(c.privacy_accepted),
        appointments_count: Number(c.appointments_count || 0),
        total_spent: Number(c.total_spent || 0),
      })),
    };
  }

  if (name === 'save_client') {
    if (args.action === 'delete') {
      const cid = Number.parseInt(args.client_id || '0', 10) || 0;
      if (cid <= 0) return { ok: false, error: 'ID cliente mancante per eliminazione.' };
      await store.deleteClient(cid);
      markAction(`Cliente #${cid} eliminata`, 'clients');
      return { ok: true, deleted_client_id: cid };
    }
    const existing = args.client_id ? (await store.getClientDossier(args.client_id))?.client : null;
    const fullName = String(args.full_name || existing?.full_name || '').trim();
    const phone = String(args.phone || existing?.phone || '').trim();
    if (!fullName || !phone) {
      return { ok: false, error: 'Nome completo e telefono della cliente sono obbligatori.' };
    }
    const res = await store.saveClient({
      id: Number.parseInt(args.client_id || '0', 10) || 0,
      fullName,
      phoneRaw: phone,
      phoneNorm: normalizePhone(phone),
      email: args.email !== undefined ? String(args.email || '').trim() : existing?.email || '',
      birthDate: isValidIsoDate(args.birth_date) ? args.birth_date : existing?.birth_date || null,
      allergiesNotes:
        args.allergies_notes !== undefined ? String(args.allergies_notes || '').trim() : existing?.allergies_notes || '',
      preferencesNotes:
        args.preferences_notes !== undefined
          ? String(args.preferences_notes || '').trim()
          : existing?.preferences_notes || '',
      privacyAccepted: args.privacy_accepted === true ? 1 : existing?.privacy_accepted ? 1 : 0,
      marketingConsent: args.marketing_consent === true ? 1 : existing?.marketing_consent ? 1 : 0,
      privacyVersion,
      nowStr,
      ipHash: 'ai-agent',
    });
    markAction(`${res.status === 201 ? 'Nuova cliente' : 'Aggiornata cliente'}: ${fullName}`, 'clients');
    return { ok: true, client_id: res.id, full_name: fullName, phone, created: res.status === 201 };
  }

  if (name === 'manage_client_card') {
    if (args.action === 'delete') {
      const cardId = Number.parseInt(args.card_id || '0', 10) || 0;
      if (cardId <= 0) return { ok: false, error: 'card_id mancante.' };
      await store.deleteClientCard(cardId);
      markAction(`Rimossa carta cliente #${cardId}`, 'clients');
      return { ok: true, deleted_id: cardId };
    }
    if (args.action === 'use') {
      const cardId = Number.parseInt(args.card_id || '0', 10) || 0;
      if (cardId <= 0) return { ok: false, error: 'card_id mancante per scalare seduta.' };
      const card = await store.useClientCard(cardId, {
        sessionsDelta: Number.parseInt(args.sessions_delta ?? '1', 10) || 0,
        creditDelta: Number(args.credit_delta || 0) || 0,
      });
      markAction(`Aggiornata tessera ${card?.title || cardId}`, 'clients');
      return { ok: true, card };
    }
    const clientRes = await resolveClientMatch(store, {
      clientId: args.client_id,
      clientName: args.client_name,
    });
    if (clientRes.error || !clientRes.found) {
      return { ok: false, error: clientRes.error || 'Cliente non trovata per associare la tessera.' };
    }
    const title = String(args.title || '').trim();
    if (title.length < 2) return { ok: false, error: 'Titolo tessera o pacchetto mancante.' };
    const card = await store.createClientCard({
      clientId: Number(clientRes.found.id),
      title: title.slice(0, 140),
      cardType: String(args.card_type || 'package').trim(),
      totalSessions: Number.parseInt(args.total_sessions || '0', 10) || 0,
      remainingCredit: Number(args.remaining_credit || 0) || 0,
      expiresAt: isValidIsoDate(args.expires_at) ? args.expires_at : null,
      notes: String(args.notes || '').trim(),
    });
    markAction(`Creata tessera "${title}" per ${clientRes.found.full_name}`, 'clients');
    return { ok: true, card };
  }

  if (name === 'create_privacy_otp_link') {
    const clientRes = await resolveClientMatch(store, {
      clientId: args.client_id,
      clientName: args.client_name,
    });
    if (clientRes.error) return { ok: false, error: clientRes.error };
    if (clientRes.ambiguous) return { ok: false, candidates: clientRes.ambiguous };
    if (!clientRes.found) return { ok: false, error: 'Cliente non trovata.' };
    const client = clientRes.found;
    const created = await store.createPrivacySignatureRequest({
      clientId: Number(client.id),
      privacyVersion,
    });
    const signUrl = `${origin}/privacy-sign.html?token=${encodeURIComponent(created.token)}`;
    const dispatch = client.phone
      ? await dispatchWhatsAppMessage({
          store,
          toPhone: client.phone,
          recipientName: client.full_name,
          clientId: Number(client.id),
          templateCode: 'privacy_sign',
          vars: { nome: client.full_name, link: signUrl, otp: created.otp_code },
          adminId: adminId || null,
          triggerSource: 'ai_privacy',
        })
      : null;
    const waUrl = dispatch?.wa_url || dispatch?.fallback_url || null;
    markAction(`Link Privacy OTP generato per ${client.full_name}`, 'clients', { wa_url: waUrl });
    return {
      ok: true,
      client_name: client.full_name,
      otp_code: created.otp_code,
      sign_url: signUrl,
      wa_url: waUrl,
    };
  }

  if (name === 'manage_staff_and_absences') {
    if (args.action === 'list') {
      const [operators, absences] = await Promise.all([
        store.listOperators(false),
        store.listOperatorAbsences(0),
      ]);
      return {
        ok: true,
        operators: operators.map((o) => ({
          id: Number(o.id),
          name: o.name,
          role: o.role,
          active: Boolean(o.active),
          schedule: parseOperatorSchedule(o.weekly_schedule_json),
        })),
        absences,
      };
    }
    if (args.action === 'save_operator') {
      const opName = String(args.operator_name || '').trim();
      if (opName.length < 2) return { ok: false, error: 'Nome operatore mancante.' };
      const existing = args.operator_id
        ? (await store.listOperators(false)).find((o) => Number(o.id) === Number(args.operator_id))
        : null;
      const res = await store.saveOperator({
        id: Number(args.operator_id || 0) || 0,
        name: opName,
        role: String(args.role || existing?.role || 'Beauty Specialist').trim(),
        color: /^#[0-9a-f]{6}$/i.test(args.color || '') ? args.color : existing?.color || '#d47491',
        active: args.active !== undefined ? Boolean(args.active) : existing ? Boolean(existing.active) : true,
        weeklyScheduleJson: existing?.weekly_schedule_json || JSON.stringify(buildDefaultSchedule()),
      });
      markAction(`Operatore salvato: ${opName}`, 'settings');
      return { ok: true, id: res.id, name: opName };
    }
    if (args.action === 'add_absence') {
      const op = await resolveOperatorId(store, args.operator_id, args.operator_name);
      if (!op) return { ok: false, error: 'Operatore non trovato.' };
      const startDate = String(args.start_date || '').trim();
      const endDate = String(args.end_date || startDate).trim();
      if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || endDate < startDate) {
        return { ok: false, error: 'Intervallo date assenza non valido.' };
      }
      const id = await store.createOperatorAbsence({
        operatorId: Number(op.id),
        startDate,
        endDate,
        startTime: normalizeTimeHHMM(args.start_time) || null,
        endTime: normalizeTimeHHMM(args.end_time) || null,
        type: String(args.absence_type || 'ferie').trim(),
        notes: String(args.notes || '').trim(),
      });
      markAction(`Assenza ${op.name} (${startDate}..${endDate})`, 'settings');
      return { ok: true, id, operator_name: op.name, start_date: startDate, end_date: endDate };
    }
    if (args.action === 'delete_absence') {
      const aid = Number.parseInt(args.absence_id || '0', 10) || 0;
      if (aid <= 0) return { ok: false, error: 'absence_id mancante.' };
      await store.deleteOperatorAbsence(aid);
      markAction(`Rimossa assenza #${aid}`, 'settings');
      return { ok: true, deleted_id: aid };
    }
  }

  if (name === 'manage_inventory') {
    const [products, suppliers] = await Promise.all([store.listProducts(), store.listSuppliers()]);
    if (args.action === 'search') {
      const q = normText(args.query);
      const filtered = products.filter((p) => !q || normText(p.name).includes(q) || normText(p.category).includes(q));
      return { ok: true, products: filtered.slice(0, 30), suppliers };
    }
    if (args.action === 'save_supplier') {
      const supName = String(args.supplier_name || '').trim();
      if (supName.length < 2) return { ok: false, error: 'Nome fornitore mancante.' };
      const res = await store.saveSupplier({
        id: 0,
        name: supName,
        contactName: '',
        phone: String(args.supplier_phone || '').trim(),
        email: '',
        notes: String(args.notes || '').trim(),
      });
      markAction(`Fornitore salvato: ${supName}`, 'inventory');
      return { ok: true, id: res.id, name: supName };
    }
    if (args.action === 'save_product') {
      const pname = String(args.product_name || '').trim();
      if (pname.length < 2) return { ok: false, error: 'Nome prodotto mancante.' };
      const res = await store.saveProduct({
        id: Number(args.product_id || 0) || 0,
        sku: String(args.sku || '').trim(),
        name: pname,
        category: String(args.category || 'Rivendita').trim(),
        supplierId: null,
        costPrice: Number(args.cost_price || 0) || 0,
        sellPrice: Number(args.sell_price || 0) || 0,
        stockQty: Number.parseInt(args.stock_qty ?? '0', 10) || 0,
        minStockQty: Number.parseInt(args.min_stock_qty ?? '2', 10) || 2,
        unit: 'pz',
        active: true,
      });
      markAction(`Prodotto salvato: ${pname}`, 'inventory');
      return { ok: true, id: res.id, name: pname };
    }
    if (args.action === 'delete_product') {
      const pid = Number.parseInt(args.product_id || '0', 10) || 0;
      if (pid <= 0) return { ok: false, error: 'product_id mancante.' };
      await store.deleteProduct(pid);
      markAction(`Prodotto #${pid} eliminato`, 'inventory');
      return { ok: true, deleted_id: pid };
    }
    if (args.action === 'record_movement') {
      let prod = products.find((p) => Number(p.id) === Number(args.product_id));
      if (!prod && args.product_name) {
        const pq = normText(args.product_name);
        prod = products.find((p) => normText(p.name).includes(pq));
      }
      if (!prod) return { ok: false, error: 'Prodotto non trovato in magazzino.' };
      const mvType = ['sale', 'restock', 'cabin_use', 'adjustment'].includes(args.movement_type)
        ? args.movement_type
        : 'sale';
      const qty = Math.max(1, Number.parseInt(args.quantity || '1', 10) || 1);
      const res = await store.recordProductMovement({
        productId: Number(prod.id),
        movementType: mvType,
        quantity: qty,
        notes: String(args.notes || '').trim() || 'Registrato via giul IA',
      });
      markAction(`Movimento magazzino (${mvType} ${qty}pz): ${prod.name}`, 'inventory');
      return { ok: true, product_name: prod.name, movement_type: mvType, quantity: qty, result: res };
    }
  }

  if (name === 'manage_promotions_and_catalog') {
    if (args.action === 'list_promotions') {
      const promos = await store.listPromotions({ activeOnly: false });
      return { ok: true, promotions: promos };
    }
    if (args.action === 'toggle_promotion') {
      const pid = Number.parseInt(args.id || '0', 10) || 0;
      const existing = await store.getPromotionById(pid);
      if (!existing) return { ok: false, error: 'Promozione non trovata.' };
      const nextActive = args.active !== undefined ? Boolean(args.active) : Number(existing.active) !== 1;
      const promo = await store.updatePromotion(pid, { active: nextActive ? 1 : 0 });
      markAction(`${nextActive ? 'Attivata' : 'Disattivata'} promo: ${existing.title}`, 'promotions');
      return { ok: true, promotion: promo };
    }
    if (args.action === 'delete_promotion') {
      const pid = Number.parseInt(args.id || '0', 10) || 0;
      await store.deletePromotion(pid);
      markAction(`Promozione #${pid} eliminata`, 'promotions');
      return { ok: true, deleted_id: pid };
    }
    if (args.action === 'save_promotion') {
      const title = String(args.title || '').trim();
      if (title.length < 2) return { ok: false, error: 'Titolo promozione obbligatorio.' };
      const srvResolved = await resolveServicesForBooking(store, {
        serviceNames: args.service_names || [],
        todayIso,
      });
      const promoPrice = Math.max(0, Number(args.promo_price || 0) || 0);
      const origPrice =
        args.original_price !== undefined
          ? Math.max(0, Number(args.original_price))
          : srvResolved.services.reduce((s, x) => s + Number(x.price || 0), 0);
      const dur =
        args.duration_minutes !== undefined
          ? Math.max(10, Number.parseInt(args.duration_minutes, 10) || 60)
          : srvResolved.durationMinutes || 60;
      const payload = {
        title: title.slice(0, 135),
        badgeText: String(args.badge_text || 'Promo del Mese').trim().slice(0, 75),
        monthLabel: String(args.month_label || '').trim().slice(0, 75),
        description: String(args.description || '').trim().slice(0, 1000),
        services: srvResolved.services,
        originalPrice: Number(origPrice.toFixed(2)),
        promoPrice: Number(promoPrice.toFixed(2)),
        durationMinutes: dur,
        validFrom: isValidIsoDate(args.valid_from) ? args.valid_from : null,
        validUntil: isValidIsoDate(args.valid_until) ? args.valid_until : null,
        active: args.active !== undefined ? (args.active ? 1 : 0) : 1,
        featured: args.featured ? 1 : 0,
        showOnHero: 0,
        sortOrder: 0,
      };
      const pid = Number.parseInt(args.id || '0', 10) || 0;
      const promotion = pid > 0 ? await store.updatePromotion(pid, payload) : await store.createPromotion(payload);
      markAction(`Promozione salvata: ${title} (${promoPrice.toFixed(0)} €)`, 'promotions');
      return { ok: true, promotion };
    }
    if (args.action === 'list_catalog') {
      return { ok: true, ...(await store.listCatalogData()) };
    }
    if (args.action === 'save_category') {
      const title = String(args.category_title || args.title || '').trim();
      if (title.length < 2) return { ok: false, error: 'Titolo categoria mancante.' };
      const cat = await store.createCatalogCategory({
        title,
        motto: String(args.description || '').trim(),
        columnSide: 'right',
        sortOrder: 100,
        active: args.active !== undefined ? (args.active ? 1 : 0) : 1,
      });
      markAction(`Categoria listino creata: ${title}`, 'catalog');
      return { ok: true, category: cat };
    }
    if (args.action === 'save_service') {
      const list = await store.listCatalogData();
      let slug = String(args.category_slug || '').trim();
      if (!slug && args.category_title) {
        const cq = normText(args.category_title);
        const matchCat = (list.categories || []).find(
          (c) => normText(c.title).includes(cq) || normText(c.slug) === cq
        );
        if (matchCat) slug = matchCat.slug;
      }
      if (!slug) slug = list.categories?.[0]?.slug || 'nails';
      const sName = String(args.service_name || args.title || '').trim();
      if (!sName) return { ok: false, error: 'Nome trattamento mancante.' };
      const sid = Number.parseInt(args.id || '0', 10) || 0;
      const service =
        sid > 0
          ? await store.updateCatalogService(sid, {
              categorySlug: args.category_slug || undefined,
              subgroupLabel: args.subgroup_label || undefined,
              name: sName,
              price: args.price,
              durationMinutes: args.duration_minutes,
              description: args.description,
              active: args.active,
              showInStorefront: args.show_in_storefront,
            })
          : await store.createCatalogService({
              categorySlug: slug,
              subgroupLabel: String(args.subgroup_label || 'Servizi Studio').trim(),
              name: sName,
              price: Number(args.price || 0),
              durationMinutes: Number(args.duration_minutes || 30),
              description: String(args.description || '').trim(),
              sortOrder: 100,
              active: args.active !== undefined ? (args.active ? 1 : 0) : 1,
              showInStorefront: args.show_in_storefront !== undefined ? (args.show_in_storefront ? 1 : 0) : 1,
            });
      markAction(`Listino aggiornato: ${sName}`, 'catalog');
      return { ok: true, service };
    }
    if (args.action === 'toggle_service') {
      const sid = Number.parseInt(args.id || '0', 10) || 0;
      const list = await store.listCatalogData();
      const existing = (list.services || []).find((s) => Number(s.id) === sid);
      if (!existing) return { ok: false, error: 'Trattamento non trovato.' };
      const service = await store.updateCatalogService(sid, {
        active: args.active !== undefined ? Boolean(args.active) : Number(existing.active) !== 1,
      });
      markAction(`Stato trattamento aggiornato: ${existing.name}`, 'catalog');
      return { ok: true, service };
    }
    if (args.action === 'delete_service') {
      const sid = Number.parseInt(args.id || '0', 10) || 0;
      await store.deleteCatalogService(sid);
      markAction(`Trattamento #${sid} eliminato dal listino`, 'catalog');
      return { ok: true, deleted_id: sid };
    }
  }

  if (name === 'manage_gift_cards') {
    if (args.action === 'list') {
      const cards = await store.listGiftCards(String(args.code || args.recipient_name || '').trim());
      return { ok: true, count: cards.length, gift_cards: cards.slice(0, 25) };
    }
    if (args.action === 'create') {
      const rec = String(args.recipient_name || '').trim();
      if (rec.length < 2) return { ok: false, error: 'Nome destinatario obbligatorio.' };
      const mode = args.gift_mode === 'treatment' ? 'treatment' : 'amount';
      const amount = Math.max(0, Number(args.amount || 0) || 0);
      if (mode === 'amount' && amount <= 0) return { ok: false, error: 'Importo Gift Card positivo richiesto.' };
      const gc = await store.createGiftCard({
        code: String(args.code || '').trim().toUpperCase() || generateGiftCardCode(),
        theme: ['rose', 'bordeaux', 'pearl'].includes(args.theme) ? args.theme : 'rose',
        giftMode: mode,
        amount: Number(amount.toFixed(2)),
        hidePrice: false,
        serviceTitle: String(args.service_title || '').trim(),
        recipientName: rec,
        senderName: String(args.sender_name || '').trim(),
        recipientPhone: String(args.recipient_phone || '').trim(),
        clientId: null,
        message: String(args.message || '').trim(),
        expiresAt: defaultGiftCardExpiry(todayIso),
        notes: 'Creata via giul IA',
      });
      markAction(`Emessa Gift Card ${gc.code} per ${rec}`, 'giftcards');
      return { ok: true, gift_card: gc };
    }
    if (args.action === 'redeem' || args.action === 'cancel') {
      let gid = Number.parseInt(args.id || '0', 10) || 0;
      if (gid <= 0 && args.code) {
        const list = await store.listGiftCards(args.code);
        gid = Number(list.find((g) => String(g.code).toUpperCase() === String(args.code).toUpperCase())?.id || 0);
      }
      if (gid <= 0) return { ok: false, error: 'Gift Card non trovata.' };
      const gc = await store.redeemGiftCard(gid, {
        redeemAmount: Number(args.redeem_amount || 0) || 0,
        markFull: Boolean(args.mark_full),
        cancel: args.action === 'cancel',
      });
      markAction(`Gift Card ${gc?.code || gid} aggiornata`, 'giftcards');
      return { ok: true, gift_card: gc };
    }
    if (args.action === 'delete') {
      const gid = Number.parseInt(args.id || '0', 10) || 0;
      await store.deleteGiftCard(gid);
      markAction(`Gift Card #${gid} eliminata`, 'giftcards');
      return { ok: true, deleted_id: gid };
    }
  }

  if (name === 'prepare_whatsapp_message') {
    const clientRes = await resolveClientMatch(store, {
      clientId: args.client_id,
      clientName: args.client_name,
      clientPhone: args.recipient_phone,
    });
    const client = clientRes.found;
    const phone = String(args.recipient_phone || client?.phone || '').trim();
    const recName = String(args.client_name || client?.full_name || 'Cliente').trim();
    if (!phone) return { ok: false, error: 'Numero di telefono destinatario mancante.' };
    const dispatch = await dispatchWhatsAppMessage({
      store,
      toPhone: phone,
      recipientName: recName,
      clientId: client ? Number(client.id) : null,
      templateCode: args.template_code || null,
      vars: { nome: recName },
      customText: String(args.message_text || '').trim(),
      adminId: adminId || null,
      triggerSource: 'ai_assistant',
    });
    const waUrl = dispatch?.wa_url || dispatch?.fallback_url || buildWaMeUrl(phone, dispatch?.message_text || '');
    markAction(`Messaggio WhatsApp pronto per ${recName}`, 'messages', { mutating: true, wa_url: waUrl });
    return { ok: true, recipient_name: recName, wa_url: waUrl, message_text: dispatch?.message_text || '' };
  }

  if (name === 'navigate_admin_view') {
    if (args.view && ALLOWED_ADMIN_VIEWS.includes(args.view)) {
      uiDirectives.navigate_view = args.view;
    }
    if (args.focus_date && isValidIsoDate(args.focus_date)) {
      uiDirectives.focus_date = args.focus_date;
    }
    markAction(
      `Vista ${uiDirectives.navigate_view || 'agenda'}${uiDirectives.focus_date ? ` (${uiDirectives.focus_date})` : ''}`,
      uiDirectives.navigate_view || null,
      { mutating: false, focus_date: uiDirectives.focus_date || null }
    );
    return { ok: true, ...uiDirectives };
  }

  return { ok: false, error: `Strumento ${name} non riconosciuto.` };
}

async function runStudioAiAgent({
  store,
  adminId = null,
  origin = '',
  todayIso,
  question,
  history = [],
  activeView = 'agenda',
  privacyVersion = 'v2.0-2026-11',
  insightsContext,
}) {
  const { clients, appointments, extra } = insightsContext;
  const aiApiKey = String(process.env.AI_API_KEY || '').trim();

  // If OpenAI-compatible AI key is missing, fallback gracefully to existing analytics/Gemini Q&A
  if (!aiApiKey) {
    const res = await answerStudioQuestion(question, clients, appointments, todayIso, {
      ...extra,
      history,
      activeView,
    });
    return { ...res, actionsExecuted: [], uiDirectives: {} };
  }

  const baseUrl = String(process.env.AI_BASE_URL || 'https://openlimits.app/v1').trim().replace(/\/+$/, '');
  const model = String(process.env.AI_MODEL || 'anthropic/claude-haiku-4.5').trim();
  const fetchFn = globalThis.__GBS_AI_FETCH__ || fetch;

  const baseInsights = computeStudioInsights(clients, appointments, todayIso, 30, extra);
  const tomorrowIso = shiftIsoDate(todayIso, 1);
  const todayAgenda = summarizeAppointmentsForAi(appointments, extra.operators, todayIso);
  const tomorrowAgenda = summarizeAppointmentsForAi(appointments, extra.operators, tomorrowIso);

  const catalogData = await store.listCatalogData();
  const activeOps = (extra.operators || []).filter((o) => Number(o.active) === 1).map((o) => ({ id: o.id, name: o.name }));
  const catalogNames = (catalogData?.services || [])
    .filter((s) => Number(s.active) === 1)
    .map((s) => `${s.name} (${Number(s.price).toFixed(0)}€, ${s.duration_minutes}m)`);

  const systemPrompt = [
    "Sei giul IA, l'assistente AI operativa completa di Giulia Beauty Studio.",
    'Puoi SIA rispondere a qualsiasi analisi SIA eseguire direttamente tutte le operazioni del gestionale usando gli strumenti (tools) forniti: appuntamenti, disponibilità, pagamenti/rimborsi, clienti CRM, tessere/pacchetti, link privacy OTP, operatori/ferie, magazzino, promozioni, listino, gift card, WhatsApp e navigazione schermate.',
    '',
    `CONTESTO LIVE: Oggi è ${todayIso}, domani è ${tomorrowIso}. Scheda aperta: ${activeView}.`,
    `Operatori attivi: ${JSON.stringify(activeOps)}`,
    `Trattamenti a listino: ${catalogNames.slice(0, 60).join(' | ')}`,
    `Agenda oggi (${todayIso}): ${JSON.stringify(todayAgenda)}`,
    `Agenda domani (${tomorrowIso}): ${JSON.stringify(tomorrowAgenda)}`,
    `KPI riepilogo studio: ${JSON.stringify(baseInsights.summary)}`,
    `Clienti inattive 30+ gg (top 12): ${JSON.stringify((baseInsights.inactive_clients || []).slice(0, 12))}`,
    `Riordini magazzino: ${JSON.stringify((baseInsights.reorder_forecasts || []).filter((r) => r.needs_reorder))}`,
    `Promozioni attive: ${JSON.stringify(baseInsights.active_promotions || [])}`,
    '',
    'REGOLE OPERATIVE:',
    '1. Converti sempre date relative ("oggi", "domani", "venerdì prossimo") nel formato YYYY-MM-DD partendo da oggi.',
    '2. Per creare/modificare appuntamenti, usa i nomi reali di cliente, trattamento e operatore chiamando direttamente il tool appropriato. Se per una nuova cliente manca il telefono o ci sono più omonimi, riporta la richiesta in italiano chiaro senza inventare numeri.',
    '3. Non attivare MAI privacy_accepted = true se la titolare non ha detto esplicitamente che la cliente ha già firmato.',
    '4. Per eliminazioni permanenti (delete_*), procedi solo su richiesta chiara dell utente; altrimenti chiedi conferma breve.',
    '5. Rispondi sempre in italiano elegante, chiaro, sintetico e accurato dopo aver eseguito i tool necessari.',
  ].join('\n');

  const safeHistory = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 1200) }))
    .filter((m) => m.content)
    .slice(-8);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...safeHistory,
    { role: 'user', content: question },
  ];

  const actionsExecuted = [];
  const uiDirectives = {};

  try {
    let usedModel = model;
    let finalAnswer = '';

    for (let step = 0; step < 5; step++) {
      const apiRes = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${aiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          tools: AI_TOOL_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.25,
          max_tokens: 2600,
        }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      });

      if (!apiRes.ok) break;
      const data = await apiRes.json();
      if (data?.model) usedModel = data.model;
      const choiceMsg = data?.choices?.[0]?.message;
      if (!choiceMsg) break;

      const toolCalls = Array.isArray(choiceMsg.tool_calls) ? choiceMsg.tool_calls : [];
      if (toolCalls.length === 0) {
        finalAnswer = String(choiceMsg.content || '').trim();
        break;
      }

      messages.push({
        role: 'assistant',
        content: choiceMsg.content || null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const fnName = tc?.function?.name;
        let parsedArgs = {};
        try {
          parsedArgs = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

        let toolResult;
        try {
          toolResult = await executeAiTool(fnName, parsedArgs, {
            store,
            adminId,
            origin,
            todayIso,
            privacyVersion,
            actionsExecuted,
            uiDirectives,
          });
        } catch (toolErr) {
          toolResult = { ok: false, error: toolErr?.message || 'Errore esecuzione azione' };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id || `call_${step}`,
          content: JSON.stringify(toolResult),
        });
      }
    }

    if (finalAnswer) {
      let latestInsights = baseInsights;
      if (actionsExecuted.some((a) => a.mutating)) {
        const [uClients, uAppts, uOps, uProd, uMov, uCards, uPromos] = await Promise.all([
          store.listClients(''),
          store.listAppointments({ startDate: '', endDate: '', status: '', clientId: 0 }),
          store.listOperators(false),
          store.listProducts(),
          store.listProductMovements(500),
          store.listClientCards(0),
          store.listPromotions({ activeOnly: false }),
        ]);
        latestInsights = computeStudioInsights(uClients, uAppts, todayIso, 30, {
          operators: uOps,
          products: uProd,
          movements: uMov,
          cards: uCards,
          promotions: uPromos,
          privacyVersion,
        });
      }

      return {
        engine: `ai (${usedModel})`,
        answer: finalAnswer,
        actionsExecuted,
        uiDirectives,
        insights: latestInsights,
      };
    }
  } catch (err) {
    console.warn('[Studio AI Agent fallback]', err?.message || err);
  }

  const fallback = await answerStudioQuestion(question, clients, appointments, todayIso, {
    ...extra,
    history,
    activeView,
  });
  return { ...fallback, actionsExecuted, uiDirectives };
}

module.exports = {
  AI_TOOL_DEFINITIONS,
  executeAiTool,
  runStudioAiAgent,
};
