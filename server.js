/**
 * GIULIA BEAUTY STUDIO — Node.js + Express + MySQL Proprietary Backend
 * Agenda stile Google Calendar, Database Clienti (CRM) & Audit Log Privacy GDPR
 */

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { isDbConfigured, getPool, applySchema } = require('./backend/db');
const {
  SESSION_COOKIE_NAME,
  SESSION_TTL_HOURS,
  hashPassword,
  verifyPassword,
  hashSessionToken,
  parseCookies,
  normalizePhone,
  isValidIsoDate,
  isClosedDay,
  formatRomeNow,
  getRomeToday,
  getSessionExpirySql,
  hashIp,
  slotOverlapsBooked,
  generateBookingCode,
  escapeHtml,
} = require('./backend/helpers');

const app = express();
const ROOT_DIR = __dirname;
const CANDIDATE_SLOTS = ['09:30', '11:00', '14:30', '16:00', '17:30', '18:30'];
const ALLOWED_APPT_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Block HTTP access to backend/source/config files before static middleware
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (
    reqPath.startsWith('/.env') ||
    reqPath.startsWith('/.git') ||
    reqPath.startsWith('/backend') ||
    reqPath.startsWith('/node_modules') ||
    reqPath === '/server.js' ||
    reqPath === '/package.json' ||
    reqPath === '/package-lock.json'
  ) {
    return res.status(404).send('Not found');
  }
  return next();
});

// Dynamic CORS for /api
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  const origin = req.headers.origin;
  const rawAllowed = process.env.ALLOWED_ORIGINS || '';
  const allowedList = rawAllowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (origin && (allowedList.includes('*') || allowedList.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

function sendError(res, message, status = 400, code = 'ERROR') {
  return res.status(status).json({
    ok: false,
    code,
    error: message,
  });
}

function getPrivacyVersion() {
  return process.env.PRIVACY_VERSION || 'v2.0-2026-11';
}

function setSessionCookie(res, req, rawToken, maxAgeSeconds) {
  const secureFlag =
    process.env.COOKIE_SECURE === 'true' ||
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https';

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${process.env.COOKIE_SAMESITE || 'Lax'}`,
  ];
  if (secureFlag) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function getAuthenticatedAdmin(req) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = hashSessionToken(rawToken);
  const pool = getPool();
  const nowSql = formatRomeNow();

  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.display_name
     FROM admin_sessions s
     INNER JOIN admin_users u ON u.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ?
     LIMIT 1`,
    [tokenHash, nowSql]
  );

  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    username: String(rows[0].username),
    display_name: String(rows[0].display_name || 'Giulia'),
    tokenHash,
  };
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) {
      return sendError(res, 'Accesso riservato. Effettua il login.', 401, 'UNAUTHORIZED');
    }
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

/* ============================================================================
   HEALTH CHECK
   ============================================================================ */
app.get('/api/health', async (_req, res) => {
  if (!isDbConfigured()) {
    return res.status(503).json({
      ok: false,
      runtime: 'nodejs',
      db_configured: false,
      error: 'Configurazione .env mancante.',
    });
  }
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    return res.json({ ok: true, runtime: 'nodejs', db_connected: true });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      runtime: 'nodejs',
      db_connected: false,
      code: 'DB_CONNECTION_ERROR',
      error: 'Impossibile connettersi al database MySQL.',
    });
  }
});

/* ============================================================================
   ONE-TIME SETUP WIZARD (Tables + First Admin User)
   ============================================================================ */
