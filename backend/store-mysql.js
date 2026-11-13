/**
 * GIULIA BEAUTY STUDIO — MySQL Store Implementation (Production / cPanel)
 */
const crypto = require('crypto');
const { isDbConfigured, getPool, ensureSchemaMigrations, applySchema } = require('./db');
const { formatRomeNow, getRomeNowParts, generateBookingCode } = require('./helpers');
const { getAvailableOperatorsForSlot } = require('./availability');
const { getDefaultOperatorPayload, DEFAULT_MESSAGE_TEMPLATES } = require('./defaults');

let defaultsSeeded = false;

async function ensureDefaults(targetPool = getPool()) {
  if (defaultsSeeded) return;
  await ensureSchemaMigrations(targetPool);

  const [opRows] = await targetPool.query('SELECT COUNT(*) AS cnt FROM operators');
  if (Number(opRows[0]?.cnt || 0) === 0) {
    const def = getDefaultOperatorPayload();
    await targetPool.query(
      'INSERT INTO operators (name, role, color, active, weekly_schedule_json) VALUES (?, ?, ?, ?, ?)',
      [def.name, def.role, def.color, def.active, def.weekly_schedule_json]
    );
  }

  for (const tpl of DEFAULT_MESSAGE_TEMPLATES) {
    await targetPool.query(
      `INSERT IGNORE INTO message_templates (code, title, body_template) VALUES (?, ?, ?)`,
      [tpl.code, tpl.title, tpl.body_template]
    );
  }
  defaultsSeeded = true;
}

/* ============================================================================
   HEALTH, AUTH & USERS
   ============================================================================ */
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
  await ensureDefaults(pool);
  const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM admin_users');
  return { configured: true, adminCount: Number(rows[0]?.cnt || 0) };
}

async function createInitialAdmin({ username, displayName, passwordHash, role = 'owner' }) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [ins] = await pool.query(
    'INSERT INTO admin_users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)',
    [username, displayName || 'Giulia', role, passwordHash]
  );
  return Number(ins.insertId);
}

async function findAdminByUsername(username) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, username, display_name, role, password_hash FROM admin_users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] || null;
}

async function listAdminUsers() {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    'SELECT id, username, display_name, role, created_at FROM admin_users ORDER BY id ASC'
  );
  return rows;
}

async function deleteAdminUser(id) {
  const pool = getPool();
  const [cnt] = await pool.query('SELECT COUNT(*) AS cnt FROM admin_users');
  if (Number(cnt[0]?.cnt || 0) <= 1) {
    const err = new Error("Impossibile eliminare l'unico account amministratore.");
    err.status = 400;
    throw err;
  }
  await pool.query('DELETE FROM admin_users WHERE id = ?', [id]);
}

async function createSession({ adminId, tokenHash, expiresAt }) {
  const pool = getPool();
  await ensureDefaults(pool);
  await pool.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [formatRomeNow()]);
  await pool.query(
    'INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)',
    [tokenHash, adminId, expiresAt]
  );
}

async function findSessionAdmin(tokenHash, nowSql) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.role
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
  await ensureDefaults(getPool());
}

/* ============================================================================
   OPERATORS & ABSENCES
   ============================================================================ */
async function listOperators(onlyActive = false) {
  const pool = getPool();
  await ensureDefaults(pool);
  const sql = onlyActive
    ? 'SELECT * FROM operators WHERE active = 1 ORDER BY id ASC'
    : 'SELECT * FROM operators ORDER BY id ASC';
  const [rows] = await pool.query(sql);
  return rows;
}

async function saveOperator({ id, name, role, color, active, weeklyScheduleJson }) {
  const pool = getPool();
  await ensureDefaults(pool);
  if (id > 0) {
    const [res] = await pool.query(
      'UPDATE operators SET name = ?, role = ?, color = ?, active = ?, weekly_schedule_json = ? WHERE id = ?',
      [name, role, color, active ? 1 : 0, weeklyScheduleJson, id]
    );
    if (res.affectedRows === 0) {
      const err = new Error('Operatore non trovato.');
      err.status = 404;
      throw err;
    }
    return { id, status: 200 };
  }
  const [ins] = await pool.query(
    'INSERT INTO operators (name, role, color, active, weekly_schedule_json) VALUES (?, ?, ?, ?, ?)',
    [name, role, color, active ? 1 : 0, weeklyScheduleJson]
  );
  return { id: Number(ins.insertId), status: 201 };
}

