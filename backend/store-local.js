/**
 * GIULIA BEAUTY STUDIO — Persistent Local JSON Store (ONLY for local testing when MySQL is unavailable)
 * Active ONLY when DB_MODE=local in .env
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatRomeNow, getRomeNowParts, getRomeToday, timeToMinutes } = require('./helpers');
const {
  getAvailableOperatorsForSlot,
  buildDefaultSchedule,
  isLegacyDefaultSchedule,
  getMinimumAllowedStartMinutes,
  DEFAULT_SAME_DAY_LEAD_MINUTES,
} = require('./availability');
const {
  getDefaultOperatorPayload,
  DEFAULT_MESSAGE_TEMPLATES,
  DEFAULT_MONTHLY_PROMOTIONS,
} = require('./defaults');
const {
  slugifyCatalogKey,
  buildDefaultCatalogSeed,
  normalizeCategoryRow,
  normalizeServiceRow,
  sortByOrderThenId,
  buildStructuredCatalog,
} = require('./catalog-utils');

const DB_FILE = path.resolve(process.cwd(), process.env.LOCAL_DB_FILE || '.local-dev-db.json');

function defaultState() {
  return {
    counters: {
      admin: 0,
      client: 0,
      appointment: 0,
      privacy_log: 0,
      operator: 0,
      absence: 0,
      card: 0,
      morpho: 0,
      priv_sign: 0,
      supplier: 0,
      product: 0,
      movement: 0,
      template: 0,
      msg_log: 0,
      gift_card: 0,
      automation_run: 0,
      promotion: 0,
      payment_tx: 0,
      cat_category: 0,
      cat_service: 0,
    },
    admin_users: [],
    admin_sessions: [],
    operators: [],
    operator_absences: [],
    clients: [],
    appointments: [],
    privacy_logs: [],
    privacy_signature_requests: [],
    client_cards: [],
    client_morpho_records: [],
    suppliers: [],
    products: [],
    product_movements: [],
    message_templates: [],
    message_logs: [],
    gift_cards: [],
    studio_settings: [],
    automation_runs: [],
    monthly_promotions: [],
    payment_transactions: [],
    catalog_categories: [],
    catalog_services: [],
  };
}

function nextId(state, key) {
  state.counters[key] = (state.counters[key] || 0) + 1;
  return state.counters[key];
}

function ensureLocalCollections(state) {
  let dirty = false;
  const base = defaultState();
  state.counters = state.counters || {};
  for (const k of Object.keys(base.counters)) {
    if (typeof state.counters[k] !== 'number') {
      state.counters[k] = 0;
      dirty = true;
    }
  }
  for (const key of Object.keys(base)) {
    if (key !== 'counters' && !Array.isArray(state[key])) {
      state[key] = [];
      dirty = true;
    }
  }
  if (state.operators.length === 0) {
    const now = formatRomeNow();
    const defOp = getDefaultOperatorPayload();
    state.operators.push({
      id: nextId(state, 'operator'),
      ...defOp,
      created_at: now,
      updated_at: now,
    });
    dirty = true;
  } else {
    const updatedDefaultJson = JSON.stringify(buildDefaultSchedule());
    for (const op of state.operators) {
      if (isLegacyDefaultSchedule(op.weekly_schedule_json)) {
        op.weekly_schedule_json = updatedDefaultJson;
        op.updated_at = formatRomeNow();
        dirty = true;
      }
    }
  }
  const existingCodes = new Set((state.message_templates || []).map((t) => t.code));
  for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
    if (!existingCodes.has(tpl.code)) {
      state.message_templates.push({
        id: nextId(state, 'template'),
        ...tpl,
        updated_at: formatRomeNow(),
      });
      dirty = true;
    }
  }
  const hasPromoSeedFlag = (state.studio_settings || []).some((s) => s.setting_key === 'promotions_seeded');
  if (!hasPromoSeedFlag) {
    if ((state.monthly_promotions || []).length === 0) {
      const now = formatRomeNow();
      for (const promo of DEFAULT_MONTHLY_PROMOTIONS) {
        state.monthly_promotions.push({
          id: nextId(state, 'promotion'),
          title: promo.title,
          badge_text: promo.badge_text || null,
          month_label: promo.month_label || null,
          description: promo.description || null,
          services_json: JSON.stringify(promo.services || []),
          original_price: Number(promo.original_price || 0),
          promo_price: Number(promo.promo_price || 0),
          duration_minutes: Number(promo.duration_minutes || 60),
          valid_from: promo.valid_from || null,
          valid_until: promo.valid_until || null,
          active: promo.active ? 1 : 0,
          featured: promo.featured ? 1 : 0,
          show_on_hero: promo.show_on_hero ? 1 : 0,
          sort_order: Number(promo.sort_order || 0),
          created_at: now,
          updated_at: now,
        });
      }
    }
    state.studio_settings.push({
      setting_key: 'promotions_seeded',
      setting_value: '1',
      updated_at: formatRomeNow(),
    });
    dirty = true;
  }
  const hasCatSeedFlag = (state.studio_settings || []).some((s) => s.setting_key === 'catalog_seeded');
  if (!hasCatSeedFlag) {
    if ((state.catalog_categories || []).length === 0 && (state.catalog_services || []).length === 0) {
      const now = formatRomeNow();
      const seed = buildDefaultCatalogSeed();
      seed.categories.forEach((cat) => {
        state.catalog_categories.push({
          id: nextId(state, 'cat_category'),
          ...cat,
          created_at: now,
          updated_at: now,
        });
      });
      seed.services.forEach((srv) => {
        state.catalog_services.push({
          id: nextId(state, 'cat_service'),
          ...srv,
          created_at: now,
          updated_at: now,
        });
      });
    }
    state.studio_settings.push({
      setting_key: 'catalog_seeded',
      setting_value: '1',
      updated_at: formatRomeNow(),
    });
    dirty = true;
  }
  return dirty;
}

function writeDb(state) {
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = defaultState();
    ensureLocalCollections(initial);
    writeDb(initial);
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (ensureLocalCollections(parsed)) {
    writeDb(parsed);
  }
  return parsed;
}

function nextBookingCode(state) {
  for (let i = 0; i < 10; i += 1) {
    const code = `GBS-${crypto.randomInt(100000, 1000000)}`;
    if (!state.appointments.some((a) => a.booking_code === code)) return code;
  }
  return `GBS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/* ============================================================================
   HEALTH, AUTH & USERS
   ============================================================================ */
async function healthCheck() {
  const db = readDb();
  return {
    ok: true,
    status: 200,
    mode: 'local',
    db_connected: true,
    admins_count: db.admin_users.length,
    operators_count: db.operators.length,
    clients_count: db.clients.length,
    appointments_count: db.appointments.length,
    products_count: db.products.length,
  };
}

async function initSchemaAndCountAdmins() {
  const db = readDb();
  return { configured: true, adminCount: db.admin_users.length };
}

async function createInitialAdmin({ username, displayName, passwordHash, role = 'owner' }) {
  const db = readDb();
  const id = nextId(db, 'admin');
  const now = formatRomeNow();
  db.admin_users.push({
    id,
    username,
    display_name: displayName || 'Giulia',
    role,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
  });
  writeDb(db);
  return id;
}

async function findAdminByUsername(username) {
  const db = readDb();
  return db.admin_users.find((u) => u.username === username) || null;
}

async function listAdminUsers() {
  const db = readDb();
  return db.admin_users.map((u) => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role || 'owner',
    created_at: u.created_at,
  }));
}

async function deleteAdminUser(id) {
  const db = readDb();
  if (db.admin_users.length <= 1) {
    const err = new Error('Impossibile eliminare l\'unico account amministratore.');
    err.status = 400;
    throw err;
  }
  db.admin_users = db.admin_users.filter((u) => Number(u.id) !== Number(id));
  db.admin_sessions = db.admin_sessions.filter((s) => Number(s.admin_id) !== Number(id));
  writeDb(db);
}

async function createSession({ adminId, tokenHash, expiresAt }) {
  const db = readDb();
  const nowSql = formatRomeNow();
  db.admin_sessions = db.admin_sessions.filter((s) => s.expires_at > nowSql);
  db.admin_sessions.push({ token_hash: tokenHash, admin_id: adminId, expires_at: expiresAt, created_at: nowSql });
  writeDb(db);
}

async function findSessionAdmin(tokenHash, nowSql) {
  const db = readDb();
  const sess = db.admin_sessions.find((s) => s.token_hash === tokenHash && s.expires_at > nowSql);
  if (!sess) return null;
  const user = db.admin_users.find((u) => Number(u.id) === Number(sess.admin_id));
  if (!user) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, role: user.role || 'owner' };
}

async function deleteSession(tokenHash) {
  const db = readDb();
  db.admin_sessions = db.admin_sessions.filter((s) => s.token_hash !== tokenHash);
  writeDb(db);
}

async function getAdminPasswordHash(adminId) {
  const db = readDb();
  const user = db.admin_users.find((u) => Number(u.id) === Number(adminId));
  return user ? user.password_hash : null;
}

async function updateAdminPassword(adminId, newHash) {
  const db = readDb();
  const user = db.admin_users.find((u) => Number(u.id) === Number(adminId));
  if (user) {
    user.password_hash = newHash;
    user.updated_at = formatRomeNow();
    writeDb(db);
  }
}

async function ensureReady() {
  readDb();
}

/* ============================================================================
   OPERATORS & ABSENCES
   ============================================================================ */
