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
  {
    code: 'promo_monthly',
    title: 'Promozione del Mese (Broadcast Clienti)',
    body_template:
      'Ciao {nome} ♡ Questo mese da *Giulia Beauty Studio* c’è una promo speciale per te:\n✨ *{promo_titolo}* a *{promo_prezzo}* {promo_sconto}\n{promo_descrizione}\n\n📍 Via Principe Amedeo 17, Verdellino (BG) • Prenota su giuliabeautystudio.com o scrivici qui!',
    meta_template_name: '',
    meta_template_lang: 'it',
  },
];

const DEFAULT_MONTHLY_PROMOTIONS = [
  {
    title: 'Rituale Semipermanente Completo',
    badge_text: 'Mani & Piedi Perfection',
    month_label: 'Offerta del Mese',
    description: 'Cura impeccabile e brillantezza a lunga durata per mani e piedi sempre perfetti in ogni stagione.',
    services: [
      { id: 'nails-12', name: 'Manicure + semipermanente', price: 28, duration: 45 },
      { id: 'nails-8', name: 'Pedicure estetica + semipermanente', price: 34, duration: 50 },
    ],
    original_price: 62,
    promo_price: 55,
    duration_minutes: 95,
    valid_from: null,
    valid_until: null,
    active: 1,
    featured: 0,
    show_on_hero: 0,
    sort_order: 1,
  },
  {
    title: 'Rituale Sguardo Magnetico & Glow',
    badge_text: '♡ Sguardo & Viso Radioso',
    month_label: 'Più Richiesta del Mese',
    description:
      'Laminazione completa per ciglia e sopracciglia unita alla pulizia viso su misura per un volto fresco e luminoso senza trucco.',
    services: [
      { id: 'lashes-1', name: 'Laminazione ciglia', price: 45, duration: 60 },
      { id: 'lashes-2', name: 'Laminazione sopracciglia', price: 35, duration: 40 },
      { id: 'viso-1', name: 'Pulizia viso', price: 45, duration: 60 },
    ],
    original_price: 125,
    promo_price: 109,
    duration_minutes: 150,
    valid_from: null,
    valid_until: null,
    active: 1,
    featured: 1,
    show_on_hero: 0,
    sort_order: 2,
  },
  {
    title: 'Bridal Couture Experience',
    badge_text: 'Speciale Sposa & Grandi Eventi',
    month_label: 'Edizione Esclusiva',
    description:
      'Il pacchetto d’eccellenza per il tuo giorno più bello: preparazione della pelle, manicure spa + semipermanente e make up sposa.',
    services: [
      { id: 'makeup-1', name: 'Make up sposa', price: 150, duration: 120 },
      { id: 'viso-2', name: 'Trattamento viso relax', price: 40, duration: 50 },
      { id: 'nails-13', name: 'Manicure + semipermanente rinforzato', price: 33, duration: 55 },
    ],
    original_price: 223,
    promo_price: 199,
    duration_minutes: 225,
    valid_from: null,
    valid_until: null,
    active: 1,
    featured: 0,
    show_on_hero: 0,
    sort_order: 3,
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

const DEFAULT_PAYMENT_SETTINGS = {
  stripe_enabled: false,
  stripe_mode: 'test',
  stripe_publishable_key: '',
  stripe_secret_key: '',
  stripe_webhook_secret: '',
  allow_pay_in_studio: true,
  allow_online_full: true,
  allow_online_deposit: true,
  deposit_percent: 30,
  auto_confirm_on_paid: true,
  currency: 'eur',
};

module.exports = {
  getDefaultOperatorPayload,
  DEFAULT_MESSAGE_TEMPLATES,
  DEFAULT_MONTHLY_PROMOTIONS,
  DEFAULT_WHATSAPP_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
};
