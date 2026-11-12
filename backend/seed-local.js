/**
 * Local Test Account & Demo Data Seeder
 * Usage: node backend/seed-local.js
 */
require('dotenv').config();
process.env.DB_MODE = 'local';

const fs = require('fs');
const path = require('path');
const storeLocal = require('./store-local');
const { hashPassword, formatRomeNow, normalizePhone } = require('./helpers');

function addDaysIso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getBirthdayThisYearMinusYears(offsetDays, yearsOld) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear() - yearsOld;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

(async () => {
  const dbPath = path.resolve(process.cwd(), process.env.LOCAL_DB_FILE || '.local-dev-db.json');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const demoUsername = process.env.DEMO_ADMIN_USER || 'giulia@prova.local';
  const demoPassword = process.env.DEMO_ADMIN_PASS || 'GiuliaProva2026!';
  const nowStr = formatRomeNow();

  await storeLocal.createInitialAdmin({
    username: demoUsername,
    displayName: 'Giulia (Prova Locale)',
    passwordHash: hashPassword(demoPassword),
  });

  // 1. Cliente con compleanno OGGI + note tecniche
  const c1 = await storeLocal.saveClient({
    id: 0,
    fullName: 'Martina Rossi',
    phoneRaw: '+39 347 112 2334',
    phoneNorm: normalizePhone('+39 347 112 2334'),
    email: 'martina.rossi@example.it',
    birthDate: getBirthdayThisYearMinusYears(0, 29),
    allergiesNotes: 'Pelle leggermente sensibile sul viso',
    preferencesNotes: 'Unghie forma mandorla corta, adora Milky Rose e French sottile.',
    privacyAccepted: 1,
    marketingConsent: 1,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    ipHash: 'demo-seed',
  });

  // 2. Cliente con compleanno tra 3 giorni
  const c2 = await storeLocal.saveClient({
    id: 0,
    fullName: 'Elena Cattaneo',
    phoneRaw: '+39 339 884 5521',
    phoneNorm: normalizePhone('+39 339 884 5521'),
    email: 'elena.cattaneo@example.it',
    birthDate: getBirthdayThisYearMinusYears(3, 32),
    allergiesNotes: 'Allergia nichel lieve',
    preferencesNotes: 'Laminazione ciglia curvatura naturale + nero intenso. Preferisce fascia mattutina.',
    privacyAccepted: 1,
    marketingConsent: 1,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    ipHash: 'demo-seed',
  });

  // 3. Terza cliente
  const c3 = await storeLocal.saveClient({
    id: 0,
    fullName: 'Sofia Brambilla',
    phoneRaw: '+39 348 990 1122',
    phoneNorm: normalizePhone('+39 348 990 1122'),
    email: 'sofia.brambilla@example.it',
    birthDate: '1995-05-18',
    allergiesNotes: '',
    preferencesNotes: 'Copertura gel bordeaux autunnale.',
    privacyAccepted: 1,
    marketingConsent: 0,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    ipHash: 'demo-seed',
  });

  const todayIso = addDaysIso(0);
  const tomorrowIso = addDaysIso(1);

  // Appuntamento Oggi
  await storeLocal.createAdminAppointment({
    clientId: c1.id,
    privacyAccepted: 1,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    date: todayIso,
    time: '14:30',
    duration: 60,
    servicesJson: JSON.stringify([{ name: 'Manicure + semipermanente rinforzato', price: 33, duration: 60 }]),
    servicesSummary: 'Manicure + semipermanente rinforzato',
    totalPrice: 33,
    mode: 'booking',
    paymentMethod: 'studio',
    status: 'confirmed',
    notes: 'Rifare base Milky Rose, preparare crema mani extra.',
    ipHash: 'demo-seed',
  });

  // Due Appuntamenti Domani (pronti per testare "Promemoria Domani")
  await storeLocal.createAdminAppointment({
    clientId: c2.id,
    privacyAccepted: 1,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    date: tomorrowIso,
    time: '09:30',
    duration: 75,
    servicesJson: JSON.stringify([{ name: 'Laminazione ciglia coreana', price: 50, duration: 75 }]),
    servicesSummary: 'Laminazione ciglia coreana',
    totalPrice: 50,
    mode: 'booking',
    paymentMethod: 'studio',
    status: 'confirmed',
    notes: 'Chiedere se vuole aggiungere Henné sopracciglia.',
    ipHash: 'demo-seed',
  });

  await storeLocal.createAdminAppointment({
    clientId: c3.id,
    privacyAccepted: 1,
    privacyVersion: 'v2.0-2026-11',
    nowStr,
    date: tomorrowIso,
    time: '16:00',
    duration: 75,
    servicesJson: JSON.stringify([{ name: 'Copertura in gel', price: 35, duration: 75 }]),
    servicesSummary: 'Copertura in gel',
    totalPrice: 35,
    mode: 'booking',
    paymentMethod: 'studio',
    status: 'pending',
    notes: 'Confermare via WhatsApp la tonalità rosso borgogna.',
    ipHash: 'demo-seed',
  });

  console.log('======================================================');
  console.log('UTENZA DI PROVA LOCALE CREATA CON SUCCESSO');
  console.log(`URL Admin:  http://localhost:${process.env.PORT || 3000}/admin.html`);
  console.log(`Username:   ${demoUsername}`);
  console.log(`Password:   ${demoPassword}`);
  console.log('======================================================');
})();
