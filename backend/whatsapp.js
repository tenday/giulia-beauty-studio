/**
 * GIULIA BEAUTY STUDIO — Meta WhatsApp Business Cloud API Client & Config
 */
const crypto = require('crypto');
const { normalizePhone } = require('./helpers');
const { DEFAULT_WHATSAPP_SETTINGS } = require('./defaults');

const TEMPLATE_PARAM_KEYS = {
  booking_confirmed: ['nome', 'data', 'ora', 'servizi', 'codice'],
  reminder_tomorrow: ['nome', 'data', 'ora', 'operatore', 'trattamenti'],
  birthday_wishes: ['nome'],
  winback_inactive: ['nome', 'giorni_assenza'],
  privacy_sign: ['nome', 'link', 'otp'],
  gift_card: ['nome', 'regalo', 'codice', 'scadenza'],
};

function normalizeWhatsAppPhone(phone) {
  const e164 = normalizePhone(phone);
  const digits = e164.replace(/[^\d]/g, '');
  if (digits.length < 8) {
    return { e164: '', waId: '' };
  }
  return {
    e164: `+${digits}`,
    waId: digits,
  };
}

function renderTemplateText(bodyTemplate, vars = {}) {
  let text = String(bodyTemplate || '');
  for (const [key, val] of Object.entries(vars || {})) {
    text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val ?? ''));
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function getOrderedTemplateParams(code, vars = {}) {
  const keys = TEMPLATE_PARAM_KEYS[code];
  if (Array.isArray(keys)) {
    return keys
      .map((k) => String(vars[k] ?? '').trim())
      .filter((v) => v.length > 0);
  }
  return Object.values(vars || {})
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.length > 0);
}

