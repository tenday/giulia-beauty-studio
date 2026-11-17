/**
 * GIULIA BEAUTY STUDIO — Node.js + Express + MySQL Proprietary Backend
 * Agenda stile Google Calendar, Database Clienti (CRM) & Audit Log Privacy GDPR
 */

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const { getStore } = require('./backend/store');
const { computeStudioInsights, answerStudioQuestion } = require('./backend/analytics');
const { runStudioAiAgent } = require('./backend/ai-agent');
const {
  computeDateSlotAvailability,
  findNextAvailableDate,
  buildDefaultSchedule,
  parseOperatorSchedule,
} = require('./backend/availability');
const {
  buildWaMeUrl,
  getWhatsAppModeStatus,
} = require('./backend/whatsapp');
const {
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  roundMoney,
  normalizePaymentStatus,
  normalizePaymentMethod,
  resolveStripeConfig,
  resolvePayPalConfig,
  sanitizePaymentSettingsForClient,
  mergePaymentSettingsUpdate,
  getPublicPaymentConfig,
  computeOnlineChargeAmount,
  derivePaymentStatus,
  verifyStripeConnection,
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
  createStripeRefund,
  verifyStripeWebhookSignature,
  verifyPayPalConnection,
  createPayPalOrder,
  capturePayPalOrder,
  createPayPalRefund,
  verifyPayPalWebhookSignature,
} = require('./backend/payments');
const {
  dispatchWhatsAppMessage,
  formatShortItDate,
} = require('./backend/jobs');
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
const ALLOWED_APPT_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

if (process.env.TRUST_PROXY !== 'false') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(
  express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl && req.originalUrl.includes('/webhooks/stripe')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: false }));