function renderSetupHtml({ adminCount = 0, error = '', message = '', configError = '' }) {
  const bodyHtml = configError
    ? `<div class="alert alert-err">${escapeHtml(configError)}</div>
       <p style="margin-top:14px;">Copia <code>.env.example</code> in <code>.env</code> nella root del progetto su cPanel, inserisci le credenziali MySQL (<code>DB_HOST</code>, <code>DB_NAME</code>, <code>DB_USER</code>, <code>DB_PASS</code>) e riavvia l'applicazione Node.js.</p>`
    : adminCount > 0
      ? `<p style="margin-top: 16px;">
           <strong>Database e accesso già configurati.</strong><br />
           Per sicurezza, la creazione di nuovi account da questa pagina è bloccata. Puoi accedere subito all'area riservata.
         </p>
         <a href="../admin.html" class="btn">Vai all'Agenda Gestionale →</a>`
      : `<form method="POST" action="setup">
           <label for="display_name">Nome Titolare</label>
           <input type="text" id="display_name" name="display_name" value="Giulia" required />

           <label for="username">Username o Email di Accesso</label>
           <input type="text" id="username" name="username" placeholder="es. giulia@giuliabeauty.it" required />

           <label for="password">Password Riservata (min. 8 caratteri)</label>
           <input type="password" id="password" name="password" minlength="8" required />

           <button type="submit" class="btn">Crea Database e Account Titolare</button>
         </form>`;

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Setup Gestionale — Giulia Beauty Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    body {
      font-family: 'Montserrat', sans-serif;
      background: linear-gradient(180deg, #fdf8f7 0%, #f4dcd9 100%);
      color: #3d1218;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }
    .setup-card {
      background: #fffbfa;
      border: 1px solid rgba(145, 78, 86, 0.4);
      border-radius: 22px;
      padding: 36px 32px;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 20px 50px -12px rgba(74, 21, 29, 0.14);
    }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 2rem; margin: 0 0 8px; color: #3d1218; }
    p { font-size: 0.88rem; color: #6e3b42; line-height: 1.6; }
    label { display: block; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; margin: 16px 0 6px; color: #6e3b42; }
    input { width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(145, 78, 86, 0.45); font-family: inherit; font-size: 16px; }
    .btn { display: inline-block; width: 100%; margin-top: 22px; padding: 14px 20px; border-radius: 999px; border: none; background: #3d1218; color: #fffbfa; font-family: inherit; font-size: 0.76rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; text-align: center; text-decoration: none; cursor: pointer; box-sizing: border-box; }
    .alert { padding: 12px 14px; border-radius: 10px; font-size: 0.84rem; margin-top: 14px; }
    .alert-err { background: #fde8ec; border: 1px solid #b5586b; color: #4a151d; }
    .alert-ok { background: #eef6f1; border: 1px solid #3b6e52; color: #244733; }
    code { background: rgba(145, 78, 86, 0.1); padding: 2px 5px; border-radius: 4px; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="setup-card">
    <h1>♡ Giulia Beauty Studio</h1>
    <p>Inizializzazione del database MySQL proprietario (Node.js Backend • Agenda, CRM Clienti &amp; Log Privacy GDPR).</p>
    ${error ? `<div class="alert alert-err">${escapeHtml(error)}</div>` : ''}
    ${message ? `<div class="alert alert-ok">${escapeHtml(message)}</div>` : ''}
    ${bodyHtml}
  </div>
</body>
</html>`;
}

app.all('/api/setup', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!isDbConfigured()) {
    return res.status(503).send(
      renderSetupHtml({
        configError: 'Variabili database mancanti nel file .env.',
      })
    );
  }

  try {
    const pool = getPool();
    await applySchema(pool);

    const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM admin_users');
    let adminCount = Number(countRows[0]?.cnt || 0);
    let error = '';
    let message = '';

    if (adminCount === 0 && req.method === 'POST') {
      const username = String(req.body?.username || '').trim();
      const displayName = String(req.body?.display_name || 'Giulia').trim();
      const password = String(req.body?.password || '');

      if (!username || password.length < 8) {
        error = 'Inserisci un username/email valido e una password di almeno 8 caratteri.';
      } else {
        const hash = hashPassword(password);
        await pool.query(
          'INSERT INTO admin_users (username, display_name, password_hash) VALUES (?, ?, ?)',
          [username, displayName || 'Giulia', hash]
        );
        adminCount = 1;
        message = "Configurazione completata! Le tabelle MySQL e l'account di Giulia sono pronti.";
      }
    }

    return res.send(renderSetupHtml({ adminCount, error, message }));
  } catch (err) {
    return res.status(500).send(
      renderSetupHtml({
        configError: `Errore connessione MySQL: ${err.message}`,
      })
    );
  }
});

/* ============================================================================
   AUTHENTICATION ENDPOINTS
   ============================================================================ */
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) {
      return res.json({ ok: true, authenticated: false });
    }
    return res.json({
      ok: true,
      authenticated: true,
      admin: {
        id: admin.id,
        username: admin.username,
        display_name: admin.display_name,
      },
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return sendError(res, 'Inserisci username e password.', 400, 'CREDENTIALS_REQUIRED');
    }

    const pool = getPool();
    let users;
    try {
      const [rows] = await pool.query(
        'SELECT id, username, display_name, password_hash FROM admin_users WHERE username = ? LIMIT 1',
        [username]
      );
      users = rows;
    } catch (dbErr) {
      if (dbErr.code === 'ER_NO_SUCH_TABLE') {
        return sendError(
          res,
          'Tabelle database non trovate. Apri /api/setup oppure esegui npm run init-db.',
          500,
          'SCHEMA_MISSING'
        );
      }
      throw dbErr;
    }

    const user = users[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendError(res, 'Credenziali non valide.', 401, 'INVALID_CREDENTIALS');
    }

    // Opportunistic cleanup of expired sessions
    const nowSql = formatRomeNow();
    await pool.query('DELETE FROM admin_sessions WHERE expires_at <= ?', [nowSql]);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = getSessionExpirySql();

    await pool.query(
      'INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)',
      [tokenHash, user.id, expiresAt]
    );

    setSessionCookie(res, req, rawToken, SESSION_TTL_HOURS * 3600);

    return res.json({
      ok: true,
      authenticated: true,
      admin: {
        id: Number(user.id),
        username: String(user.username),
        display_name: String(user.display_name || 'Giulia'),
      },
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const cookies = parseCookies(req);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (rawToken && isDbConfigured()) {
      const pool = getPool();
      await pool.query('DELETE FROM admin_sessions WHERE token_hash = ?', [hashSessionToken(rawToken)]);
    }
    setSessionCookie(res, req, '', 0);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/auth/change-password', requireAdmin, async (req, res, next) => {
  try {
    const current = String(req.body?.current_password || '');
    const nextPass = String(req.body?.new_password || '');

    if (nextPass.length < 8) {
      return sendError(res, 'La nuova password deve contenere almeno 8 caratteri.', 400);
    }

    const pool = getPool();
    const [rows] = await pool.query('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1', [
      req.admin.id,
    ]);

    if (!rows.length || !verifyPassword(current, rows[0].password_hash)) {
      return sendError(res, 'La password attuale non è corretta.', 403);
    }

    const newHash = hashPassword(nextPass);
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, req.admin.id]);

    return res.json({ ok: true, message: 'Password aggiornata con successo.' });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   PUBLIC ENDPOINTS (NO PII EXPOSED ON SLOTS)
   ============================================================================ */
app.get('/api/public/slots', async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || '').trim();
    const duration = Math.max(15, Math.min(300, Number.parseInt(req.query.duration || '60', 10) || 60));

    if (!isValidIsoDate(dateStr)) {
      return sendError(res, 'Formato data non valido (atteso YYYY-MM-DD).', 400);
    }

    const closed = isClosedDay(dateStr);
    if (closed) {
      return res.json({
        ok: true,
        date: dateStr,
        closed: true,
        booked_slots: CANDIDATE_SLOTS,
      });
    }

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
       FROM appointments
       WHERE appointment_date = ?
         AND mode = 'booking'
         AND status IN ('pending', 'confirmed')`,
      [dateStr]
    );

    const bookedSlots = CANDIDATE_SLOTS.filter((slot) => slotOverlapsBooked(slot, duration, rows));

    return res.json({
      ok: true,
      date: dateStr,
      closed: false,
      booked_slots: bookedSlots,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/book', async (req, res, next) => {
  let conn = null;
  try {
    const body = req.body || {};
    const mode = body.mode === 'voucher' ? 'voucher' : 'booking';
    const clientName = String(body.client_name || '').trim();
    const clientPhoneRaw = String(body.client_phone || '').trim();
    const clientEmail = String(body.client_email || '').trim();
    const notes = String(body.notes || '').trim();
    const paymentMethod = String(body.payment_method || 'studio').trim() || 'studio';
    const privacyAccepted = Boolean(body.privacy_accepted);
    const marketingConsent = body.marketing_consent ? 1 : 0;

    const services = Array.isArray(body.services) ? body.services : [];
    const totalPrice = Number(body.total_price || 0) || 0;
    let durationMinutes = Math.max(0, Number.parseInt(body.duration_minutes || '0', 10) || 0);
    let appointmentDate = String(body.appointment_date || getRomeToday()).trim();
    let startTime = String(body.start_time || '11:00').trim();

    if (!privacyAccepted) {
      return sendError(
        res,
        "È obbligatorio accettare l'Informativa Privacy (GDPR) e i Termini e Condizioni.",
        422,
        'PRIVACY_REQUIRED'
      );
    }

    if (clientName.length < 2) {
      return sendError(res, 'Inserisci nome e cognome.', 422, 'NAME_REQUIRED');
    }

    const phoneNormalized = normalizePhone(clientPhoneRaw);
    if (!phoneNormalized || phoneNormalized.replace(/\D/g, '').length < 7) {
      return sendError(res, 'Inserisci un numero di telefono / WhatsApp valido.', 422, 'PHONE_REQUIRED');
    }

    if (services.length === 0) {
      return sendError(res, 'Seleziona almeno un trattamento o una Gift Card.', 422, 'SERVICES_REQUIRED');
    }

    if (mode === 'booking') {
      if (!isValidIsoDate(appointmentDate)) {
        return sendError(res, 'Data appuntamento non valida.', 422);
      }
      if (isClosedDay(appointmentDate)) {
        return sendError(
          res,
          'Il Martedì e la Domenica lo studio è chiuso. Seleziona un altro giorno.',
          422,
          'CLOSED_DAY'
        );
      }
      if (!/^\d{2}:\d{2}$/.test(startTime)) {
        return sendError(res, 'Orario non valido.', 422);
      }
      if (durationMinutes < 15) {
        durationMinutes = 30;
      }
    } else {
      if (!isValidIsoDate(appointmentDate)) appointmentDate = getRomeToday();
      if (!/^\d{2}:\d{2}$/.test(startTime)) startTime = '09:30';
    }

    const serviceNames = services
      .map((s) => (s && typeof s === 'object' ? String(s.name || '').trim() : ''))
      .filter(Boolean);
    const servicesSummary = serviceNames.join(' + ').slice(0, 490) || 'Trattamento Studio';
    const servicesJson = JSON.stringify(services);
    const privacyVersion = getPrivacyVersion();
    const nowStr = formatRomeNow();

    const pool = getPool();
    conn = await pool.getConnection();
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
        return sendError(
          res,
          'Spiacenti, la fascia oraria selezionata è appena stata prenotata. Scegli un altro orario disponibile.',
          409,
          'SLOT_OCCUPIED'
        );
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

    const ipHashValue = hashIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 250);
    await conn.query(
      `INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
       VALUES (?, ?, 'privacy_terms', ?, ?, ?, ?)`,
      [clientId, appointmentId, privacyVersion, nowStr, ipHashValue, userAgent]
    );

    await conn.commit();

    return res.status(201).json({
      ok: true,
      booking_code: bookingCode,
      appointment_id: appointmentId,
      client_id: clientId,
      privacy_accepted_at: nowStr,
      privacy_version: privacyVersion,
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback failure
      }
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

/* ============================================================================
   ADMIN APPOINTMENTS API (Calendar CRUD)
   ============================================================================ */
app.get('/api/admin/appointments', requireAdmin, async (req, res, next) => {
  try {
    const startDate = String(req.query.start_date || '').trim();
    const endDate = String(req.query.end_date || '').trim();
    const status = String(req.query.status || '').trim();
    const clientId = Number.parseInt(req.query.client_id || '0', 10) || 0;

    const where = ['1=1'];
    const params = [];

    if (startDate && isValidIsoDate(startDate)) {
      where.push('a.appointment_date >= ?');
      params.push(startDate);
    }
    if (endDate && isValidIsoDate(endDate)) {
      where.push('a.appointment_date <= ?');
      params.push(endDate);
    }
    if (status && ALLOWED_APPT_STATUSES.includes(status)) {
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
          a.id,
          a.booking_code,
          a.client_id,
          a.appointment_date,
          TIME_FORMAT(a.start_time, '%H:%i') AS start_time,
          a.duration_minutes,
          a.services_json,
          a.services_summary,
          a.total_price,
          a.mode,
          a.payment_method,
          a.status,
          a.notes,
          a.privacy_accepted,
          a.privacy_accepted_at,
          a.created_at,
          c.full_name AS client_name,
          c.phone AS client_phone,
          c.email AS client_email,
          c.allergies_notes,
          c.preferences_notes,
          c.privacy_version
       FROM appointments a
       INNER JOIN clients c ON c.id = a.client_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.appointment_date ASC, a.start_time ASC`,
      params
    );

    return res.json({ ok: true, appointments: rows });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/appointments', requireAdmin, async (req, res, next) => {
  let conn = null;
  try {
    const body = req.body || {};
    const action = String(body.action || 'create');
    const pool = getPool();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
      await pool.query('DELETE FROM appointments WHERE id = ?', [id]);
      return res.json({ ok: true, deleted_id: id });
    }

    if (action === 'update') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);

      const status = ALLOWED_APPT_STATUSES.includes(body.status) ? body.status : 'confirmed';
      const date = String(body.appointment_date || '').trim();
      const time = String(body.start_time || '').trim();
      const duration = Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60);
      const totalPrice = Number(body.total_price || 0) || 0;
      const notes = String(body.notes || '').trim();
      const servicesSummary = String(body.services_summary || '').trim() || 'Trattamento personalizzato';
      const servicesJson = Array.isArray(body.services) ? JSON.stringify(body.services) : null;

      if (!isValidIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return sendError(res, 'Data o orario non validi.', 422);
      }

      if (servicesJson !== null) {
        await pool.query(
          `UPDATE appointments
           SET appointment_date = ?, start_time = ?, duration_minutes = ?, services_json = ?,
               services_summary = ?, total_price = ?, status = ?, notes = ?
           WHERE id = ?`,
          [date, `${time}:00`, duration, servicesJson, servicesSummary.slice(0, 490), totalPrice, status, notes || null, id]
        );
      } else {
        await pool.query(
          `UPDATE appointments
           SET appointment_date = ?, start_time = ?, duration_minutes = ?,
               services_summary = ?, total_price = ?, status = ?, notes = ?
           WHERE id = ?`,
          [date, `${time}:00`, duration, servicesSummary.slice(0, 490), totalPrice, status, notes || null, id]
        );
      }

      return res.json({ ok: true, updated_id: id });
    }

    // Create manual appointment from Admin Dashboard
    let clientId = Number.parseInt(body.client_id || '0', 10) || 0;
    const clientName = String(body.client_name || '').trim();
    const clientPhone = String(body.client_phone || '').trim();
    const clientEmail = String(body.client_email || '').trim();
    const privacyAccepted = body.privacy_accepted ? 1 : 0;

    const date = String(body.appointment_date || '').trim();
    const time = String(body.start_time || '').trim();
    const duration = Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60);
    const services = Array.isArray(body.services) ? body.services : [];
    let servicesSummary = String(body.services_summary || '').trim();
    const totalPrice = Number(body.total_price || 0) || 0;
    const status = ALLOWED_APPT_STATUSES.includes(body.status) ? body.status : 'confirmed';
    const mode = body.mode === 'voucher' ? 'voucher' : 'booking';
    const paymentMethod = String(body.payment_method || 'studio').trim() || 'studio';
    const notes = String(body.notes || '').trim();

    if (!isValidIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return sendError(res, 'Inserisci una data e un orario validi.', 422);
    }

    const privacyVersion = getPrivacyVersion();
    const nowStr = formatRomeNow();

    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (clientId <= 0) {
      if (!clientName || !clientPhone) {
        await conn.rollback();
        return sendError(
          res,
          'Seleziona una cliente esistente oppure inserisci Nome e Telefono della nuova cliente.',
          422
        );
      }

      const phoneNorm = normalizePhone(clientPhone);
      const [found] = await conn.query('SELECT id FROM clients WHERE phone_normalized = ? LIMIT 1', [phoneNorm]);
      if (found.length > 0) {
        clientId = Number(found[0].id);
      } else {
        const [insC] = await conn.query(
          `INSERT INTO clients (full_name, phone, phone_normalized, email, privacy_accepted, privacy_accepted_at, privacy_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            clientName,
            clientPhone,
            phoneNorm,
            clientEmail || null,
            privacyAccepted,
            privacyAccepted ? nowStr : null,
            privacyVersion,
          ]
        );
        clientId = Number(insC.insertId);
      }
    }

    if (!servicesSummary && services.length > 0) {
      servicesSummary = services
        .map((s) => (s && typeof s === 'object' ? String(s.name || '').trim() : ''))
        .filter(Boolean)
        .join(' + ');
    }
    if (!servicesSummary) {
      servicesSummary = 'Appuntamento in Studio';
    }

    const bookingCode = await generateBookingCode(conn);
    const [insA] = await conn.query(
      `INSERT INTO appointments
       (booking_code, client_id, appointment_date, start_time, duration_minutes, services_json, services_summary,
        total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingCode,
        clientId,
        date,
        `${time}:00`,
        duration,
        JSON.stringify(services),
        servicesSummary.slice(0, 490),
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
        [clientId, newApptId, privacyVersion, nowStr, hashIp(req)]
      );
    }

    await conn.commit();
    return res.status(201).json({
      ok: true,
      id: newApptId,
      booking_code: bookingCode,
      client_id: clientId,
    });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback error
      }
    }
    return next(err);
  } finally {
    if (conn) conn.release();
  }
});

/* ============================================================================
   ADMIN CLIENTS API (CRM + GDPR Dossier)
   ============================================================================ */
app.get('/api/admin/clients', requireAdmin, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.query.id || '0', 10) || 0;
    const pool = getPool();

    if (id > 0) {
      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ? LIMIT 1', [id]);
      if (!clients.length) return sendError(res, 'Cliente non trovata.', 404);

      const [appointments] = await pool.query(
        `SELECT id, booking_code, appointment_date, TIME_FORMAT(start_time, '%H:%i') AS start_time,
                duration_minutes, services_summary, total_price, mode, payment_method, status, notes, created_at
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

      return res.json({
        ok: true,
        client: clients[0],
        appointments,
        privacy_logs: privacyLogs,
      });
    }

    const q = String(req.query.q || '').trim();
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
      sql += ' WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.allergies_notes LIKE ?';
      params.push(like, like, like, like);
    }
    sql += ' GROUP BY c.id ORDER BY c.full_name ASC';

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, clients: rows });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/clients', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || 'save');
    const pool = getPool();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID cliente non valido.', 400);
      await pool.query('DELETE FROM clients WHERE id = ?', [id]);
      return res.json({ ok: true, deleted_client_id: id });
    }

    const id = Number.parseInt(body.id || '0', 10) || 0;
    const fullName = String(body.full_name || '').trim();
    const phoneRaw = String(body.phone || '').trim();
    const email = String(body.email || '').trim();
    const allergiesNotes = String(body.allergies_notes || '').trim();
    const preferencesNotes = String(body.preferences_notes || '').trim();
    const privacyAccepted = body.privacy_accepted ? 1 : 0;
    const marketingConsent = body.marketing_consent ? 1 : 0;

    if (!fullName || !phoneRaw) {
      return sendError(res, 'Nome completo e telefono sono obbligatori.', 422);
    }

    const phoneNorm = normalizePhone(phoneRaw);
    const privacyVersion = getPrivacyVersion();
    const nowStr = formatRomeNow();

    if (id > 0) {
      const [curRows] = await pool.query(
        'SELECT privacy_accepted, privacy_accepted_at FROM clients WHERE id = ? LIMIT 1',
        [id]
      );
      if (!curRows.length) return sendError(res, 'Cliente non trovata.', 404);

      const cur = curRows[0];
      let acceptedAt = cur.privacy_accepted_at;
      if (privacyAccepted && !cur.privacy_accepted) {
        acceptedAt = nowStr;
      } else if (!privacyAccepted) {
        acceptedAt = null;
      }

      await pool.query(
        `UPDATE clients
         SET full_name = ?, phone = ?, phone_normalized = ?, email = ?, allergies_notes = ?,
             preferences_notes = ?, privacy_accepted = ?, privacy_accepted_at = ?,
             privacy_version = ?, marketing_consent = ?
         WHERE id = ?`,
        [
          fullName,
          phoneRaw,
          phoneNorm,
          email || null,
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
          [id, privacyVersion, nowStr, hashIp(req)]
        );
      }

      return res.json({ ok: true, id });
    }

    const [ins] = await pool.query(
      `INSERT INTO clients
       (full_name, phone, phone_normalized, email, allergies_notes, preferences_notes,
        privacy_accepted, privacy_accepted_at, privacy_version, marketing_consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        phoneRaw,
        phoneNorm,
        email || null,
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
        [newId, privacyVersion, nowStr, hashIp(req)]
      );
    }

    return res.status(201).json({ ok: true, id: newId });
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return sendError(res, 'Esiste già una cliente registrata con questo numero di telefono.', 409);
    }
    return next(err);
  }
});

/* ============================================================================
   STATIC FRONTEND & GLOBAL API ERROR HANDLER
   ============================================================================ */
app.use(express.static(ROOT_DIR, { extensions: ['html'] }));

app.use('/api', (err, _req, res, _next) => {
  console.error('[API ERROR]', err);
  if (err && err.code === 'DB_CONFIG_MISSING') {
    return sendError(res, err.message, 503, 'DB_CONFIG_MISSING');
  }
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_BAD_DB_ERROR')) {
    return sendError(
      res,
      'Impossibile connettersi al database MySQL. Verifica le credenziali nel file .env.',
      500,
      'DB_CONNECTION_ERROR'
    );
  }
  return sendError(res, 'Errore interno del server Node.js.', 500, 'INTERNAL_ERROR');
});

const PORT = Number(process.env.PORT || 3000);
if (process.env.GBS_NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`[Giulia Beauty Studio] Server Node.js attivo su http://localhost:${PORT}`);
  });
}

module.exports = { app };
