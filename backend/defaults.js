/**
 * GIULIA BEAUTY STUDIO — Shared Defaults (Operators & Message Templates)
 */
const { buildDefaultSchedule } = require('./availability');

function getDefaultOperatorPayload() {
  return {
    name: 'Giulia',
    role: 'Titolare • Nail Artist & Lash Specialist',
    color: '#d47491',
    active: 1,
    weekly_schedule_json: JSON.stringify(buildDefaultSchedule()),
  };
}

const DEFAULT_MESSAGE_TEMPLATES = [
  {
    code: 'reminder_tomorrow',
    title: 'Promemoria Appuntamento (Giorno Dopo)',
    body_template:
      'Ciao {nome} ♡ Ti ricordiamo il tuo appuntamento da *Giulia Beauty Studio* (Via Principe Amedeo 17, Verdellino) domani *{data}* alle *{ora}* con {operatore} per:\n• {trattamenti}\n\nA domani!',
  },
  {
    code: 'birthday_wishes',
    title: 'Auguri di Compleanno',
    body_template:
      'Tanti auguri di buon compleanno {nome}! 🎂✨ Tutto lo staff di *Giulia Beauty Studio* ti augura una giornata meravigliosa. Quando vuoi concederti una coccola beauty, ti aspettiamo in studio ♡',
  },
  {
    code: 'winback_inactive',
    title: 'Ricontatto Clienti Assenti',
    body_template:
      'Ciao {nome} ♡ È passato un po\' di tempo dalla tua ultima visita da *Giulia Beauty Studio* ({giorni_assenza} giorni fa). Se vuoi prenotare un ritocco o un trattamento relax, scrivici o prenota online quando preferisci!',
  },
  {
    code: 'privacy_sign',
    title: 'Firma Privacy Mobile con OTP',
    body_template:
      'Ciao {nome} ♡ Prima del tuo appuntamento da *Giulia Beauty Studio*, completa la firma dell\'Informativa Privacy GDPR direttamente dal telefono a questo link:\n{link}\n\nCodice di verifica OTP: *{otp}* (valido 7 giorni). Grazie!',
  },
  {
    code: 'booking_confirmed',
    title: 'Conferma Prenotazione Ricevuta',
    body_template:
      'Ciao {nome} ♡ Il tuo appuntamento da *Giulia Beauty Studio* del *{data}* alle *{ora}* con {operatore} ({trattamenti}) è confermato! A presto.',
    meta_template_name: '',
    meta_template_lang: 'it',
  },
  {
    code: 'gift_card',
    title: 'Invio Gift Card Digitale',
    body_template:
      'Ciao {nome}! ♡ Ecco la tua *Gift Card Giulia Beauty Studio*{da_parte}: *{regalo}*{scadenza}.\n{dedica}\n🔑 Codice Univoco: *{codice}*\n📍 Via Principe Amedeo 17, Verdellino (BG) • Prenota su +39 331 504 5135',
    meta_template_name: '',
    meta_template_lang: 'it',
  },
];

const DEFAULT_WHATSAPP_SETTINGS = {
  enabled: false,
  phone_number_id: '',
  business_account_id: '',
  access_token: '',
  api_version: 'v21.0',
  cron_secret: '',
  fallback_to_wa_me: true,
  auto_booking_confirmed: true,
  auto_privacy_otp: true,
  auto_reminder_tomorrow: true,
  reminder_send_hour: 10,
  auto_birthday_wishes: true,
  birthday_send_hour: 9,
  auto_winback_inactive: true,
  winback_inactive_days: 45,
  winback_cooldown_days: 30,
  winback_send_hour: 11,
  winback_max_per_run: 25,
};

module.exports = {
  getDefaultOperatorPayload,
  DEFAULT_MESSAGE_TEMPLATES,
  DEFAULT_WHATSAPP_SETTINGS,
};