// Block HTTP access to backend/source/config files before static middleware
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (
    reqPath.startsWith('/.env') ||
    reqPath.startsWith('/.local-dev-db') ||
    reqPath.startsWith('/.git') ||
    reqPath.startsWith('/backend') ||
    reqPath.startsWith('/scripts') ||
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
   PUBLIC ENDPOINTS (NO PII EXPOSED ON SLOTS / OPERATORS + MOBILE PRIVACY SIGN)
   ============================================================================ */
app.get('/api/public/operators', async (_req, res, next) => {
  try {
    const operators = await getStore().listOperators(true);
    return res.json({
      ok: true,
      operators: operators.map((o) => ({
        id: Number(o.id),
        name: o.name,
        role: o.role,
        color: o.color,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/public/promotions', async (_req, res, next) => {
  try {
    const today = getRomeToday();
    const promotions = await getStore().listPromotions({ activeOnly: true, todayIso: today });
    return res.json({
      ok: true,
      today,
      promotions: promotions.map((p) => ({
        id: Number(p.id),
        title: p.title,
        badge_text: p.badge_text,
        month_label: p.month_label,
        description: p.description,
        services: Array.isArray(p.services) ? p.services : [],
        original_price: Number(p.original_price || 0),
        promo_price: Number(p.promo_price || 0),
        duration_minutes: Number(p.duration_minutes || 60),
        valid_from: p.valid_from || null,
        valid_until: p.valid_until || null,
        featured: Number(p.featured) === 1 ? 1 : 0,
        show_on_hero: Number(p.show_on_hero) === 1 ? 1 : 0,
        sort_order: Number(p.sort_order || 0),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/public/slots', async (req, res, next) => {
  try {
    const dateStr = String(req.query.date || '').trim();
    const duration = Math.max(15, Math.min(300, Number.parseInt(req.query.duration || '60', 10) || 60));
    const operatorId = Number.parseInt(req.query.operator_id || '0', 10) || 0;
    if (!isValidIsoDate(dateStr)) {
      return sendError(res, 'Formato data non valido (atteso YYYY-MM-DD).', 400);
    }

    const ctx = await getStore().getPublicAvailabilityContext(dateStr);
    const avail = computeDateSlotAvailability({
      dateStr,
      durationMinutes: duration,
      operators: ctx.operators,
      absences: ctx.absences,
      bookedRows: ctx.bookedRows,
      requestedOperatorId: operatorId,
    });

    if (avail.closed) {
      return res.json({
        ok: true,
        date: dateStr,
        closed: true,
        past: avail.past,
        step_minutes: avail.stepMinutes,
        min_lead_minutes: avail.minLeadMinutes,
        booked_slots: avail.bookedSlots,
        free_slots: [],
        day_slots: [],
      });
    }

    return res.json({
      ok: true,
      date: dateStr,
      closed: false,
      past: avail.past,
      step_minutes: avail.stepMinutes,
      min_lead_minutes: avail.minLeadMinutes,
      booked_slots: avail.bookedSlots,
      free_slots: avail.freeSlots,
      day_slots: avail.daySlots,
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/public/next-available', async (req, res, next) => {
  try {
    const rawFrom = String(req.query.from || '').trim();
    const todayStr = getRomeToday();
    const fromDate = isValidIsoDate(rawFrom) && rawFrom >= todayStr ? rawFrom : todayStr;
    const duration = Math.max(15, Math.min(300, Number.parseInt(req.query.duration || '60', 10) || 60));
    const operatorId = Number.parseInt(req.query.operator_id || '0', 10) || 0;

    const [y, m, d] = fromDate.split('-').map(Number);
    const maxDays = 35;
    const endDate = new Date(Date.UTC(y, m - 1, d + maxDays - 1)).toISOString().slice(0, 10);
    const range = await getStore().getPublicAvailabilityRange(fromDate, endDate);
    const found = findNextAvailableDate({
      fromDateStr: fromDate,
      durationMinutes: duration,
      operators: range.operators,
      absences: range.absences,
      bookedRowsByDate: range.bookedRowsByDate,
      requestedOperatorId: operatorId,
      maxDays,
    });
    return res.json({ ok: true, ...found });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/public/privacy-sign/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return sendError(res, 'Link non valido.', 400);
    }
    const requestInfo = await getStore().getPrivacySignatureByToken(token);
    if (!requestInfo) {
      return sendError(res, 'Richiesta firma privacy non trovata o scaduta.', 404);
    }
    return res.json({ ok: true, request: requestInfo });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/privacy-sign/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    const body = req.body || {};
    const otpCode = String(body.otp_code || '').trim();
    const signatureName = String(body.signature_name || '').trim();
    const signatureData = String(body.signature_data || '').trim();
    const privacyAccepted = Boolean(body.privacy_accepted);
    const marketingConsent = Boolean(body.marketing_consent);

    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return sendError(res, 'Link non valido.', 400);
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return sendError(res, 'Inserisci il codice OTP a 6 cifre ricevuto via WhatsApp/SMS.', 422);
    }
    if (!privacyAccepted) {
      return sendError(res, "Devi accettare l'Informativa Privacy GDPR per confermare.", 422);
    }
    if (signatureName.length < 2) {
      return sendError(res, 'Inserisci il tuo Nome e Cognome per firmare.', 422);
    }

    const result = await getStore().completePrivacySignature({
      token,
      otpCode,
      signatureName: signatureName.slice(0, 140),
      signatureData: signatureData.startsWith('data:image/') ? signatureData.slice(0, 200000) : null,
      marketingConsent,
      nowStr: formatRomeNow(),
      ipHash: hashIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 250),
    });

    return res.json(result);
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
    let totalPrice = Number(body.total_price || 0) || 0;
    let durationMinutes = Math.max(0, Number.parseInt(body.duration_minutes || '0', 10) || 0);
    let appointmentDate = String(body.appointment_date || getRomeToday()).trim();
    let startTime = String(body.start_time || '11:00').trim();
    const operatorId = Number.parseInt(body.operator_id || '0', 10) || 0;

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

    const store = getStore();
    const hasPromoItem = services.some((s) => s && typeof s === 'object' && (s.is_promotion || Number(s.promo_id) > 0));
    let normalizedServices = services;
    if (hasPromoItem) {
      const activePromos = await store.listPromotions({ activeOnly: true, todayIso: getRomeToday() });
      const promoMap = new Map(activePromos.map((p) => [Number(p.id), p]));
      normalizedServices = [];
      for (const item of services) {
        const promoId = Number(item?.promo_id || 0);
        if (item?.is_promotion || promoId > 0) {
          const matchedPromo = promoMap.get(promoId);
          if (!matchedPromo) {
            return sendError(
              res,
              'Una delle promozioni selezionate non è più attiva o è scaduta. Ricarica la vetrina per vedere le offerte aggiornate.',
              422,
              'PROMO_UNAVAILABLE'
            );
          }
          normalizedServices.push({
            id: `promo-${matchedPromo.id}`,
            promo_id: matchedPromo.id,
            is_promotion: true,
            name: `Promo: ${matchedPromo.title}`,
            price: Number(matchedPromo.promo_price || 0),
            original_price: Number(matchedPromo.original_price || 0),
            duration: Number(matchedPromo.duration_minutes || 60),
            included_services: matchedPromo.services || [],
          });
        } else {
          normalizedServices.push(item);
        }
      }
      totalPrice = Number(
        normalizedServices.reduce((sum, s) => sum + Number(s?.price || 0), 0).toFixed(2)
      );
      const sumDur = normalizedServices.reduce((sum, s) => sum + Math.max(0, Number(s?.duration || 0)), 0);
      if (sumDur > 0) durationMinutes = sumDur;
    }

    if (mode === 'booking') {
      if (!isValidIsoDate(appointmentDate)) return sendError(res, 'Data appuntamento non valida.', 422);
      if (!/^\d{2}:\d{2}$/.test(startTime)) return sendError(res, 'Orario non valido.', 422);
      if (durationMinutes < 15) durationMinutes = 30;
    } else {
      if (!isValidIsoDate(appointmentDate)) appointmentDate = getRomeToday();
      if (!/^\d{2}:\d{2}$/.test(startTime)) startTime = '09:30';
    }

    const serviceNames = normalizedServices
      .map((s) => (s && typeof s === 'object' ? String(s.name || '').trim() : ''))
      .filter(Boolean);
    const servicesSummary = serviceNames.join(' + ').slice(0, 490) || 'Trattamento Studio';
    const privacyVersion = getPrivacyVersion();
    const nowStr = formatRomeNow();

    const isStripeFull = paymentMethod === 'stripe_full';
    const isStripeDeposit = paymentMethod === 'stripe_deposit';
    const isPaypalFull = paymentMethod === 'paypal_full';
    const isPaypalDeposit = paymentMethod === 'paypal_deposit';
    const wantsStripeCheckout = isStripeFull || isStripeDeposit;
    const wantsPaypalCheckout = isPaypalFull || isPaypalDeposit;
    const isDepositChoice = isStripeDeposit || isPaypalDeposit;
    const payScope = isDepositChoice ? 'deposit' : 'full';

    let stripeCfg = null;
    let paypalCfg = null;
    let chargeAmount = 0;

    if (wantsStripeCheckout || wantsPaypalCheckout) {
      const rawPaySettings = (await store.getStudioSetting('payment_settings')) || {};
      const providerCfg = wantsStripeCheckout
        ? resolveStripeConfig(rawPaySettings)
        : resolvePayPalConfig(rawPaySettings);
      const providerLabel = wantsStripeCheckout ? 'Stripe' : 'PayPal';
      const unavailCode = wantsStripeCheckout ? 'STRIPE_UNAVAILABLE' : 'PAYPAL_UNAVAILABLE';
      const minCode = wantsStripeCheckout ? 'STRIPE_MIN_AMOUNT' : 'PAYPAL_MIN_AMOUNT';

      if (
        !providerCfg.ready ||
        (!isDepositChoice && !providerCfg.allow_online_full) ||
        (isDepositChoice && !providerCfg.allow_online_deposit)
      ) {
        return sendError(
          res,
          `Il pagamento online con ${providerLabel} non è attualmente disponibile. Seleziona Salda in Studio.`,
          422,
          unavailCode
        );
      }
      chargeAmount = computeOnlineChargeAmount(totalPrice, payScope, providerCfg.deposit_percent);
      if (chargeAmount < 0.5) {
        return sendError(
          res,
          `L'importo minimo per pagare online con ${providerLabel} è € 0,50.`,
          422,
          minCode
        );
      }
      if (wantsStripeCheckout) stripeCfg = providerCfg;
      else paypalCfg = providerCfg;
    }

    const storedPaymentMethod = wantsStripeCheckout
      ? 'stripe_online'
      : wantsPaypalCheckout
      ? 'paypal_online'
      : normalizePaymentMethod(paymentMethod, 'studio');

    const created = await store.createPublicBooking({
      mode,
      appointmentDate,
      startTime,
      durationMinutes,
      operatorId,
      servicesJson: JSON.stringify(normalizedServices),
      servicesSummary,
      totalPrice,
      paymentMethod: storedPaymentMethod,
      paymentStatus: 'unpaid',
      paidAmount: 0,
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

    if (wantsStripeCheckout) {
      const origin = getRequestOrigin(req);
      const codeParam = encodeURIComponent(created.bookingCode);
      const successUrl = `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}&code=${codeParam}`;
      const cancelUrl = `${origin}/?payment=cancelled&session_id={CHECKOUT_SESSION_ID}&code=${codeParam}`;
      try {
        const session = await createStripeCheckoutSession({
          config: stripeCfg,
          appointment: {
            id: created.appointmentId,
            booking_code: created.bookingCode,
            appointment_date: appointmentDate,
            start_time: startTime,
            total_price: totalPrice,
            client_email: clientEmail,
          },
          items: normalizedServices.map((s) => ({
            title: s?.name || 'Trattamento',
            quantity: 1,
          })),
          chargeAmount,
          payScope,
          successUrl,
          cancelUrl,
        });
        await store.updateAppointmentStripeSession(created.appointmentId, session.id);
        return res.status(201).json({
          ok: true,
          booking_code: created.bookingCode,
          appointment_id: created.appointmentId,
          client_id: created.clientId,
          privacy_accepted_at: nowStr,
          privacy_version: privacyVersion,
          whatsapp_sent: false,
          requires_stripe_redirect: true,
          requires_payment_redirect: true,
          payment_provider: 'stripe',
          checkout_url: session.url,
          stripe_session_id: session.id,
          pay_scope: payScope,
          charge_amount: chargeAmount,
          total_price: totalPrice,
        });
      } catch (stripeErr) {
        await store.cancelUnpaidPendingAppointment(
          created.appointmentId,
          `Sessione Stripe non avviata: ${stripeErr?.message || 'errore'}`
        );
        return sendError(
          res,
          stripeErr?.message || 'Impossibile avviare il checkout Stripe in questo momento. Riprova o scegli Salda in Studio.',
          stripeErr?.status || 502,
          'STRIPE_SESSION_FAILED'
        );
      }
    }

    if (wantsPaypalCheckout) {
      const origin = getRequestOrigin(req);
      const codeParam = encodeURIComponent(created.bookingCode);
      const returnUrl = `${origin}/?payment=paypal_success&code=${codeParam}`;
      const cancelUrl = `${origin}/?payment=paypal_cancelled&code=${codeParam}`;
      try {
        const order = await createPayPalOrder({
          config: paypalCfg,
          appointment: {
            id: created.appointmentId,
            booking_code: created.bookingCode,
            appointment_date: appointmentDate,
            start_time: startTime,
            total_price: totalPrice,
            client_email: clientEmail,
          },
          items: normalizedServices.map((s) => ({
            title: s?.name || 'Trattamento',
            quantity: 1,
          })),
          chargeAmount,
          payScope,
          returnUrl,
          cancelUrl,
        });
        if (!order?.id || !order?.approveUrl) {
          throw new Error('Link di approvazione PayPal non disponibile nella risposta API.');
        }
        await store.updateAppointmentPayPalOrder(created.appointmentId, order.id);
        return res.status(201).json({
          ok: true,
          booking_code: created.bookingCode,
          appointment_id: created.appointmentId,
          client_id: created.clientId,
          privacy_accepted_at: nowStr,
          privacy_version: privacyVersion,
          whatsapp_sent: false,
          requires_stripe_redirect: false,
          requires_payment_redirect: true,
          payment_provider: 'paypal',
          checkout_url: order.approveUrl,
          paypal_order_id: order.id,
          pay_scope: payScope,
          charge_amount: chargeAmount,
          total_price: totalPrice,
        });
      } catch (paypalErr) {
        await store.cancelUnpaidPendingAppointment(
          created.appointmentId,
          `Ordine PayPal non avviato: ${paypalErr?.message || 'errore'}`
        );
        return sendError(
          res,
          paypalErr?.message || 'Impossibile avviare il checkout PayPal in questo momento. Riprova o scegli Salda in Studio.',
          paypalErr?.status || 502,
          'PAYPAL_ORDER_FAILED'
        );
      }
    }

    return res.status(201).json({
      ok: true,
      booking_code: created.bookingCode,
      appointment_id: created.appointmentId,
      client_id: created.clientId,
      privacy_accepted_at: nowStr,
      privacy_version: privacyVersion,
      whatsapp_sent: false,
      requires_stripe_redirect: false,
      requires_payment_redirect: false,
      payment_provider: 'studio',
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/public/payment-config', async (_req, res, next) => {
  try {
    const store = getStore();
    const raw = (await store.getStudioSetting('payment_settings')) || {};
    return res.json({ ok: true, config: getPublicPaymentConfig(raw) });
  } catch (err) {
    return next(err);
  }
});

async function applyStripePaidSession(store, session, stripeCfg, bookingCodeHint = '') {
  const code = String(session?.client_reference_id || session?.metadata?.booking_code || bookingCodeHint || '').trim();
  let appt = code ? await store.getAppointmentByCode(code) : null;
  if (!appt && session?.id) {
    appt = await store.getAppointmentByStripeSession(session.id);
  }
  if (!appt) return { found: false, paid: false, appointment: null };

  const isPaidSession = session?.payment_status === 'paid';
  if (!isPaidSession) {
    return { found: true, paid: false, appointment: appt };
  }

  const paidEur =
    Number(session.amount_total || 0) > 0
      ? roundMoney(Number(session.amount_total) / 100)
      : roundMoney(session?.metadata?.charge_amount || appt.total_price);

  const totalEur = roundMoney(appt.total_price);
  const payScope = session?.metadata?.pay_scope === 'deposit' || (totalEur > 0 && paidEur < totalEur - 0.01)
    ? 'deposit'
    : 'full';
  const nextPaymentStatus = totalEur > 0 && paidEur < totalEur - 0.01 ? 'partial' : 'paid';
  const nextApptStatus =
    stripeCfg.auto_confirm_on_paid && appt.status === 'pending' ? 'confirmed' : appt.status;
  const intentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const payRes = await store.recordAppointmentPayment({
    appointmentId: appt.id,
    paymentStatus: nextPaymentStatus,
    paymentMethod: 'stripe_online',
    paidAmount: paidEur,
    transactionAmount: paidEur,
    direction: 'payment',
    stripeSessionId: session.id,
    stripePaymentIntent: intentId,
    paymentNotes:
      payScope === 'deposit'
        ? `Acconto online Stripe (${paidEur.toFixed(2)} €)`
        : `Saldo completo online Stripe (${paidEur.toFixed(2)} €)`,
    transactionNotes:
      payScope === 'deposit' ? 'Acconto online via Stripe Checkout' : 'Saldo online via Stripe Checkout',
    statusOverride: nextApptStatus,
    nowStr: formatRomeNow(),
  });

  return { found: true, paid: true, ...payRes };
}

async function applyPayPalPaidCapture(store, summary, paypalCfg, bookingCodeHint = '') {
  const code = String(summary?.bookingCode || bookingCodeHint || '').trim();
  const orderId = String(summary?.orderId || '').trim();
  const captureId = String(summary?.captureId || '').trim();
  const apptIdHint = Number.parseInt(String(summary?.appointmentIdHint || '0'), 10) || 0;

  let appt = code ? await store.getAppointmentByCode(code) : null;
  if (!appt && orderId) {
    appt = await store.getAppointmentByPayPalOrder(orderId);
  }
  if (!appt && captureId) {
    appt = await store.getAppointmentByPayPalCapture(captureId);
  }
  if (!appt && apptIdHint > 0) {
    appt = await store.getAppointmentById(apptIdHint);
  }
  if (!appt) return { found: false, paid: false, appointment: null };

  const statusUpper = String(summary?.status || '').toUpperCase();
  const capStatusUpper = String(summary?.captureStatus || '').toUpperCase();
  const isPaid = statusUpper === 'COMPLETED' || capStatusUpper === 'COMPLETED';
  if (!isPaid) {
    return { found: true, paid: false, appointment: appt };
  }

  const paidEur =
    Number(summary?.amountEur || 0) > 0
      ? roundMoney(summary.amountEur)
      : roundMoney(appt.total_price);

  const totalEur = roundMoney(appt.total_price);
  const nextPaymentStatus = totalEur > 0 && paidEur < totalEur - 0.01 ? 'partial' : 'paid';
  const payScope = nextPaymentStatus === 'partial' ? 'deposit' : 'full';
  const nextApptStatus =
    paypalCfg.auto_confirm_on_paid && appt.status === 'pending' ? 'confirmed' : appt.status;

  const payRes = await store.recordAppointmentPayment({
    appointmentId: appt.id,
    paymentStatus: nextPaymentStatus,
    paymentMethod: 'paypal_online',
    paidAmount: paidEur,
    transactionAmount: paidEur,
    direction: 'payment',
    paypalOrderId: orderId || appt.paypal_order_id || null,
    paypalCaptureId: captureId || appt.paypal_capture_id || null,
    paymentNotes:
      payScope === 'deposit'
        ? `Acconto online PayPal (${paidEur.toFixed(2)} €)`
        : `Saldo completo online PayPal (${paidEur.toFixed(2)} €)`,
    transactionNotes:
      payScope === 'deposit' ? 'Acconto online via PayPal Checkout' : 'Saldo online via PayPal Checkout',
    statusOverride: nextApptStatus,
    nowStr: formatRomeNow(),
  });

  return { found: true, paid: true, ...payRes };
}

function formatPublicPaymentReceipt(appt, chargeAmountFallback = null) {
  if (!appt) return null;
  const total = roundMoney(appt.total_price);
  const paid = roundMoney(appt.paid_amount ?? chargeAmountFallback ?? 0);
  return {
    booking_code: appt.booking_code,
    mode: appt.mode,
    status: appt.status,
    payment_status: appt.payment_status || 'unpaid',
    payment_method: appt.payment_method || 'studio',
    total_price: total,
    paid_amount: paid,
    remaining_amount: Math.max(0, roundMoney(total - paid)),
    appointment_date: appt.appointment_date,
    start_time: String(appt.start_time || '').slice(0, 5),
    services_summary: appt.services_summary,
    operator_name: appt.operator_name || 'Giulia',
    client_name: appt.client_name,
  };
}

app.post('/api/public/stripe/verify-session', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sessionId = String(body.session_id || '').trim();
    const bookingCode = String(body.booking_code || '').trim();
    if (!sessionId) {
      return sendError(res, 'Parametro session_id mancante.', 422);
    }

    const store = getStore();
    const rawPaySettings = (await store.getStudioSetting('payment_settings')) || {};
    const stripeCfg = resolveStripeConfig(rawPaySettings);
    if (!stripeCfg.configured) {
      return sendError(res, 'Configurazione Stripe non attiva.', 400);
    }

    const session = await retrieveStripeCheckoutSession({ config: stripeCfg, sessionId });
    const sessionCode = String(session?.client_reference_id || session?.metadata?.booking_code || '').trim();
    if (bookingCode && sessionCode && bookingCode !== sessionCode) {
      return sendError(res, 'Sessione Stripe non corrispondente al codice prenotazione.', 403);
    }

    const applied = await applyStripePaidSession(store, session, stripeCfg, bookingCode);
    if (!applied.found) {
      return sendError(res, 'Prenotazione associata alla sessione Stripe non trovata.', 404);
    }

    return res.json({
      ok: true,
      paid: Boolean(applied.paid),
      duplicate: Boolean(applied.duplicate),
      receipt: formatPublicPaymentReceipt(applied.appointment),
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/paypal/capture-order', async (req, res, next) => {
  try {
    const body = req.body || {};
    const orderId = String(body.order_id || body.token || '').trim();
    const bookingCode = String(body.booking_code || '').trim();
    if (!orderId) {
      return sendError(res, 'Parametro order_id PayPal mancante.', 422);
    }

    const store = getStore();
    const rawPaySettings = (await store.getStudioSetting('payment_settings')) || {};
    const paypalCfg = resolvePayPalConfig(rawPaySettings);
    if (!paypalCfg.configured) {
      return sendError(res, 'Configurazione PayPal non attiva.', 400);
    }

    let existingAppt = bookingCode ? await store.getAppointmentByCode(bookingCode) : null;
    if (!existingAppt) {
      existingAppt = await store.getAppointmentByPayPalOrder(orderId);
    }
    if (existingAppt && existingAppt.paypal_order_id && existingAppt.paypal_order_id !== orderId) {
      return sendError(res, 'Ordine PayPal non corrispondente al codice prenotazione.', 403);
    }
    if (
      existingAppt &&
      existingAppt.paypal_order_id === orderId &&
      existingAppt.paypal_capture_id &&
      ['paid', 'partial'].includes(existingAppt.payment_status)
    ) {
      return res.json({
        ok: true,
        paid: true,
        duplicate: true,
        receipt: formatPublicPaymentReceipt(existingAppt),
      });
    }

    const captured = await capturePayPalOrder({ config: paypalCfg, orderId });
    if (bookingCode && captured.bookingCode && bookingCode !== captured.bookingCode) {
      return sendError(res, 'Ordine PayPal non corrispondente al codice prenotazione.', 403);
    }

    const applied = await applyPayPalPaidCapture(store, captured, paypalCfg, bookingCode);
    if (!applied.found) {
      return sendError(res, "Prenotazione associata all'ordine PayPal non trovata.", 404);
    }

    return res.json({
      ok: true,
      paid: Boolean(applied.paid),
      duplicate: Boolean(applied.duplicate),
      receipt: formatPublicPaymentReceipt(applied.appointment),
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/payment-fallback-studio', async (req, res, next) => {
  try {
    const body = req.body || {};
    const bookingCode = String(body.booking_code || '').trim();
    const sessionId = String(body.session_id || '').trim();
    const orderId = String(body.order_id || body.token || '').trim();
    if (!bookingCode) return sendError(res, 'Codice prenotazione mancante.', 422);

    const store = getStore();
    const appt = await store.getAppointmentByCode(bookingCode);
    if (!appt) return sendError(res, 'Prenotazione non trovata.', 404);
    if (sessionId && appt.stripe_session_id && appt.stripe_session_id !== sessionId) {
      return sendError(res, 'Sessione non corrispondente alla prenotazione.', 403);
    }
    if (orderId && appt.paypal_order_id && appt.paypal_order_id !== orderId) {
      return sendError(res, 'Ordine PayPal non corrispondente alla prenotazione.', 403);
    }
    if ((appt.payment_status || 'unpaid') !== 'unpaid') {
      return res.json({ ok: true, already_paid: true, receipt: formatPublicPaymentReceipt(appt) });
    }

    const updated = await store.fallbackAppointmentToStudioPayment(appt.id);
    return res.json({ ok: true, receipt: formatPublicPaymentReceipt(updated) });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/public/payment-cancel-pending', async (req, res, next) => {
  try {
    const body = req.body || {};
    const bookingCode = String(body.booking_code || '').trim();
    const sessionId = String(body.session_id || '').trim();
    const orderId = String(body.order_id || body.token || '').trim();
    if (!bookingCode) return sendError(res, 'Codice prenotazione mancante.', 422);

    const store = getStore();
    const appt = await store.getAppointmentByCode(bookingCode);
    if (!appt) return sendError(res, 'Prenotazione non trovata.', 404);
    if (sessionId && appt.stripe_session_id && appt.stripe_session_id !== sessionId) {
      return sendError(res, 'Sessione non corrispondente alla prenotazione.', 403);
    }
    if (orderId && appt.paypal_order_id && appt.paypal_order_id !== orderId) {
      return sendError(res, 'Ordine PayPal non corrispondente alla prenotazione.', 403);
    }

    const cancelled = await store.cancelUnpaidPendingAppointment(appt.id);
    return res.json({ ok: true, receipt: formatPublicPaymentReceipt(cancelled) });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/webhooks/stripe', async (req, res, next) => {
  try {
    const store = getStore();
    const rawPaySettings = (await store.getStudioSetting('payment_settings')) || {};
    const stripeCfg = resolveStripeConfig(rawPaySettings);
    const sigHeader = req.headers['stripe-signature'];
    const payloadRaw = req.rawBody || JSON.stringify(req.body || {});
    const sigCheck = verifyStripeWebhookSignature(payloadRaw, sigHeader, stripeCfg.stripe_webhook_secret);
    if (!sigCheck.valid) {
      return sendError(res, sigCheck.reason || 'Firma Webhook Stripe non valida.', 400, 'STRIPE_SIGNATURE_INVALID');
    }

    const event =
      req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
        ? req.body
        : JSON.parse(Buffer.isBuffer(payloadRaw) ? payloadRaw.toString('utf8') : String(payloadRaw || '{}'));

    const eventType = String(event?.type || '');
    const obj = event?.data?.object || {};

    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
      await applyStripePaidSession(store, obj, stripeCfg);
    } else if (eventType === 'checkout.session.expired') {
      if (obj?.id) {
        const appt = await store.getAppointmentByStripeSession(obj.id);
        if (appt && appt.status === 'pending' && (appt.payment_status || 'unpaid') === 'unpaid') {
          await store.cancelUnpaidPendingAppointment(appt.id, 'Sessione Stripe Checkout scaduta');
        }
      }
    } else if (eventType === 'charge.refunded') {
      const piId = typeof obj?.payment_intent === 'string' ? obj.payment_intent : obj?.payment_intent?.id || '';
      if (piId) {
        const allAppts = await store.listAppointments({});
        const match = allAppts.find((a) => a.stripe_payment_intent === piId);
        if (match) {
          const refundedEur = roundMoney(Number(obj.amount_refunded || 0) / 100);
          const alreadyPaid = roundMoney(match.paid_amount);
          let deltaRefund = Math.min(alreadyPaid, refundedEur);
          if (Number(obj.amount || 0) > 0) {
            const remainingAfterRefund = Math.max(0, roundMoney(Number(obj.amount) / 100 - refundedEur));
            deltaRefund = Math.max(0, roundMoney(alreadyPaid - remainingAfterRefund));
          }
          await store.recordAppointmentPayment({
            appointmentId: match.id,
            paymentMethod: 'stripe_online',
            transactionAmount: deltaRefund > 0 ? deltaRefund : alreadyPaid,
            direction: 'refund',
            stripePaymentIntent: piId,
            paymentNotes: `Rimborso registrato da webhook Stripe (€ ${refundedEur.toFixed(2)})`,
            transactionNotes: 'Rimborso Stripe webhook (charge.refunded)',
            nowStr: formatRomeNow(),
          });
        }
      }
    }

    return res.json({ ok: true, received: true, event_type: eventType });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/webhooks/paypal', async (req, res, next) => {
  try {
    const store = getStore();
    const rawPaySettings = (await store.getStudioSetting('payment_settings')) || {};
    const paypalCfg = resolvePayPalConfig(rawPaySettings);
    if (!paypalCfg.configured) {
      return sendError(res, 'Configurazione PayPal non attiva.', 400, 'PAYPAL_NOT_CONFIGURED');
    }

    const event = req.body && typeof req.body === 'object' ? req.body : {};
    const sigCheck = await verifyPayPalWebhookSignature({
      config: paypalCfg,
      headers: req.headers,
      webhookEvent: event,
    });
    if (!sigCheck.valid) {
      return sendError(res, sigCheck.reason || 'Firma Webhook PayPal non valida.', 400, 'PAYPAL_SIGNATURE_INVALID');
    }

    const eventType = String(event?.event_type || '').trim();
    const resource = event?.resource || {};

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = String(resource?.supplementary_data?.related_ids?.order_id || resource?.order_id || '').trim();
      const captureId = String(resource?.id || '').trim();
      const customRaw = String(resource?.custom_id || '').trim();
      const invoiceCode = String(resource?.invoice_id || '').trim();
      const bookingCodeHint = invoiceCode || (/^GBS-/i.test(customRaw) ? customRaw : '');
      const apptIdHint = /^\d+$/.test(customRaw) ? Number.parseInt(customRaw, 10) : 0;

      await applyPayPalPaidCapture(
        store,
        {
          orderId,
          captureId,
          status: resource?.status || 'COMPLETED',
          captureStatus: resource?.status || 'COMPLETED',
          amountEur: roundMoney(resource?.amount?.value || 0),
          bookingCode: bookingCodeHint,
          appointmentIdHint: apptIdHint,
        },
        paypalCfg,
        bookingCodeHint
      );
    } else if (eventType === 'PAYMENT.CAPTURE.REFUNDED' || eventType === 'PAYMENT.CAPTURE.REVERSED') {
      const upLink = (Array.isArray(resource?.links) ? resource.links : []).find((l) => l.rel === 'up');
      const capFromLink = upLink?.href ? (upLink.href.match(/\/captures\/([^/?]+)/) || [])[1] || '' : '';
      const captureId = String(resource?.capture_id || capFromLink || '').trim();
      const orderId = String(resource?.supplementary_data?.related_ids?.order_id || resource?.order_id || '').trim();
      const customRaw = String(resource?.custom_id || '').trim();

      let match = captureId ? await store.getAppointmentByPayPalCapture(captureId) : null;
      if (!match && orderId) match = await store.getAppointmentByPayPalOrder(orderId);
      if (!match && /^GBS-/i.test(customRaw)) match = await store.getAppointmentByCode(customRaw);
      if (!match && /^\d+$/.test(customRaw)) match = await store.getAppointmentById(Number.parseInt(customRaw, 10));

      if (match && match.payment_status !== 'refunded' && roundMoney(match.paid_amount) > 0) {
        const refundedEur = roundMoney(resource?.amount?.value || 0);
        const alreadyPaid = roundMoney(match.paid_amount);
        const txRefund = refundedEur > 0 ? Math.min(alreadyPaid, refundedEur) : alreadyPaid;
        await store.recordAppointmentPayment({
          appointmentId: match.id,
          paymentMethod: 'paypal_online',
          transactionAmount: txRefund,
          direction: 'refund',
          paypalOrderId: match.paypal_order_id || orderId || null,
          paypalCaptureId: match.paypal_capture_id || captureId || null,
          paymentNotes: `Rimborso registrato da webhook PayPal (€ ${txRefund.toFixed(2)})`,
          transactionNotes: `Rimborso PayPal webhook (${resource?.id || eventType})`,
          nowStr: formatRomeNow(),
        });
      }
    }

    return res.json({ ok: true, received: true, event_type: eventType });
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
    const operatorId = Number.parseInt(req.query.operator_id || '0', 10) || 0;

    const appointments = await getStore().listAppointments({
      startDate: isValidIsoDate(startDate) ? startDate : '',
      endDate: isValidIsoDate(endDate) ? endDate : '',
      status: ALLOWED_APPT_STATUSES.includes(status) ? status : '',
      clientId,
      operatorId,
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

    if (action === 'reschedule') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);

      const date = String(body.appointment_date || '').trim();
      const time = String(body.start_time || '').trim();
      if (!isValidIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return sendError(res, 'Data o orario non validi.', 422);
      }

      const rawDuration = Number.parseInt(String(body.duration_minutes ?? '60'), 10);
      const duration = Math.max(15, Math.min(600, Number.isFinite(rawDuration) ? rawDuration : 60));
      const operatorId =
        body.operator_id !== undefined ? Number.parseInt(String(body.operator_id || '0'), 10) || null : undefined;
      let status;
      if (body.status !== undefined) {
        if (!ALLOWED_APPT_STATUSES.includes(body.status)) {
          return sendError(res, 'Stato appuntamento non valido.', 422);
        }
        status = body.status;
      }

      const updated = await store.rescheduleAppointment(id, {
        date,
        time,
        duration,
        operatorId,
        status,
      });
      if (!updated) return sendError(res, 'Appuntamento non trovato.', 404);
      return res.json({
        ok: true,
        updated_id: id,
        appointment_date: date,
        start_time: time,
        duration_minutes: duration,
      });
    }

    if (action === 'record_payment') {
      const id = Number.parseInt(body.id || body.appointment_id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
      const appt = await store.getAppointmentById(id);
      if (!appt) return sendError(res, 'Appuntamento non trovato.', 404);

      const method = normalizePaymentMethod(body.payment_method, appt.payment_method || 'contanti');
      const total = roundMoney(appt.total_price);
      let reqStatus = body.payment_status ? normalizePaymentStatus(body.payment_status) : null;
      let targetPaidAmount = body.paid_amount !== undefined ? roundMoney(body.paid_amount) : null;
      const txAmount = body.transaction_amount !== undefined ? roundMoney(body.transaction_amount) : null;

      if (targetPaidAmount === null && txAmount === null) {
        if (reqStatus === 'paid') targetPaidAmount = total;
        else if (reqStatus === 'unpaid') targetPaidAmount = 0;
      }
      const finalStatus = reqStatus || derivePaymentStatus({ totalPrice: total, paidAmount: targetPaidAmount ?? appt.paid_amount });
      const statusOverride =
        body.confirm_appointment && appt.status === 'pending' && finalStatus !== 'unpaid' ? 'confirmed' : null;

      const recorded = await store.recordAppointmentPayment({
        appointmentId: id,
        paymentStatus: finalStatus,
        paymentMethod: method,
        paidAmount: targetPaidAmount,
        transactionAmount: txAmount,
        direction: body.direction === 'refund' ? 'refund' : 'payment',
        paymentNotes: body.payment_notes !== undefined ? String(body.payment_notes || '').trim() : null,
        transactionNotes:
          String(body.transaction_notes || '').trim() ||
          `Incasso registrato in agenda (${PAYMENT_METHOD_LABELS[method] || method})`,
        statusOverride,
        adminId: req.admin?.id || null,
        nowStr: formatRomeNow(),
      });
      return res.json({ ok: true, appointment: recorded.appointment, transaction: recorded.transaction });
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

      const existingAppt = await store.getAppointmentById(id);
      if (!existingAppt) return sendError(res, 'Appuntamento non trovato.', 404);

      const operatorId = body.operator_id ? Number.parseInt(body.operator_id, 10) || null : undefined;
      const nextTotalPrice = Number(body.total_price || 0) || 0;
      const hasPaymentFields =
        body.payment_status !== undefined ||
        body.payment_method !== undefined ||
        body.paid_amount !== undefined ||
        body.payment_notes !== undefined;

      await store.updateAppointment(id, {
        date,
        time,
        duration: Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60),
        operatorId,
        servicesJson: Array.isArray(body.services) ? JSON.stringify(body.services) : null,
        servicesSummary: (String(body.services_summary || '').trim() || 'Trattamento personalizzato').slice(0, 490),
        totalPrice: nextTotalPrice,
        status,
        notes: String(body.notes || '').trim(),
      });

      if (hasPaymentFields) {
        const nextMethod = normalizePaymentMethod(body.payment_method, existingAppt.payment_method || 'studio');
        const nextNotes =
          body.payment_notes !== undefined ? String(body.payment_notes || '').trim() : existingAppt.payment_notes || null;
        const prevPaid = roundMoney(existingAppt.paid_amount);
        let nextPaid =
          body.paid_amount !== undefined && body.paid_amount !== ''
            ? Math.max(0, roundMoney(body.paid_amount))
            : prevPaid;
        let nextPayStatus = normalizePaymentStatus(body.payment_status, existingAppt.payment_status || 'unpaid');
        if (nextPayStatus === 'paid' && (body.paid_amount === undefined || nextPaid <= 0) && nextTotalPrice > 0) {
          nextPaid = roundMoney(nextTotalPrice);
        } else if (nextPayStatus === 'unpaid') {
          nextPaid = 0;
        }
        nextPayStatus = derivePaymentStatus({
          totalPrice: nextTotalPrice,
          paidAmount: nextPaid,
          requestedStatus: nextPayStatus,
        });

        if (nextPaid > prevPaid + 0.009) {
          await store.recordAppointmentPayment({
            appointmentId: id,
            paymentStatus: nextPayStatus,
            paymentMethod: nextMethod,
            paidAmount: nextPaid,
            transactionAmount: roundMoney(nextPaid - prevPaid),
            direction: 'payment',
            paymentNotes: nextNotes,
            transactionNotes: `Pagamento aggiornato da scheda appuntamento (${PAYMENT_METHOD_LABELS[nextMethod] || nextMethod})`,
            adminId: req.admin?.id || null,
            nowStr: formatRomeNow(),
          });
        } else {
          await store.updateAppointment(id, {
            date,
            time,
            duration: Math.max(10, Number.parseInt(body.duration_minutes || '60', 10) || 60),
            operatorId,
            servicesJson: Array.isArray(body.services) ? JSON.stringify(body.services) : null,
            servicesSummary: (String(body.services_summary || '').trim() || 'Trattamento personalizzato').slice(0, 490),
            totalPrice: nextTotalPrice,
            status,
            notes: String(body.notes || '').trim(),
            paymentMethod: nextMethod,
            paymentStatus: nextPayStatus,
            paidAmount: nextPaid,
            paymentNotes: nextNotes,
            paidAt: nextPayStatus === 'unpaid' ? null : existingAppt.paid_at || formatRomeNow(),
          });
        }
      }
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
    const apptStatus = ALLOWED_APPT_STATUSES.includes(body.status) ? body.status : 'confirmed';
    const apptMode = body.mode === 'voucher' ? 'voucher' : 'booking';
    const apptOperatorId = Number.parseInt(body.operator_id || '0', 10) || null;
    const createTotalPrice = Number(body.total_price || 0) || 0;
    const createPayMethod = normalizePaymentMethod(body.payment_method, 'studio');
    let createPaidAmount =
      body.paid_amount !== undefined && body.paid_amount !== '' ? Math.max(0, roundMoney(body.paid_amount)) : 0;
    let createPayStatus = normalizePaymentStatus(body.payment_status, 'unpaid');
    if (createPayStatus === 'paid' && createPaidAmount <= 0 && createTotalPrice > 0) {
      createPaidAmount = roundMoney(createTotalPrice);
    }
    createPayStatus = derivePaymentStatus({
      totalPrice: createTotalPrice,
      paidAmount: createPaidAmount,
      requestedStatus: createPayStatus,
    });

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
      operatorId: apptOperatorId,
      servicesJson: JSON.stringify(services),
      servicesSummary: servicesSummary.slice(0, 490),
      totalPrice: createTotalPrice,
      mode: apptMode,
      paymentMethod: createPayMethod,
      paymentStatus: createPayStatus,
      paidAmount: createPaidAmount,
      paymentNotes: String(body.payment_notes || '').trim() || null,
      paidAt: createPayStatus !== 'unpaid' ? formatRomeNow() : null,
      adminId: req.admin?.id || null,
      status: apptStatus,
      notes: String(body.notes || '').trim(),
      ipHash: hashIp(req),
    });

    let whatsappDispatch = null;
    if (apptMode === 'booking' && apptStatus === 'confirmed' && body.send_whatsapp === true) {
      try {
        const [ops, clientList] = await Promise.all([
          store.listOperators(false),
          clientId > 0 ? store.listClients('') : Promise.resolve([]),
        ]);
        const opName = ops.find((o) => Number(o.id) === Number(apptOperatorId))?.name || 'Giulia';
        const resolvedClient = clientId > 0 ? clientList.find((c) => Number(c.id) === Number(clientId)) : null;
        const targetPhone = resolvedClient?.phone || clientPhone;
        const targetName = resolvedClient?.full_name || clientName;
        if (targetPhone) {
          whatsappDispatch = await dispatchWhatsAppMessage({
            store,
            toPhone: targetPhone,
            recipientName: targetName,
            clientId: created.clientId,
            appointmentId: created.id,
            templateCode: 'booking_confirmed',
            vars: {
              nome: targetName,
              data: formatShortItDate(date),
              ora: time,
              trattamenti: servicesSummary,
              servizi: servicesSummary,
              operatore: opName,
              codice: created.bookingCode,
            },
            adminId: req.admin?.id || null,
            triggerSource: 'manual',
          });
        }
      } catch (waErr) {
        console.error('[Giulia Beauty Studio] Errore preparazione WA conferma agenda:', waErr?.message || waErr);
      }
    }

    return res.status(201).json({
      ok: true,
      id: created.id,
      booking_code: created.bookingCode,
      client_id: created.clientId,
      whatsapp_sent: Boolean(whatsappDispatch?.sent),
      whatsapp_dispatch: whatsappDispatch
        ? {
            sent: whatsappDispatch.sent,
            sent_via: whatsappDispatch.sent_via,
            wa_url: whatsappDispatch.wa_url || whatsappDispatch.fallback_url || null,
            message_text: whatsappDispatch.message_text || '',
            error: whatsappDispatch.error || null,
          }
        : null,
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
   ADMIN OPERATORS, SCHEDULES & ABSENCES API
   ============================================================================ */
app.get('/api/admin/operators', requireAdmin, async (_req, res, next) => {
  try {
    const store = getStore();
    const [operators, absences] = await Promise.all([
      store.listOperators(false),
      store.listOperatorAbsences(0),
    ]);
    const hydratedOperators = (operators || []).map((op) => ({
      ...op,
      weekly_schedule: parseOperatorSchedule(op.weekly_schedule_json),
    }));
    return res.json({ ok: true, operators: hydratedOperators, absences });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/operators', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    if (body.action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID operatore non valido.', 400);
      await store.deleteOperator(id);
      return res.json({ ok: true, deleted_id: id });
    }
    const name = String(body.name || '').trim();
    if (name.length < 2) return sendError(res, 'Inserisci il nome dell\'operatore.', 422);
    const schedule = body.weekly_schedule
      ? JSON.stringify(body.weekly_schedule)
      : typeof body.weekly_schedule_json === 'string' && body.weekly_schedule_json
        ? body.weekly_schedule_json
        : JSON.stringify(buildDefaultSchedule());
    const result = await store.saveOperator({
      id: Number.parseInt(body.id || '0', 10) || 0,
      name: name.slice(0, 120),
      role: String(body.role || 'Beauty Specialist').trim().slice(0, 120),
      color: /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#d47491',
      active: body.active !== undefined ? Boolean(body.active) : true,
      weeklyScheduleJson: schedule,
    });
    return res.status(result.status).json({ ok: true, id: result.id });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/absences', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    if (body.action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID assenza non valido.', 400);
      await store.deleteOperatorAbsence(id);
      return res.json({ ok: true, deleted_id: id });
    }
    const operatorId = Number.parseInt(body.operator_id || '0', 10) || 0;
    const startDate = String(body.start_date || '').trim();
    const endDate = String(body.end_date || startDate).trim();
    if (operatorId <= 0 || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || endDate < startDate) {
      return sendError(res, 'Seleziona operatore e intervallo date valido.', 422);
    }
    const startTime = /^\d{2}:\d{2}$/.test(body.start_time || '') ? body.start_time : null;
    const endTime = /^\d{2}:\d{2}$/.test(body.end_time || '') ? body.end_time : null;
    const id = await store.createOperatorAbsence({
      operatorId,
      startDate,
      endDate,
      startTime,
      endTime,
      type: String(body.type || 'ferie').trim().slice(0, 40),
      notes: String(body.notes || '').trim().slice(0, 290),
    });
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN CLIENT CARDS, MORPHOLOGY & PRIVACY MOBILE OTP REQUESTS
   ============================================================================ */
app.post('/api/admin/clients/:id/cards', requireAdmin, async (req, res, next) => {
  try {
    const clientId = Number.parseInt(req.params.id || '0', 10) || 0;
    if (clientId <= 0) return sendError(res, 'Cliente non valida.', 400);
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (title.length < 2) return sendError(res, 'Inserisci il nome della carta o pacchetto.', 422);
    const card = await getStore().createClientCard({
      clientId,
      title: title.slice(0, 140),
      cardType: String(body.card_type || 'package').trim(),
      totalSessions: Number.parseInt(body.total_sessions || '0', 10) || 0,
      remainingCredit: Number(body.remaining_credit || 0) || 0,
      expiresAt: isValidIsoDate(body.expires_at) ? body.expires_at : null,
      notes: String(body.notes || '').trim(),
    });
    return res.status(201).json({ ok: true, card });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/cards/:cardId/use', requireAdmin, async (req, res, next) => {
  try {
    const cardId = Number.parseInt(req.params.cardId || '0', 10) || 0;
    if (cardId <= 0) return sendError(res, 'Carta non valida.', 400);
    const body = req.body || {};
    if (body.action === 'delete') {
      await getStore().deleteClientCard(cardId);
      return res.json({ ok: true, deleted_id: cardId });
    }
    const card = await getStore().useClientCard(cardId, {
      sessionsDelta: Number.parseInt(body.sessions_delta ?? '1', 10),
      creditDelta: Number(body.credit_delta || 0) || 0,
    });
    return res.json({ ok: true, card });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/admin/clients/:id/morpho', requireAdmin, async (req, res, next) => {
  try {
    const clientId = Number.parseInt(req.params.id || '0', 10) || 0;
    if (clientId <= 0) return sendError(res, 'Cliente non valida.', 400);
    const records = await getStore().listClientMorphoRecords(clientId);
    return res.json({ ok: true, records });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/clients/:id/morpho', requireAdmin, async (req, res, next) => {
  try {
    const clientId = Number.parseInt(req.params.id || '0', 10) || 0;
    if (clientId <= 0) return sendError(res, 'Cliente non valida.', 400);
    const body = req.body || {};
    const recordedAt = isValidIsoDate(body.recorded_at) ? body.recorded_at : getRomeToday();
    const weightKg = body.weight_kg !== undefined && body.weight_kg !== '' && body.weight_kg !== null ? Number(body.weight_kg) : null;
    const heightCm = body.height_cm !== undefined && body.height_cm !== '' && body.height_cm !== null ? Number(body.height_cm) : null;
    let bmi = null;
    if (weightKg > 0 && heightCm > 0) {
      bmi = Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
    }
    const photos = Array.isArray(body.photos)
      ? body.photos.filter((p) => typeof p === 'string' && p.startsWith('data:image/')).slice(0, 6)
      : [];
    const record = await getStore().createClientMorphoRecord({
      clientId,
      recordedAt,
      gender: body.gender === 'male' ? 'male' : 'female',
      weightKg,
      heightCm,
      bmi,
      measurementsJson: JSON.stringify(body.measurements || {}),
      annotationsJson: JSON.stringify(Array.isArray(body.annotations) ? body.annotations : []),
      photosJson: JSON.stringify(photos),
      notes: String(body.notes || '').trim(),
    });
    return res.status(201).json({ ok: true, record });
  } catch (err) {
    return next(err);
  }
});

app.delete('/api/admin/morpho/:recordId', requireAdmin, async (req, res, next) => {
  try {
    const recordId = Number.parseInt(req.params.recordId || '0', 10) || 0;
    if (recordId <= 0) return sendError(res, 'ID scheda non valido.', 400);
    await getStore().deleteMorphoRecord(recordId);
    return res.json({ ok: true, deleted_id: recordId });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/clients/:id/privacy-request', requireAdmin, async (req, res, next) => {
  try {
    const clientId = Number.parseInt(req.params.id || '0', 10) || 0;
    if (clientId <= 0) return sendError(res, 'Cliente non valida.', 400);
    const store = getStore();
    const created = await store.createPrivacySignatureRequest({
      clientId,
      privacyVersion: getPrivacyVersion(),
    });

    let whatsappDispatch = null;
    const origin = getRequestOrigin(req);
    const signUrl = `${origin}/privacy-sign.html?token=${encodeURIComponent(created.token)}`;
    const vars = {
      nome: created?.client?.full_name || 'Cliente',
      link: signUrl,
      otp: created.otp_code,
    };

    const sendWaRequested = req.body?.send_whatsapp !== false && req.body?.auto_send !== false;
    if (sendWaRequested && created?.client?.phone) {
      whatsappDispatch = await dispatchWhatsAppMessage({
        store,
        toPhone: created.client.phone,
        recipientName: created.client.full_name,
        clientId,
        templateCode: 'privacy_sign',
        vars,
        adminId: req.admin?.id || null,
        triggerSource: 'auto_privacy',
      });
    } else {
      const templates = await store.listMessageTemplates();
      const tpl = templates.find((t) => t.code === 'privacy_sign');
      const fallbackBody = tpl?.body_template || 'Ciao {nome} ♡ Completa la firma Privacy GDPR qui: {link}\nCodice OTP: *{otp}*';
      const rendered = fallbackBody
        .replace(/\{nome\}/g, vars.nome)
        .replace(/\{link\}/g, vars.link)
        .replace(/\{otp\}/g, vars.otp);
      whatsappDispatch = {
        ok: false,
        sent: false,
        sent_via: 'wa_me',
        wa_url: buildWaMeUrl(created?.client?.phone || '', rendered),
        fallback_url: buildWaMeUrl(created?.client?.phone || '', rendered),
        message_text: rendered,
      };
    }

    return res.status(201).json({ ok: true, request: created, whatsapp_dispatch: whatsappDispatch });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN INVENTORY (SUPPLIERS, PRODUCTS & MOVEMENTS)
   ============================================================================ */
app.get('/api/admin/inventory', requireAdmin, async (_req, res, next) => {
  try {
    const store = getStore();
    const [suppliers, products, movements] = await Promise.all([
      store.listSuppliers(),
      store.listProducts(),
      store.listProductMovements(100),
    ]);
    return res.json({ ok: true, suppliers, products, movements });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/inventory/suppliers', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    if (body.action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID fornitore non valido.', 400);
      await store.deleteSupplier(id);
      return res.json({ ok: true, deleted_id: id });
    }
    const name = String(body.name || '').trim();
    if (name.length < 2) return sendError(res, 'Inserisci il nome del fornitore.', 422);
    const result = await store.saveSupplier({
      id: Number.parseInt(body.id || '0', 10) || 0,
      name: name.slice(0, 140),
      contactName: String(body.contact_name || '').trim(),
      phone: String(body.phone || '').trim(),
      email: String(body.email || '').trim(),
      notes: String(body.notes || '').trim(),
    });
    return res.status(result.status).json({ ok: true, id: result.id });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/inventory/products', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    if (body.action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID prodotto non valido.', 400);
      await store.deleteProduct(id);
      return res.json({ ok: true, deleted_id: id });
    }
    const name = String(body.name || '').trim();
    if (name.length < 2) return sendError(res, 'Inserisci il nome del prodotto.', 422);
    const result = await store.saveProduct({
      id: Number.parseInt(body.id || '0', 10) || 0,
      sku: String(body.sku || '').trim(),
      name: name.slice(0, 140),
      category: String(body.category || 'Rivendita').trim(),
      supplierId: Number.parseInt(body.supplier_id || '0', 10) || null,
      costPrice: Number(body.cost_price || 0) || 0,
      sellPrice: Number(body.sell_price || 0) || 0,
      stockQty: Number.parseInt(body.stock_qty ?? '0', 10) || 0,
      minStockQty: Number.parseInt(body.min_stock_qty ?? '2', 10) || 2,
      unit: String(body.unit || 'pz').trim() || 'pz',
      active: body.active !== undefined ? Boolean(body.active) : true,
    });
    return res.status(result.status).json({ ok: true, id: result.id });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/inventory/movements', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const productId = Number.parseInt(body.product_id || '0', 10) || 0;
    const movementType = ['sale', 'restock', 'cabin_use', 'adjustment'].includes(body.movement_type)
      ? body.movement_type
      : 'sale';
    const quantity = Number.parseInt(body.quantity || '1', 10) || 1;
    if (productId <= 0) return sendError(res, 'Seleziona un prodotto valido.', 422);
    const result = await getStore().recordProductMovement({
      productId,
      movementType,
      quantity,
      unitPrice: body.unit_price,
      clientId: Number.parseInt(body.client_id || '0', 10) || null,
      operatorId: Number.parseInt(body.operator_id || '0', 10) || null,
      notes: String(body.notes || '').trim(),
    });
    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN MESSAGE CENTER (TEMPLATES & LOGS) & ADMIN USERS
   ============================================================================ */
function getRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

app.get('/api/admin/messages', requireAdmin, async (_req, res, next) => {
  try {
    const store = getStore();
    const [templates, logs] = await Promise.all([
      store.listMessageTemplates(),
      store.listMessageLogs(120),
    ]);
    return res.json({
      ok: true,
      templates,
      logs,
      whatsapp_status: getWhatsAppModeStatus(),
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/messages/templates', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    const bodyTemplate = String(body.body_template || '').trim();
    if (!code || !bodyTemplate) {
      return sendError(res, 'Codice e testo template sono obbligatori.', 422);
    }
    const tpl = await getStore().saveMessageTemplate({
      code: code.slice(0, 60),
      title: String(body.title || '').trim().slice(0, 120),
      bodyTemplate,
      metaTemplateName: body.meta_template_name !== undefined ? String(body.meta_template_name || '').trim().slice(0, 120) : undefined,
      metaTemplateLang: body.meta_template_lang !== undefined ? String(body.meta_template_lang || 'it').trim().slice(0, 20) : undefined,
    });
    return res.json({ ok: true, template: tpl });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/messages/logs', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const messageText = String(body.message_text || '').trim();
    if (!messageText) return sendError(res, 'Testo messaggio vuoto.', 422);
    const log = await getStore().createMessageLog({
      clientId: Number.parseInt(body.client_id || '0', 10) || null,
      appointmentId: Number.parseInt(body.appointment_id || '0', 10) || null,
      recipientPhone: String(body.recipient_phone || '').trim(),
      recipientName: String(body.recipient_name || '').trim(),
      channel: String(body.channel || 'whatsapp').trim(),
      templateCode: String(body.template_code || '').trim() || null,
      messageText,
      adminId: req.admin?.id || null,
      status: String(body.status || 'fallback_wa_me').trim(),
      triggerSource: String(body.trigger_source || 'manual').trim(),
      metaPayloadType: String(body.meta_payload_type || 'wa_me').trim(),
    });
    return res.status(201).json({ ok: true, log });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/whatsapp/send', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    const clientId = Number.parseInt(body.client_id || '0', 10) || null;
    const appointmentId = Number.parseInt(body.appointment_id || '0', 10) || null;
    let recipientPhone = String(body.recipient_phone || '').trim();
    let recipientName = String(body.recipient_name || '').trim();

    if (clientId && (!recipientPhone || !recipientName)) {
      const clients = await store.listClients('');
      const found = clients.find((c) => Number(c.id) === clientId);
      if (found) {
        if (!recipientPhone) recipientPhone = found.phone || '';
        if (!recipientName) recipientName = found.full_name || '';
      }
    }

    const result = await dispatchWhatsAppMessage({
      store,
      toPhone: recipientPhone,
      recipientName,
      clientId,
      appointmentId,
      templateCode: body.template_code ? String(body.template_code).trim() : null,
      vars: body.vars && typeof body.vars === 'object' ? body.vars : {},
      customText: String(body.message_text || '').trim(),
      adminId: req.admin?.id || null,
      triggerSource: String(body.trigger_source || 'manual').trim().slice(0, 40) || 'manual',
    });

    if (!result.ok) {
      return res.status(result.sent_via === 'empty_message' || result.sent_via === 'invalid_phone' ? 422 : 400).json({
        ok: false,
        sent: false,
        sent_via: result.sent_via,
        error: result.error || 'Impossibile preparare il messaggio WhatsApp.',
        wa_url: result.wa_url || null,
        fallback_url: result.fallback_url || null,
        log: result.log || null,
      });
    }

    return res.status(200).json({
      ok: true,
      sent: true,
      sent_via: result.sent_via,
      wa_url: result.wa_url,
      fallback_url: result.fallback_url,
      message_text: result.message_text,
      log: result.log,
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res, next) => {
  try {
    const users = await getStore().listAdminUsers();
    return res.json({ ok: true, users });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const store = getStore();
    if (body.action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID utente non valido.', 400);
      if (id === Number(req.admin?.id)) {
        return sendError(res, 'Non puoi eliminare l\'utente con cui sei attualmente collegata.', 400);
      }
      await store.deleteAdminUser(id);
      return res.json({ ok: true, deleted_id: id });
    }
    const username = String(body.username || '').trim();
    const displayName = String(body.display_name || '').trim();
    const password = String(body.password || '');
    const role = ['owner', 'staff'].includes(body.role) ? body.role : 'staff';
    if (username.length < 3 || password.length < 8) {
      return sendError(res, 'Username (min 3 caratteri) e password (min 8 caratteri) obbligatori.', 422);
    }
    const existing = await store.findAdminByUsername(username);
    if (existing) return sendError(res, 'Username già esistente.', 409);
    const id = await store.createInitialAdmin({
      username,
      displayName: displayName || username,
      role,
      passwordHash: hashPassword(password),
    });
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN AI INSIGHTS & STUDIO REPORTS API (ALL MODULES UNIFIED)
   ============================================================================ */
async function loadInsightsContext(store) {
  const [clients, appointments, operators, products, movements, cards, promotions] = await Promise.all([
    store.listClients(''),
    store.listAppointments({ startDate: '', endDate: '', status: '', clientId: 0 }),
    store.listOperators(false),
    store.listProducts(),
    store.listProductMovements(500),
    store.listClientCards(0),
    store.listPromotions({ activeOnly: false }),
  ]);
  return {
    clients,
    appointments,
    extra: { operators, products, movements, cards, promotions, privacyVersion: getPrivacyVersion() },
  };
}

app.get('/api/admin/insights', requireAdmin, async (req, res, next) => {
  try {
    const days = Math.max(7, Math.min(365, Number.parseInt(req.query.days || '30', 10) || 30));
    const { clients, appointments, extra } = await loadInsightsContext(getStore());
    const insights = computeStudioInsights(clients, appointments, getRomeToday(), days, extra);
    const hasAiApi = Boolean(String(process.env.AI_API_KEY || '').trim());
    const hasGemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
    const aiEnabled = hasAiApi || hasGemini;
    return res.json({
      ok: true,
      ai_enabled: aiEnabled,
      ai_provider: hasAiApi ? 'openai_compatible' : hasGemini ? 'gemini' : 'local',
      gemini_enabled: aiEnabled,
      privacy_version: getPrivacyVersion(),
      insights,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/ai-chat', requireAdmin, async (req, res, next) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) {
      return sendError(res, 'Scrivi una domanda per Giul✦IA.', 400);
    }

    const store = getStore();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const activeView = String(req.body?.active_view || '').trim();
    const insightsContext = await loadInsightsContext(store);
    const reply = await runStudioAiAgent({
      store,
      adminId: req.admin?.id || null,
      origin: getRequestOrigin(req),
      todayIso: getRomeToday(),
      question,
      history,
      activeView,
      privacyVersion: getPrivacyVersion(),
      insightsContext,
    });
    return res.json({
      ok: true,
      engine: reply.engine,
      answer: reply.answer,
      actions_executed: reply.actionsExecuted || [],
      ui_directives: reply.uiDirectives || {},
      insights: reply.insights,
    });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN GIFT CARD GENERATOR API (ISSUE, LIST, REDEEM, CANCEL, DELETE)
   ============================================================================ */
function generateGiftCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  return `GBS-${suffix}`;
}

function getDefaultGiftCardExpiry(fromDateIso) {
  const parts = String(fromDateIso || getRomeToday()).split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, parts[2] || 1));
  dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}

app.get('/api/admin/gift-cards', requireAdmin, async (req, res, next) => {
  try {
    const giftCards = await getStore().listGiftCards(String(req.query.q || '').trim());
    const active = giftCards.filter((g) => g.status === 'active');
    const summary = {
      active_count: active.length,
      redeemed_count: giftCards.filter((g) => g.status === 'redeemed').length,
      active_remaining_total: Number(
        active.reduce((sum, g) => sum + Math.max(0, Number(g.remaining_amount || 0)), 0).toFixed(2)
      ),
      total_issued_amount: Number(
        giftCards
          .filter((g) => g.status !== 'cancelled')
          .reduce((sum, g) => sum + Math.max(0, Number(g.amount || 0)), 0)
          .toFixed(2)
      ),
    };
    return res.json({ ok: true, gift_cards: giftCards, summary });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/gift-cards', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || 'create');
    const store = getStore();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID Gift Card non valido.', 400);
      await store.deleteGiftCard(id);
      return res.json({ ok: true, deleted_id: id });
    }

    if (action === 'redeem' || action === 'cancel') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID Gift Card non valido.', 400);
      const giftCard = await store.redeemGiftCard(id, {
        redeemAmount: Number(body.redeem_amount || 0) || 0,
        markFull: Boolean(body.mark_full),
        cancel: action === 'cancel',
      });
      if (!giftCard) return sendError(res, 'Gift Card non trovata.', 404);
      return res.json({ ok: true, gift_card: giftCard });
    }

    const recipientName = String(body.recipient_name || '').trim();
    if (recipientName.length < 2) {
      return sendError(res, 'Inserisci il nome del destinatario della Gift Card.', 422);
    }

    const giftMode = body.gift_mode === 'treatment' ? 'treatment' : 'amount';
    const serviceTitle = String(body.service_title || '').trim().slice(0, 175);
    const amount = Math.max(0, Number(body.amount || 0) || 0);

    if (giftMode === 'amount' && amount <= 0) {
      return sendError(res, 'Inserisci un valore positivo in euro per la Gift Card.', 422);
    }
    if (giftMode === 'treatment' && serviceTitle.length < 2) {
      return sendError(res, 'Specifica il trattamento regalo incluso nella Gift Card.', 422);
    }

    const rawCode = String(body.code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 36);
    const code = rawCode.length >= 4 ? rawCode : generateGiftCardCode();
    const theme = ['rose', 'bordeaux', 'pearl'].includes(body.theme) ? body.theme : 'rose';
    const expiresAt = isValidIsoDate(body.expires_at) ? body.expires_at : getDefaultGiftCardExpiry();

    const giftCard = await store.createGiftCard({
      code,
      theme,
      giftMode,
      amount: Number(amount.toFixed(2)),
      hidePrice: Boolean(body.hide_price),
      serviceTitle,
      recipientName: recipientName.slice(0, 115),
      senderName: String(body.sender_name || '').trim().slice(0, 115),
      recipientPhone: String(body.recipient_phone || '').trim().slice(0, 38),
      clientId: Number.parseInt(body.client_id || '0', 10) || null,
      message: String(body.message || '').trim().slice(0, 310),
      expiresAt,
      notes: String(body.notes || '').trim().slice(0, 290),
    });

    return res.status(201).json({ ok: true, gift_card: giftCard });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN MONTHLY PROMOTIONS API (LIST, CREATE, UPDATE, TOGGLE, DELETE)
   ============================================================================ */
function sanitizePromotionServices(rawList) {
  if (!Array.isArray(rawList)) return [];
  const cleaned = [];
  for (const item of rawList.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim().slice(0, 140);
    if (!name) continue;
    cleaned.push({
      id: item.id ? String(item.id).trim().slice(0, 60) : null,
      name,
      price: Math.max(0, Number(item.price || 0) || 0),
      duration: Math.max(5, Math.min(480, Number.parseInt(item.duration || '30', 10) || 30)),
    });
  }
  return cleaned;
}

app.get('/api/admin/promotions', requireAdmin, async (_req, res, next) => {
  try {
    const today = getRomeToday();
    const promotions = await getStore().listPromotions({ activeOnly: false, todayIso: today });
    return res.json({ ok: true, today, promotions });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/promotions', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const action = String(body.action || 'create');
    const store = getStore();

    if (action === 'delete') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID promozione non valido.', 400);
      await store.deletePromotion(id);
      return res.json({ ok: true, deleted_id: id });
    }

    if (action === 'toggle_active') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID promozione non valido.', 400);
      const existing = await store.getPromotionById(id);
      if (!existing) return sendError(res, 'Promozione non trovata.', 404);
      const nextActive = body.active !== undefined ? Boolean(body.active) : Number(existing.active) !== 1;
      const promotion = await store.updatePromotion(id, { active: nextActive ? 1 : 0 });
      return res.json({ ok: true, promotion });
    }

    const title = String(body.title || '').trim().slice(0, 135);
    if (title.length < 2) {
      return sendError(res, 'Inserisci un titolo valido per la promozione.', 422);
    }

    const services = sanitizePromotionServices(body.services);
    const promoPrice = Math.max(0, Number(body.promo_price ?? body.promoPrice ?? 0) || 0);
    let originalPrice = Math.max(0, Number(body.original_price ?? body.originalPrice ?? 0) || 0);
    if (originalPrice === 0 && services.length > 0) {
      originalPrice = services.reduce((s, item) => s + Number(item.price || 0), 0);
    }
    const durationMinutes = Math.max(
      10,
      Math.min(600, Number.parseInt(String(body.duration_minutes ?? body.durationMinutes ?? '60'), 10) || 60)
    );

    const validFrom = isValidIsoDate(body.valid_from) ? String(body.valid_from).trim() : null;
    const validUntil = isValidIsoDate(body.valid_until) ? String(body.valid_until).trim() : null;
    if (validFrom && validUntil && validFrom > validUntil) {
      return sendError(res, 'La data di fine validità non può precedere la data di inizio.', 422);
    }

    const payload = {
      title,
      badgeText: String(body.badge_text || '').trim().slice(0, 75),
      monthLabel: String(body.month_label || '').trim().slice(0, 75),
      description: String(body.description || '').trim().slice(0, 1000),
      services,
      originalPrice: Number(originalPrice.toFixed(2)),
      promoPrice: Number(promoPrice.toFixed(2)),
      durationMinutes,
      validFrom,
      validUntil,
      active: body.active !== undefined ? (body.active ? 1 : 0) : 1,
      featured: body.featured ? 1 : 0,
      showOnHero: body.show_on_hero ? 1 : 0,
      sortOrder: Number.parseInt(String(body.sort_order ?? '0'), 10) || 0,
    };

    if (action === 'update') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID promozione non valido.', 400);
      const promotion = await store.updatePromotion(id, payload);
      if (!promotion) return sendError(res, 'Promozione non trovata.', 404);
      return res.json({ ok: true, promotion });
    }

    const promotion = await store.createPromotion(payload);
    return res.status(201).json({ ok: true, promotion });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   ADMIN PAYMENTS, CASSA & STRIPE SETTINGS API
   ============================================================================ */
function computePaymentsDashboardSummary(appointments = [], transactions = []) {
  const today = getRomeToday();
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayIdx = (dt.getUTCDay() + 6) % 7; // Monday = 0
  const monDt = new Date(dt);
  monDt.setUTCDate(dt.getUTCDate() - dayIdx);
  const weekStart = monDt.toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);

  let todayCollected = 0;
  let weekCollected = 0;
  let monthCollected = 0;
  let allTimeNet = 0;
  const byMethod = {};

  for (const tx of transactions) {
    if (tx.status && tx.status !== 'succeeded') continue;
    const rawAmt = Number(tx.amount || 0);
    const signedAmt = tx.direction === 'refund' ? -rawAmt : rawAmt;
    allTimeNet += signedAmt;
    const txDate = String(tx.created_at || '').slice(0, 10);
    if (txDate === today) todayCollected += signedAmt;
    if (txDate >= weekStart && txDate <= today) weekCollected += signedAmt;
    if (txDate.startsWith(monthPrefix)) monthCollected += signedAmt;
    const mKey = tx.payment_method || 'altro';
    byMethod[mKey] = roundMoney((byMethod[mKey] || 0) + signedAmt);
  }

  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;
  let outstandingTotal = 0;
  for (const a of appointments) {
    if (a.status === 'cancelled') continue;
    const ps = a.payment_status || 'unpaid';
    const total = roundMoney(a.total_price);
    const paid = roundMoney(a.paid_amount);
    if (ps === 'paid') paidCount += 1;
    else if (ps === 'partial') {
      partialCount += 1;
      outstandingTotal += Math.max(0, roundMoney(total - paid));
    } else if (ps === 'unpaid') {
      unpaidCount += 1;
      outstandingTotal += total;
    }
  }

  return {
    today_collected: roundMoney(todayCollected),
    week_collected: roundMoney(weekCollected),
    month_collected: roundMoney(monthCollected),
    all_time_net: roundMoney(allTimeNet),
    outstanding_total: roundMoney(outstandingTotal),
    paid_count: paidCount,
    partial_count: partialCount,
    unpaid_count: unpaidCount,
    by_method: byMethod,
    status_labels: PAYMENT_STATUS_LABELS,
    method_labels: PAYMENT_METHOD_LABELS,
  };
}

app.get('/api/admin/payments', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const startDate = String(req.query.start_date || '').trim() || null;
    const endDate = String(req.query.end_date || '').trim() || null;
    const method = String(req.query.method || '').trim() || null;
    const appointmentId = Number.parseInt(req.query.appointment_id || '0', 10) || 0;
    const limit = Number.parseInt(req.query.limit || '120', 10) || 120;

    const [rawSettings, transactions, allTransactionsForKpi, allAppts] = await Promise.all([
      store.getStudioSetting('payment_settings'),
      store.listPaymentTransactions({ startDate, endDate, method, appointmentId, limit }),
      appointmentId > 0 || startDate || endDate || method
        ? store.listPaymentTransactions({ limit: 500 })
        : Promise.resolve(null),
      store.listAppointments({}),
    ]);

    const summary = computePaymentsDashboardSummary(allAppts, allTransactionsForKpi || transactions);
    const origin = getRequestOrigin(req);

    return res.json({
      ok: true,
      settings: sanitizePaymentSettingsForClient(rawSettings || {}),
      webhook_url: `${origin}/api/webhooks/stripe`,
      paypal_webhook_url: `${origin}/api/webhooks/paypal`,
      summary,
      transactions,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/payments/settings', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const existing = (await store.getStudioSetting('payment_settings')) || {};
    const merged = mergePaymentSettingsUpdate(existing, req.body || {});
    const saved = await store.saveStudioSetting('payment_settings', merged);
    const origin = getRequestOrigin(req);
    return res.json({
      ok: true,
      settings: sanitizePaymentSettingsForClient(saved.setting_value || merged),
      webhook_url: `${origin}/api/webhooks/stripe`,
      paypal_webhook_url: `${origin}/api/webhooks/paypal`,
    });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/payments/test-stripe', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
    const body = req.body || {};
    const tempMerged = mergePaymentSettingsUpdate(rawSettings, body);
    const config = resolveStripeConfig(tempMerged);
    if (!config.configured) {
      return sendError(res, 'Inserisci prima una Stripe Secret Key (sk_test_... o sk_live_...).', 422);
    }
    const result = await verifyStripeConnection({ config });
    return res.json({ ok: true, ...result, mode: config.mode });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/payments/test-paypal', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
    const body = req.body || {};
    const tempMerged = mergePaymentSettingsUpdate(rawSettings, body);
    const config = resolvePayPalConfig(tempMerged);
    if (!config.configured) {
      return sendError(res, 'Inserisci prima Client ID e Client Secret PayPal.', 422);
    }
    const result = await verifyPayPalConnection({ config });
    return res.json({ ok: true, ...result, mode: config.paypal_mode });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/payments/refund', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const body = req.body || {};
    const appointmentId = Number.parseInt(body.appointment_id || '0', 10) || 0;
    if (appointmentId <= 0) return sendError(res, 'ID appuntamento mancante.', 400);
    const appt = await store.getAppointmentById(appointmentId);
    if (!appt) return sendError(res, 'Appuntamento non trovato.', 404);

    const currentPaid = roundMoney(appt.paid_amount);
    if (currentPaid <= 0) {
      return sendError(res, 'Questo appuntamento non ha importi incassati da rimborsare.', 422);
    }

    const reqAmt = body.amount !== undefined && body.amount !== '' ? roundMoney(body.amount) : currentPaid;
    const refundAmt = Math.min(currentPaid, Math.max(0.01, reqAmt));
    const notes = String(body.notes || '').trim() || 'Rimborso registrato dallo studio';
    let stripeRefund = null;
    let paypalRefund = null;

    if (body.call_stripe !== false && appt.stripe_payment_intent) {
      const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
      const stripeCfg = resolveStripeConfig(rawSettings);
      if (!stripeCfg.configured) {
        return sendError(res, 'Chiave Stripe non configurata: impossibile emettere rimborso su carta.', 422);
      }
      stripeRefund = await createStripeRefund({
        config: stripeCfg,
        paymentIntentId: appt.stripe_payment_intent,
        amountEur: refundAmt,
      });
    } else if (body.call_paypal !== false && appt.paypal_capture_id) {
      const rawSettings = (await store.getStudioSetting('payment_settings')) || {};
      const paypalCfg = resolvePayPalConfig(rawSettings);
      if (!paypalCfg.configured) {
        return sendError(res, 'Credenziali PayPal non configurate: impossibile emettere rimborso su PayPal.', 422);
      }
      paypalRefund = await createPayPalRefund({
        config: paypalCfg,
        captureId: appt.paypal_capture_id,
        amountEur: refundAmt,
        note: notes,
      });
    }

    const isStripeRefund = Boolean(appt.stripe_payment_intent && body.call_stripe !== false);
    const isPaypalRefund = Boolean(appt.paypal_capture_id && body.call_paypal !== false && !isStripeRefund);

    const recorded = await store.recordAppointmentPayment({
      appointmentId,
      paymentMethod: isStripeRefund ? 'stripe_online' : isPaypalRefund ? 'paypal_online' : appt.payment_method,
      transactionAmount: refundAmt,
      direction: 'refund',
      stripePaymentIntent: appt.stripe_payment_intent || null,
      paypalOrderId: appt.paypal_order_id || null,
      paypalCaptureId: appt.paypal_capture_id || null,
      paymentNotes: notes,
      transactionNotes: stripeRefund
        ? `Rimborso Stripe (${stripeRefund.id})`
        : paypalRefund
        ? `Rimborso PayPal (${paypalRefund.id || 'completed'})`
        : notes,
      adminId: req.admin?.id || null,
      nowStr: formatRomeNow(),
    });

    return res.json({
      ok: true,
      appointment: recorded.appointment,
      transaction: recorded.transaction,
      stripe_refund_id: stripeRefund?.id || null,
      paypal_refund_id: paypalRefund?.id || null,
    });
  } catch (err) {
    return next(err);
  }
});

/* ============================================================================
   CONFIGURABLE SERVICE CATALOG API (PUBLIC + ADMIN)
   ============================================================================ */
app.get('/api/public/catalog', async (_req, res, next) => {
  try {
    const store = getStore();
    const catalog = await store.listPublicCatalog();
    const totalCount = catalog.reduce(
      (sum, cat) => sum + (cat.subgroups || []).reduce((s2, sg) => s2 + (sg.items || []).length, 0),
      0
    );
    return res.json({ ok: true, catalog, total_count: totalCount });
  } catch (err) {
    return next(err);
  }
});

app.get('/api/admin/catalog', requireAdmin, async (_req, res, next) => {
  try {
    const store = getStore();
    const data = await store.listCatalogData();
    return res.json({ ok: true, ...data });
  } catch (err) {
    return next(err);
  }
});

app.post('/api/admin/catalog', requireAdmin, async (req, res, next) => {
  try {
    const store = getStore();
    const body = req.body || {};
    const action = String(body.action || 'create_service').trim();
    let affectedService = null;
    let affectedCategory = null;

    if (action === 'create_category') {
      affectedCategory = await store.createCatalogCategory({
        title: body.title,
        motto: body.motto,
        columnSide: body.column_side === 'left' ? 'left' : 'right',
        sortOrder: Number(body.sort_order ?? 100) || 100,
        active: body.active !== undefined ? (body.active ? 1 : 0) : 1,
        slug: body.slug || '',
      });
    } else if (action === 'update_category') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID categoria mancante.', 400);
      affectedCategory = await store.updateCatalogCategory(id, {
        title: body.title,
        motto: body.motto,
        columnSide: body.column_side,
        sortOrder: body.sort_order,
        active: body.active,
      });
      if (!affectedCategory) return sendError(res, 'Categoria non trovata.', 404);
    } else if (action === 'toggle_category') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      const list = await store.listCatalogData();
      const existing = list.categories.find((c) => Number(c.id) === id);
      if (!existing) return sendError(res, 'Categoria non trovata.', 404);
      affectedCategory = await store.updateCatalogCategory(id, {
        active: body.active !== undefined ? Boolean(body.active) : Number(existing.active) !== 1,
      });
    } else if (action === 'delete_category') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID categoria mancante.', 400);
      await store.deleteCatalogCategory(id);
    } else if (action === 'create_service') {
      affectedService = await store.createCatalogService({
        categorySlug: body.category_slug,
        subgroupLabel: body.subgroup_label,
        name: body.name,
        price: Number(body.price || 0),
        durationMinutes: Number(body.duration_minutes || 30),
        description: body.description,
        sortOrder: Number(body.sort_order ?? 100) || 100,
        active: body.active !== undefined ? (body.active ? 1 : 0) : 1,
        showInStorefront: body.show_in_storefront !== undefined ? (body.show_in_storefront ? 1 : 0) : 1,
        serviceKey: body.service_key || '',
      });
    } else if (action === 'update_service') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID trattamento mancante.', 400);
      affectedService = await store.updateCatalogService(id, {
        categorySlug: body.category_slug,
        subgroupLabel: body.subgroup_label,
        name: body.name,
        price: body.price,
        durationMinutes: body.duration_minutes,
        description: body.description,
        sortOrder: body.sort_order,
        active: body.active,
        showInStorefront: body.show_in_storefront,
      });
      if (!affectedService) return sendError(res, 'Trattamento non trovato.', 404);
    } else if (action === 'toggle_service') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      const list = await store.listCatalogData();
      const existing = list.services.find((s) => Number(s.id) === id);
      if (!existing) return sendError(res, 'Trattamento non trovato.', 404);
      affectedService = await store.updateCatalogService(id, {
        active: body.active !== undefined ? Boolean(body.active) : Number(existing.active) !== 1,
      });
    } else if (action === 'delete_service') {
      const id = Number.parseInt(body.id || '0', 10) || 0;
      if (id <= 0) return sendError(res, 'ID trattamento mancante.', 400);
      await store.deleteCatalogService(id);
    } else {
      return sendError(res, 'Azione listino non supportata.', 400);
    }

    const updatedData = await store.listCatalogData();
    return res.status(action.startsWith('create_') ? 201 : 200).json({
      ok: true,
      ...updatedData,
      service: affectedService,
      category: affectedCategory,
    });
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
