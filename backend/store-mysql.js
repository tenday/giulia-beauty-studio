/**
 * GIULIA BEAUTY STUDIO — MySQL Store Implementation (Production / cPanel)
 */
const { isDbConfigured, getPool, ensureSchemaMigrations, applySchema } = require('./db');
const { formatRomeNow, slotOverlapsBooked, generateBookingCode } = require('./helpers');

async function healthCheck() {
  if (!isDbConfigured()) {
    return {
      ok: false,
      status: 503,
      mode: 'mysql',
      db_configured: false,
      error: 'Configurazione .env mancante.',
    };
  }
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    return { ok: true, status: 200, mode: 'mysql', db_connected: true };
  } catch {
    return {
      ok: false,
      status: 500,
      mode: 'mysql',
      db_connected: false,
      code: 'DB_CONNECTION_ERROR',
      error: 'Impossibile connettersi al database MySQL.',
    };
  }
}

async function initSchemaAndCountAdmins() {
  if (!isDbConfigured()) {
    return { configured: false, adminCount: 0, error: 'Variabili database mancanti nel file .env.' };
  }
  const pool = getPool();
  await applySchema(pool);
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM admin_users');
  return { configured: true, adminCount: Number(rows[0]?.cnt || 0) };
}

async function createInitialAdmin({ username, displayName, passwordHash }) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO admin_users (username, display_name, password_hash) VALUES (?, ?, ?)',
    [username, displayName || 'Giulia', passwordHash]
  );
}

async function findAdminByUsername(username) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, username, display_name, password_hash FROM admin_users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] || null;
}

async function createSession({ adminId, tokenHash, expiresAt }) {
  const pool = getPool();
  await ensureSchemaMigrations(pool);
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [formatRomeNow()]);
  await pool.query(
    'INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)',
    [tokenHash, adminId, expiresAt]
  );
}