async function deleteOperator(id) {
  const pool = getPool();
  const [cnt] = await pool.query('SELECT COUNT(*) AS cnt FROM operators');
  if (Number(cnt[0]?.cnt || 0) <= 1) {
    const err = new Error('Deve rimanere almeno un operatore attivo in studio.');
    err.status = 400;
    throw err;
  }
  await pool.query('UPDATE appointments SET operator_id = NULL WHERE operator_id = ?', [id]);
  await pool.query('DELETE FROM operators WHERE id = ?', [id]);
}

async function listOperatorAbsences(operatorId = 0) {
  const pool = getPool();
  await ensureDefaults(pool);
  let sql = `SELECT a.*, TIME_FORMAT(a.start_time, '%H:%i') AS start_time,
                    TIME_FORMAT(a.end_time, '%H:%i') AS end_time,
                    o.name AS operator_name
             FROM operator_absences a
             INNER JOIN operators o ON o.id = a.operator_id`;
  const params = [];
  if (operatorId > 0) {
    sql += ' WHERE a.operator_id = ?';
    params.push(operatorId);
  }
  sql += ' ORDER BY a.start_date DESC, a.id DESC';
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function createOperatorAbsence({ operatorId, startDate, endDate, startTime, endTime, type, notes }) {
  const pool = getPool();
  const [ins] = await pool.query(
    `INSERT INTO operator_absences (operator_id, start_date, end_date, start_time, end_time, type, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      operatorId,
      startDate,
      endDate,
      startTime ? `${startTime}:00` : null,
      endTime ? `${endTime}:00` : null,
      type || 'ferie',
      notes || null,
    ]
  );
  return Number(ins.insertId);
}

async function deleteOperatorAbsence(id) {
  const pool = getPool();
  await pool.query('DELETE FROM operator_absences WHERE id = ?', [id]);
}

/* ============================================================================
   PUBLIC SLOTS & BOOKING
   ============================================================================ */
async function getPublicAvailabilityContext(dateStr) {
  const pool = getPool();
  await ensureDefaults(pool);

  const [operators] = await pool.query('SELECT * FROM operators WHERE active = 1 ORDER BY id ASC');
  const [absences] = await pool.query(
    `SELECT id, operator_id, start_date, end_date,
            TIME_FORMAT(start_time, '%H:%i') AS start_time,
            TIME_FORMAT(end_time, '%H:%i') AS end_time, type
     FROM operator_absences
     WHERE start_date <= ? AND end_date >= ?`,
    [dateStr, dateStr]
  );
  const [bookedRows] = await pool.query(
    `SELECT operator_id, TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
     FROM appointments
     WHERE appointment_date = ?
       AND mode = 'booking'
       AND status IN ('pending', 'confirmed')`,
    [dateStr]
  );
  return { operators, absences, bookedRows };
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
  const pool = getPool();
  await ensureDefaults(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [activeOps] = await conn.query('SELECT * FROM operators WHERE active = 1 ORDER BY id ASC');
    let resolvedOperatorId = activeOps[0]?.id ? Number(activeOps[0].id) : null;

    if (mode === 'booking') {
      const [existing] = await conn.query(
        `SELECT operator_id, TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
         FROM appointments
         WHERE appointment_date = ?
           AND mode = 'booking'
           AND status IN ('pending', 'confirmed')
         FOR UPDATE`,
        [appointmentDate]
      );
      const [absences] = await conn.query(
        `SELECT operator_id, start_date, end_date,
                TIME_FORMAT(start_time, '%H:%i') AS start_time,
                TIME_FORMAT(end_time, '%H:%i') AS end_time
         FROM operator_absences
         WHERE start_date <= ? AND end_date >= ?`,
        [appointmentDate, appointmentDate]
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
        await conn.rollback();
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
       (booking_code, client_id, operator_id, appointment_date, start_time, duration_minutes, services_json, services_summary,
        total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?)`,
      [
        bookingCode,
        clientId,
        resolvedOperatorId,
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
    return { bookingCode, appointmentId, clientId, operatorId: resolvedOperatorId };
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

/* ============================================================================
   ADMIN APPOINTMENTS
   ============================================================================ */
async function listAppointments({ startDate, endDate, status, clientId, operatorId = 0 }) {
  const pool = getPool();
  await ensureDefaults(pool);

  const [firstOpRows] = await pool.query('SELECT id, name, color FROM operators ORDER BY id ASC LIMIT 1');
  const primaryOp = firstOpRows[0] || { id: null, name: 'Giulia', color: '#d47491' };

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
  if (operatorId > 0) {
    if (Number(operatorId) === Number(primaryOp.id)) {
      where.push('(a.operator_id = ? OR a.operator_id IS NULL)');
      params.push(operatorId);
    } else {
      where.push('a.operator_id = ?');
      params.push(operatorId);
    }
  }

  const [rows] = await pool.query(
    `SELECT
        a.id, a.booking_code, a.client_id,
        COALESCE(a.operator_id, ?) AS operator_id,
        COALESCE(o.name, ?) AS operator_name,
        COALESCE(o.color, ?) AS operator_color,
        a.appointment_date,
        TIME_FORMAT(a.start_time, '%H:%i') AS start_time,
        a.duration_minutes, a.services_json, a.services_summary, a.total_price,
        a.mode, a.payment_method, a.status, a.notes, a.reminder_sent_at,
        a.privacy_accepted, a.privacy_accepted_at, a.created_at,
        c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
        c.birth_date AS client_birth_date, c.allergies_notes, c.preferences_notes, c.privacy_version
     FROM appointments a
     INNER JOIN clients c ON c.id = a.client_id
     LEFT JOIN operators o ON o.id = a.operator_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.appointment_date ASC, a.start_time ASC`,
    [primaryOp.id, primaryOp.name, primaryOp.color, ...params]
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

async function updateAppointment(
  id,
  { date, time, duration, operatorId, servicesJson, servicesSummary, totalPrice, status, notes }
) {
  const pool = getPool();
  const hasOp = operatorId !== undefined;
  if (servicesJson !== null) {
    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, duration_minutes = ?, ${hasOp ? 'operator_id = ?,' : ''}
           services_json = ?, services_summary = ?, total_price = ?, status = ?, notes = ?
       WHERE id = ?`,
      hasOp
        ? [date, `${time}:00`, duration, operatorId || null, servicesJson, servicesSummary, totalPrice, status, notes || null, id]
        : [date, `${time}:00`, duration, servicesJson, servicesSummary, totalPrice, status, notes || null, id]
    );
  } else {
    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, duration_minutes = ?, ${hasOp ? 'operator_id = ?,' : ''}
           services_summary = ?, total_price = ?, status = ?, notes = ?
       WHERE id = ?`,
      hasOp
        ? [date, `${time}:00`, duration, operatorId || null, servicesSummary, totalPrice, status, notes || null, id]
        : [date, `${time}:00`, duration, servicesSummary, totalPrice, status, notes || null, id]
    );
  }
}

async function rescheduleAppointment(id, { date, time, duration, operatorId, status }) {
  const pool = getPool();
  const sets = ['appointment_date = ?', 'start_time = ?', 'duration_minutes = ?'];
  const params = [date, `${time}:00`, duration];
  if (operatorId !== undefined) {
    sets.push('operator_id = ?');
    params.push(operatorId || null);
  }
  if (status !== undefined) {
    sets.push('status = ?');
    params.push(status);
  }
  params.push(id);
  const [result] = await pool.query(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`, params);
  return Number(result?.affectedRows || 0) > 0;
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
  const pool = getPool();
  await ensureDefaults(pool);
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

    let resolvedOpId = operatorId;
    if (!resolvedOpId) {
      const [firstOp] = await conn.query('SELECT id FROM operators ORDER BY id ASC LIMIT 1');
      resolvedOpId = firstOp[0]?.id ? Number(firstOp[0].id) : null;
    }

    const bookingCode = await generateBookingCode(conn);
    const [insA] = await conn.query(
      `INSERT INTO appointments
       (booking_code, client_id, operator_id, appointment_date, start_time, duration_minutes, services_json, services_summary,
        total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingCode,
        resolvedClientId,
        resolvedOpId,
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

/* ============================================================================
   CLIENTS, CARDS, MORPHO & PRIVACY OTP SIGNATURE
   ============================================================================ */
async function getClientDossier(id) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? LIMIT 1', [id]);
  if (!clients.length) return null;

  const [appointments] = await pool.query(
    `SELECT a.id, a.booking_code, a.appointment_date, TIME_FORMAT(a.start_time, '%H:%i') AS start_time,
            a.duration_minutes, a.services_summary, a.total_price, a.mode, a.payment_method, a.status,
            a.notes, a.reminder_sent_at, a.created_at, COALESCE(o.name, 'Giulia') AS operator_name
     FROM appointments a
     LEFT JOIN operators o ON o.id = a.operator_id
     WHERE a.client_id = ?
     ORDER BY a.appointment_date DESC, a.start_time DESC`,
    [id]
  );

  const [privacyLogs] = await pool.query(
    `SELECT id, appointment_id, consent_type, consent_version, accepted_at
     FROM privacy_logs
     WHERE client_id = ?
     ORDER BY accepted_at DESC`,
    [id]
  );

  const [cards] = await pool.query(
    'SELECT * FROM client_cards WHERE client_id = ? ORDER BY created_at DESC',
    [id]
  );

  const [morphoRecords] = await pool.query(
    'SELECT * FROM client_morpho_records WHERE client_id = ? ORDER BY recorded_at DESC, id DESC',
    [id]
  );

  const [signatureRequests] = await pool.query(
    `SELECT id, token, privacy_version, status, signed_at, signature_name, otp_expires_at, created_at
     FROM privacy_signature_requests
     WHERE client_id = ?
     ORDER BY created_at DESC`,
    [id]
  );

  return {
    client: clients[0],
    appointments,
    privacy_logs: privacyLogs,
    cards,
    morpho_records: morphoRecords,
    signature_requests: signatureRequests,
  };
}

async function listClients(q) {
  const pool = getPool();
  await ensureDefaults(pool);
  let sql = `SELECT
              c.*,
              COUNT(DISTINCT CASE WHEN a.status <> 'cancelled' THEN a.id END) AS appointments_count,
              COALESCE(SUM(DISTINCT CASE WHEN a.status <> 'cancelled' THEN a.total_price ELSE 0 END), 0) AS appts_spent,
              MAX(CASE WHEN a.status <> 'cancelled' THEN a.appointment_date END) AS last_visit,
              (SELECT COUNT(*) FROM client_cards cc WHERE cc.client_id = c.id AND cc.status = 'active') AS active_cards_count,
              (SELECT COUNT(*) FROM client_morpho_records cm WHERE cm.client_id = c.id) AS morpho_count
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

  const [salesRows] = await pool.query(
    `SELECT client_id, COALESCE(SUM(total_amount), 0) AS prod_spent
     FROM product_movements
     WHERE client_id IS NOT NULL AND movement_type = 'sale'
     GROUP BY client_id`
  );
  const salesMap = new Map(salesRows.map((r) => [Number(r.client_id), Number(r.prod_spent || 0)]));

  return rows.map((r) => ({
    ...r,
    total_spent: (Number(r.appts_spent || 0) + (salesMap.get(Number(r.id)) || 0)).toFixed(2),
  }));
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

/* --- Client Cards & Packages --- */
async function listClientCards(clientId = 0) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    clientId > 0
      ? 'SELECT * FROM client_cards WHERE client_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM client_cards ORDER BY created_at DESC',
    clientId > 0 ? [clientId] : []
  );
  return rows;
}

async function createClientCard({ clientId, title, cardType, totalSessions, remainingCredit, expiresAt, notes }) {
  const pool = getPool();
  const [ins] = await pool.query(
    `INSERT INTO client_cards (client_id, title, card_type, total_sessions, used_sessions, remaining_credit, expires_at, status, notes)
     VALUES (?, ?, ?, ?, 0, ?, ?, 'active', ?)`,
    [clientId, title, cardType || 'package', Number(totalSessions || 0), Number(remainingCredit || 0), expiresAt || null, notes || null]
  );
  const [rows] = await pool.query('SELECT * FROM client_cards WHERE id = ?', [ins.insertId]);
  return rows[0];
}

async function useClientCard(cardId, { sessionsDelta = 1, creditDelta = 0 } = {}) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM client_cards WHERE id = ? LIMIT 1', [cardId]);
  if (!rows.length) {
    const err = new Error('Carta/Pacchetto non trovato.');
    err.status = 404;
    throw err;
  }
  const card = rows[0];
  let used = Number(card.used_sessions || 0);
  const total = Number(card.total_sessions || 0);
  let credit = Number(card.remaining_credit || 0);
  let status = card.status;

  if (total > 0) {
    used = Math.min(total, Math.max(0, used + Number(sessionsDelta)));
  }
  if (Number(creditDelta) > 0) {
    credit = Math.max(0, credit - Number(creditDelta));
  }
  if ((total > 0 && used >= total) && credit <= 0) {
    status = 'completed';
  }
  await pool.query(
    'UPDATE client_cards SET used_sessions = ?, remaining_credit = ?, status = ? WHERE id = ?',
    [used, credit.toFixed(2), status, cardId]
  );
  const [updated] = await pool.query('SELECT * FROM client_cards WHERE id = ?', [cardId]);
  return updated[0];
}

async function deleteClientCard(cardId) {
  const pool = getPool();
  await pool.query('DELETE FROM client_cards WHERE id = ?', [cardId]);
}

/* --- Morphological & Body Measurements --- */
async function listClientMorphoRecords(clientId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM client_morpho_records WHERE client_id = ? ORDER BY recorded_at DESC, id DESC',
    [clientId]
  );
  return rows;
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
  const pool = getPool();
  const [ins] = await pool.query(
    `INSERT INTO client_morpho_records
     (client_id, recorded_at, gender, weight_kg, height_cm, bmi, measurements_json, annotations_json, photos_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clientId,
      recordedAt,
      gender === 'male' ? 'male' : 'female',
      weightKg ?? null,
      heightCm ?? null,
      bmi ?? null,
      measurementsJson || '{}',
      annotationsJson || '[]',
      photosJson || '[]',
      notes || null,
    ]
  );
  const [rows] = await pool.query('SELECT * FROM client_morpho_records WHERE id = ?', [ins.insertId]);
  return rows[0];
}

async function deleteMorphoRecord(id) {
  const pool = getPool();
  await pool.query('DELETE FROM client_morpho_records WHERE id = ?', [id]);
}

/* --- Mobile Privacy Signature with OTP --- */
async function createPrivacySignatureRequest({ clientId, privacyVersion }) {
  const pool = getPool();
  const [cRows] = await pool.query('SELECT id, full_name, phone FROM clients WHERE id = ? LIMIT 1', [clientId]);
  if (!cRows.length) {
    const err = new Error('Cliente non trovata.');
    err.status = 404;
    throw err;
  }
  const client = cRows[0];
  const token = crypto.randomBytes(16).toString('hex');
  const otpCode = String(crypto.randomInt(100000, 1000000));
  const expiresAt = getRomeNowParts(7 * 24 * 60 * 60 * 1000).datetime;

  const [ins] = await pool.query(
    `INSERT INTO privacy_signature_requests (client_id, token, otp_code, otp_expires_at, privacy_version, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [clientId, token, otpCode, expiresAt, privacyVersion]
  );
  return {
    id: Number(ins.insertId),
    token,
    otp_code: otpCode,
    otp_expires_at: expiresAt,
    privacy_version: privacyVersion,
    client,
  };
}

async function getPrivacySignatureByToken(token) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT r.id, r.client_id, r.privacy_version, r.status, r.otp_expires_at, r.signed_at,
            c.full_name AS client_name, c.phone AS client_phone
     FROM privacy_signature_requests r
     INNER JOIN clients c ON c.id = r.client_id
     WHERE r.token = ? LIMIT 1`,
    [token]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    client_id: r.client_id,
    client_name: r.client_name,
    client_phone_masked: String(r.client_phone || '').replace(/\d(?=\d{3})/g, '*'),
    privacy_version: r.privacy_version,
    status: r.status,
    otp_expires_at: r.otp_expires_at,
    signed_at: r.signed_at,
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
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM privacy_signature_requests WHERE token = ? LIMIT 1 FOR UPDATE', [token]);
    if (!rows.length) {
      const err = new Error('Link di firma non trovato o non valido.');
      err.status = 404;
      throw err;
    }
    const reqObj = rows[0];
    if (reqObj.status === 'signed') {
      const err = new Error('Questo modulo privacy risulta già firmato.');
      err.status = 400;
      throw err;
    }
    if (reqObj.otp_expires_at < nowStr) {
      await conn.query("UPDATE privacy_signature_requests SET status = 'expired' WHERE id = ?", [reqObj.id]);
      await conn.commit();
      const err = new Error('Richiesta scaduta. Chiedi allo studio un nuovo link.');
      err.status = 410;
      throw err;
    }
    if (Number(reqObj.otp_attempts) >= 5) {
      const err = new Error('Troppi tentativi OTP errati. Richiedi un nuovo codice allo studio.');
      err.status = 429;
      throw err;
    }
    if (String(otpCode || '').trim() !== String(reqObj.otp_code)) {
      await conn.query('UPDATE privacy_signature_requests SET otp_attempts = otp_attempts + 1 WHERE id = ?', [reqObj.id]);
      await conn.commit();
      const err = new Error('Codice OTP non corretto. Controlla il messaggio ricevuto.');
      err.status = 400;
      throw err;
    }

    await conn.query(
      `UPDATE privacy_signature_requests
       SET status = 'signed', signature_name = ?, signature_data = ?, signed_at = ?, ip_hash = ?, user_agent = ?
       WHERE id = ?`,
      [signatureName, signatureData || null, nowStr, ipHash, userAgent, reqObj.id]
    );
    await conn.query(
      `UPDATE clients
       SET privacy_accepted = 1, privacy_accepted_at = ?, privacy_version = ?,
           marketing_consent = GREATEST(marketing_consent, ?)
       WHERE id = ?`,
      [nowStr, reqObj.privacy_version, marketingConsent ? 1 : 0, reqObj.client_id]
    );
    await conn.query(
      `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
       VALUES (?, NULL, 'mobile_otp_signature', ?, ?, ?, ?)`,
      [reqObj.client_id, reqObj.privacy_version, nowStr, ipHash, userAgent]
    );
    await conn.commit();
    return { ok: true, signed_at: nowStr, privacy_version: reqObj.privacy_version };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    conn.release();
  }
}

/* ============================================================================
   INVENTORY (SUPPLIERS, PRODUCTS & MOVEMENTS)
   ============================================================================ */
async function listSuppliers() {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query('SELECT * FROM suppliers ORDER BY name ASC');
  return rows;
}

async function saveSupplier({ id, name, contactName, phone, email, notes }) {
  const pool = getPool();
  if (id > 0) {
    await pool.query(
      'UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, notes = ? WHERE id = ?',
      [name, contactName || null, phone || null, email || null, notes || null, id]
    );
    return { id, status: 200 };
  }
  const [ins] = await pool.query(
    'INSERT INTO suppliers (name, contact_name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
    [name, contactName || null, phone || null, email || null, notes || null]
  );
  return { id: Number(ins.insertId), status: 201 };
}

async function deleteSupplier(id) {
  const pool = getPool();
  await pool.query('UPDATE products SET supplier_id = NULL WHERE supplier_id = ?', [id]);
  await pool.query('DELETE FROM suppliers WHERE id = ?', [id]);
}

async function listProducts() {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    `SELECT p.*, s.name AS supplier_name
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     ORDER BY p.name ASC`
  );
  return rows;
}

async function saveProduct({ id, sku, name, category, supplierId, costPrice, sellPrice, stockQty, minStockQty, unit, active }) {
  const pool = getPool();
  if (id > 0) {
    await pool.query(
      `UPDATE products
       SET sku = ?, name = ?, category = ?, supplier_id = ?, cost_price = ?, sell_price = ?,
           stock_qty = ?, min_stock_qty = ?, unit = ?, active = ?
       WHERE id = ?`,
      [
        sku || null,
        name,
        category || 'Rivendita',
        supplierId || null,
        Number(costPrice || 0),
        Number(sellPrice || 0),
        Number(stockQty || 0),
        Number(minStockQty ?? 2),
        unit || 'pz',
        active !== undefined ? (active ? 1 : 0) : 1,
        id,
      ]
    );
    return { id, status: 200 };
  }
  const [ins] = await pool.query(
    `INSERT INTO products (sku, name, category, supplier_id, cost_price, sell_price, stock_qty, min_stock_qty, unit, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sku || null,
      name,
      category || 'Rivendita',
      supplierId || null,
      Number(costPrice || 0),
      Number(sellPrice || 0),
      Number(stockQty || 0),
      Number(minStockQty ?? 2),
      unit || 'pz',
      active !== undefined ? (active ? 1 : 0) : 1,
    ]
  );
  return { id: Number(ins.insertId), status: 201 };
}

async function deleteProduct(id) {
  const pool = getPool();
  await pool.query('DELETE FROM products WHERE id = ?', [id]);
}

async function listProductMovements(limit = 100) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    `SELECT m.*, COALESCE(p.name, 'Prodotto') AS product_name, c.full_name AS client_name
     FROM product_movements m
     LEFT JOIN products p ON p.id = m.product_id
     LEFT JOIN clients c ON c.id = m.client_id
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ?`,
    [Number(limit) || 100]
  );
  return rows;
}

async function recordProductMovement({ productId, movementType, quantity, unitPrice, clientId, operatorId, notes }) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [pRows] = await conn.query('SELECT * FROM products WHERE id = ? LIMIT 1 FOR UPDATE', [productId]);
    if (!pRows.length) {
      const err = new Error('Prodotto non trovato.');
      err.status = 404;
      throw err;
    }
    const p = pRows[0];
    const absQty = Math.max(1, Math.abs(Number(quantity) || 1));
    const delta = movementType === 'restock' ? absQty : movementType === 'adjustment' ? Number(quantity) || 0 : -absQty;
    const resolvedUnitPrice =
      unitPrice !== undefined && unitPrice !== null && unitPrice !== ''
        ? Number(unitPrice)
        : movementType === 'sale'
          ? Number(p.sell_price || 0)
          : Number(p.cost_price || 0);
    const totalAmount = resolvedUnitPrice * absQty;
    const nextQty = Math.max(0, Number(p.stock_qty || 0) + delta);

    await conn.query('UPDATE products SET stock_qty = ? WHERE id = ?', [nextQty, productId]);
    const [ins] = await conn.query(
      `INSERT INTO product_movements (product_id, movement_type, quantity, unit_price, total_amount, client_id, operator_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [productId, movementType, delta, resolvedUnitPrice, totalAmount, clientId || null, operatorId || null, notes || null]
    );
    await conn.commit();
    const [movRows] = await conn.query('SELECT * FROM product_movements WHERE id = ?', [ins.insertId]);
    return { movement: movRows[0], new_stock_qty: nextQty };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    conn.release();
  }
}

/* ============================================================================
   MESSAGE TEMPLATES & LOGS
   ============================================================================ */
async function listMessageTemplates() {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query('SELECT * FROM message_templates ORDER BY id ASC');
  return rows;
}

async function saveMessageTemplate({
  code,
  title,
  bodyTemplate,
  metaTemplateName,
  metaTemplateLang,
}) {
  const pool = getPool();
  await ensureDefaults(pool);
  await pool.query(
    `INSERT INTO message_templates (code, title, body_template, meta_template_name, meta_template_lang)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = COALESCE(VALUES(title), title),
       body_template = VALUES(body_template),
       meta_template_name = COALESCE(VALUES(meta_template_name), meta_template_name),
       meta_template_lang = COALESCE(VALUES(meta_template_lang), meta_template_lang)`,
    [
      code,
      title || code,
      bodyTemplate,
      metaTemplateName !== undefined ? (String(metaTemplateName || '').trim() || null) : null,
      metaTemplateLang !== undefined ? (String(metaTemplateLang || 'it').trim() || 'it') : 'it',
    ]
  );
  if (metaTemplateName !== undefined && String(metaTemplateName || '').trim() === '') {
    await pool.query('UPDATE message_templates SET meta_template_name = NULL WHERE code = ?', [code]);
  }
  const [rows] = await pool.query('SELECT * FROM message_templates WHERE code = ? LIMIT 1', [code]);
  return rows[0];
}

async function listMessageLogs(limit = 100) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query('SELECT * FROM message_logs ORDER BY sent_at DESC, id DESC LIMIT ?', [
    Number(limit) || 100,
  ]);
  return rows;
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
  const pool = getPool();
  await ensureDefaults(pool);
  const [ins] = await pool.query(
    `INSERT INTO message_logs
     (client_id, appointment_id, recipient_phone, recipient_name, channel, template_code, message_text,
      status, external_message_id, error_message, trigger_source, meta_payload_type, sent_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clientId || null,
      appointmentId || null,
      recipientPhone || null,
      recipientName || null,
      channel || 'whatsapp',
      templateCode || null,
      messageText,
      status || 'sent',
      externalMessageId || null,
      errorMessage ? String(errorMessage).slice(0, 395) : null,
      triggerSource || 'manual',
      metaPayloadType || 'text',
      adminId || null,
    ]
  );
  const [rows] = await pool.query('SELECT * FROM message_logs WHERE id = ?', [ins.insertId]);
  return rows[0];
}

async function hasRecentMessageLog({
  clientId = null,
  appointmentId = null,
  templateCode = '',
  withinDays = 0,
  sinceDate = '',
  statuses = ['sent'],
}) {
  const pool = getPool();
  await ensureDefaults(pool);
  const conditions = [];
  const params = [];

  if (templateCode) {
    conditions.push('template_code = ?');
    params.push(templateCode);
  }
  if (appointmentId) {
    conditions.push('appointment_id = ?');
    params.push(Number(appointmentId));
  }
  if (clientId) {
    conditions.push('client_id = ?');
    params.push(Number(clientId));
  }
  const stList = Array.isArray(statuses) && statuses.length ? statuses : ['sent'];
  conditions.push(`status IN (${stList.map(() => '?').join(',')})`);
  params.push(...stList);

  const cutoffDate = sinceDate
    ? sinceDate
    : withinDays > 0
      ? getRomeNowParts(-Number(withinDays) * 86400000).date
      : '';
  if (cutoffDate) {
    conditions.push('DATE(sent_at) >= ?');
    params.push(cutoffDate);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT id FROM message_logs ${whereSql} LIMIT 1`, params);
  return rows.length > 0;
}

async function getStudioSetting(key) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    'SELECT setting_value, updated_at FROM studio_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  if (!rows[0]) return null;
  try {
    const parsed = JSON.parse(rows[0].setting_value);
    if (parsed && typeof parsed === 'object') {
      return { ...parsed, updated_at: rows[0].updated_at || null };
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveStudioSetting(key, valueObj) {
  const pool = getPool();
  await ensureDefaults(pool);
  const serialized = JSON.stringify(valueObj || {});
  await pool.query(
    `INSERT INTO studio_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, serialized]
  );
  return getStudioSetting(key);
}

async function listAutomationRuns(limit = 40) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    'SELECT * FROM automation_runs ORDER BY id DESC LIMIT ?',
    [Number(limit) || 40]
  );
  return rows;
}

async function hasAutomationRunForDate(jobName, runDate) {
  const pool = getPool();
  await ensureDefaults(pool);
  const [rows] = await pool.query(
    "SELECT id FROM automation_runs WHERE job_name = ? AND run_date = ? AND status = 'completed' LIMIT 1",
    [jobName, runDate]
  );
  return rows.length > 0;
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
  const pool = getPool();
  await ensureDefaults(pool);
  const start = startedAt || formatRomeNow();
  const finish = finishedAt || formatRomeNow();
  const [ins] = await pool.query(
    `INSERT INTO automation_runs
     (job_name, run_date, trigger_mode, status, processed_count, sent_count, failed_count, skipped_count, summary_text, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      jobName,
      runDate,
      triggerMode,
      status,
      Number(processedCount || 0),
      Number(sentCount || 0),
      Number(failedCount || 0),
      Number(skippedCount || 0),
      String(summaryText || '').slice(0, 490),
      start,
      finish,
    ]
  );
  const [rows] = await pool.query('SELECT * FROM automation_runs WHERE id = ?', [ins.insertId]);
  return rows[0];
}

async function listGiftCards(query = '') {
  const pool = getPool();
  const q = String(query || '').trim();
  let sql = `SELECT gc.*, c.full_name AS client_name
    FROM gift_cards gc
    LEFT JOIN clients c ON c.id = gc.client_id`;
  const params = [];
  if (q) {
    const like = `%${q}%`;
    sql += ` WHERE gc.code LIKE ? OR gc.recipient_name LIKE ? OR gc.sender_name LIKE ? OR gc.service_title LIKE ?`;
    params.push(like, like, like, like);
  }
  sql += ` ORDER BY gc.created_at DESC, gc.id DESC`;
  const [rows] = await pool.query(sql, params);
  return rows;
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
  const pool = getPool();
  const [dup] = await pool.query('SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [code]);
  if (dup.length > 0) {
    const err = new Error('Questo codice Gift Card esiste già. Rigenera o scegli un altro codice.');
    err.status = 409;
    err.code = 'GIFT_CODE_EXISTS';
    throw err;
  }

  const [ins] = await pool.query(
    `INSERT INTO gift_cards
      (code, theme, gift_mode, amount, remaining_amount, hide_price, service_title,
       recipient_name, sender_name, recipient_phone, client_id, message, expires_at, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      code,
      theme || 'rose',
      giftMode || 'amount',
      amount,
      amount,
      hidePrice ? 1 : 0,
      serviceTitle || null,
      recipientName,
      senderName || null,
      recipientPhone || null,
      clientId || null,
      message || null,
      expiresAt || null,
      notes || null,
    ]
  );
  const [rows] = await pool.query(
    `SELECT gc.*, c.full_name AS client_name
     FROM gift_cards gc LEFT JOIN clients c ON c.id = gc.client_id
     WHERE gc.id = ? LIMIT 1`,
    [ins.insertId]
  );
  return rows[0];
}

async function redeemGiftCard(id, { redeemAmount = 0, markFull = false, cancel = false }) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM gift_cards WHERE id = ? LIMIT 1', [id]);
  if (rows.length === 0) return null;
  const gc = rows[0];

  if (cancel) {
    await pool.query('UPDATE gift_cards SET status = ? WHERE id = ?', ['cancelled', id]);
  } else if (markFull) {
    await pool.query(
      'UPDATE gift_cards SET remaining_amount = 0.00, status = ?, redeemed_at = NOW() WHERE id = ?',
      ['redeemed', id]
    );
  } else if (Number(gc.amount) > 0) {
    const nextRem = Math.max(0, Number((Number(gc.remaining_amount) - Math.max(0, Number(redeemAmount) || 0)).toFixed(2)));
    const nextStatus = nextRem <= 0 ? 'redeemed' : 'active';
    await pool.query(
      'UPDATE gift_cards SET remaining_amount = ?, status = ?, redeemed_at = IF(? = "redeemed", NOW(), redeemed_at) WHERE id = ?',
      [nextRem, nextStatus, nextStatus, id]
    );
  } else {
    await pool.query(
      'UPDATE gift_cards SET status = ?, redeemed_at = NOW() WHERE id = ?',
      ['redeemed', id]
    );
  }

  const [updated] = await pool.query(
    `SELECT gc.*, c.full_name AS client_name
     FROM gift_cards gc LEFT JOIN clients c ON c.id = gc.client_id
     WHERE gc.id = ? LIMIT 1`,
    [id]
  );
  return updated[0] || null;
}

async function deleteGiftCard(id) {
  const pool = getPool();
  await pool.query('DELETE FROM gift_cards WHERE id = ?', [id]);
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
};
