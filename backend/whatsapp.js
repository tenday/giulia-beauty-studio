/**
 * GIULIA BEAUTY STUDIO — Semiautomatic WhatsApp (wa.me) & Template Helper
 */
const { normalizePhone } = require('./helpers');
const { DEFAULT_WHATSAPP_SETTINGS } = require('./defaults');

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

function buildWaMeUrl(phone, text) {
  const { waId } = normalizeWhatsAppPhone(phone);
  const encoded = encodeURIComponent(String(text || ''));
  return waId ? `https://wa.me/${waId}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

function getWhatsAppModeStatus() {
  return {
    ...DEFAULT_WHATSAPP_SETTINGS,
    mode: 'wa_me',
    semiautomatic: true,
    active: true,
  };
}

module.exports = {
  normalizeWhatsAppPhone,
  renderTemplateText,
  buildWaMeUrl,
  buildWaMeFallbackUrl: buildWaMeUrl,
  getWhatsAppModeStatus,
};
