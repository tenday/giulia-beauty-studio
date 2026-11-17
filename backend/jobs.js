/**
 * GIULIA BEAUTY STUDIO — Semiautomatic WhatsApp Dispatcher & Date Helpers
 */
const { formatRomeNow } = require('./helpers');
const { normalizeWhatsAppPhone, renderTemplateText, buildWaMeUrl } = require('./whatsapp');

function addDaysIso(isoStr, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoStr || ''))) return isoStr;
  const [y, m, d] = isoStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(deltaDays || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatShortItDate(isoStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoStr || ''))) return String(isoStr || '');
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const [, m, d] = isoStr.split('-').map(Number);
  return `${d} ${months[m - 1] || m}`;
}

async function dispatchWhatsAppMessage({
  store,
  toPhone,
  recipientName = '',
  clientId = null,
  appointmentId = null,
  templateCode = null,
  vars = {},
  customText = '',
  adminId = null,
  triggerSource = 'manual',
}) {
  const templates = await store.listMessageTemplates();
  const tplRecord = templateCode ? templates.find((t) => t.code === templateCode) || null : null;

  const messageText = String(customText || '').trim()
    ? String(customText).trim()
    : renderTemplateText(tplRecord?.body_template || '', vars);

  if (!messageText) {
    return {
      ok: false,
      sent: false,
      sent_via: 'empty_message',
      error: 'Testo del messaggio vuoto o template non trovato.',
      log: null,
      wa_url: null,
      fallback_url: null,
      message_text: '',
    };
  }

  const normalized = normalizeWhatsAppPhone(toPhone);
  if (!normalized.waId) {
    return {
      ok: false,
      sent: false,
      sent_via: 'invalid_phone',
      error: 'Numero WhatsApp destinatario mancante o non valido.',
      log: null,
      wa_url: buildWaMeUrl('', messageText),
      fallback_url: buildWaMeUrl('', messageText),
      message_text: messageText,
    };
  }

  const displayPhone = normalized.e164 || String(toPhone || '').trim();
  const waUrl = buildWaMeUrl(displayPhone, messageText);

  const log = await store.createMessageLog({
    clientId,
    appointmentId,
    recipientPhone: displayPhone,
    recipientName: recipientName || null,
    channel: 'whatsapp',
    templateCode: templateCode || null,
    messageText,
    adminId,
    status: 'wa_me',
    externalMessageId: null,
    errorMessage: null,
    triggerSource,
    metaPayloadType: 'wa_me',
  });

  if (appointmentId && templateCode === 'reminder_tomorrow') {
    await store.markAppointmentReminder(appointmentId, formatRomeNow());
  }

  return {
    ok: true,
    sent: true,
    sent_via: 'wa_me',
    external_message_id: null,
    error: null,
    log,
    wa_url: waUrl,
    fallback_url: waUrl,
    message_text: messageText,
  };
}

module.exports = {
  addDaysIso,
  formatShortItDate,
  dispatchWhatsAppMessage,
};