async function listOperators(onlyActive = false) {
  const db = readDb();
  return db.operators
    .filter((o) => !onlyActive || Number(o.active) !== 0)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

async function saveOperator({ id, name, role, color, active, weeklyScheduleJson }) {
  const db = readDb();
  const now = formatRomeNow();
  if (id > 0) {
    const op = db.operators.find((o) => Number(o.id) === Number(id));
    if (!op) {
      const err = new Error('Operatore non trovato.');
      err.status = 404;
      throw err;
    }
    op.name = name;
    op.role = role;
    op.color = color;
    op.active = active ? 1 : 0;
    op.weekly_schedule_json = weeklyScheduleJson;
    op.updated_at = now;
    writeDb(db);
    return { id: op.id, status: 200 };
  }
  const newId = nextId(db, 'operator');
  db.operators.push({
    id: newId,
    name,
    role,
    color,
    active: active ? 1 : 0,
    weekly_schedule_json: weeklyScheduleJson,
    created_at: now,
    updated_at: now,
  });
  writeDb(db);
  return { id: newId, status: 201 };
}

async function deleteOperator(id) {
  const db = readDb();
  if (db.operators.length <= 1) {
    const err = new Error('Deve rimanere almeno un operatore attivo in studio.');
    err.status = 400;
    throw err;
  }
  db.operators = db.operators.filter((o) => Number(o.id) !== Number(id));
  db.operator_absences = db.operator_absences.filter((a) => Number(a.operator_id) !== Number(id));
  db.appointments.forEach((a) => {
    if (Number(a.operator_id) === Number(id)) a.operator_id = null;
  });
  writeDb(db);
}

async function listOperatorAbsences(operatorId = 0) {
  const db = readDb();
  const opMap = new Map(db.operators.map((o) => [Number(o.id), o]));
  return db.operator_absences
    .filter((a) => operatorId <= 0 || Number(a.operator_id) === Number(operatorId))
    .sort((a, b) => (a.start_date > b.start_date ? -1 : 1))
    .map((a) => ({
      ...a,
      operator_name: opMap.get(Number(a.operator_id))?.name || 'Operatore',
    }));
}

async function createOperatorAbsence({ operatorId, startDate, endDate, startTime, endTime, type, notes }) {
  const db = readDb();
  const id = nextId(db, 'absence');
  db.operator_absences.push({
    id,
    operator_id: Number(operatorId),
    start_date: startDate,
    end_date: endDate,
    start_time: startTime || null,
    end_time: endTime || null,
    type: type || 'ferie',
    notes: notes || null,
    created_at: formatRomeNow(),
  });
  writeDb(db);
  return id;
}

async function deleteOperatorAbsence(id) {
  const db = readDb();
  db.operator_absences = db.operator_absences.filter((a) => Number(a.id) !== Number(id));
  writeDb(db);
}

/* ============================================================================
   PUBLIC SLOTS & BOOKING (OPERATOR-AWARE)
   ============================================================================ */
async function getPublicAvailabilityRange(startDate, endDate) {
  const db = readDb();
  const bookedRowsByDate = new Map();
  for (const a of db.appointments) {
    if (
      a.appointment_date >= startDate &&
      a.appointment_date <= endDate &&
      a.mode === 'booking' &&
      (a.status === 'pending' || a.status === 'confirmed')
    ) {
      if (!bookedRowsByDate.has(a.appointment_date)) bookedRowsByDate.set(a.appointment_date, []);
      bookedRowsByDate.get(a.appointment_date).push({
        operator_id: a.operator_id || null,
        start_time: String(a.start_time).slice(0, 5),
        duration_minutes: a.duration_minutes,
      });
    }
  }

  const absences = db.operator_absences.filter(
    (abs) => abs.start_date <= endDate && abs.end_date >= startDate
  );

  return {
    operators: db.operators.filter((o) => Number(o.active) !== 0),
    absences,
    bookedRowsByDate,
  };
}

async function getPublicAvailabilityContext(dateStr) {
  const range = await getPublicAvailabilityRange(dateStr, dateStr);
  return {
    operators: range.operators,
    absences: range.absences,
    bookedRows: range.bookedRowsByDate.get(dateStr) || [],
  };
}

async function createPublicBooking({
  mode,
  appointmentDate,
  startTime,
  durationMinutes,
  operatorId = 0,
  servicesJson,
  servicesSummary,
  totalPrice,
  paymentMethod,
  paymentStatus = 'unpaid',
  paidAmount = 0,
  notes,
  clientName,
  clientPhoneRaw,
  phoneNormalized,
  clientEmail,
  marketingConsent,
  privacyVersion,
  nowStr,
  ipHash,
  userAgent,
}) {
  if (mode === 'booking') {
    const minAllowedStart = getMinimumAllowedStartMinutes(appointmentDate);
    if (timeToMinutes(startTime) < minAllowedStart) {
      const err = new Error(
        appointmentDate < getRomeToday()
          ? 'Non è possibile prenotare in una data passata. Scegli un altro giorno.'
          : `Per le prenotazioni in giornata è richiesto almeno ${DEFAULT_SAME_DAY_LEAD_MINUTES} minuti di preavviso.`
      );
      err.status = 422;
      err.code = 'SLOT_TOO_SOON';
      throw err;
    }
  }

  const db = readDb();
  const activeOps = db.operators.filter((o) => Number(o.active) !== 0);
  let resolvedOperatorId = activeOps[0]?.id || null;

  if (mode === 'booking') {
    const existing = db.appointments
      .filter(
        (a) =>
          a.appointment_date === appointmentDate &&
          a.mode === 'booking' &&
          (a.status === 'pending' || a.status === 'confirmed')
      )
      .map((a) => ({
        operator_id: a.operator_id || null,
        start_time: String(a.start_time).slice(0, 5),
        duration_minutes: a.duration_minutes,
      }));
    const absences = db.operator_absences.filter(
      (abs) => appointmentDate >= abs.start_date && appointmentDate <= abs.end_date
    );
    const availableOps = getAvailableOperatorsForSlot({
      dateStr: appointmentDate,
      slotTime: startTime,
      durationMinutes,
      operators: activeOps,
      absences,
      bookedRows: existing,
      requestedOperatorId: Number(operatorId || 0),
    });
    if (availableOps.length === 0) {
      const err = new Error(
        'Spiacenti, la fascia oraria selezionata non è più disponibile. Scegli un altro orario.'
      );
      err.status = 409;
      err.code = 'SLOT_OCCUPIED';
      throw err;
    }
    resolvedOperatorId = Number(availableOps[0].id);
  } else if (Number(operatorId) > 0) {
    resolvedOperatorId = Number(operatorId);
  }

  let client = db.clients.find((c) => c.phone_normalized === phoneNormalized);
  if (client) {
    client.full_name = clientName;
    client.phone = clientPhoneRaw;
    client.email = clientEmail || client.email || null;
    client.privacy_accepted = 1;
    client.privacy_accepted_at = nowStr;
    client.privacy_version = privacyVersion;
    client.marketing_consent = Math.max(Number(client.marketing_consent || 0), marketingConsent ? 1 : 0);
    client.updated_at = nowStr;
  } else {
    const newClientId = nextId(db, 'client');
    client = {
      id: newClientId,
      full_name: clientName,
      phone: clientPhoneRaw,
      phone_normalized: phoneNormalized,
      email: clientEmail || null,
      birth_date: null,
      allergies_notes: null,
      preferences_notes: null,
      privacy_accepted: 1,
      privacy_accepted_at: nowStr,
      privacy_version: privacyVersion,
      marketing_consent: marketingConsent ? 1 : 0,
      created_at: nowStr,
      updated_at: nowStr,
    };
    db.clients.push(client);
  }

  const appointmentId = nextId(db, 'appointment');
  const bookingCode = nextBookingCode(db);
  db.appointments.push({
    id: appointmentId,
    booking_code: bookingCode,
    client_id: client.id,
    operator_id: resolvedOperatorId,
    appointment_date: appointmentDate,
    start_time: `${startTime}:00`,
    duration_minutes: durationMinutes,
    services_json: servicesJson,
    services_summary: servicesSummary,
    total_price: Number(totalPrice).toFixed(2),
    mode,
    payment_method: paymentMethod,
    payment_status: paymentStatus || 'unpaid',
    paid_amount: Number(paidAmount || 0).toFixed(2),
    payment_notes: null,
    paid_at: null,
    stripe_session_id: null,
    stripe_payment_intent: null,
    paypal_order_id: null,
    paypal_capture_id: null,
    status: 'pending',
    notes: notes || null,
    reminder_sent_at: null,
    privacy_accepted: 1,
    privacy_accepted_at: nowStr,
    created_at: nowStr,
    updated_at: nowStr,
  });

  db.privacy_logs.push({
    id: nextId(db, 'privacy_log'),
    client_id: client.id,
    appointment_id: appointmentId,
    consent_type: 'privacy_terms',
    consent_version: privacyVersion,
    accepted_at: nowStr,
    ip_hash: ipHash,
    user_agent: userAgent,
  });

  writeDb(db);
  return { bookingCode, appointmentId, clientId: client.id, operatorId: resolvedOperatorId };
}

/* ============================================================================
   ADMIN APPOINTMENTS
   ============================================================================ */
async function listAppointments({ startDate, endDate, status, clientId, operatorId = 0 }) {
  const db = readDb();
  const clientMap = new Map(db.clients.map((c) => [Number(c.id), c]));
  const opMap = new Map(db.operators.map((o) => [Number(o.id), o]));
  const primaryOp = db.operators[0] || { id: null, name: 'Giulia', color: '#d47491' };

  return db.appointments
    .filter((a) => {
      if (startDate && a.appointment_date < startDate) return false;
      if (endDate && a.appointment_date > endDate) return false;
      if (status && a.status !== status) return false;
      if (clientId > 0 && Number(a.client_id) !== Number(clientId)) return false;
      if (operatorId > 0 && Number(a.operator_id || primaryOp.id) !== Number(operatorId)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.appointment_date !== b.appointment_date) {
        return a.appointment_date < b.appointment_date ? -1 : 1;
      }
      return String(a.start_time) < String(b.start_time) ? -1 : 1;
    })
    .map((a) => {
      const c = clientMap.get(Number(a.client_id)) || {};
      const op = opMap.get(Number(a.operator_id)) || primaryOp;
      return {
        ...a,
        operator_id: a.operator_id || op.id || null,
        operator_name: op.name || 'Giulia',
        operator_color: op.color || '#d47491',
        start_time: String(a.start_time).slice(0, 5),
        payment_status: a.payment_status || 'unpaid',
        paid_amount:
          a.paid_amount !== undefined && a.paid_amount !== null ? Number(a.paid_amount).toFixed(2) : '0.00',
        payment_notes: a.payment_notes || null,
        paid_at: a.paid_at || null,
        stripe_session_id: a.stripe_session_id || null,
        stripe_payment_intent: a.stripe_payment_intent || null,
        paypal_order_id: a.paypal_order_id || null,
        paypal_capture_id: a.paypal_capture_id || null,
        client_name: c.full_name || '',
        client_phone: c.phone || '',
        client_email: c.email || null,
        client_birth_date: c.birth_date || null,
        allergies_notes: c.allergies_notes || null,
        preferences_notes: c.preferences_notes || null,
        privacy_version: c.privacy_version || 'v2.0-2026-11',
      };
    });
}

async function deleteAppointment(id) {
  const db = readDb();
  db.appointments = db.appointments.filter((a) => Number(a.id) !== Number(id));
  writeDb(db);
}

async function markAppointmentReminder(id, sentAt) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (appt) {
    appt.reminder_sent_at = sentAt;
    appt.updated_at = formatRomeNow();
    writeDb(db);
  }
}

async function updateAppointment(
  id,
  {
    date,
    time,
    duration,
    operatorId,
    servicesJson,
    servicesSummary,
    totalPrice,
    status,
    notes,
    paymentMethod,
    paymentStatus,
    paidAmount,
    paymentNotes,
    paidAt,
  }
) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (!appt) return;
  appt.appointment_date = date;
  appt.start_time = `${time}:00`;
  appt.duration_minutes = duration;
  if (operatorId !== undefined) appt.operator_id = operatorId || null;
  if (servicesJson !== null && servicesJson !== undefined) appt.services_json = servicesJson;
  appt.services_summary = servicesSummary;
  appt.total_price = Number(totalPrice).toFixed(2);
  appt.status = status;
  appt.notes = notes || null;
  if (paymentMethod !== undefined) appt.payment_method = paymentMethod;
  if (paymentStatus !== undefined) appt.payment_status = paymentStatus;
  if (paidAmount !== undefined) appt.paid_amount = Number(paidAmount || 0).toFixed(2);
  if (paymentNotes !== undefined) appt.payment_notes = paymentNotes || null;
  if (paidAt !== undefined) appt.paid_at = paidAt || null;
  appt.updated_at = formatRomeNow();
  writeDb(db);
}