function buildWaMeFallbackUrl(phone, text) {
  const { waId } = normalizeWhatsAppPhone(phone);
  const encoded = encodeURIComponent(String(text || ''));
  return waId ? `https://wa.me/${waId}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

function maskSecret(secret) {
  const val = String(secret || '').trim();
  if (!val) return '';
  if (val.length <= 10) return '••••••••';
  return `${val.slice(0, 4)}••••••••${val.slice(-4)}`;
}

function generateCronSecretToken() {
  return crypto.randomBytes(20).toString('hex');
}

function clampInt(val, min, max, fallback) {
  const n = Number.parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function resolveWhatsAppConfig(stored = {}) {
  const envPhoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const envAccessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const envBizId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
  const envVersion = String(process.env.WHATSAPP_API_VERSION || 'v21.0').trim() || 'v21.0';
  const envCronSecret = String(process.env.CRON_SECRET || '').trim();

  const phoneNumberId = String(stored.phone_number_id ?? '').trim() || envPhoneId;
  const businessAccountId = String(stored.business_account_id ?? '').trim() || envBizId;
  const accessToken = String(stored.access_token ?? '').trim() || envAccessToken;
  const apiVersion = String(stored.api_version ?? '').trim() || envVersion;
  const cronSecret = String(stored.cron_secret ?? '').trim() || envCronSecret;

  const envHasCreds = Boolean(envPhoneId && envAccessToken);
  const envEnabled =
    process.env.WHATSAPP_ENABLED !== undefined
      ? process.env.WHATSAPP_ENABLED === '1' || process.env.WHATSAPP_ENABLED === 'true'
      : envHasCreds;

  const enabled = typeof stored.enabled === 'boolean' ? stored.enabled : envEnabled;
  const isConfigured = Boolean(phoneNumberId && accessToken);
  const isActive = Boolean(enabled && isConfigured);

  return {
    ...DEFAULT_WHATSAPP_SETTINGS,
    enabled,
    phone_number_id: phoneNumberId,
    business_account_id: businessAccountId,
    access_token: accessToken,
    api_version: apiVersion,
    cron_secret: cronSecret,
    fallback_to_wa_me:
      typeof stored.fallback_to_wa_me === 'boolean'
        ? stored.fallback_to_wa_me
        : DEFAULT_WHATSAPP_SETTINGS.fallback_to_wa_me,
    auto_booking_confirmed:
      typeof stored.auto_booking_confirmed === 'boolean'
        ? stored.auto_booking_confirmed
        : DEFAULT_WHATSAPP_SETTINGS.auto_booking_confirmed,
    auto_privacy_otp:
      typeof stored.auto_privacy_otp === 'boolean'
        ? stored.auto_privacy_otp
        : DEFAULT_WHATSAPP_SETTINGS.auto_privacy_otp,
    auto_reminder_tomorrow:
      typeof stored.auto_reminder_tomorrow === 'boolean'
        ? stored.auto_reminder_tomorrow
        : DEFAULT_WHATSAPP_SETTINGS.auto_reminder_tomorrow,
    reminder_send_hour: clampInt(
      stored.reminder_send_hour,
      6,
      22,
      DEFAULT_WHATSAPP_SETTINGS.reminder_send_hour
    ),
    auto_birthday_wishes:
      typeof stored.auto_birthday_wishes === 'boolean'
        ? stored.auto_birthday_wishes
        : DEFAULT_WHATSAPP_SETTINGS.auto_birthday_wishes,
    birthday_send_hour: clampInt(
      stored.birthday_send_hour,
      6,
      22,
      DEFAULT_WHATSAPP_SETTINGS.birthday_send_hour
    ),
    auto_winback_inactive:
      typeof stored.auto_winback_inactive === 'boolean'
        ? stored.auto_winback_inactive
        : DEFAULT_WHATSAPP_SETTINGS.auto_winback_inactive,
    winback_inactive_days: clampInt(
      stored.winback_inactive_days,
      15,
      180,
      DEFAULT_WHATSAPP_SETTINGS.winback_inactive_days
    ),
    winback_cooldown_days: clampInt(
      stored.winback_cooldown_days,
      7,
      180,
      DEFAULT_WHATSAPP_SETTINGS.winback_cooldown_days
    ),
    winback_send_hour: clampInt(
      stored.winback_send_hour,
      6,
      22,
      DEFAULT_WHATSAPP_SETTINGS.winback_send_hour
    ),
    winback_max_per_run: clampInt(
      stored.winback_max_per_run,
      1,
      100,
      DEFAULT_WHATSAPP_SETTINGS.winback_max_per_run
    ),
    isConfigured,
    isActive,
    updated_at: stored.updated_at || null,
  };
}

function sanitizeWhatsAppSettingsForClient(config, baseOrigin = '') {
  const origin = String(baseOrigin || '').replace(/\/+$/, '');
  return {
    enabled: Boolean(config.enabled),
    configured: Boolean(config.isConfigured),
    active: Boolean(config.isActive),
    phone_number_id: config.phone_number_id || '',
    business_account_id: config.business_account_id || '',
    api_version: config.api_version || 'v21.0',
    has_access_token: Boolean(config.access_token),
    access_token_masked: maskSecret(config.access_token),
    has_cron_secret: Boolean(config.cron_secret),
    cron_secret_masked: maskSecret(config.cron_secret),
    cron_endpoint_preview:
      origin && config.cron_secret
        ? `${origin}/api/cron/run-jobs?secret=${config.cron_secret}`
        : origin
          ? `${origin}/api/cron/run-jobs?secret=<CRON_SECRET>`
          : '',
    fallback_to_wa_me: Boolean(config.fallback_to_wa_me),
    auto_booking_confirmed: Boolean(config.auto_booking_confirmed),
    auto_privacy_otp: Boolean(config.auto_privacy_otp),
    auto_reminder_tomorrow: Boolean(config.auto_reminder_tomorrow),
    reminder_send_hour: config.reminder_send_hour,
    auto_birthday_wishes: Boolean(config.auto_birthday_wishes),
    birthday_send_hour: config.birthday_send_hour,
    auto_winback_inactive: Boolean(config.auto_winback_inactive),
    winback_inactive_days: config.winback_inactive_days,
    winback_cooldown_days: config.winback_cooldown_days,
    winback_send_hour: config.winback_send_hour,
    winback_max_per_run: config.winback_max_per_run,
    updated_at: config.updated_at || null,
  };
}

function mergeWhatsAppSettingsUpdate(existingStored = {}, patch = {}) {
  const next = { ...existingStored };

  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (patch.phone_number_id !== undefined) {
    next.phone_number_id = String(patch.phone_number_id || '').trim().slice(0, 80);
  }
  if (patch.business_account_id !== undefined) {
    next.business_account_id = String(patch.business_account_id || '').trim().slice(0, 80);
  }
  if (patch.api_version !== undefined) {
    const ver = String(patch.api_version || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (ver) next.api_version = ver.slice(0, 16);
  }
  if (patch.clear_access_token === true) {
    next.access_token = '';
  } else if (typeof patch.access_token === 'string' && patch.access_token.trim()) {
    next.access_token = patch.access_token.trim().slice(0, 512);
  }

  if (patch.regenerate_cron_secret === true) {
    next.cron_secret = generateCronSecretToken();
  } else if (typeof patch.cron_secret === 'string' && patch.cron_secret.trim()) {
    next.cron_secret = patch.cron_secret.trim().slice(0, 160);
  } else if (!next.cron_secret && !process.env.CRON_SECRET) {
    next.cron_secret = generateCronSecretToken();
  }

  const boolKeys = [
    'fallback_to_wa_me',
    'auto_booking_confirmed',
    'auto_privacy_otp',
    'auto_reminder_tomorrow',
    'auto_birthday_wishes',
    'auto_winback_inactive',
  ];
  for (const key of boolKeys) {
    if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
  }

  if (patch.reminder_send_hour !== undefined) {
    next.reminder_send_hour = clampInt(patch.reminder_send_hour, 6, 22, 10);
  }
  if (patch.birthday_send_hour !== undefined) {
    next.birthday_send_hour = clampInt(patch.birthday_send_hour, 6, 22, 9);
  }
  if (patch.winback_send_hour !== undefined) {
    next.winback_send_hour = clampInt(patch.winback_send_hour, 6, 22, 11);
  }
  if (patch.winback_inactive_days !== undefined) {
    next.winback_inactive_days = clampInt(patch.winback_inactive_days, 15, 180, 45);
  }
  if (patch.winback_cooldown_days !== undefined) {
    next.winback_cooldown_days = clampInt(patch.winback_cooldown_days, 7, 180, 30);
  }
  if (patch.winback_max_per_run !== undefined) {
    next.winback_max_per_run = clampInt(patch.winback_max_per_run, 1, 100, 25);
  }

  return next;
}

async function sendWhatsAppCloudMessage({
  config,
  toPhone,
  messageText,
  metaTemplateName = '',
  metaTemplateLang = 'it',
  orderedParams = [],
  fetchImpl = null,
}) {
  const { waId, e164 } = normalizeWhatsAppPhone(toPhone);
  if (!waId) {
    return {
      ok: false,
      sent: false,
      mode: 'invalid_phone',
      payloadType: 'text',
      waId: '',
      e164: '',
      externalMessageId: null,
      error: 'Numero WhatsApp destinatario mancante o non valido.',
    };
  }

  if (!config || !config.isActive) {
    return {
      ok: false,
      sent: false,
      mode: config?.isConfigured ? 'disabled' : 'unconfigured',
      payloadType: 'text',
      waId,
      e164,
      externalMessageId: null,
      error: config?.isConfigured
        ? 'Invio automatico WhatsApp Business disattivato nelle impostazioni.'
        : 'Credenziali Meta WhatsApp Business API non configurate.',
    };
  }

  const tplName = String(metaTemplateName || '').trim();
  const payloadType = tplName ? 'template' : 'text';
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waId,
    type: payloadType,
  };

  if (tplName) {
    const cleanParams = (Array.isArray(orderedParams) ? orderedParams : [])
      .map((v) => String(v ?? '').trim())
      .filter((v) => v.length > 0);
    payload.template = {
      name: tplName,
      language: { code: String(metaTemplateLang || 'it').trim() || 'it' },
    };
    if (cleanParams.length > 0) {
      payload.template.components = [
        {
          type: 'body',
          parameters: cleanParams.map((textVal) => ({
            type: 'text',
            text: textVal.slice(0, 1024),
          })),
        },
      ];
    }
  } else {
    payload.text = {
      preview_url: false,
      body: String(messageText || '').slice(0, 4096),
    };
  }

  const transport = fetchImpl || globalThis.__GBS_WHATSAPP_FETCH__ || globalThis.fetch;
  if (typeof transport !== 'function') {
    return {
      ok: false,
      sent: false,
      mode: 'transport_unavailable',
      payloadType,
      waId,
      e164,
      externalMessageId: null,
      error: 'Client HTTP fetch non disponibile su questo runtime Node.',
    };
  }

  const endpoint = `https://graph.facebook.com/${encodeURIComponent(config.api_version || 'v21.0')}/${encodeURIComponent(config.phone_number_id)}/messages`;

  try {
    const res = await transport(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const apiErr = data.error || {};
      const detail = apiErr.error_data?.details ? ` (${apiErr.error_data.details})` : '';
      const msg = apiErr.message
        ? `Meta API${apiErr.code ? ` #${apiErr.code}` : ''}: ${apiErr.message}${detail}`
        : `Errore HTTP ${res.status} da Meta WhatsApp Cloud API`;
      return {
        ok: false,
        sent: false,
        mode: 'cloud_api_error',
        payloadType,
        waId,
        e164,
        externalMessageId: null,
        error: msg.slice(0, 390),
      };
    }

    const messageId = data?.messages?.[0]?.id || null;
    return {
      ok: true,
      sent: true,
      mode: 'cloud_api',
      payloadType,
      waId,
      e164,
      externalMessageId: messageId,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      sent: false,
      mode: 'network_error',
      payloadType,
      waId,
      e164,
      externalMessageId: null,
      error: String(err?.message || 'Errore di rete verso graph.facebook.com').slice(0, 390),
    };
  }
}

module.exports = {
  normalizeWhatsAppPhone,
  renderTemplateText,
  getOrderedTemplateParams,
  buildWaMeFallbackUrl,
  maskSecret,
  generateCronSecretToken,
  resolveWhatsAppConfig,
  sanitizeWhatsAppSettingsForClient,
  mergeWhatsAppSettingsUpdate,
  sendWhatsAppCloudMessage,
};
