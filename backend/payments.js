/**
 * GIULIA BEAUTY STUDIO — Payments, Cassa & Stripe Checkout Connector
 */
const crypto = require('crypto');
const { DEFAULT_PAYMENT_SETTINGS } = require('./defaults');

const PAYMENT_STATUS_VALUES = ['unpaid', 'partial', 'paid', 'refunded'];

const PAYMENT_STATUS_LABELS = {
  unpaid: 'Da saldare',
  partial: 'Acconto',
  paid: 'Pagato',
  refunded: 'Rimborsato',
};

const PAYMENT_METHOD_LABELS = {
  studio: 'Salda in Studio',
  contanti: 'Contanti',
  pos: 'POS / Carta Studio',
  satispay: 'Satispay',
  bonifico: 'Bonifico',
  gift_card: 'Gift Card',
  stripe_online: 'Stripe Online',
  carta: 'Carta / Digitale',
};

const ALLOWED_PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS);

function roundMoney(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function clampInt(val, min, max, fallback) {
  const num = Number.parseInt(val, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function maskSecret(secret) {
  const raw = String(secret || '').trim();
  if (!raw) return '';
  if (raw.length <= 10) return '••••••••';
  return `${raw.slice(0, 6)}••••${raw.slice(-4)}`;
}

function isMaskedPlaceholder(value) {
  return typeof value === 'string' && value.includes('••••');
}

function normalizePaymentStatus(val, fallback = 'unpaid') {
  const clean = String(val || '')
    .trim()
    .toLowerCase();
  return PAYMENT_STATUS_VALUES.includes(clean) ? clean : fallback;
}

function normalizePaymentMethod(val, fallback = 'studio') {
  const clean = String(val || '')
    .trim()
    .toLowerCase();
  return ALLOWED_PAYMENT_METHODS.includes(clean) ? clean : fallback;
}

function normalizePaymentSettings(raw = {}) {
  const envEnabled =
    process.env.STRIPE_ENABLED === 'true' ||
    process.env.STRIPE_ENABLED === '1' ||
    Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_ENABLED !== 'false');

  const merged = {
    ...DEFAULT_PAYMENT_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  if (!merged.stripe_publishable_key && process.env.STRIPE_PUBLISHABLE_KEY) {
    merged.stripe_publishable_key = String(process.env.STRIPE_PUBLISHABLE_KEY).trim();
  }
  if (!merged.stripe_secret_key && process.env.STRIPE_SECRET_KEY) {
    merged.stripe_secret_key = String(process.env.STRIPE_SECRET_KEY).trim();
  }
  if (!merged.stripe_webhook_secret && process.env.STRIPE_WEBHOOK_SECRET) {
    merged.stripe_webhook_secret = String(process.env.STRIPE_WEBHOOK_SECRET).trim();
  }
  if (raw && raw.stripe_enabled === undefined && envEnabled) {
    merged.stripe_enabled = true;
  }

  return {
    stripe_enabled: Boolean(merged.stripe_enabled),
    stripe_mode: String(merged.stripe_mode || process.env.STRIPE_MODE || 'test').toLowerCase() === 'live' ? 'live' : 'test',
    stripe_publishable_key: String(merged.stripe_publishable_key || '').trim(),
    stripe_secret_key: String(merged.stripe_secret_key || '').trim(),
    stripe_webhook_secret: String(merged.stripe_webhook_secret || '').trim(),
    allow_pay_in_studio: merged.allow_pay_in_studio !== false,
    allow_online_full: merged.allow_online_full !== false,
    allow_online_deposit: merged.allow_online_deposit !== false,
    deposit_percent: clampInt(merged.deposit_percent, 10, 90, DEFAULT_PAYMENT_SETTINGS.deposit_percent),
    auto_confirm_on_paid: merged.auto_confirm_on_paid !== false,
    currency: 'eur',
  };
}

function resolveStripeConfig(rawSettings = {}) {
  const s = normalizePaymentSettings(rawSettings);
  const configured = Boolean(s.stripe_secret_key);
  const ready = Boolean(s.stripe_enabled && configured && (s.allow_online_full || s.allow_online_deposit));
  return {
    ...s,
    configured,
    ready,
  };
}

function sanitizePaymentSettingsForClient(rawSettings = {}) {
  const s = resolveStripeConfig(rawSettings);
  return {
    stripe_enabled: s.stripe_enabled,
    stripe_configured: s.configured,
    stripe_ready: s.ready,
    stripe_mode: s.stripe_mode,
    stripe_publishable_key: s.stripe_publishable_key,
    has_secret_key: Boolean(s.stripe_secret_key),
    stripe_secret_key_masked: maskSecret(s.stripe_secret_key),
    has_webhook_secret: Boolean(s.stripe_webhook_secret),
    stripe_webhook_secret_masked: maskSecret(s.stripe_webhook_secret),
    allow_pay_in_studio: s.allow_pay_in_studio,
    allow_online_full: s.allow_online_full,
    allow_online_deposit: s.allow_online_deposit,
    deposit_percent: s.deposit_percent,
    auto_confirm_on_paid: s.auto_confirm_on_paid,
    currency: s.currency,
  };
}

function mergePaymentSettingsUpdate(currentRaw = {}, patch = {}) {
  const current = normalizePaymentSettings(currentRaw);
  const next = { ...current };

  if (patch.stripe_enabled !== undefined) next.stripe_enabled = Boolean(patch.stripe_enabled);
  if (patch.stripe_mode !== undefined) {
    next.stripe_mode = String(patch.stripe_mode).toLowerCase() === 'live' ? 'live' : 'test';
  }
  if (patch.stripe_publishable_key !== undefined) {
    next.stripe_publishable_key = String(patch.stripe_publishable_key || '').trim();
  }

  if (patch.clear_secret_key === true) {
    next.stripe_secret_key = '';
  } else if (typeof patch.stripe_secret_key === 'string') {
    const trimmed = patch.stripe_secret_key.trim();
    if (trimmed && !isMaskedPlaceholder(trimmed)) {
      next.stripe_secret_key = trimmed;
    }
  }

  if (patch.clear_webhook_secret === true) {
    next.stripe_webhook_secret = '';
  } else if (typeof patch.stripe_webhook_secret === 'string') {
    const trimmed = patch.stripe_webhook_secret.trim();
    if (trimmed && !isMaskedPlaceholder(trimmed)) {
      next.stripe_webhook_secret = trimmed;
    }
  }

  if (patch.allow_pay_in_studio !== undefined) next.allow_pay_in_studio = Boolean(patch.allow_pay_in_studio);
  if (patch.allow_online_full !== undefined) next.allow_online_full = Boolean(patch.allow_online_full);
  if (patch.allow_online_deposit !== undefined) next.allow_online_deposit = Boolean(patch.allow_online_deposit);
  if (patch.deposit_percent !== undefined) {
    next.deposit_percent = clampInt(patch.deposit_percent, 10, 90, current.deposit_percent);
  }
  if (patch.auto_confirm_on_paid !== undefined) {
    next.auto_confirm_on_paid = Boolean(patch.auto_confirm_on_paid);
  }

  return next;
}

function getPublicPaymentConfig(rawSettings = {}) {
  const s = resolveStripeConfig(rawSettings);
  return {
    stripe_ready: s.ready,
    stripe_enabled: s.stripe_enabled,
    stripe_mode: s.stripe_mode,
    publishable_key: s.stripe_publishable_key,
    allow_pay_in_studio: s.allow_pay_in_studio,
    allow_online_full: s.ready && s.allow_online_full,
    allow_online_deposit: s.ready && s.allow_online_deposit,
    deposit_percent: s.deposit_percent,
    currency: s.currency,
  };
}

function computeOnlineChargeAmount(totalPrice, payScope = 'full', depositPercent = 30) {
  const total = roundMoney(totalPrice);
  if (total <= 0) return 0;
  if (payScope === 'deposit') {
    const pct = clampInt(depositPercent, 10, 90, 30);
    const deposit = roundMoney((total * pct) / 100);
    return Math.min(total, Math.max(1, deposit));
  }
  return total;
}

function derivePaymentStatus({ totalPrice, paidAmount, requestedStatus }) {
  const total = roundMoney(totalPrice);
  const paid = Math.max(0, roundMoney(paidAmount));
  if (requestedStatus === 'refunded') return 'refunded';
  if (requestedStatus && PAYMENT_STATUS_VALUES.includes(requestedStatus)) {
    if (requestedStatus === 'paid' && paid <= 0 && total > 0) return 'paid';
    return requestedStatus;
  }
  if (total <= 0) return paid > 0 ? 'paid' : 'unpaid';
  if (paid >= total - 0.01) return 'paid';
  if (paid > 0.009) return 'partial';
  return 'unpaid';
}

function flattenStripeParams(obj, prefix = '', out = new URLSearchParams()) {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const key = `${prefix}[${index}]`;
      flattenStripeParams(item, key, out);
    });
    return out;
  }
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const key = prefix ? `${prefix}[${k}]` : k;
      flattenStripeParams(v, key, out);
    });
    return out;
  }
  if (prefix) {
    out.append(prefix, String(obj));
  }
  return out;
}