async function findSessionAdmin(tokenHash, nowSql) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name
     FROM admin_sessions s
     INNER JOIN admin_users u ON u.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ?
     LIMIT 1`,
    [tokenHash, nowSql]
  );
  return rows[0] || null;
}

async function deleteSession(tokenHash) {
  if (!isDbConfigured()) return;
  const pool = getPool();
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
}

async function getAdminPasswordHash(adminId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1', [adminId]);
  return rows[0]?.password_hash || null;
}

async function updateAdminPassword(adminId, newHash) {
  const pool = getPool();
  await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, adminId]);
}

async function ensureReady() {
  await ensureSchemaMigrations(getPool());
}

async function getPublicBookedSlots(dateStr) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
     FROM appointments
     WHERE appointment_date = ?
       AND mode = 'booking'
       AND status IN ('pending', 'confirmed')`,
    [dateStr]
  );
  return rows;
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
  const pool = getPool();
  await ensureSchemaMigrations(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (mode === 'booking') {
      const [existing] = await conn.query(
        `SELECT TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
         FROM appointments
         WHERE appointment_date = ?
           AND mode = 'booking'
           AND status IN ('pending', 'confirmed')
         FOR UPDATE`,
        [appointmentDate]
      );
      if (slotOverlapsBooked(startTime, durationMinutes, existing)) {
        await conn.rollback();
        const err = new Error(
          'Spiacenti, la fascia oraria selezionata è appena stata prenotata. Scegli un altro orario disponibile.'
        );
        err.status = 409;
        err.code = 'SLOT_OCCUPIED';
        throw err;
      }
    }

    const [foundClients] = await conn.query(
      'SELECT id, email FROM clients WHERE phone_normalized = ? LIMIT 1',
      [phoneNormalized]
    );

    let clientId;
    if (foundClients.length > 0) {
      clientId = Number(foundClients[0].id);
      const finalEmail = clientEmail || foundClients[0].email || null;
      await conn.query(
        `UPDATE clients
         SET full_name = ?, phone = ?, email = ?, privacy_accepted = 1, privacy_accepted_at = ?,
             privacy_version = ?, marketing_consent = GREATEST(marketing_consent, ?)
         WHERE id = ?`,
        [clientName, clientPhoneRaw, finalEmail, nowStr, privacyVersion, marketingConsent, clientId]
      );
    } else {
      const [insClient] = await conn.query(
        `INSERT INTO clients
         (full_name, phone, phone_normalized, email, privacy_accepted, privacy_accepted_at, privacy_version, marketing_consent)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [clientName, clientPhoneRaw, phoneNormalized, clientEmail || null, nowStr, privacyVersion, marketingConsent]
      );
      clientId = Number(insClient.insertId);
    }

    const bookingCode = await generateBookingCode(conn);
    const [insAppt] = await conn.query(
      `INSERT INTO appointments
       (booking_code, client_id, appointment_date, start_time, duration_minutes, services_json, services_summary,
        total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
      [
        bookingCode,
        clientId,
        appointmentDate,
        `${startTime}:00`,
        durationMinutes,
        servicesJson,
        servicesSummary,
        totalPrice,
        mode,
        paymentMethod,
        notes || null,
        nowStr,
      ]
    );
    const appointmentId = Number(insAppt.insertId);

    await conn.query(
      `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
       VALUES (?, ?, 'privacy_terms', ?, ?, ?, ?)`,
      [clientId, appointmentId, privacyVersion, nowStr, ipHash, userAgent]
    );

    await conn.commit();
    return { bookingCode, appointmentId, clientId };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function listAppointments({ startDate, endDate, status, clientId }) {
  const where = ['1=1'];
  const params = [];

  if (startDate) {
    where.push('a.appointment_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('a.appointment_date <= ?');
    params.push(endDate);
  }
  if (status) {
    where.push('a.status = ?');
    params.push(status);
  }
  if (clientId > 0) {
    where.push('a.client_id = ?');
    params.push(clientId);
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT
        a.id, a.booking_code, a.client_id, a.appointment_date,
        TIME_FORMAT(a.start_time, '%H:%i') AS start_time,
        a.duration_minutes, a.services_json, a.services_summary, a.total_price,
        a.mode, a.payment_method, a.status, a.notes, a.reminder_sent_at,
        a.privacy_accepted, a.privacy_accepted_at, a.created_at,
        c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
        c.birth_date AS client_birth_date, c.allergies_notes, c.preferences_notes, c.privacy_version
     FROM appointments a
     INNER JOIN clients c ON c.id = a.client_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.appointment_date ASC, a.start_time ASC`,
    params
  );
  return rows;
}

async function deleteAppointment(id) {
  const pool = getPool();
  await pool.query('DELETE FROM appointments WHERE id = ?', [id]);
}

async function markAppointmentReminder(id, sentAt) {
  const pool = getPool();
  await pool.query('UPDATE appointments SET reminder_sent_at = ? WHERE id = ?', [sentAt, id]);
}

async function updateAppointment(id, { date, time, duration, servicesJson, servicesSummary, totalPrice, status, notes }) {
  const pool = getPool();
  if (servicesJson !== null) {
    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, duration_minutes = ?, services_json = ?,
           services_summary = ?, total_price = ?, status = ?, notes = ?
       WHERE id = ?`,
      [date, `${time}:00`, duration, servicesJson, servicesSummary, totalPrice, status, notes || null, id]
    );
  } else {
    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, duration_minutes = ?,
           services_summary = ?, total_price = ?, status = ?, notes = ?
       WHERE id = ?`,
      [date, `${time}:00`, duration, servicesSummary, totalPrice, status, notes || null, id]
    );
  }
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
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let resolvedClientId = clientId;
    if (resolvedClientId <= 0) {
      const [found] = await conn.query('SELECT id FROM clients WHERE phone_normalized = ? LIMIT 1', [phoneNorm]);
      if (found.length > 0) {
        resolvedClientId = Number(found[0].id);
      } else {
        const [insC] = await conn.query(
          `INSERT INTO clients
           (full_name, phone, phone_normalized, email, birth_date, preferences_notes, privacy_accepted, privacy_accepted_at, privacy_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clientName,
            clientPhone,
            phoneNorm,
            clientEmail || null,
            clientBirthDate,
            clientNotes || null,
            privacyAccepted,
            privacyAccepted ? nowStr : null,
            privacyVersion,
          ]
        );
        resolvedClientId = Number(insC.insertId);
      }
    }

    const bookingCode = await generateBookingCode(conn);
    const [insA] = await conn.query(
      `INSERT INTO appointments
       (booking_code, client_id, appointment_date, start_time, duration_minutes, services_json, services_summary,
        total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingCode,
        resolvedClientId,
        date,
        `${time}:00`,
        duration,
        servicesJson,
        servicesSummary,
        totalPrice,
        mode,
        paymentMethod,
        status,
        notes || null,
        privacyAccepted,
        nowStr,
      ]
    );
    const newApptId = Number(insA.insertId);

    if (privacyAccepted) {
      await conn.query(
        `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
         VALUES (?, ?, 'studio_manual_consent', ?, ?, ?, 'Admin Dashboard')`,
        [resolvedClientId, newApptId, privacyVersion, nowStr, ipHash]
      );
    }

    await conn.commit();
    return { id: newApptId, bookingCode, clientId: resolvedClientId };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function getClientDossier(id) {
  const pool = getPool();
  const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? LIMIT 1', [id]);
  if (!clients.length) return null;

  const [appointments] = await pool.query(
    `SELECT id, booking_code, appointment_date, TIME_FORMAT(start_time, '%H:%i') AS start_time,
            duration_minutes, services_summary, total_price, mode, payment_method, status, notes, reminder_sent_at, created_at
     FROM appointments
     WHERE client_id = ?
     ORDER BY appointment_date DESC, start_time DESC`,
    [id]
  );

  const [privacyLogs] = await pool.query(
    `SELECT id, appointment_id, consent_type, consent_version, accepted_at
     FROM privacy_logs
     WHERE client_id = ?
     ORDER BY accepted_at DESC`,
    [id]
  );

  return { client: clients[0], appointments, privacy_logs: privacyLogs };
}

async function listClients(q) {
  const pool = getPool();
  let sql = `SELECT
              c.*,
              COUNT(CASE WHEN a.status <> 'cancelled' THEN a.id END) AS appointments_count,
              COALESCE(SUM(CASE WHEN a.status <> 'cancelled' THEN a.total_price ELSE 0 END), 0) AS total_spent,
              MAX(CASE WHEN a.status <> 'cancelled' THEN a.appointment_date END) AS last_visit
            FROM clients c
            LEFT JOIN appointments a ON a.client_id = c.id`;
  const params = [];
  if (q) {
    const like = `%${q}%`;
    sql += ' WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.allergies_notes LIKE ? OR c.preferences_notes LIKE ?';
    params.push(like, like, like, like, like);
  }
  sql += ' GROUP BY c.id ORDER BY c.full_name ASC';
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function deleteClient(id) {
  const pool = getPool();
  await pool.query('DELETE FROM clients WHERE id = ?', [id]);
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
  const pool = getPool();
  try {
    if (id > 0) {
      const [curRows] = await pool.query(
        'SELECT privacy_accepted, privacy_accepted_at FROM clients WHERE id = ? LIMIT 1',
        [id]
      );
      if (!curRows.length) {
        const err = new Error('Cliente non trovata.');
        err.status = 404;
        throw err;
      }

      const cur = curRows[0];
      let acceptedAt = cur.privacy_accepted_at;
      if (privacyAccepted && !cur.privacy_accepted) acceptedAt = nowStr;
      else if (!privacyAccepted) acceptedAt = null;

      await pool.query(
        `UPDATE clients
         SET full_name = ?, phone = ?, phone_normalized = ?, email = ?, birth_date = ?,
             allergies_notes = ?, preferences_notes = ?, privacy_accepted = ?, privacy_accepted_at = ?,
             privacy_version = ?, marketing_consent = ?
         WHERE id = ?`,
        [
          fullName,
          phoneRaw,
          phoneNorm,
          email || null,
          birthDate,
          allergiesNotes || null,
          preferencesNotes || null,
          privacyAccepted,
          acceptedAt,
          privacyVersion,
          marketingConsent,
          id,
        ]
      );

      if (privacyAccepted && !cur.privacy_accepted) {
        await pool.query(
          `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
           VALUES (?, NULL, 'studio_crm_update', ?, ?, ?, 'Admin CRM')`,
          [id, privacyVersion, nowStr, ipHash]
        );
      }

      return { id, status: 200 };
    }

    const [ins] = await pool.query(
      `INSERT INTO clients
       (full_name, phone, phone_normalized, email, birth_date, allergies_notes, preferences_notes,
        privacy_accepted, privacy_accepted_at, privacy_version, marketing_consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        phoneRaw,
        phoneNorm,
        email || null,
        birthDate,
        allergiesNotes || null,
        preferencesNotes || null,
        privacyAccepted,
        privacyAccepted ? nowStr : null,
        privacyVersion,
        marketingConsent,
      ]
    );
    const newId = Number(ins.insertId);

    if (privacyAccepted) {
      await pool.query(
        `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
         VALUES (?, NULL, 'studio_crm_create', ?, ?, ?, 'Admin CRM')`,
        [newId, privacyVersion, nowStr, ipHash]
      );
    }

    return { id: newId, status: 201 };
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      const dupErr = new Error('Esiste già una cliente registrata con questo numero di telefono.');
      dupErr.status = 409;
      throw dupErr;
    }
    throw err;
  }
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
