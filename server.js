/**
 * GIULIA BEAUTY STUDIO — Node.js + Express + MySQL Proprietary Backend
 * Agenda stile Google Calendar, Database Clienti (CRM) & Audit Log Privacy GDPR
 */

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const { getStore } = require('./backend/store');
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
    reqPath.startsWith('/.local-dev-db') ||
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
  return res.status(status).json({ ok: false, code, error: message });
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
  if (secureFlag) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function getAuthenticatedAdmin(req) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const store = getStore();
  const admin = await store.findSessionAdmin(hashSessionToken(rawToken), formatRomeNow());
  if (!admin) return null;
  return {
    id: Number(admin.id),
    username: String(admin.username),
    display_name: String(admin.display_name || 'Giulia'),
  };
}

async function requireAdmin(req, res, next) {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) {
      return sendError(res, 'Accesso riservato. Effettua il login.', 401, 'UNAUTHORIZED');
    }
    await getStore().ensureReady();
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
  const info = await getStore().healthCheck();
  const { status, ...payload } = info;
  return res.status(status || 200).json({ runtime: 'nodejs', ...payload });
});

/* ============================================================================
   ONE-TIME SETUP WIZARD (Tables + First Admin User)
   ============================================================================ */
function renderSetupHtml({ adminCount = 0, error = '', message = '', configError = '' }) {
  const bodyHtml = configError
    ? `<div class="alert alert-err">${escapeHtml(configError)}</div>
       <p style="margin-top:14px;">Copia <code>.env.example</code> in <code>.env</code> nella root del progetto, inserisci le credenziali MySQL (<code>DB_HOST</code>, <code>DB_NAME</code>, <code>DB_USER</code>, <code>DB_PASS</code>) oppure usa <code>DB_MODE=local</code> per test in locale.</p>`
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
    body { font-family: 'Montserrat', sans-serif; background: linear-gradient(180deg, #fdf8f7 0%, #f4dcd9 100%); color: #3d1218; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; margin: 0; }
    .setup-card { background: #fffbfa; border: 1px solid rgba(145, 78, 86, 0.4); border-radius: 22px; padding: 36px 32px; max-width: 460px; width: 100%; box-shadow: 0 20px 50px -12px rgba(74, 21, 29, 0.14); }
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
    <p>Inizializzazione del database proprietario (Node.js Backend • Agenda, CRM Clienti &amp; Log Privacy GDPR).</p>
    ${error ? `<div class="alert alert-err">${escapeHtml(error)}</div>` : ''}
    ${message ? `<div class="alert alert-ok">${escapeHtml(message)}</div>` : ''}
    ${bodyHtml}
  </div>
</body>
</html>`;
}

app.all('/api/setup', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const store = getStore();
    const state = await store.initSchemaAndCountAdmins();
    if (!state.configured) {
      return res.status(503).send(renderSetupHtml({ configError: state.error }));
    }

    let { adminCount } = state;
    let error = '';
    let message = '';

    if (adminCount === 0 && req.method === 'POST') {
      const username = String(req.body?.username || '').trim();
      const displayName = String(req.body?.display_name || 'Giulia').trim();
      const password = String(req.body?.password || '');

      if (!username || password.length < 8) {
        error = 'Inserisci un username/email valido e una password di almeno 8 caratteri.';
      } else {
        await store.createInitialAdmin({
          username,
          displayName: displayName || 'Giulia',
          passwordHash: hashPassword(password),
        });
        adminCount = 1;
        message = "Configurazione completata! Il database e l'account di Giulia sono pronti.";
      }
    }

    return res.send(renderSetupHtml({ adminCount, error, message }));
  } catch (err) {
    return res.status(500).send(renderSetupHtml({ configError: `Errore database: ${err.message}` }));
  }
});

/* ============================================================================
   AUTHENTICATION ENDPOINTS
   ============================================================================ */
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const admin = await getAuthenticatedAdmin(req);
    if (!admin) return res.json({ ok: true, authenticated: false });
    return res.json({ ok: true, authenticated: true, admin });
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

    const store = getStore();
    let user;
    try {
      user = await store.findAdminByUsername(username);
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

    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendError(res, 'Credenziali non valide.', 401, 'INVALID_CREDENTIALS');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    await store.createSession({
      adminId: user.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: getSessionExpirySql(),
    });

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
    const rawToken = parseCookies(req)[SESSION_COOKIE_NAME];
    if (rawToken) {
      await getStore().deleteSession(hashSessionToken(rawToken));
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

    const store = getStore();
    const existingHash = await store.getAdminPasswordHash(req.admin.id);
    if (!existingHash || !verifyPassword(current, existingHash)) {
      return sendError(res, 'La password attuale non è corretta.', 403);
    }

    await store.updateAdminPassword(req.admin.id, hashPassword(nextPass));
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

    if (isClosedDay(dateStr)) {
      return res.json({ ok: true, date: dateStr, closed: true, booked_slots: CANDIDATE_SLOTS });
    }

    const rows = await getStore().getPublicBookedSlots(dateStr);
    const bookedSlots = CANDIDATE_SLOTS.filter((slot) => slotOverlapsBooked(slot, duration, rows));
    return res.json({ ok: true, date: dateStr, closed: false, booked_slots: bookedSlots });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/book', async (req, res, next) => {
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
    if (clientName.length < 2) return sendError(res, 'Inserisci nome e cognome.', 422, 'NAME_REQUIRED');

    const phoneNormalized = normalizePhone(clientPhoneRaw);
    if (!phoneNormalized || phoneNormalized.replace(/\D/g, '').length < 7) {
      return sendError(res, 'Inserisci un numero di telefono / WhatsApp valido.', 422, 'PHONE_REQUIRED');
    }
    if (services.length === 0) {
      return sendError(res, 'Seleziona almeno un trattamento o una Gift Card.', 422, 'SERVICES_REQUIRED');
    }

    if (mode === 'booking') {
      if (!isValidIsoDate(appointmentDate)) return sendError(res, 'Data appuntamento non valida.', 422);
      if (isClosedDay(appointmentDate)) {
        return sendError(res, 'Il Martedì e la Domenica lo studio è chiuso. Seleziona un altro giorno.', 422, 'CLOSED_DAY');
      }
      if (!/^\d{2}:\d{2}$/.test(startTime)) return sendError(res, 'Orario non valido.', 422);
      if (durationMinutes < 15) durationMinutes = 30;
    } else {
      if (!isValidIsoDate(appointmentDate)) appointmentDate = getRomeToday();
      if (!/^\d{2}:\d{2}$/.test(startTime)) startTime = '09:30';
    }

    const serviceNames = services
      .map((s) => (s && typeof s === 'object' ? String(s.name || '').trim() : ''))
      .filter(Boolean);
    const servicesSummary = serviceNames.join(' + ').slice(0, 490) || 'Trattamento Studio';
    const privacyVersion = getPrivacyVersion();
    const nowStr = formatRomeNow();

    const created = await getStore().createPublicBooking({
      mode,
      appointmentDate,
      startTime,
      durationMinutes,
      servicesJson: JSON.stringify(services),
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
      ipHash: hashIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
    });

    return res.status(201).json({
      ok: true,
      booking_code: created.bookingCode,
      appointment_id: created.appointmentId,
      client_id: created.clientId,
      privacy_accepted_at: nowStr,
      privacy_version: privacyVersion,
    });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN APPOINTMENTS API (Calendar CRUD + Reminders)
   ============================================================================ */
app.get('/api/admin/appointments', requireAdmin, async (req, res, next) => {
  try {
    const startDate = String(req.query.start_date || '').trim();
    const endDate = String(req.query.end_date || '').trim();
    const status = String(req.query.status || '').trim();
    const clientId = Number.parseInt(req.query.client_id || '0', 10) || 0;

    const appointments = await getStore().listAppointments({
      startDate: isValidIsoDate(startDate) ? startDate : '',
      endDate: isValidIsoDate(endDate) ? endDate : '',
      status: ALLOWED_APPT_STATUSES.includes(status) ? status : '',
      clientId,
    });

    return res.json({ ok: true, appointments });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/appointments', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || 'create');
    const store = getStore();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
      await store.deleteAppointment(id);
      return res.json({ ok: true, deleted_id: id });
    }

    if (action === 'mark_reminder') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
      const sentAt = body.reset ? null : formatRomeNow();
      await store.markAppointmentReminder(id, sentAt);
      return res.json({ ok: true, id, reminder_sent_at: sentAt });
    }

    if (action === 'update') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
      const status = ALLOWED_APPT_STATUSES.includes(body.status) ? body.status : 'confirmed';
      const date = String(body.appointment_date || '').trim();
      const time = String(body.start_time || '').trim();
      if (!isValidIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return sendError(res, 'Data o orario non validi.', 422);
      }

      await store.updateAppointment(id, {
        date,
        time,
        duration: Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60),
        servicesJson: Array.isArray(body.services) ? JSON.stringify(body.services) : null,
        servicesSummary: (String(body.services_summary || '').trim() || 'Trattamento personalizzato').slice(0, 490),
        totalPrice: Number(body.total_price || 0) || 0,
        status,
        notes: String(body.notes || '').trim(),
      });
      return res.json({ ok: true, updated_id: id });
    }

    const clientId = Number.parseInt(body.client_id || '0', 10) || 0;
    const clientName = String(body.client_name || '').trim();
    const clientPhone = String(body.client_phone || '').trim();
    if (clientId <= 0 && (!clientName || !clientPhone)) {
      return sendError(res, 'Seleziona una cliente esistente oppure inserisci Nome e Telefono della nuova cliente.', 422);
    }

    const date = String(body.appointment_date || '').trim();
    const time = String(body.start_time || '').trim();
    if (!isValidIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return sendError(res, 'Inserisci una data e un orario validi.', 422);
    }

    const services = Array.isArray(body.services) ? body.services : [];
    let servicesSummary = String(body.services_summary || '').trim();
    if (!servicesSummary && services.length > 0) {
      servicesSummary = services.map((s) => (s && typeof s === 'object' ? String(s.name || '').trim() : '')).filter(Boolean).join(' + ');
    }
    if (!servicesSummary) servicesSummary = 'Appuntamento in Studio';

    const clientBirthDateRaw = String(body.client_birth_date || '').trim();
    const created = await store.createAdminAppointment({
      clientId,
      clientName,
      clientPhone,
      phoneNorm: normalizePhone(clientPhone),
      clientEmail: String(body.client_email || '').trim(),
      clientBirthDate: isValidIsoDate(clientBirthDateRaw) ? clientBirthDateRaw : null,
      clientNotes: String(body.client_notes || '').trim(),
      privacyAccepted: body.privacy_accepted ? 1 : 0,
      privacyVersion: getPrivacyVersion(),
      nowStr: formatRomeNow(),
      date,
      time,
      duration: Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60),
      servicesJson: JSON.stringify(services),
      servicesSummary: servicesSummary.slice(0, 490),
      totalPrice: Number(body.total_price || 0) || 0,
      mode: body.mode === 'voucher' ? 'voucher' : 'booking',
      paymentMethod: String(body.payment_method || 'studio').trim() || 'studio',
      status: ALLOWED_APPT_STATUSES.includes(body.status) ? body.status : 'confirmed',
      notes: String(body.notes || '').trim(),
      ipHash: hashIp(req),
    });

    return res.status(201).json({
      ok: true,
      id: created.id,
      booking_code: created.bookingCode,
      client_id: created.clientId,
    });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN CLIENTS API (CRM + Birthdays + Notes + GDPR Dossier)
   ============================================================================ */
app.get('/api/admin/clients', requireAdmin, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.query.id || '0', 10) || 0;
    const store = getStore();
    if (id > 0) {
      const dossier = await store.getClientDossier(id);
      if (!dossier) return sendError(res, 'Cliente non trovata.', 404);
      return res.json({ ok: true, ...dossier });
    }
    const clients = await store.listClients(String(req.query.q || '').trim());
    return res.json({ ok: true, clients });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/clients', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || 'save');
    const store = getStore();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID cliente non valido.', 400);
      await store.deleteClient(id);
      return res.json({ ok: true, deleted_client_id: id });
    }

    const fullName = String(body.full_name || '').trim();
    const phoneRaw = String(body.phone || '').trim();
    if (!fullName || !phoneRaw) {
      return sendError(res, 'Nome completo e telefono sono obbligatori.', 422);
    }

    const birthDateRaw = String(body.birth_date || '').trim();
    const result = await store.saveClient({
      id: Number.parseInt(body.id || '0', 10) || 0,
      fullName,
      phoneRaw,
      phoneNorm: normalizePhone(phoneRaw),
      email: String(body.email || '').trim(),
      birthDate: isValidIsoDate(birthDateRaw) ? birthDateRaw : null,
      allergiesNotes: String(body.allergies_notes || '').trim(),
      preferencesNotes: String(body.preferences_notes || '').trim(),
      privacyAccepted: body.privacy_accepted ? 1 : 0,
      marketingConsent: body.marketing_consent ? 1 : 0,
      privacyVersion: getPrivacyVersion(),
      nowStr: formatRomeNow(),
      ipHash: hashIp(req),
    });

    return res.status(result.status).json({ ok: true, id: result.id });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   STATIC FRONTEND & GLOBAL API ERROR HANDLER
   ============================================================================ */
app.use(express.static(ROOT_DIR, { extensions: ['html'] }));

app.use('/api', (err, _req, res, _next) => {
  console.error('[API ERROR]', err);
  if (err && (err.status || err.code === 'DB_CONFIG_MISSING' || err.code === 'SLOT_OCCUPIED')) {
    return sendError(res, err.message, err.status || 400, err.code || 'ERROR');
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
    console.log(`[Giulia Beauty Studio] Server Node.js (${process.env.DB_MODE === 'local' ? 'LOCAL DEMO' : 'MYSQL'}) attivo su http://localhost:${PORT}`);
  });
}

module.exports = { app };