async function stripeRequest(config, method, endpointPath, params = null) {
  if (!config || !config.stripe_secret_key) {
    const err = new Error('Chiave segreta Stripe non configurata nelle Impostazioni.');
    err.status = 400;
    throw err;
  }
  const fetchFn = globalThis.__GBS_STRIPE_FETCH__ || fetch;
  const upperMethod = String(method || 'GET').toUpperCase();
  const base = 'https://api.stripe.com';
  let url = `${base}${endpointPath}`;
  const headers = {
    Authorization: `Bearer ${config.stripe_secret_key}`,
  };
  const fetchOpts = { method: upperMethod, headers };

  if (params && upperMethod === 'GET') {
    const qs = flattenStripeParams(params).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  } else if (params && upperMethod !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOpts.body = flattenStripeParams(params).toString();
  }

  const res = await fetchFn(url, fetchOpts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Errore API Stripe (HTTP ${res.status}).`;
    const err = new Error(msg);
    err.status = res.status >= 400 && res.status < 500 ? 400 : 502;
    err.stripeCode = data?.error?.code || null;
    err.httpStatus = res.status;
    throw err;
  }
  return data;
}

async function verifyStripeConnection({ config }) {
  try {
    const acct = await stripeRequest(config, 'GET', '/v1/account');
    return {
      ok: true,
      account_id: acct?.id || null,
      business_name: acct?.business_profile?.name || acct?.settings?.dashboard?.display_name || null,
      country: acct?.country || null,
      charges_enabled: Boolean(acct?.charges_enabled !== false),
    };
  } catch (err) {
    // Restricted API keys may lack /v1/account read permission; verify via balance/payment_intents
    if (err.httpStatus === 403) {
      await stripeRequest(config, 'GET', '/v1/payment_intents', { limit: 1 });
      return {
        ok: true,
        account_id: null,
        business_name: 'Chiave Stripe Ristretta Valida',
        charges_enabled: true,
      };
    }
    throw err;
  }
}

async function createStripeCheckoutSession({
  config,
  appointment,
  items = [],
  chargeAmount,
  payScope = 'full',
  successUrl,
  cancelUrl,
}) {
  const amountCents = Math.round(roundMoney(chargeAmount) * 100);
  if (amountCents < 50) {
    const err = new Error('L\'importo minimo per il pagamento online con Stripe è € 0,50.');
    err.status = 400;
    throw err;
  }

  const serviceSummary = (items || [])
    .map((it) => `${it.title}${Number(it.quantity || 1) > 1 ? ` x${it.quantity}` : ''}`)
    .join(', ')
    .slice(0, 420);

  const labelPrefix =
    payScope === 'deposit'
      ? `Acconto ${config.deposit_percent}% — Prenotazione ${appointment.booking_code}`
      : `Saldo Trattamenti — Prenotazione ${appointment.booking_code}`;

  const params = {
    mode: 'payment',
    client_reference_id: appointment.booking_code,
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][quantity]': 1,
    'line_items[0][price_data][currency]': config.currency || 'eur',
    'line_items[0][price_data][unit_amount]': amountCents,
    'line_items[0][price_data][product_data][name]': `Giulia Beauty Studio • ${labelPrefix}`,
    'line_items[0][price_data][product_data][description]':
      serviceSummary || `Appuntamento ${appointment.appointment_date} ${String(appointment.start_time || '').slice(0, 5)}`,
    'metadata[booking_code]': appointment.booking_code,
    'metadata[appointment_id]': String(appointment.id),
    'metadata[pay_scope]': payScope,
    'metadata[total_price]': String(roundMoney(appointment.total_price)),
    'metadata[charge_amount]': String(roundMoney(chargeAmount)),
    'payment_intent_data[metadata][booking_code]': appointment.booking_code,
    'payment_intent_data[metadata][appointment_id]': String(appointment.id),
    'payment_intent_data[metadata][pay_scope]': payScope,
  };

  if (appointment.client_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appointment.client_email)) {
    params.customer_email = appointment.client_email;
  }

  return stripeRequest(config, 'POST', '/v1/checkout/sessions', params);
}

async function retrieveStripeCheckoutSession({ config, sessionId }) {
  if (!sessionId) {
    const err = new Error('Session ID Stripe mancante.');
    err.status = 400;
    throw err;
  }
  return stripeRequest(config, 'GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function createStripeRefund({ config, paymentIntentId, amountEur = null, reason = 'requested_by_customer' }) {
  if (!paymentIntentId) {
    const err = new Error('PaymentIntent Stripe mancante per il rimborso.');
    err.status = 400;
    throw err;
  }
  const params = {
    payment_intent: paymentIntentId,
    reason,
  };
  if (amountEur !== null && amountEur !== undefined && Number(amountEur) > 0) {
    params.amount = Math.round(roundMoney(amountEur) * 100);
  }
  return stripeRequest(config, 'POST', '/v1/refunds', params);
}

function verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret, toleranceSec = 300) {
  const secret = String(webhookSecret || '').trim();
  if (!secret) {
    return { valid: false, reason: 'Webhook secret Stripe non configurato.' };
  }
  if (!sigHeader || typeof sigHeader !== 'string') {
    return { valid: false, reason: 'Header Stripe-Signature mancante.' };
  }

  const parts = sigHeader.split(',').map((p) => p.trim());
  let timestamp = null;
  const v1Sigs = [];
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = Number.parseInt(v, 10);
    if (k === 'v1' && v) v1Sigs.push(v);
  }

  if (!Number.isFinite(timestamp) || v1Sigs.length === 0) {
    return { valid: false, reason: 'Formato Stripe-Signature non valido.' };
  }

  if (toleranceSec > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > toleranceSec) {
      return { valid: false, reason: 'Timestamp firma Stripe scaduto.' };
    }
  }

  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadStr}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const matched = v1Sigs.some((sig) => {
    const candidateBuf = Buffer.from(sig, 'utf8');
    if (candidateBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, candidateBuf);
  });

  if (!matched) {
    return { valid: false, reason: 'Firma HMAC webhook Stripe non valida.' };
  }

  return { valid: true, timestamp };
}

module.exports = {
  PAYMENT_STATUS_VALUES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  ALLOWED_PAYMENT_METHODS,
  roundMoney,
  normalizePaymentStatus,
  normalizePaymentMethod,
  normalizePaymentSettings,
  resolveStripeConfig,
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
};
