/**
 * GIULIA BEAUTY STUDIO — Persistent Local JSON Store (ONLY for local testing when MySQL is unavailable)
 * Active ONLY when DB_MODE=local in .env
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatRomeNow, slotOverlapsBooked } = require('./helpers');

const DB_FILE = path.resolve(process.cwd(), process.env.LOCAL_DB_FILE || '.local-dev-db.json');

function defaultState() {
  return {
    counters: { admin: 0, client: 0, appointment: 0, privacy_log: 0 },
    admin_users: [],
    admin_sessions: [],
    clients: [],
    appointments: [],
    privacy_logs: [],
  };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = defaultState();
    writeDb(initial);
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function writeDb(state) {
  fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function nextId(state, key) {
  state.counters[key] = (state.counters[key] || 0) + 1;
  return state.counters[key];
}

function nextBookingCode(state) {
  for (let i = 0; i < 10; i += 1) {
    const code = `GBS-${crypto.randomInt(100000, 1000000)}`;
    if (!state.appointments.some((a) => a.booking_code === code)) return code;
  }
  return `GBS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function healthCheck() {
  const db = readDb();
  return {
    ok: true,
    status: 200,
    mode: 'local',
    db_connected: true,
    admins_count: db.admin_users.length,
    clients_count: db.clients.length,
    appointments_count: db.appointments.length,
  };
}

async function initSchemaAndCountAdmins() {
  const db = readDb();
  return { configured: true, adminCount: db.admin_users.length };
}

async function createInitialAdmin({ username, displayName, passwordHash }) {
  const db = readDb();
  const id = nextId(db, 'admin');
  const now = formatRomeNow();
  db.admin_users.push({
    id,
    username,
    display_name: displayName || 'Giulia',
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
  });
  writeDb(db);
}

async function findAdminByUsername(username) {
  const db = readDb();
  return db.admin_users.find((u) => u.username === username) || null;
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
  return { id: user.id, username: user.username, display_name: user.display_name };
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

async function getPublicBookedSlots(dateStr) {
  const db = readDb();
  return db.appointments
    .filter(
      (a) =>
        a.appointment_date === dateStr &&
        a.mode === 'booking' &&
        (a.status === 'pending' || a.status === 'confirmed')
    )
    .map((a) => ({
      start_time: String(a.start_time).slice(0, 5),
      duration_minutes: a.duration_minutes,
    }));
}

async function createPublicBooking({
  mode,
  appointmentDate,
  startTime,
  durationMinutes,
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

  if (mode === 'booking') {
    const existing = db.appointments
      .filter(
        (a) =>
          a.appointment_date === appointmentDate &&
          a.mode === 'booking' &&
          (a.status === 'pending' || a.status === 'confirmed')
      )
      .map((a) => ({ start_time: String(a.start_time).slice(0, 5), duration_minutes: a.duration_minutes }));

    if (slotOverlapsBooked(startTime, durationMinutes, existing)) {
      const err = new Error(
        'Spiacenti, la fascia oraria selezionata è appena stata prenotata. Scegli un altro orario disponibile.'
      );
      err.status = 409;
      err.code = 'SLOT_OCCUPIED';
      throw err;
    }
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
  return { bookingCode, appointmentId, clientId: client.id };
}

async function listAppointments({ startDate, endDate, status, clientId }) {
  const db = readDb();
  const clientMap = new Map(db.clients.map((c) => [Number(c.id), c]));

  return db.appointments
    .filter((a) => {
      if (startDate && a.appointment_date < startDate) return false;
      if (endDate && a.appointment_date > endDate) return false;
      if (status && a.status !== status) return false;
      if (clientId > 0 && Number(a.client_id) !== Number(clientId)) return false;
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
      return {
        ...a,
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

async function updateAppointment(id, { date, time, duration, servicesJson, servicesSummary, totalPrice, status, notes }) {
  const db = readDb();
  const appt = db.appointments.find((a) => Number(a.id) === Number(id));
  if (!appt) return;
  appt.appointment_date = date;
  appt.start_time = `${time}:00`;
  appt.duration_minutes = duration;
  if (servicesJson !== null) appt.services_json = servicesJson;
  appt.services_summary = servicesSummary;
  appt.total_price = Number(totalPrice).toFixed(2);
  appt.status = status;
  appt.notes = notes || null;
  appt.updated_at = formatRomeNow();
  writeDb(db);
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

  const newApptId = nextId(db, 'appointment');
  const bookingCode = nextBookingCode(db);
  db.appointments.push({
    id: newApptId,
    booking_code: bookingCode,
    client_id: resolvedClientId,
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

async function getClientDossier(id) {
  const db = readDb();
  const client = db.clients.find((c) => Number(c.id) === Number(id));
  if (!client) return null;

  const appointments = db.appointments
    .filter((a) => Number(a.client_id) === Number(id))
    .sort((a, b) => (a.appointment_date > b.appointment_date ? -1 : a.appointment_date < b.appointment_date ? 1 : String(b.start_time).localeCompare(String(a.start_time))))
    .map((a) => ({ ...a, start_time: String(a.start_time).slice(0, 5) }));

  const privacyLogs = db.privacy_logs
    .filter((l) => Number(l.client_id) === Number(id))
    .sort((a, b) => (a.accepted_at > b.accepted_at ? -1 : 1));

  return { client, appointments, privacy_logs: privacyLogs };
}

async function listClients(q) {
  const db = readDb();
  const needle = String(q || '').toLowerCase();

  return db.clients
    .filter((c) => {
      if (!needle) return true;
      return [c.full_name, c.phone, c.email, c.allergies_notes, c.preferences_notes]
        .some((field) => String(field || '').toLowerCase().includes(needle));
    })
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
    .map((c) => {
      const activeAppts = db.appointments.filter(
        (a) => Number(a.client_id) === Number(c.id) && a.status !== 'cancelled'
      );
      const totalSpent = activeAppts.reduce((sum, a) => sum + Number(a.total_price || 0), 0);
      const lastVisit = activeAppts.reduce(
        (maxD, a) => (!maxD || a.appointment_date > maxD ? a.appointment_date : maxD),
        null
      );
      return {
        ...c,
        appointments_count: activeAppts.length,
        total_spent: totalSpent.toFixed(2),
        last_visit: lastVisit,
      };
    });
}

async function deleteClient(id) {
  const db = readDb();
  db.clients = db.clients.filter((c) => Number(c.id) !== Number(id));
  db.appointments = db.appointments.filter((a) => Number(a.client_id) !== Number(id));
  db.privacy_logs = db.privacy_logs.filter((l) => Number(l.client_id) !== Number(id));
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

module.exports = {
  healthCheck,
  initSchemaAndCountAdmins,
  createInitialAdmin,
  findAdminByUsername,
  createSession,
  findSessionAdmin,
  deleteSession,
  getAdminPasswordHash,
  updateAdminPassword,
  ensureReady,
  getPublicBookedSlots,
  createPublicBooking,
  listAppointments,
  deleteAppointment,
  markAppointmentReminder,
  updateAppointment,
  createAdminAppointment,
  getClientDossier,
  listClients,
  deleteClient,
  saveClient,
};
