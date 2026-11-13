/**
 * GIULIA BEAUTY STUDIO — Persistent Local JSON Store (ONLY for local testing when MySQL is unavailable)
 * Active ONLY when DB_MODE=local in .env
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatRomeNow, getRomeNowParts } = require('./helpers');
const { getAvailableOperatorsForSlot } = require('./availability');
const { getDefaultOperatorPayload, DEFAULT_MESSAGE_TEMPLATES } = require('./defaults');

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
  }
  if (state.message_templates.length === 0) {
    const now = formatRomeNow();
    for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
      state.message_templates.push({
        id: nextId(state, 'template'),
        ...tpl,
        updated_at: now,
      });
    }
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
async function getPublicAvailabilityContext(dateStr) {
  const db = readDb();
  const bookedRows = db.appointments
    .filter(
      (a) =>
        a.appointment_date === dateStr &&
        a.mode === 'booking' &&
        (a.status === 'pending' || a.status === 'confirmed')
    )
    .map((a) => ({
      operator_id: a.operator_id || null,
      start_time: String(a.start_time).slice(0, 5),
      duration_minutes: a.duration_minutes,
    }));

  const absences = db.operator_absences.filter(
    (abs) => dateStr >= abs.start_date && dateStr <= abs.end_date
  );

  return {
    operators: db.operators.filter((o) => Number(o.active) !== 0),
    absences,
    bookedRows,
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
  { date, time, duration, operatorId, servicesJson, servicesSummary, totalPrice, status, notes }
) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (!appt) return;
  appt.appointment_date = date;
  appt.start_time = `${time}:00`;
  appt.duration_minutes = duration;
  if (operatorId !== undefined) appt.operator_id = operatorId || null;
  if (servicesJson !== null) appt.services_json = servicesJson;
  appt.services_summary = servicesSummary;
  appt.total_price = Number(totalPrice).toFixed(2);
  appt.status = status;
  appt.notes = notes || null;
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
    status,
    notes: notes || null,
    reminder_sent_at: null,
    privacy_accepted: privacyAccepted ? 1 : 0,
    privacy_accepted_at: nowStr,
    created_at: nowStr,
    updated_at: nowStr,
  });

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

async function saveMessageTemplate({ code, title, bodyTemplate }) {
  const db = readDb();
  const now = formatRomeNow();
  const existing = db.message_templates.find((t) => t.code === code);
  if (existing) {
    if (title) existing.title = title;
    existing.body_template = bodyTemplate;
    existing.updated_at = now;
    writeDb(db);
    return existing;
  }
  const created = {
    id: nextId(db, 'template'),
    code,
    title: title || code,
    body_template: bodyTemplate,
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
    sent_by_admin_id: adminId || null,
    sent_at: now,
  };
  db.message_logs.push(log);
  writeDb(db);
  return log;
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
};