async function rescheduleAppointment(id, { date, time, duration, operatorId, status }) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (!appt) return false;
  appt.appointment_date = date;
  appt.start_time = `${time}:00`;
  appt.duration_minutes = duration;
  if (operatorId !== undefined) appt.operator_id = operatorId || null;
  if (status !== undefined) appt.status = status;
  appt.updated_at = formatRomeNow();
  writeDb(db);
  return true;
}

async function createAdminAppointment({
  clientId,
  clientName,
  clientPhone,
  phoneNorm,
  clientEmail,
  clientBirthDate,
  clientNotes,
  privacyAccepted,
  privacyVersion,
  nowStr,
  date,
  time,
  duration,
  operatorId = null,
  servicesJson,
  servicesSummary,
  totalPrice,
  mode,
  paymentMethod,
  paymentStatus = 'unpaid',
  paidAmount = 0,
  paymentNotes = null,
  paidAt = null,
  adminId = null,
  status,
  notes,
  ipHash,
}) {
  const db = readDb();
  let resolvedClientId = clientId;

  if (resolvedClientId <= 0) {
    const existing = db.clients.find((c) => c.phone_normalized === phoneNorm);
    if (existing) {
      resolvedClientId = existing.id;
    } else {
      resolvedClientId = nextId(db, 'client');
      db.clients.push({
        id: resolvedClientId,
        full_name: clientName,
        phone: clientPhone,
        phone_normalized: phoneNorm,
        email: clientEmail || null,
        birth_date: clientBirthDate || null,
        allergies_notes: null,
        preferences_notes: clientNotes || null,
        privacy_accepted: privacyAccepted ? 1 : 0,
        privacy_accepted_at: privacyAccepted ? nowStr : null,
        privacy_version: privacyVersion,
        marketing_consent: 0,
        created_at: nowStr,
        updated_at: nowStr,
      });
    }
  }

  const resolvedOpId = operatorId || db.operators[0]?.id || null;
  const newApptId = nextId(db, 'appointment');
  const bookingCode = nextBookingCode(db);
  const paidNum = Math.max(0, Number(paidAmount || 0));
  const effectivePaidAt = paidNum > 0 ? paidAt || nowStr : null;
  db.appointments.push({
    id: newApptId,
    booking_code: bookingCode,
    client_id: resolvedClientId,
    operator_id: resolvedOpId,
    appointment_date: date,
    start_time: `${time}:00`,
    duration_minutes: duration,
    services_json: servicesJson,
    services_summary: servicesSummary,
    total_price: Number(totalPrice).toFixed(2),
    mode,
    payment_method: paymentMethod,
    payment_status: paymentStatus || 'unpaid',
    paid_amount: paidNum.toFixed(2),
    payment_notes: paymentNotes || null,
    paid_at: effectivePaidAt,
    stripe_session_id: null,
    stripe_payment_intent: null,
    paypal_order_id: null,
    paypal_capture_id: null,
    status,
    notes: notes || null,
    reminder_sent_at: null,
    privacy_accepted: privacyAccepted ? 1 : 0,
    privacy_accepted_at: nowStr,
    created_at: nowStr,
    updated_at: nowStr,
  });

  if (paidNum > 0) {
    db.payment_transactions.push({
      id: nextId(db, 'payment_tx'),
      appointment_id: newApptId,
      client_id: resolvedClientId,
      booking_code: bookingCode,
      direction: 'payment',
      payment_method: paymentMethod || 'contanti',
      amount: paidNum.toFixed(2),
      currency: 'EUR',
      status: 'succeeded',
      stripe_session_id: null,
      stripe_payment_intent: null,
      paypal_order_id: null,
      paypal_capture_id: null,
      notes: paymentNotes || 'Incasso registrato alla creazione appuntamento',
      created_by_admin_id: adminId || null,
      created_at: effectivePaidAt,
    });
  }

  if (privacyAccepted) {
    db.privacy_logs.push({
      id: nextId(db, 'privacy_log'),
      client_id: resolvedClientId,
      appointment_id: newApptId,
      consent_type: 'studio_manual_consent',
      consent_version: privacyVersion,
      accepted_at: nowStr,
      ip_hash: ipHash,
      user_agent: 'Admin Dashboard',
    });
  }

  writeDb(db);
  return { id: newApptId, bookingCode, clientId: resolvedClientId };
}

/* ============================================================================
   CLIENTS, CARDS, MORPHO & PRIVACY SIGNATURE OTP
   ============================================================================ */
async function getClientDossier(id) {
  const db = readDb();
  const client = db.clients.find((c) => Number(c.id) === Number(id));
  if (!client) return null;

  const opMap = new Map(db.operators.map((o) => [Number(o.id), o]));
  const appointments = db.appointments
    .filter((a) => Number(a.client_id) === Number(id))
    .sort((a, b) =>
      a.appointment_date > b.appointment_date
        ? -1
        : a.appointment_date < b.appointment_date
          ? 1
          : String(b.start_time).localeCompare(String(a.start_time))
    )
    .map((a) => ({
      ...a,
      operator_name: opMap.get(Number(a.operator_id))?.name || 'Giulia',
      start_time: String(a.start_time).slice(0, 5),
    }));

  const privacyLogs = db.privacy_logs
    .filter((l) => Number(l.client_id) === Number(id))
    .sort((a, b) => (a.accepted_at > b.accepted_at ? -1 : 1));

  const cards = db.client_cards
    .filter((c) => Number(c.client_id) === Number(id))
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

  const morphoRecords = db.client_morpho_records
    .filter((m) => Number(m.client_id) === Number(id))
    .sort((a, b) => (a.recorded_at > b.recorded_at ? -1 : a.id > b.id ? -1 : 1));

  const signatureRequests = db.privacy_signature_requests
    .filter((r) => Number(r.client_id) === Number(id))
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    .map((r) => ({
      id: r.id,
      token: r.token,
      privacy_version: r.privacy_version,
      status: r.status,
      signed_at: r.signed_at,
      signature_name: r.signature_name,
      otp_expires_at: r.otp_expires_at,
      created_at: r.created_at,
    }));

  return {
    client,
    appointments,
    privacy_logs: privacyLogs,
    cards,
    morpho_records: morphoRecords,
    signature_requests: signatureRequests,
  };
}

