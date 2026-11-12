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
  },
];

module.exports = {
  getDefaultOperatorPayload,
  DEFAULT_MESSAGE_TEMPLATES,
};