async function listClients(q) {
  const db = readDb();
  const needle = String(q || '').toLowerCase();

  return db.clients
    .filter((c) => {
      if (!needle) return true;
      return [c.full_name, c.phone, c.email, c.allergies_notes, c.preferences_notes].some((field) =>
        String(field || '').toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
    .map((c) => {
      const activeAppts = db.appointments.filter(
        (a) => Number(a.client_id) === Number(c.id) && a.status !== 'cancelled'
      );
      const totalSpentAppts = activeAppts.reduce((sum, a) => sum + Number(a.total_price || 0), 0);
      const totalSpentProducts = db.product_movements
        .filter((m) => Number(m.client_id) === Number(c.id) && m.movement_type === 'sale')
        .reduce((sum, m) => sum + Number(m.total_amount || 0), 0);
      const lastVisit = activeAppts.reduce(
        (maxD, a) => (!maxD || a.appointment_date > maxD ? a.appointment_date : maxD),
        null
      );
      const activeCards = db.client_cards.filter(
        (card) => Number(card.client_id) === Number(c.id) && card.status === 'active'
      ).length;
      const morphoCount = db.client_morpho_records.filter((m) => Number(m.client_id) === Number(c.id)).length;
      return {
        ...c,
        appointments_count: activeAppts.length,
        total_spent: (totalSpentAppts + totalSpentProducts).toFixed(2),
        last_visit: lastVisit,
        active_cards_count: activeCards,
        morpho_count: morphoCount,
      };
    });
}

async function deleteClient(id) {
  const db = readDb();
  const cid = Number(id);
  db.clients = db.clients.filter((c) => Number(c.id) !== cid);
  db.appointments = db.appointments.filter((a) => Number(a.client_id) !== cid);
  db.privacy_logs = db.privacy_logs.filter((l) => Number(l.client_id) !== cid);
  db.client_cards = db.client_cards.filter((c) => Number(c.client_id) !== cid);
  db.client_morpho_records = db.client_morpho_records.filter((m) => Number(m.client_id) !== cid);
  db.privacy_signature_requests = db.privacy_signature_requests.filter((r) => Number(r.client_id) !== cid);
  writeDb(db);
}

async function saveClient({
  id,
  fullName,
  phoneRaw,
  phoneNorm,
  email,
  birthDate,
  allergiesNotes,
  preferencesNotes,
  privacyAccepted,
  marketingConsent,
  privacyVersion,
  nowStr,
  ipHash,
}) {
  const db = readDb();

  if (id > 0) {
    const cur = db.clients.find((c) => Number(c.id) === Number(id));
    if (!cur) {
      const err = new Error('Cliente non trovata.');
      err.status = 404;
      throw err;
    }
    const dup = db.clients.find((c) => c.phone_normalized === phoneNorm && Number(c.id) !== Number(id));
    if (dup) {
      const err = new Error('Esiste già una cliente registrata con questo numero di telefono.');
      err.status = 409;
      throw err;
    }

    const wasAccepted = Number(cur.privacy_accepted) === 1;
    let acceptedAt = cur.privacy_accepted_at;
    if (privacyAccepted && !wasAccepted) acceptedAt = nowStr;
    else if (!privacyAccepted) acceptedAt = null;

    cur.full_name = fullName;
    cur.phone = phoneRaw;
    cur.phone_normalized = phoneNorm;
    cur.email = email || null;
    cur.birth_date = birthDate || null;
    cur.allergies_notes = allergiesNotes || null;
    cur.preferences_notes = preferencesNotes || null;
    cur.privacy_accepted = privacyAccepted ? 1 : 0;
    cur.privacy_accepted_at = acceptedAt;
    cur.privacy_version = privacyVersion;
    cur.marketing_consent = marketingConsent ? 1 : 0;
    cur.updated_at = nowStr;

    if (privacyAccepted && !wasAccepted) {
      db.privacy_logs.push({
        id: nextId(db, 'privacy_log'),
        client_id: id,
        appointment_id: null,
        consent_type: 'studio_crm_update',
        consent_version: privacyVersion,
        accepted_at: nowStr,
        ip_hash: ipHash,
        user_agent: 'Admin CRM',
      });
    }

    writeDb(db);
    return { id, status: 200 };
  }

  if (db.clients.some((c) => c.phone_normalized === phoneNorm)) {
    const err = new Error('Esiste già una cliente registrata con questo numero di telefono.');
    err.status = 409;
    throw err;
  }

  const newId = nextId(db, 'client');
  db.clients.push({
    id: newId,
    full_name: fullName,
    phone: phoneRaw,
    phone_normalized: phoneNorm,
    email: email || null,
    birth_date: birthDate || null,
    allergies_notes: allergiesNotes || null,
    preferences_notes: preferencesNotes || null,
    privacy_accepted: privacyAccepted ? 1 : 0,
    privacy_accepted_at: privacyAccepted ? nowStr : null,
    privacy_version: privacyVersion,
    marketing_consent: marketingConsent ? 1 : 0,
    created_at: nowStr,
    updated_at: nowStr,
  });

  if (privacyAccepted) {
    db.privacy_logs.push({
      id: nextId(db, 'privacy_log'),
      client_id: newId,
      appointment_id: null,
      consent_type: 'studio_crm_create',
      consent_version: privacyVersion,
      accepted_at: nowStr,
      ip_hash: ipHash,
      user_agent: 'Admin CRM',
    });
  }

  writeDb(db);
  return { id: newId, status: 201 };
}

/* --- Client Cards & Packages --- */
async function listClientCards(clientId = 0) {
  const db = readDb();
  return db.client_cards
    .filter((c) => clientId <= 0 || Number(c.client_id) === Number(clientId))
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
}

async function createClientCard({ clientId, title, cardType, totalSessions, remainingCredit, expiresAt, notes }) {
  const db = readDb();
  const now = formatRomeNow();
  const id = nextId(db, 'card');
  const card = {
    id,
    client_id: Number(clientId),
    title,
    card_type: cardType || 'package',
    total_sessions: Number(totalSessions || 0),
    used_sessions: 0,
    remaining_credit: Number(remainingCredit || 0).toFixed(2),
    expires_at: expiresAt || null,
    status: 'active',
    notes: notes || null,
    created_at: now,
    updated_at: now,
  };
  db.client_cards.push(card);
  writeDb(db);
  return card;
}

async function useClientCard(cardId, { sessionsDelta = 1, creditDelta = 0 } = {}) {
  const db = readDb();
  const card = db.client_cards.find((c) => Number(c.id) === Number(cardId));
  if (!card) {
    const err = new Error('Carta/Pacchetto non trovato.');
    err.status = 404;
    throw err;
  }
  if (card.total_sessions > 0) {
    card.used_sessions = Math.min(card.total_sessions, Math.max(0, Number(card.used_sessions) + Number(sessionsDelta)));
    if (card.used_sessions >= card.total_sessions && Number(card.remaining_credit) <= 0) {
      card.status = 'completed';
    }
  }
  if (Number(creditDelta) > 0) {
    const nextCredit = Math.max(0, Number(card.remaining_credit) - Number(creditDelta));
    card.remaining_credit = nextCredit.toFixed(2);
    if (nextCredit <= 0 && (card.total_sessions === 0 || card.used_sessions >= card.total_sessions)) {
      card.status = 'completed';
    }
  }
  card.updated_at = formatRomeNow();
  writeDb(db);
  return card;
}

async function deleteClientCard(cardId) {
  const db = readDb();
  db.client_cards = db.client_cards.filter((c) => Number(c.id) !== Number(cardId));
  writeDb(db);
}

/* --- Morphological & Body Measurements --- */
async function listClientMorphoRecords(clientId) {
  const db = readDb();
  return db.client_morpho_records
    .filter((m) => Number(m.client_id) === Number(clientId))
    .sort((a, b) => (a.recorded_at > b.recorded_at ? -1 : Number(b.id) - Number(a.id)));
}

async function createClientMorphoRecord({
  clientId,
  recordedAt,
  gender,
  weightKg,
  heightCm,
  bmi,
  measurementsJson,
  annotationsJson,
  photosJson,
  notes,
}) {
  const db = readDb();
  const id = nextId(db, 'morpho');
  const rec = {
    id,
    client_id: Number(clientId),
    recorded_at: recordedAt,
    gender: gender === 'male' ? 'male' : 'female',
    weight_kg: weightKg ?? null,
    height_cm: heightCm ?? null,
    bmi: bmi ?? null,
    measurements_json: measurementsJson || '{}',
    annotations_json: annotationsJson || '[]',
    photos_json: photosJson || '[]',
    notes: notes || null,
    created_at: formatRomeNow(),
  };
  db.client_morpho_records.push(rec);
  writeDb(db);
  return rec;
}

async function deleteMorphoRecord(id) {
  const db = readDb();
  db.client_morpho_records = db.client_morpho_records.filter((m) => Number(m.id) !== Number(id));
  writeDb(db);
}

/* --- Mobile Privacy Signature with OTP --- */
async function createPrivacySignatureRequest({ clientId, privacyVersion }) {
  const db = readDb();
  const client = db.clients.find((c) => Number(c.id) === Number(clientId));
  if (!client) {
    const err = new Error('Cliente non trovata.');
    err.status = 404;
    throw err;
  }
  const token = crypto.randomBytes(16).toString('hex');
  const otpCode = String(crypto.randomInt(100000, 1000000));
  const expiresAt = getRomeNowParts(7 * 24 * 60 * 60 * 1000).datetime;
  const nowStr = formatRomeNow();
  const id = nextId(db, 'priv_sign');
  const reqObj = {
    id,
    client_id: client.id,
    token,
    otp_code: otpCode,
    otp_attempts: 0,
    otp_expires_at: expiresAt,
    privacy_version: privacyVersion,
    status: 'pending',
    signature_name: null,
    signature_data: null,
    signed_at: null,
    ip_hash: null,
    user_agent: null,
    created_at: nowStr,
  };
  db.privacy_signature_requests.push(reqObj);
  writeDb(db);
  return {
    id,
    token,
    otp_code: otpCode,
    otp_expires_at: expiresAt,
    privacy_version: privacyVersion,
    client: { id: client.id, full_name: client.full_name, phone: client.phone },
  };
}

async function getPrivacySignatureByToken(token) {
  const db = readDb();
  const reqObj = db.privacy_signature_requests.find((r) => r.token === token);
  if (!reqObj) return null;
  const client = db.clients.find((c) => Number(c.id) === Number(reqObj.client_id));
  if (!client) return null;
  return {
    id: reqObj.id,
    client_id: reqObj.client_id,
    client_name: client.full_name,
    client_phone_masked: String(client.phone || '').replace(/\d(?=\d{3})/g, '*'),
    privacy_version: reqObj.privacy_version,
    status: reqObj.status,
    otp_expires_at: reqObj.otp_expires_at,
    signed_at: reqObj.signed_at,
  };
}

async function completePrivacySignature({
  token,
  otpCode,
  signatureName,
  signatureData,
  marketingConsent,
  nowStr,
  ipHash,
  userAgent,
}) {
  const db = readDb();
  const reqObj = db.privacy_signature_requests.find((r) => r.token === token);
  if (!reqObj) {
    const err = new Error('Link di firma non trovato o non valido.');
    err.status = 404;
    throw err;
  }
  if (reqObj.status === 'signed') {
    const err = new Error('Questo modulo privacy risulta già firmato.');
    err.status = 400;
    throw err;
  }
  if (reqObj.otp_expires_at < nowStr) {
    reqObj.status = 'expired';
    writeDb(db);
    const err = new Error('Richiesta scaduta. Chiedi allo studio un nuovo link.');
    err.status = 410;
    throw err;
  }
  if (reqObj.otp_attempts >= 5) {
    const err = new Error('Troppi tentativi OTP errati. Richiedi un nuovo codice allo studio.');
    err.status = 429;
    throw err;
  }
  if (String(otpCode || '').trim() !== String(reqObj.otp_code)) {
    reqObj.otp_attempts += 1;
    writeDb(db);
    const err = new Error('Codice OTP non corretto. Controlla il messaggio ricevuto.');
    err.status = 400;
    throw err;
  }

  reqObj.status = 'signed';
  reqObj.signature_name = signatureName;
  reqObj.signature_data = signatureData || null;
  reqObj.signed_at = nowStr;
  reqObj.ip_hash = ipHash;
  reqObj.user_agent = userAgent;

  const client = db.clients.find((c) => Number(c.id) === Number(reqObj.client_id));
  if (client) {
    client.privacy_accepted = 1;
    client.privacy_accepted_at = nowStr;
    client.privacy_version = reqObj.privacy_version;
    client.marketing_consent = Math.max(Number(client.marketing_consent || 0), marketingConsent ? 1 : 0);
    client.updated_at = nowStr;
  }

  db.privacy_logs.push({
    id: nextId(db, 'privacy_log'),
    client_id: reqObj.client_id,
    appointment_id: null,
    consent_type: 'mobile_otp_signature',
    consent_version: reqObj.privacy_version,
    accepted_at: nowStr,
    ip_hash: ipHash,
    user_agent: userAgent,
  });

  writeDb(db);
  return { ok: true, signed_at: nowStr, privacy_version: reqObj.privacy_version };
}

/* ============================================================================
   INVENTORY (SUPPLIERS, PRODUCTS & MOVEMENTS)
   ============================================================================ */
async function listSuppliers() {
  const db = readDb();
  return [...db.suppliers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function saveSupplier({ id, name, contactName, phone, email, notes }) {
  const db = readDb();
  const now = formatRomeNow();
  if (id > 0) {
    const s = db.suppliers.find((x) => Number(x.id) === Number(id));
    if (!s) {
      const err = new Error('Fornitore non trovato.');
      err.status = 404;
      throw err;
    }
    s.name = name;
    s.contact_name = contactName || null;
    s.phone = phone || null;
    s.email = email || null;
    s.notes = notes || null;
    s.updated_at = now;
    writeDb(db);
    return { id: s.id, status: 200 };
  }
  const newId = nextId(db, 'supplier');
  db.suppliers.push({
    id: newId,
    name,
    contact_name: contactName || null,
    phone: phone || null,
    email: email || null,
    notes: notes || null,
    created_at: now,
    updated_at: now,
  });
  writeDb(db);
  return { id: newId, status: 201 };
}

async function deleteSupplier(id) {
  const db = readDb();
  db.suppliers = db.suppliers.filter((s) => Number(s.id) !== Number(id));
  db.products.forEach((p) => {
    if (Number(p.supplier_id) === Number(id)) p.supplier_id = null;
  });
  writeDb(db);
}

async function listProducts() {
  const db = readDb();
  const supMap = new Map(db.suppliers.map((s) => [Number(s.id), s.name]));
  return db.products
    .map((p) => ({
      ...p,
      supplier_name: supMap.get(Number(p.supplier_id)) || null,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function saveProduct({ id, sku, name, category, supplierId, costPrice, sellPrice, stockQty, minStockQty, unit, active }) {
  const db = readDb();
  const now = formatRomeNow();
  if (id > 0) {
    const p = db.products.find((x) => Number(x.id) === Number(id));
    if (!p) {
      const err = new Error('Prodotto non trovato.');
      err.status = 404;
      throw err;
    }
    p.sku = sku || null;
    p.name = name;
    p.category = category || 'Rivendita';
    p.supplier_id = supplierId || null;
    p.cost_price = Number(costPrice || 0).toFixed(2);
    p.sell_price = Number(sellPrice || 0).toFixed(2);
    p.stock_qty = Number(stockQty ?? p.stock_qty);
    p.min_stock_qty = Number(minStockQty ?? 2);
    p.unit = unit || 'pz';
    p.active = active !== undefined ? (active ? 1 : 0) : 1;
    p.updated_at = now;
    writeDb(db);
    return { id: p.id, status: 200 };
  }
  const newId = nextId(db, 'product');
  db.products.push({
    id: newId,
    sku: sku || null,
    name,
    category: category || 'Rivendita',
    supplier_id: supplierId || null,
    cost_price: Number(costPrice || 0).toFixed(2),
    sell_price: Number(sellPrice || 0).toFixed(2),
    stock_qty: Number(stockQty || 0),
    min_stock_qty: Number(minStockQty ?? 2),
    unit: unit || 'pz',
    active: active !== undefined ? (active ? 1 : 0) : 1,
    created_at: now,
    updated_at: now,
  });
  writeDb(db);
  return { id: newId, status: 201 };
}

async function deleteProduct(id) {
  const db = readDb();
  db.products = db.products.filter((p) => Number(p.id) !== Number(id));
  db.product_movements = db.product_movements.filter((m) => Number(m.product_id) !== Number(id));
  writeDb(db);
}

async function listProductMovements(limit = 100) {
  const db = readDb();
  const prodMap = new Map(db.products.map((p) => [Number(p.id), p.name]));
  const clientMap = new Map(db.clients.map((c) => [Number(c.id), c.full_name]));
  return [...db.product_movements]
    .sort((a, b) => (a.created_at > b.created_at ? -1 : Number(b.id) - Number(a.id)))
    .slice(0, limit)
    .map((m) => ({
      ...m,
      product_name: prodMap.get(Number(m.product_id)) || 'Prodotto rimosso',
      client_name: m.client_id ? clientMap.get(Number(m.client_id)) || null : null,
    }));
}

async function recordProductMovement({ productId, movementType, quantity, unitPrice, clientId, operatorId, notes }) {
  const db = readDb();
  const p = db.products.find((x) => Number(x.id) === Number(productId));
  if (!p) {
    const err = new Error('Prodotto non trovato.');
    err.status = 404;
    throw err;
  }
  const absQty = Math.max(1, Math.abs(Number(quantity) || 1));
  const delta = movementType === 'restock' ? absQty : movementType === 'adjustment' ? Number(quantity) || 0 : -absQty;
  const resolvedUnitPrice =
    unitPrice !== undefined && unitPrice !== null && unitPrice !== ''
      ? Number(unitPrice)
      : movementType === 'sale'
        ? Number(p.sell_price || 0)
        : Number(p.cost_price || 0);
  const totalAmount = resolvedUnitPrice * absQty;
  const now = formatRomeNow();

  p.stock_qty = Math.max(0, Number(p.stock_qty || 0) + delta);
  p.updated_at = now;

  const movId = nextId(db, 'movement');
  const mov = {
    id: movId,
    product_id: p.id,
    movement_type: movementType,
    quantity: delta,
    unit_price: resolvedUnitPrice.toFixed(2),
    total_amount: totalAmount.toFixed(2),
    client_id: clientId || null,
    operator_id: operatorId || null,
    notes: notes || null,
    created_at: now,
  };
  db.product_movements.push(mov);
  writeDb(db);
  return { movement: mov, new_stock_qty: p.stock_qty };
}

/* ============================================================================
   MESSAGE TEMPLATES & LOGS
   ============================================================================ */
async function listMessageTemplates() {
  const db = readDb();
  return [...db.message_templates].sort((a, b) => Number(a.id) - Number(b.id));
}

async function saveMessageTemplate({
  code,
  title,
  bodyTemplate,
  metaTemplateName,
  metaTemplateLang,
}) {
  const db = readDb();
  const now = formatRomeNow();
  const existing = db.message_templates.find((t) => t.code === code);
  if (existing) {
    if (title) existing.title = title;
    existing.body_template = bodyTemplate;
    if (metaTemplateName !== undefined) {
      existing.meta_template_name = String(metaTemplateName || '').trim() || null;
    }
    if (metaTemplateLang !== undefined) {
      existing.meta_template_lang = String(metaTemplateLang || 'it').trim() || 'it';
    }
    existing.updated_at = now;
    writeDb(db);
    return existing;
  }
  const created = {
    id: nextId(db, 'template'),
    code,
    title: title || code,
    body_template: bodyTemplate,
    meta_template_name: metaTemplateName ? String(metaTemplateName).trim() : null,
    meta_template_lang: metaTemplateLang ? String(metaTemplateLang).trim() : 'it',
    updated_at: now,
  };
  db.message_templates.push(created);
  writeDb(db);
  return created;
}

async function listMessageLogs(limit = 100) {
  const db = readDb();
  return [...db.message_logs]
    .sort((a, b) => (a.sent_at > b.sent_at ? -1 : Number(b.id) - Number(a.id)))
    .slice(0, limit);
}

async function createMessageLog({
  clientId,
  appointmentId,
  recipientPhone,
  recipientName,
  channel,
  templateCode,
  messageText,
  adminId,
  status = 'sent',
  externalMessageId = null,
  errorMessage = null,
  triggerSource = 'manual',
  metaPayloadType = 'text',
}) {
  const db = readDb();
  const now = formatRomeNow();
  const log = {
    id: nextId(db, 'msg_log'),
    client_id: clientId || null,
    appointment_id: appointmentId || null,
    recipient_phone: recipientPhone || null,
    recipient_name: recipientName || null,
    channel: channel || 'whatsapp',
    template_code: templateCode || null,
    message_text: messageText,
    status: status || 'sent',
    external_message_id: externalMessageId || null,
    error_message: errorMessage || null,
    trigger_source: triggerSource || 'manual',
    meta_payload_type: metaPayloadType || 'text',
    sent_by_admin_id: adminId || null,
    sent_at: now,
  };
  db.message_logs.push(log);
  writeDb(db);
  return log;
}

async function hasRecentMessageLog({
  clientId = null,
  appointmentId = null,
  templateCode = '',
  withinDays = 0,
  sinceDate = '',
  statuses = ['sent'],
}) {
  const db = readDb();
  const cutoffDate = sinceDate
    ? sinceDate
    : withinDays > 0
      ? getRomeNowParts(-Number(withinDays) * 86400000).date
      : '';
  const allowedStatuses = new Set(Array.isArray(statuses) ? statuses : ['sent']);

  return (db.message_logs || []).some((log) => {
    if (templateCode && log.template_code !== templateCode) return false;
    const logStatus = log.status || 'sent';
    if (!allowedStatuses.has(logStatus)) return false;
    if (appointmentId && Number(log.appointment_id) !== Number(appointmentId)) return false;
    if (clientId && Number(log.client_id) !== Number(clientId)) return false;
    if (cutoffDate) {
      const logDate = String(log.sent_at || '').slice(0, 10);
      if (logDate < cutoffDate) return false;
    }
    return true;
  });
}

async function getStudioSetting(key) {
  const db = readDb();
  const found = (db.studio_settings || []).find((s) => s.setting_key === key);
  if (!found) return null;
  try {
    const val = typeof found.setting_value === 'string'
      ? JSON.parse(found.setting_value)
      : found.setting_value;
    if (val && typeof val === 'object') {
      return { ...val, updated_at: found.updated_at || null };
    }
    return val;
  } catch {
    return null;
  }
}

async function saveStudioSetting(key, valueObj) {
  const db = readDb();
  const now = formatRomeNow();
  const serialized = JSON.stringify(valueObj || {});
  const list = db.studio_settings || (db.studio_settings = []);
  const existing = list.find((s) => s.setting_key === key);
  if (existing) {
    existing.setting_value = serialized;
    existing.updated_at = now;
  } else {
    list.push({ setting_key: key, setting_value: serialized, updated_at: now });
  }
  writeDb(db);
  return { ...(valueObj || {}), updated_at: now };
}

async function listAutomationRuns(limit = 40) {
  const db = readDb();
  return [...(db.automation_runs || [])]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, limit);
}

async function hasAutomationRunForDate(jobName, runDate) {
  const db = readDb();
  return (db.automation_runs || []).some(
    (r) => r.job_name === jobName && r.run_date === runDate && r.status === 'completed'
  );
}

async function recordAutomationRun({
  jobName,
  runDate,
  triggerMode = 'scheduler',
  status = 'completed',
  processedCount = 0,
  sentCount = 0,
  failedCount = 0,
  skippedCount = 0,
  summaryText = '',
  startedAt = null,
  finishedAt = null,
}) {
  const db = readDb();
  const row = {
    id: nextId(db, 'automation_run'),
    job_name: jobName,
    run_date: runDate,
    trigger_mode: triggerMode,
    status,
    processed_count: Number(processedCount || 0),
    sent_count: Number(sentCount || 0),
    failed_count: Number(failedCount || 0),
    skipped_count: Number(skippedCount || 0),
    summary_text: summaryText || '',
    started_at: startedAt || formatRomeNow(),
    finished_at: finishedAt || formatRomeNow(),
  };
  (db.automation_runs || (db.automation_runs = [])).push(row);
  writeDb(db);
  return row;
}

async function listGiftCards(query = '') {
  const db = readDb();
  const clientMap = new Map(db.clients.map((c) => [Number(c.id), c]));
  const q = String(query || '').trim().toLowerCase();
  return [...(db.gift_cards || [])]
    .filter((gc) => {
      if (!q) return true;
      return [gc.code, gc.recipient_name, gc.sender_name, gc.service_title]
        .some((v) => String(v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => Number(b.id) - Number(a.id))
    .map((gc) => ({
      ...gc,
      client_name: clientMap.get(Number(gc.client_id))?.full_name || null,
    }));
}

async function createGiftCard({
  code,
  theme,
  giftMode,
  amount,
  hidePrice,
  serviceTitle,
  recipientName,
  senderName,
  recipientPhone,
  clientId,
  message,
  expiresAt,
  notes,
}) {
  const db = readDb();
  const dup = (db.gift_cards || []).find((g) => String(g.code).toUpperCase() === String(code).toUpperCase());
  if (dup) {
    const err = new Error('Questo codice Gift Card esiste già. Rigenera o scegli un altro codice.');
    err.status = 409;
    err.code = 'GIFT_CODE_EXISTS';
    throw err;
  }
  const now = formatRomeNow();
  const row = {
    id: nextId(db, 'gift_card'),
    code,
    theme: theme || 'rose',
    gift_mode: giftMode || 'amount',
    amount: Number(amount || 0).toFixed(2),
    remaining_amount: Number(amount || 0).toFixed(2),
    hide_price: hidePrice ? 1 : 0,
    service_title: serviceTitle || null,
    recipient_name: recipientName,
    sender_name: senderName || null,
    recipient_phone: recipientPhone || null,
    client_id: clientId || null,
    message: message || null,
    expires_at: expiresAt || null,
    status: 'active',
    redeemed_at: null,
    notes: notes || null,
    created_at: now,
    updated_at: now,
  };
  db.gift_cards.push(row);
  writeDb(db);
  const clientName = db.clients.find((c) => Number(c.id) === Number(clientId))?.full_name || null;
  return { ...row, client_name: clientName };
}

async function redeemGiftCard(id, { redeemAmount = 0, markFull = false, cancel = false }) {
  const db = readDb();
  const gc = (db.gift_cards || []).find((g) => Number(g.id) === Number(id));
  if (!gc) return null;
  const now = formatRomeNow();
  if (cancel) {
    gc.status = 'cancelled';
  } else if (markFull) {
    gc.remaining_amount = '0.00';
    gc.status = 'redeemed';
    gc.redeemed_at = now;
  } else if (Number(gc.amount) > 0) {
    const nextRem = Math.max(0, Number((Number(gc.remaining_amount) - Math.max(0, Number(redeemAmount) || 0)).toFixed(2)));
    gc.remaining_amount = nextRem.toFixed(2);
    if (nextRem <= 0) {
      gc.status = 'redeemed';
      gc.redeemed_at = now;
    }
  } else {
    gc.status = 'redeemed';
    gc.redeemed_at = now;
  }
  gc.updated_at = now;
  writeDb(db);
  const clientName = db.clients.find((c) => Number(c.id) === Number(gc.client_id))?.full_name || null;
  return { ...gc, client_name: clientName };
}

async function deleteGiftCard(id) {
  const db = readDb();
  db.gift_cards = (db.gift_cards || []).filter((g) => Number(g.id) !== Number(id));
  writeDb(db);
}

/* ============================================================================
   MONTHLY PROMOTIONS CRUD
   ============================================================================ */
function normalizePromotionRow(row) {
  if (!row) return null;
  let services = [];
  if (Array.isArray(row.services)) {
    services = row.services;
  } else if (typeof row.services_json === 'string' && row.services_json.trim()) {
    try {
      const parsed = JSON.parse(row.services_json);
      if (Array.isArray(parsed)) services = parsed;
    } catch {
      services = [];
    }
  }
  return {
    ...row,
    id: Number(row.id),
    original_price: Number(row.original_price || 0),
    promo_price: Number(row.promo_price || 0),
    duration_minutes: Math.max(10, Number(row.duration_minutes || 60)),
    active: Number(row.active) !== 0 ? 1 : 0,
    featured: Number(row.featured) === 1 ? 1 : 0,
    show_on_hero: Number(row.show_on_hero) === 1 ? 1 : 0,
    sort_order: Number(row.sort_order || 0),
    valid_from: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
    valid_until: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
    services,
    services_json: JSON.stringify(services),
  };
}

function isPromotionActiveForDate(promo, todayIso) {
  if (!promo || Number(promo.active) !== 1) return false;
  if (todayIso) {
    if (promo.valid_from && String(promo.valid_from) > todayIso) return false;
    if (promo.valid_until && String(promo.valid_until) < todayIso) return false;
  }
  return true;
}

async function listPromotions({ activeOnly = false, todayIso = null } = {}) {
  const db = readDb();
  const list = (db.monthly_promotions || [])
    .map(normalizePromotionRow)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.id - b.id);
  if (!activeOnly) return list;
  const checkDate = todayIso || getRomeToday();
  return list.filter((p) => isPromotionActiveForDate(p, checkDate));
}

async function getPromotionById(id) {
  const db = readDb();
  const row = (db.monthly_promotions || []).find((p) => Number(p.id) === Number(id));
  return normalizePromotionRow(row);
}

async function createPromotion({
  title,
  badgeText,
  monthLabel,
  description,
  services,
  originalPrice,
  promoPrice,
  durationMinutes,
  validFrom,
  validUntil,
  active = 1,
  featured = 0,
  showOnHero = 0,
  sortOrder = 0,
}) {
  const db = readDb();
  const now = formatRomeNow();
  if (showOnHero) {
    (db.monthly_promotions || []).forEach((p) => {
      p.show_on_hero = 0;
    });
  }
  const row = {
    id: nextId(db, 'promotion'),
    title,
    badge_text: badgeText || null,
    month_label: monthLabel || null,
    description: description || null,
    services_json: JSON.stringify(Array.isArray(services) ? services : []),
    original_price: Number(originalPrice || 0),
    promo_price: Number(promoPrice || 0),
    duration_minutes: Math.max(10, Number(durationMinutes || 60)),
    valid_from: validFrom || null,
    valid_until: validUntil || null,
    active: active ? 1 : 0,
    featured: featured ? 1 : 0,
    show_on_hero: showOnHero ? 1 : 0,
    sort_order: Number(sortOrder || 0),
    created_at: now,
    updated_at: now,
  };
  db.monthly_promotions = db.monthly_promotions || [];
  db.monthly_promotions.push(row);
  writeDb(db);
  return normalizePromotionRow(row);
}

async function updatePromotion(id, updates = {}) {
  const db = readDb();
  const row = (db.monthly_promotions || []).find((p) => Number(p.id) === Number(id));
  if (!row) return null;

  const nextShowOnHero =
    updates.showOnHero !== undefined ? (updates.showOnHero ? 1 : 0) : Number(row.show_on_hero) === 1 ? 1 : 0;
  if (nextShowOnHero === 1) {
    db.monthly_promotions.forEach((p) => {
      if (Number(p.id) !== Number(id)) p.show_on_hero = 0;
    });
  }

  const currentNorm = normalizePromotionRow(row);
  const nextServices = Array.isArray(updates.services) ? updates.services : currentNorm.services;
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.badgeText !== undefined) row.badge_text = updates.badgeText || null;
  if (updates.monthLabel !== undefined) row.month_label = updates.monthLabel || null;
  if (updates.description !== undefined) row.description = updates.description || null;
  row.services_json = JSON.stringify(nextServices);
  if (updates.originalPrice !== undefined) row.original_price = Number(updates.originalPrice || 0);
  if (updates.promoPrice !== undefined) row.promo_price = Number(updates.promoPrice || 0);
  if (updates.durationMinutes !== undefined) row.duration_minutes = Math.max(10, Number(updates.durationMinutes || 60));
  if (updates.validFrom !== undefined) row.valid_from = updates.validFrom || null;
  if (updates.validUntil !== undefined) row.valid_until = updates.validUntil || null;
  if (updates.active !== undefined) row.active = updates.active ? 1 : 0;
  if (updates.featured !== undefined) row.featured = updates.featured ? 1 : 0;
  row.show_on_hero = nextShowOnHero;
  if (updates.sortOrder !== undefined) row.sort_order = Number(updates.sortOrder || 0);
  row.updated_at = formatRomeNow();

  writeDb(db);
  return normalizePromotionRow(row);
}

async function deletePromotion(id) {
  const db = readDb();
  db.monthly_promotions = (db.monthly_promotions || []).filter((p) => Number(p.id) !== Number(id));
  writeDb(db);
}

/* ============================================================================
   PAYMENTS, CASSA & STRIPE CHECKOUT LEDGER
   ============================================================================ */
function hydrateLocalAppointment(db, appt) {
  if (!appt) return null;
  const c = db.clients.find((cl) => Number(cl.id) === Number(appt.client_id)) || {};
  const primaryOp = db.operators[0] || { id: null, name: 'Giulia', color: '#d47491' };
  const op = db.operators.find((o) => Number(o.id) === Number(appt.operator_id)) || primaryOp;
  return {
    ...appt,
    operator_id: appt.operator_id || op.id || null,
    operator_name: op.name || 'Giulia',
    operator_color: op.color || '#d47491',
    start_time: String(appt.start_time).slice(0, 5),
    payment_status: appt.payment_status || 'unpaid',
    paid_amount:
      appt.paid_amount !== undefined && appt.paid_amount !== null ? Number(appt.paid_amount).toFixed(2) : '0.00',
    payment_notes: appt.payment_notes || null,
    paid_at: appt.paid_at || null,
    stripe_session_id: appt.stripe_session_id || null,
    stripe_payment_intent: appt.stripe_payment_intent || null,
    paypal_order_id: appt.paypal_order_id || null,
    paypal_capture_id: appt.paypal_capture_id || null,
    client_name: c.full_name || '',
    client_phone: c.phone || '',
    client_email: c.email || null,
    client_birth_date: c.birth_date || null,
    allergies_notes: c.allergies_notes || null,
    preferences_notes: c.preferences_notes || null,
    privacy_version: c.privacy_version || 'v2.0-2026-11',
  };
}

async function getAppointmentById(id) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  return hydrateLocalAppointment(db, appt);
}

async function getAppointmentByCode(bookingCode) {
  const db = readDb();
  const code = String(bookingCode || '').trim();
  const appt = db.appointments.find((a) => String(a.booking_code) === code);
  return hydrateLocalAppointment(db, appt);
}

async function getAppointmentByStripeSession(sessionId) {
  const db = readDb();
  const sid = String(sessionId || '').trim();
  const appt = db.appointments.find((a) => String(a.stripe_session_id || '') === sid);
  return hydrateLocalAppointment(db, appt);
}

async function updateAppointmentStripeSession(id, sessionId) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (appt) {
    appt.stripe_session_id = String(sessionId || '').trim() || null;
    appt.payment_method = 'stripe_online';
    appt.updated_at = formatRomeNow();
    writeDb(db);
  }
}

async function getAppointmentByPayPalOrder(orderId) {
  const db = readDb();
  const oid = String(orderId || '').trim();
  const appt = db.appointments.find((a) => String(a.paypal_order_id || '') === oid);
  return hydrateLocalAppointment(db, appt);
}

async function getAppointmentByPayPalCapture(captureId) {
  const db = readDb();
  const cid = String(captureId || '').trim();
  const appt = db.appointments.find((a) => String(a.paypal_capture_id || '') === cid);
  return hydrateLocalAppointment(db, appt);
}

async function updateAppointmentPayPalOrder(id, orderId) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (appt) {
    appt.paypal_order_id = String(orderId || '').trim() || null;
    appt.payment_method = 'paypal_online';
    appt.updated_at = formatRomeNow();
    writeDb(db);
  }
}

async function fallbackAppointmentToStudioPayment(id) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (appt && (appt.payment_status || 'unpaid') === 'unpaid') {
    appt.payment_method = 'studio';
    appt.stripe_session_id = null;
    appt.paypal_order_id = null;
    appt.updated_at = formatRomeNow();
    writeDb(db);
  }
  return getAppointmentById(id);
}

async function cancelUnpaidPendingAppointment(id, reasonNote = 'Pagamento online non completato dalla cliente') {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (appt && appt.status === 'pending' && (appt.payment_status || 'unpaid') === 'unpaid') {
    appt.status = 'cancelled';
    if (!appt.payment_notes) appt.payment_notes = reasonNote;
    appt.updated_at = formatRomeNow();
    writeDb(db);
  }
  return getAppointmentById(id);
}

async function listPaymentTransactions({ startDate = null, endDate = null, method = null, appointmentId = 0, limit = 120 } = {}) {
  const db = readDb();
  const apptMap = new Map(db.appointments.map((a) => [Number(a.id), a]));
  const clientMap = new Map(db.clients.map((c) => [Number(c.id), c]));
  const safeLimit = Math.min(500, Math.max(1, Number(limit || 120)));

  return (db.payment_transactions || [])
    .filter((pt) => {
      if (appointmentId > 0 && Number(pt.appointment_id) !== Number(appointmentId)) return false;
      if (method && String(pt.payment_method) !== String(method).trim()) return false;
      const d = String(pt.created_at || '').slice(0, 10);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    })
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, safeLimit)
    .map((pt) => {
      const a = apptMap.get(Number(pt.appointment_id)) || {};
      const c = clientMap.get(Number(pt.client_id)) || {};
      return {
        ...pt,
        appointment_date: a.appointment_date || null,
        start_time: a.start_time ? String(a.start_time).slice(0, 5) : null,
        services_summary: a.services_summary || null,
        appointment_total_price: a.total_price || null,
        appointment_payment_status: a.payment_status || null,
        client_name: c.full_name || null,
        client_phone: c.phone || null,
      };
    });
}

async function recordAppointmentPayment({
  appointmentId,
  paymentStatus = null,
  paymentMethod = null,
  paidAmount = null,
  transactionAmount = null,
  direction = 'payment',
  stripeSessionId = null,
  stripePaymentIntent = null,
  paypalOrderId = null,
  paypalCaptureId = null,
  paymentNotes = null,
  transactionNotes = null,
  statusOverride = null,
  adminId = null,
  nowStr = formatRomeNow(),
}) {
  const db = readDb();

  if (direction === 'payment' && (stripeSessionId || paypalOrderId || paypalCaptureId)) {
    const dup = (db.payment_transactions || []).find(
      (pt) =>
        pt.direction === 'payment' &&
        pt.status === 'succeeded' &&
        ((stripeSessionId && pt.stripe_session_id === stripeSessionId) ||
          (paypalCaptureId && pt.paypal_capture_id === paypalCaptureId) ||
          (paypalOrderId && pt.paypal_order_id === paypalOrderId))
    );
    if (dup) {
      const apptExisting = await getAppointmentById(appointmentId);
      return { appointment: apptExisting, transaction: dup, duplicate: true };
    }
  }

  const appt = db.appointments.find((a) => Number(a.id) === Number(appointmentId));
  if (!appt) {
    const err = new Error('Appuntamento non trovato.');
    err.status = 404;
    throw err;
  }

  const currentPaid = Math.max(0, Number(appt.paid_amount || 0));
  const total = Math.max(0, Number(appt.total_price || 0));

  let nextPaid = currentPaid;
  let txAmt = 0;

  if (direction === 'refund') {
    const refAmt = transactionAmount !== null ? Math.max(0, Number(transactionAmount || 0)) : currentPaid;
    txAmt = Math.min(currentPaid > 0 ? currentPaid : total, refAmt);
    nextPaid = Math.max(0, Math.round((currentPaid - txAmt) * 100) / 100);
  } else if (paidAmount !== null && paidAmount !== undefined) {
    nextPaid = Math.max(0, Math.round(Number(paidAmount || 0) * 100) / 100);
    if (transactionAmount !== null && transactionAmount !== undefined) {
      txAmt = Math.max(0, Math.round(Number(transactionAmount || 0) * 100) / 100);
    } else {
      txAmt = Math.max(0, Math.round((nextPaid - currentPaid) * 100) / 100);
    }
  } else if (transactionAmount !== null && transactionAmount !== undefined) {
    txAmt = Math.max(0, Math.round(Number(transactionAmount || 0) * 100) / 100);
    nextPaid = Math.round((currentPaid + txAmt) * 100) / 100;
  }

  let nextPayStatus = paymentStatus || appt.payment_status || 'unpaid';
  if (direction === 'refund') {
    nextPayStatus = nextPaid <= 0.009 ? 'refunded' : 'partial';
  } else if (!paymentStatus) {
    if (total > 0 && nextPaid >= total - 0.01) nextPayStatus = 'paid';
    else if (nextPaid > 0.009) nextPayStatus = 'partial';
    else nextPayStatus = 'unpaid';
  }

  const nextMethod = paymentMethod || appt.payment_method || 'studio';
  const nextPaidAt =
    nextPayStatus === 'unpaid'
      ? null
      : nextPaid > 0 || nextPayStatus === 'paid'
      ? appt.paid_at || nowStr
      : appt.paid_at || null;
  const nextNotes = paymentNotes !== null && paymentNotes !== undefined ? paymentNotes : appt.payment_notes || null;
  const nextApptStatus = statusOverride || appt.status;
  const nextSession = stripeSessionId || appt.stripe_session_id || null;
  const nextIntent = stripePaymentIntent || appt.stripe_payment_intent || null;
  const nextPaypalOrder = paypalOrderId || appt.paypal_order_id || null;
  const nextPaypalCapture = paypalCaptureId || appt.paypal_capture_id || null;

  appt.payment_method = nextMethod;
  appt.payment_status = nextPayStatus;
  appt.paid_amount = nextPaid.toFixed(2);
  appt.payment_notes = nextNotes;
  appt.paid_at = nextPaidAt;
  appt.stripe_session_id = nextSession;
  appt.stripe_payment_intent = nextIntent;
  appt.paypal_order_id = nextPaypalOrder;
  appt.paypal_capture_id = nextPaypalCapture;
  appt.status = nextApptStatus;
  appt.updated_at = nowStr;

  let insertedTx = null;
  if (txAmt > 0.009) {
    insertedTx = {
      id: nextId(db, 'payment_tx'),
      appointment_id: appt.id,
      client_id: appt.client_id,
      booking_code: appt.booking_code,
      direction,
      payment_method: nextMethod,
      amount: txAmt.toFixed(2),
      currency: 'EUR',
      status: 'succeeded',
      stripe_session_id: stripeSessionId || null,
      stripe_payment_intent: stripePaymentIntent || null,
      paypal_order_id: paypalOrderId || null,
      paypal_capture_id: paypalCaptureId || null,
      notes: transactionNotes || nextNotes || null,
      created_by_admin_id: adminId || null,
      created_at: nowStr,
    };
    db.payment_transactions.push(insertedTx);
  }

  writeDb(db);
  return { appointment: hydrateLocalAppointment(db, appt), transaction: insertedTx, duplicate: false };
}

function recomputeLocalAppointmentFromTransactions(db, appointmentId, nowStr) {
  if (!appointmentId) return null;
  const appt = (db.appointments || []).find((a) => Number(a.id) === Number(appointmentId));
  if (!appt) return null;
  const txs = (db.payment_transactions || []).filter(
    (t) => Number(t.appointment_id) === Number(appointmentId) && (t.status || 'succeeded') === 'succeeded'
  );
  let net = 0;
  let hasRefund = false;
  let latestMethod = appt.payment_method || 'studio';
  let latestAt = null;
  for (const t of txs) {
    const amt = Number(t.amount || 0);
    if (t.direction === 'refund') {
      net -= amt;
      hasRefund = true;
    } else {
      net += amt;
      if (!latestAt || String(t.created_at || '') >= latestAt) {
        latestAt = String(t.created_at || '');
        latestMethod = t.payment_method || latestMethod;
      }
    }
  }
  const nextPaid = Math.max(0, Math.round((net + Number.EPSILON) * 100) / 100);
  const total = Math.max(0, Number(appt.total_price || 0));
  let nextStatus = 'unpaid';
  if (total > 0 && nextPaid >= total - 0.01) nextStatus = 'paid';
  else if (nextPaid > 0.009) nextStatus = 'partial';
  else nextStatus = hasRefund ? 'refunded' : 'unpaid';

  appt.paid_amount = nextPaid.toFixed(2);
  appt.payment_status = nextStatus;
  appt.payment_method = nextStatus === 'unpaid' ? 'studio' : latestMethod;
  appt.paid_at = nextStatus === 'unpaid' ? null : appt.paid_at || latestAt || nowStr;
  appt.updated_at = nowStr;
  return appt;
}

async function createPaymentTransaction({
  appointmentId = null,
  clientId = null,
  bookingCode = null,
  direction = 'payment',
  paymentMethod = 'contanti',
  amount = 0,
  notes = null,
  adminId = null,
  createdAt = formatRomeNow(),
}) {
  const db = readDb();
  const amt = Math.max(0, Math.round((Number(amount || 0) + Number.EPSILON) * 100) / 100);
  if (amt < 0.01) {
    const err = new Error("Inserisci un importo valido superiore a 0 €.");
    err.status = 422;
    throw err;
  }
  const dir = direction === 'refund' ? 'refund' : 'payment';
  const tx = {
    id: nextId(db, 'payment_tx'),
    appointment_id: appointmentId ? Number(appointmentId) : null,
    client_id: clientId ? Number(clientId) : null,
    booking_code: bookingCode ? String(bookingCode).trim().slice(0, 32) : null,
    direction: dir,
    payment_method: String(paymentMethod || 'contanti').trim().slice(0, 40),
    amount: amt.toFixed(2),
    currency: 'EUR',
    status: 'succeeded',
    stripe_session_id: null,
    stripe_payment_intent: null,
    paypal_order_id: null,
    paypal_capture_id: null,
    notes: notes ? String(notes).trim().slice(0, 300) : null,
    created_by_admin_id: adminId ? Number(adminId) : null,
    created_at: String(createdAt || formatRomeNow()).slice(0, 19),
  };
  db.payment_transactions = db.payment_transactions || [];
  db.payment_transactions.push(tx);
  if (tx.appointment_id) {
    recomputeLocalAppointmentFromTransactions(db, tx.appointment_id, formatRomeNow());
  }
  writeDb(db);
  return tx;
}

async function updatePaymentTransaction(id, { direction, paymentMethod, amount, notes, createdAt } = {}) {
  const db = readDb();
  const tx = (db.payment_transactions || []).find((t) => Number(t.id) === Number(id));
  if (!tx) {
    const err = new Error('Movimento di incasso non trovato.');
    err.status = 404;
    throw err;
  }
  if (amount !== undefined) {
    const amt = Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(amt) || amt < 0.01) {
      const err = new Error("Inserisci un importo valido superiore a 0 €.");
      err.status = 422;
      throw err;
    }
    tx.amount = amt.toFixed(2);
  }
  if (direction !== undefined) {
    tx.direction = direction === 'refund' ? 'refund' : 'payment';
  }
  if (paymentMethod !== undefined) {
    tx.payment_method = String(paymentMethod || 'contanti').trim().slice(0, 40);
  }
  if (notes !== undefined) {
    tx.notes = String(notes || '').trim().slice(0, 300) || null;
  }
  if (createdAt !== undefined && String(createdAt || '').trim()) {
    tx.created_at = String(createdAt).trim().slice(0, 19);
  }
  if (tx.appointment_id) {
    recomputeLocalAppointmentFromTransactions(db, tx.appointment_id, formatRomeNow());
  }
  writeDb(db);
  return tx;
}

async function deletePaymentTransaction(id) {
  const db = readDb();
  const list = db.payment_transactions || [];
  const idx = list.findIndex((t) => Number(t.id) === Number(id));
  if (idx === -1) {
    const err = new Error('Movimento di incasso non trovato.');
    err.status = 404;
    throw err;
  }
  const [removed] = list.splice(idx, 1);
  if (removed.appointment_id) {
    recomputeLocalAppointmentFromTransactions(db, removed.appointment_id, formatRomeNow());
  }
  writeDb(db);
  return removed;
}

/* ============================================================================
   CONFIGURABLE SERVICE CATALOG (CATEGORIES & TREATMENTS)
   ============================================================================ */
async function listCatalogData() {
  const db = readDb();
  const categories = (db.catalog_categories || []).map(normalizeCategoryRow).sort(sortByOrderThenId);
  const services = (db.catalog_services || []).map(normalizeServiceRow).sort(sortByOrderThenId);
  return {
    categories,
    services,
    catalog: buildStructuredCatalog(categories, services, { includeInactive: true, storefrontOnly: false }),
    activeCatalog: buildStructuredCatalog(categories, services, { includeInactive: false, storefrontOnly: false }),
    storefrontCatalog: buildStructuredCatalog(categories, services, { includeInactive: false, storefrontOnly: true }),
  };
}

async function listPublicCatalog() {
  const data = await listCatalogData();
  return data.storefrontCatalog;
}

async function createCatalogCategory({ title, motto = '', columnSide = 'right', sortOrder = 0, active = 1, slug = '' }) {
  const db = readDb();
  const cleanTitle = String(title || '').trim().slice(0, 115);
  if (!cleanTitle) {
    const err = new Error('Inserisci il nome della categoria.');
    err.status = 422;
    throw err;
  }
  let resolvedSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '');
  if (!resolvedSlug || (db.catalog_categories || []).some((c) => c.slug === resolvedSlug)) {
    resolvedSlug = slugifyCatalogKey(cleanTitle, 'cat');
  }
  const now = formatRomeNow();
  const row = {
    id: nextId(db, 'cat_category'),
    slug: resolvedSlug,
    title: cleanTitle,
    motto: String(motto || '').trim() || null,
    column_side: columnSide === 'left' ? 'left' : 'right',
    sort_order: Number(sortOrder || 0),
    active: active ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  db.catalog_categories.push(row);
  writeDb(db);
  return normalizeCategoryRow(row);
}

async function updateCatalogCategory(id, updates = {}) {
  const db = readDb();
  const row = (db.catalog_categories || []).find((c) => Number(c.id) === Number(id));
  if (!row) return null;
  if (updates.title !== undefined) {
    const clean = String(updates.title || '').trim().slice(0, 115);
    if (clean) row.title = clean;
  }
  if (updates.motto !== undefined) row.motto = String(updates.motto || '').trim() || null;
  if (updates.columnSide !== undefined) row.column_side = updates.columnSide === 'left' ? 'left' : 'right';
  if (updates.sortOrder !== undefined) row.sort_order = Number(updates.sortOrder || 0);
  if (updates.active !== undefined) row.active = updates.active ? 1 : 0;
  row.updated_at = formatRomeNow();
  writeDb(db);
  return normalizeCategoryRow(row);
}

async function deleteCatalogCategory(id) {
  const db = readDb();
  const cat = (db.catalog_categories || []).find((c) => Number(c.id) === Number(id));
  if (!cat) return false;
  if ((db.catalog_services || []).some((s) => s.category_slug === cat.slug)) {
    const err = new Error('Sposta o elimina prima i trattamenti presenti in questa categoria.');
    err.status = 409;
    err.code = 'CATEGORY_NOT_EMPTY';
    throw err;
  }
  db.catalog_categories = db.catalog_categories.filter((c) => Number(c.id) !== Number(id));
  writeDb(db);
  return true;
}

async function createCatalogService({
  categorySlug,
  subgroupLabel = '',
  name,
  price = 0,
  durationMinutes = 30,
  description = '',
  sortOrder = 0,
  active = 1,
  showInStorefront = 1,
  serviceKey = '',
}) {
  const db = readDb();
  const cleanName = String(name || '').trim().slice(0, 155);
  if (cleanName.length < 2) {
    const err = new Error('Inserisci il nome del trattamento.');
    err.status = 422;
    throw err;
  }
  const cleanCat = String(categorySlug || '').trim();
  if (!(db.catalog_categories || []).some((c) => c.slug === cleanCat)) {
    const err = new Error('Seleziona una categoria valida dal listino.');
    err.status = 422;
    throw err;
  }
  let resolvedKey = String(serviceKey || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '');
  if (!resolvedKey || (db.catalog_services || []).some((s) => s.service_key === resolvedKey)) {
    resolvedKey = slugifyCatalogKey(cleanName, cleanCat.slice(0, 10) || 'srv');
  }
  const now = formatRomeNow();
  const row = {
    id: nextId(db, 'cat_service'),
    service_key: resolvedKey,
    category_slug: cleanCat,
    subgroup_label: String(subgroupLabel || '').trim() || null,
    name: cleanName,
    price: Number(Math.max(0, Number(price || 0)).toFixed(2)),
    duration_minutes: Math.max(5, Number.parseInt(durationMinutes || '30', 10) || 30),
    description: String(description || '').trim() || null,
    sort_order: Number(sortOrder || 0),
    active: active ? 1 : 0,
    show_in_storefront: showInStorefront ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
  db.catalog_services.push(row);
  writeDb(db);
  return normalizeServiceRow(row);
}

async function updateCatalogService(id, updates = {}) {
  const db = readDb();
  const row = (db.catalog_services || []).find((s) => Number(s.id) === Number(id));
  if (!row) return null;
  if (updates.categorySlug !== undefined) {
    const nextCat = String(updates.categorySlug || '').trim();
    if (!(db.catalog_categories || []).some((c) => c.slug === nextCat)) {
      const err = new Error('Categoria selezionata non valida.');
      err.status = 422;
      throw err;
    }
    row.category_slug = nextCat;
  }
  if (updates.subgroupLabel !== undefined) row.subgroup_label = String(updates.subgroupLabel || '').trim() || null;
  if (updates.name !== undefined) {
    const clean = String(updates.name || '').trim().slice(0, 155);
    if (clean) row.name = clean;
  }
  if (updates.price !== undefined) row.price = Number(Math.max(0, Number(priceNum(updates.price))).toFixed(2));
  if (updates.durationMinutes !== undefined) {
    row.duration_minutes = Math.max(5, Number.parseInt(updates.durationMinutes || '30', 10) || 30);
  }
  if (updates.description !== undefined) row.description = String(updates.description || '').trim() || null;
  if (updates.sortOrder !== undefined) row.sort_order = Number(updates.sortOrder || 0);
  if (updates.active !== undefined) row.active = updates.active ? 1 : 0;
  if (updates.showInStorefront !== undefined) row.show_in_storefront = updates.showInStorefront ? 1 : 0;
  row.updated_at = formatRomeNow();
  writeDb(db);
  return normalizeServiceRow(row);
}

function priceNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

async function deleteCatalogService(id) {
  const db = readDb();
  db.catalog_services = (db.catalog_services || []).filter((s) => Number(s.id) !== Number(id));
  writeDb(db);
}

function sanitizeStudioSettingsForBackup(rows = []) {
  return (rows || []).map((row) => {
    if (!row || row.setting_key !== 'payment_settings') return row;
    try {
      const parsed = typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : { ...(row.setting_value || {}) };
      delete parsed.stripe_secret_key;
      delete parsed.stripe_webhook_secret;
      delete parsed.paypal_client_secret;
      return {
        ...row,
        setting_value: typeof row.setting_value === 'string' ? JSON.stringify(parsed) : parsed,
      };
    } catch {
      return { ...row, setting_value: '{}' };
    }
  });
}

async function exportFullBackupSnapshot() {
  const db = readDb();
  const tables = {
    admin_users: (db.admin_users || []).map(({ password_hash, ...safe }) => safe),
    operators: db.operators || [],
    operator_absences: db.operator_absences || [],
    clients: db.clients || [],
    appointments: db.appointments || [],
    privacy_logs: db.privacy_logs || [],
    privacy_signature_requests: db.privacy_signature_requests || [],
    client_cards: db.client_cards || [],
    client_morpho_records: db.client_morpho_records || [],
    suppliers: db.suppliers || [],
    products: db.products || [],
    product_movements: db.product_movements || [],
    message_templates: db.message_templates || [],
    message_logs: db.message_logs || [],
    studio_settings: sanitizeStudioSettingsForBackup(db.studio_settings || []),
    automation_runs: db.automation_runs || [],
    gift_cards: db.gift_cards || [],
    monthly_promotions: db.monthly_promotions || [],
    payment_transactions: db.payment_transactions || [],
    catalog_categories: db.catalog_categories || [],
    catalog_services: db.catalog_services || [],
  };
  return tables;
}

module.exports = {
  healthCheck,
  initSchemaAndCountAdmins,
  createInitialAdmin,
  findAdminByUsername,
  listAdminUsers,
  deleteAdminUser,
  createSession,
  findSessionAdmin,
  deleteSession,
  getAdminPasswordHash,
  updateAdminPassword,
  ensureReady,
  listOperators,
  saveOperator,
  deleteOperator,
  listOperatorAbsences,
  createOperatorAbsence,
  deleteOperatorAbsence,
  getPublicAvailabilityRange,
  getPublicAvailabilityContext,
  createPublicBooking,
  listAppointments,
  deleteAppointment,
  markAppointmentReminder,
  updateAppointment,
  rescheduleAppointment,
  createAdminAppointment,
  getClientDossier,
  listClients,
  deleteClient,
  saveClient,
  listClientCards,
  createClientCard,
  useClientCard,
  deleteClientCard,
  listClientMorphoRecords,
  createClientMorphoRecord,
  deleteMorphoRecord,
  createPrivacySignatureRequest,
  getPrivacySignatureByToken,
  completePrivacySignature,
  listSuppliers,
  saveSupplier,
  deleteSupplier,
  listProducts,
  saveProduct,
  deleteProduct,
  listProductMovements,
  recordProductMovement,
  listMessageTemplates,
  saveMessageTemplate,
  listMessageLogs,
  createMessageLog,
  hasRecentMessageLog,
  getStudioSetting,
  saveStudioSetting,
  listAutomationRuns,
  hasAutomationRunForDate,
  recordAutomationRun,
  listGiftCards,
  createGiftCard,
  redeemGiftCard,
  deleteGiftCard,
  listPromotions,
  getPromotionById,
  createPromotion,
  updatePromotion,
  deletePromotion,
  getAppointmentById,
  getAppointmentByCode,
  getAppointmentByStripeSession,
  updateAppointmentStripeSession,
  getAppointmentByPayPalOrder,
  getAppointmentByPayPalCapture,
  updateAppointmentPayPalOrder,
  fallbackAppointmentToStudioPayment,
  cancelUnpaidPendingAppointment,
  listPaymentTransactions,
  recordAppointmentPayment,
  createPaymentTransaction,
  updatePaymentTransaction,
  deletePaymentTransaction,
  listCatalogData,
  listPublicCatalog,
  createCatalogCategory,
  updateCatalogCategory,
  deleteCatalogCategory,
  createCatalogService,
  updateCatalogService,
  deleteCatalogService,
  exportFullBackupSnapshot,
};
