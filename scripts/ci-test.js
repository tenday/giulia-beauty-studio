/**
 * CI Pre-Deploy Verification Suite:
 * 1. Syntax check across all JavaScript files
 * 2. DOM element ID alignment across HTML & frontend JS
 * 3. Isolated local-store end-to-end API regression suite
 */
const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TMP_DB_NAME = `.tmp-ci-db-${process.pid}.json`;
const TMP_DB_PATH = path.join(ROOT_DIR, TMP_DB_NAME);

function checkSyntax(files) {
  for (const rel of files) {
    execFileSync(process.execPath, ['--check', path.join(ROOT_DIR, rel)], { stdio: 'inherit' });
  }
  console.log(`[CI] Syntax OK (${files.length} file JavaScript)`);
}

function checkDomIds(jsFiles, htmlFiles) {
  const combinedHtml = htmlFiles.map((f) => fs.readFileSync(path.join(ROOT_DIR, f), 'utf8')).join('\n');
  const combinedJs = jsFiles.map((f) => fs.readFileSync(path.join(ROOT_DIR, f), 'utf8')).join('\n');
  const missing = [];
  for (const jsFile of jsFiles) {
    const js = fs.readFileSync(path.join(ROOT_DIR, jsFile), 'utf8');
    const re = /getElementById\(['"]([A-Za-z0-9_-]+)['"]\)/g;
    let m;
    while ((m = re.exec(js))) {
      const id = m[1];
      const inHtml = combinedHtml.includes(`id="${id}"`) || combinedHtml.includes(`id='${id}'`);
      const injectedInJs = combinedJs.includes(`id="${id}"`) || combinedJs.includes(`id='${id}'`);
      if (!inHtml && !injectedInJs) {
        missing.push(`${jsFile} -> #${id}`);
      }
    }
  }
  assert.deepStrictEqual(missing, [], `DOM IDs mancanti: ${missing.join(', ')}`);
}

async function runApiSuite() {
  process.env.DB_MODE = 'local';
  process.env.GBS_NO_LISTEN = '1';
  process.env.LOCAL_DB_FILE = TMP_DB_NAME;
  process.env.SESSION_SECRET = 'ci-test-session-secret-key';

  if (fs.existsSync(TMP_DB_PATH)) fs.unlinkSync(TMP_DB_PATH);

  const { app } = require(path.join(ROOT_DIR, 'server'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function req(method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }

  try {
    const setupRes = await req('POST', '/api/setup', {
      username: 'ci@test.local',
      password: 'Password123!',
      display_name: 'Giulia CI',
    });
    assert.strictEqual(setupRes.status, 200);

    const health = await req('GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.ok, true);

    const loginRes = await req('POST', '/api/auth/login', {
      username: 'ci@test.local',
      password: 'Password123!',
    });
    assert.strictEqual(loginRes.status, 200);
    assert(cookie.includes('gbs_studio_session='), 'Session cookie mancante');

    const opRes = await req('POST', '/api/admin/operators', {
      action: 'save',
      name: 'Sara',
      role: 'Nail Artist',
      color: '#6b4c9a',
      active: true,
    });
    assert([200, 201].includes(opRes.status));
    const opsList = await req('GET', '/api/admin/operators');
    const sara = opsList.json.operators.find((o) => o.name === 'Sara');
    assert(sara);
    assert.strictEqual(sara.weekly_schedule[1].enabled, true);
    assert.strictEqual(sara.weekly_schedule[1].start, '09:00');
    assert.strictEqual(sara.weekly_schedule[1].end, '15:00');
    assert.strictEqual(sara.weekly_schedule[2].enabled, false);
    assert.strictEqual(sara.weekly_schedule[3].end, '18:00');
    assert.strictEqual(sara.weekly_schedule[4].start, '13:00');
    assert.strictEqual(sara.weekly_schedule[4].end, '21:00');
    assert.strictEqual(sara.weekly_schedule[5].end, '19:00');
    assert.strictEqual(sara.weekly_schedule[6].end, '18:00');
    assert.strictEqual(sara.weekly_schedule[0].enabled, false);

    // Day-specific 15-min slot checks aligned to weekly working hours
    const monSlots = await req('GET', `/api/public/slots?date=2026-11-30&duration=60&operator_id=${sara.id}`);
    assert.strictEqual(monSlots.json.closed, false);
    assert.strictEqual(monSlots.json.step_minutes, 15);
    assert(monSlots.json.free_slots.includes('09:15'), 'Lunedì deve generare slot ogni 15 min (09:15)');
    assert(monSlots.json.free_slots.includes('14:00'), 'Lunedì 14:00 deve risultare libero per 60 min (chiude alle 15:00)');
    assert(!monSlots.json.free_slots.includes('14:15'), 'Lunedì 14:15 non deve entrare per 60 min (chiude alle 15:00)');
    assert(!monSlots.json.booked_slots.includes('13:00'), 'Lunedì 13:00 deve risultare libero (09:00-15:00)');
    assert(monSlots.json.booked_slots.includes('16:00'), 'Lunedì 16:00 deve risultare fuori orario');

    const monShort = await req('GET', `/api/public/slots?date=2026-11-30&duration=40&operator_id=${sara.id}`);
    assert(monShort.json.free_slots.includes('14:15'), 'Lunedì 14:15 deve essere disponibile per un trattamento da 40 min');

    const tueSlots = await req('GET', `/api/public/slots?date=2026-12-01&duration=60&operator_id=${sara.id}`);
    assert.strictEqual(tueSlots.json.closed, true);
    assert.deepStrictEqual(tueSlots.json.free_slots, []);

    const nextAvailRes = await req('GET', `/api/public/next-available?from=2026-12-01&duration=60&operator_id=${sara.id}`);
    assert.strictEqual(nextAvailRes.status, 200);
    assert.strictEqual(nextAvailRes.json.found, true);
    assert.strictEqual(nextAvailRes.json.date, '2026-12-02');
    assert(nextAvailRes.json.available_count > 0 && /^\d{2}:\d{2}$/.test(nextAvailRes.json.first_slot));

    const thuSlots = await req('GET', `/api/public/slots?date=2026-12-03&duration=60&operator_id=${sara.id}`);
    assert(thuSlots.json.booked_slots.includes('11:00'), 'Giovedì 11:00 deve risultare fuori orario (13:00-21:00)');
    assert(thuSlots.json.free_slots.includes('13:15'), 'Giovedì deve includere 13:15');
    assert(!thuSlots.json.booked_slots.includes('19:30'), 'Giovedì 19:30 deve risultare libero (13:00-21:00)');
    assert(thuSlots.json.free_slots.includes('20:00'), 'Giovedì 20:00 deve risultare libero per 60 min (fino alle 21:00)');
    assert(!thuSlots.json.free_slots.includes('20:15'), 'Giovedì 20:15 non deve entrare per 60 min');
    assert(Array.isArray(thuSlots.json.day_slots) && thuSlots.json.day_slots.some((s) => s.time === '13:00' && s.available));

    // Verify 15-min gap recovery & same-day lead time filtering directly
    const { computeDateSlotAvailability } = require(path.join(ROOT_DIR, 'backend', 'availability'));
    const gapCheck = computeDateSlotAvailability({
      dateStr: '2026-11-30',
      durationMinutes: 60,
      operators: [sara],
      bookedRows: [{ operator_id: sara.id, start_time: '09:00', duration_minutes: 40 }],
      requestedOperatorId: sara.id,
      nowRome: { date: '2026-11-15', datetime: '2026-11-15 10:00:00' },
    });
    assert(!gapCheck.freeSlots.includes('09:30'));
    assert(gapCheck.freeSlots.includes('09:45'), 'Dopo appuntamento 09:00-09:40 deve liberarsi subito lo slot delle 09:45');

    const sameDayCheck = computeDateSlotAvailability({
      dateStr: '2026-12-03',
      durationMinutes: 60,
      operators: [sara],
      bookedRows: [],
      requestedOperatorId: sara.id,
      minLeadMinutes: 60,
      nowRome: { date: '2026-12-03', datetime: '2026-12-03 14:10:00' },
    });
    assert(!sameDayCheck.freeSlots.includes('15:00'), 'Slot 15:00 alle 14:10 viola preavviso 60 min');
    assert.strictEqual(sameDayCheck.freeSlots[0], '15:15', 'Primo slot valido alle 14:10 (+60 min) deve essere 15:15');

    // Past dates must be rejected cleanly by POST /api/public/book
    const pastBook = await req('POST', '/api/public/book', {
      client_name: 'Passato Test',
      client_phone: '+393401112299',
      appointment_date: '2020-01-15',
      start_time: '10:00',
      duration_minutes: 60,
      operator_id: sara.id,
      services: [{ name: 'Manicure', price: 12 }],
      total_price: 12,
      privacy_accepted: true,
    });
    assert.strictEqual(pastBook.status, 422);
    assert.strictEqual(pastBook.json.code, 'SLOT_TOO_SOON');

    // Verify editing operator weekly schedule works cleanly and persists
    const customSchedule = { ...sara.weekly_schedule, 3: { ...sara.weekly_schedule[3], break_start: '13:00', break_end: '14:00' } };
    const updOpRes = await req('POST', '/api/admin/operators', {
      action: 'save',
      id: sara.id,
      name: sara.name,
      role: sara.role,
      color: sara.color,
      active: true,
      weekly_schedule: customSchedule,
    });
    assert.strictEqual(updOpRes.status, 200);
    const opsAfterUpd = await req('GET', '/api/admin/operators');
    const saraUpdated = opsAfterUpd.json.operators.find((o) => o.id === sara.id);
    assert.strictEqual(saraUpdated.weekly_schedule[3].break_start, '13:00');
    assert.strictEqual(saraUpdated.weekly_schedule[3].break_end, '14:00');

    const testDate = '2026-12-02';
    const absRes = await req('POST', '/api/admin/absences', {
      action: 'create',
      operator_id: sara.id,
      start_date: testDate,
      end_date: testDate,
      start_time: '09:30',
      end_time: '12:00',
      type: 'permesso',
    });
    assert([200, 201].includes(absRes.status));

    const slots = await req('GET', `/api/public/slots?date=${testDate}&duration=60&operator_id=${sara.id}`);
    assert(slots.json.booked_slots.includes('11:00'));
    assert(!slots.json.free_slots.includes('12:15'), '12:15 (60 min) si sovrappone alla pausa 13:00-14:00');
    assert(!slots.json.free_slots.includes('13:15'), 'Gli slot in pausa 13:00-14:00 non devono risultare liberi');
    assert(!slots.json.day_slots.some((s) => s.time === '13:15'), 'Gli slot nella pausa giornaliera sono esclusi dai day_slots');
    assert(slots.json.free_slots.includes('12:00'), '12:00 (60 min) termina alle 13:00 ed è valido prima della pausa');
    assert(slots.json.free_slots.includes('14:00'), '14:00 riparte subito dopo la pausa');
    assert(!slots.json.booked_slots.includes('14:30'));

    const blocked = await req('POST', '/api/public/book', {
      client_name: 'Elena Rossi',
      client_phone: '+393401112233',
      appointment_date: testDate,
      start_time: '11:00',
      duration_minutes: 60,
      operator_id: sara.id,
      services: [{ name: 'Manicure Gel', price: 45 }],
      total_price: 45,
      privacy_accepted: true,
    });
    assert.strictEqual(blocked.status, 409);

    const booked = await req('POST', '/api/public/book', {
      client_name: 'Elena Rossi',
      client_phone: '+393401112233',
      appointment_date: testDate,
      start_time: '14:30',
      duration_minutes: 60,
      operator_id: sara.id,
      services: [{ name: 'Manicure Gel', price: 45 }],
      total_price: 45,
      privacy_accepted: true,
    });
    assert.strictEqual(booked.status, 201);

    const insights = await req('GET', '/api/admin/insights');
    assert.strictEqual(insights.status, 200);
    assert(Array.isArray(insights.json.insights.operator_stats));

    // Interactive calendar reschedule (drag/drop + duration resize)
    const apptsBefore = await req('GET', `/api/admin/appointments?start_date=${testDate}&end_date=${testDate}`);
    const targetAppt = apptsBefore.json.appointments.find((a) => Number(a.id) === Number(booked.json.appointment_id));
    assert(targetAppt);

    const movedDate = '2026-12-03';
    const resched = await req('POST', '/api/admin/appointments', {
      action: 'reschedule',
      id: targetAppt.id,
      appointment_date: movedDate,
      start_time: '16:15',
      duration_minutes: 105,
    });
    assert.strictEqual(resched.status, 200);
    assert.strictEqual(resched.json.duration_minutes, 105);

    const apptsAfter = await req('GET', `/api/admin/appointments?start_date=${movedDate}&end_date=${movedDate}`);
    const movedAppt = apptsAfter.json.appointments.find((a) => Number(a.id) === Number(targetAppt.id));
    assert(movedAppt);
    assert.strictEqual(movedAppt.start_time, '16:15');
    assert.strictEqual(movedAppt.duration_minutes, 105);
    assert.strictEqual(movedAppt.services_summary, targetAppt.services_summary);
    assert.strictEqual(Number(movedAppt.total_price), Number(targetAppt.total_price));

    // Direct in-agenda appointment duplication (clone to another day/slot via create action)
    const dupDate = '2026-12-04';
    const dupRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      client_id: movedAppt.client_id,
      client_name: movedAppt.client_name,
      client_phone: movedAppt.client_phone,
      operator_id: movedAppt.operator_id,
      appointment_date: dupDate,
      start_time: '11:15',
      duration_minutes: movedAppt.duration_minutes,
      services_summary: movedAppt.services_summary,
      total_price: Number(movedAppt.total_price),
      status: 'confirmed',
      notes: 'Duplicato in agenda',
      send_whatsapp: false,
    });
    assert.strictEqual(dupRes.status, 201);
    assert.strictEqual(dupRes.json.ok, true);
    assert(dupRes.json.id && Number(dupRes.json.id) !== Number(movedAppt.id), 'Duplicate deve creare un nuovo ID');

    const apptsDup = await req('GET', `/api/admin/appointments?start_date=${dupDate}&end_date=${dupDate}`);
    const clonedAppt = apptsDup.json.appointments.find((a) => Number(a.id) === Number(dupRes.json.id));
    assert(clonedAppt);
    assert.strictEqual(clonedAppt.start_time, '11:15');
    assert.strictEqual(clonedAppt.duration_minutes, movedAppt.duration_minutes);
    assert.strictEqual(clonedAppt.services_summary, movedAppt.services_summary);
    assert.strictEqual(Number(clonedAppt.total_price), Number(movedAppt.total_price));
    assert.strictEqual(clonedAppt.notes, 'Duplicato in agenda');

    const delDupRes = await req('POST', '/api/admin/appointments', {
      action: 'delete',
      id: clonedAppt.id,
    });
    assert.strictEqual(delDupRes.status, 200);

    const badTime = await req('POST', '/api/admin/appointments', {
      action: 'reschedule',
      id: targetAppt.id,
      appointment_date: movedDate,
      start_time: '29:99',
      duration_minutes: 60,
    });
    assert.strictEqual(badTime.status, 422);

    const missingId = await req('POST', '/api/admin/appointments', {
      action: 'reschedule',
      id: 999999,
      appointment_date: movedDate,
      start_time: '10:00',
      duration_minutes: 60,
    });
    assert.strictEqual(missingId.status, 404);

    const delRes = await req('POST', '/api/admin/appointments', {
      action: 'delete',
      id: targetAppt.id,
    });
    assert.strictEqual(delRes.status, 200);

    // Gift Card Generator CRUD + Partial/Full Redeem + Delete
    const gcBad = await req('POST', '/api/admin/gift-cards', {
      action: 'create',
      recipient_name: '',
      amount: 80,
    });
    assert.strictEqual(gcBad.status, 422);

    const gcCreate = await req('POST', '/api/admin/gift-cards', {
      action: 'create',
      theme: 'bordeaux',
      gift_mode: 'amount',
      amount: 80,
      recipient_name: 'Laura Conti',
      sender_name: 'Marco',
      message: 'Buon compleanno!',
    });
    assert.strictEqual(gcCreate.status, 201);
    const gcId = gcCreate.json.gift_card.id;
    const gcCode = gcCreate.json.gift_card.code;
    assert(gcCode.startsWith('GBS-'));

    const gcDup = await req('POST', '/api/admin/gift-cards', {
      action: 'create',
      code: gcCode,
      recipient_name: 'Altra',
      amount: 50,
    });
    assert.strictEqual(gcDup.status, 409);

    const gcPartial = await req('POST', '/api/admin/gift-cards', {
      action: 'redeem',
      id: gcId,
      redeem_amount: 30,
    });
    assert.strictEqual(gcPartial.status, 200);
    assert.strictEqual(Number(gcPartial.json.gift_card.remaining_amount), 50);
    assert.strictEqual(gcPartial.json.gift_card.status, 'active');

    const gcFull = await req('POST', '/api/admin/gift-cards', {
      action: 'redeem',
      id: gcId,
      mark_full: true,
    });
    assert.strictEqual(gcFull.status, 200);
    assert.strictEqual(Number(gcFull.json.gift_card.remaining_amount), 0);
    assert.strictEqual(gcFull.json.gift_card.status, 'redeemed');

    const gcList = await req('GET', '/api/admin/gift-cards');
    assert.strictEqual(gcList.status, 200);
    assert(gcList.json.gift_cards.some((g) => g.code === gcCode));

    const gcDel = await req('POST', '/api/admin/gift-cards', {
      action: 'delete',
      id: gcId,
    });
    assert.strictEqual(gcDel.status, 200);

    // =========================================================================
    // Monthly Promotions CRUD + Storefront Reflection + Authoritative Pricing
    // =========================================================================
    const initPublicPromos = await req('GET', '/api/public/promotions');
    assert.strictEqual(initPublicPromos.status, 200);
    assert(Array.isArray(initPublicPromos.json.promotions) && initPublicPromos.json.promotions.length >= 1, 'Promozioni default devono essere inizializzate');

    const createPromo = await req('POST', '/api/admin/promotions', {
      action: 'create',
      title: 'Rituale Novembre Test Promo',
      badge_text: '♡ Promo Test',
      month_label: 'Novembre 2026',
      description: 'Pacchetto test promozionale',
      services: [
        { id: 'nails-12', name: 'Manicure + semipermanente', price: 28, duration: 45 },
        { id: 'lashes-1', name: 'Laminazione ciglia', price: 45, duration: 60 },
      ],
      original_price: 73,
      promo_price: 59,
      duration_minutes: 90,
      active: true,
      featured: true,
      show_on_hero: true,
      sort_order: 0,
    });
    assert.strictEqual(createPromo.status, 201);
    const createdPromoId = createPromo.json.promotion.id;

    const pubAfterCreate = await req('GET', '/api/public/promotions');
    assert.strictEqual(pubAfterCreate.status, 200);
    const foundHero = pubAfterCreate.json.promotions.find((p) => Number(p.id) === Number(createdPromoId));
    assert(foundHero, 'La promo creata deve comparire in /api/public/promotions');
    assert.strictEqual(Number(foundHero.show_on_hero), 1);

    // Public booking with promo_id must use server authoritative promo_price (59, ignoring client 1)
    const promoBookDate = '2026-12-07'; // Monday (Giulia open 09:00-15:00)
    const promoBook = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: promoBookDate,
      start_time: '11:00',
      duration_minutes: 90,
      operator_id: sara.id,
      services: [{ promo_id: createdPromoId, is_promotion: true, name: 'Tampered Name', price: 1, duration: 15 }],
      total_price: 1,
      client_name: 'Elena Promo',
      client_phone: '+39 339 777 8899',
      payment_method: 'studio',
      privacy_accepted: true,
    });
    assert.strictEqual(promoBook.status, 201);

    const apptsCheck = await req('GET', `/api/admin/appointments?start_date=${promoBookDate}&end_date=${promoBookDate}`);
    const savedPromoAppt = apptsCheck.json.appointments.find((a) => a.booking_code === promoBook.json.booking_code);
    assert(savedPromoAppt, 'Appuntamento con promo salvato in agenda');
    assert.strictEqual(Number(savedPromoAppt.total_price), 59);
    assert(savedPromoAppt.services_summary.includes('Rituale Novembre Test Promo'));

    // Toggle inactive -> must hide from storefront and reject stale promo_id booking
    const toggleOff = await req('POST', '/api/admin/promotions', {
      action: 'toggle_active',
      id: createdPromoId,
      active: false,
    });
    assert.strictEqual(toggleOff.status, 200);
    assert.strictEqual(Number(toggleOff.json.promotion.active), 0);

    const pubAfterToggle = await req('GET', '/api/public/promotions');
    assert(!pubAfterToggle.json.promotions.some((p) => Number(p.id) === Number(createdPromoId)));

    const stalePromoBook = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: promoBookDate,
      start_time: '12:45',
      duration_minutes: 90,
      operator_id: sara.id,
      services: [{ promo_id: createdPromoId, is_promotion: true, name: 'Promo', price: 59, duration: 90 }],
      total_price: 59,
      client_name: 'Elena Scaduta',
      client_phone: '+39 339 777 8890',
      payment_method: 'studio',
      privacy_accepted: true,
    });
    assert.strictEqual(stalePromoBook.status, 422);
    assert.strictEqual(stalePromoBook.json.code, 'PROMO_UNAVAILABLE');

    // Reactivate briefly to verify AI chat knows about monthly promo, then clean up
    await req('POST', '/api/admin/promotions', { action: 'toggle_active', id: createdPromoId, active: true });
    const aiPromoRes = await req('POST', '/api/admin/ai-chat', { question: 'Quali promozioni sono attive questo mese?' });
    assert.strictEqual(aiPromoRes.status, 200);
    assert(aiPromoRes.json.answer.includes('Rituale Novembre Test Promo'));

    const promoDel = await req('POST', '/api/admin/promotions', { action: 'delete', id: createdPromoId });
    assert.strictEqual(promoDel.status, 200);
    const adminPromosAfterDel = await req('GET', '/api/admin/promotions');
    assert(!adminPromosAfterDel.json.promotions.some((p) => Number(p.id) === Number(createdPromoId)));
    await req('POST', '/api/admin/appointments', { action: 'delete', id: savedPromoAppt.id });

    // =========================================================================
    // Semiautomatic WhatsApp (wa.me) & Privacy OTP Regression Suite (Meta-free)
    // =========================================================================
    const { getRomeToday } = require(path.join(ROOT_DIR, 'backend', 'helpers'));
    const { addDaysIso } = require(path.join(ROOT_DIR, 'backend', 'jobs'));
    const todayIso = getRomeToday();
    const tomorrowIso = addDaysIso(todayIso, 1);

    const msgsInit = await req('GET', '/api/admin/messages');
    assert.strictEqual(msgsInit.status, 200);
    assert.strictEqual(msgsInit.json.whatsapp_status.mode, 'wa_me');
    assert.strictEqual(msgsInit.json.whatsapp_status.semiautomatic, true);
    assert(msgsInit.json.templates.some((t) => t.code === 'privacy_sign'));
    assert(msgsInit.json.templates.some((t) => t.code === 'reminder_tomorrow'));

    // Removed Meta Cloud API & cron routes must return 404
    const removedAuto = await req('GET', '/api/admin/automation');
    assert.strictEqual(removedAuto.status, 404);
    const removedCron = await fetch(`${baseUrl}/api/cron/run-jobs`);
    assert.strictEqual(removedCron.status, 404);

    // Invalid phone returns 422 clearly without Meta error
    const badWaSend = await req('POST', '/api/admin/whatsapp/send', {
      recipient_phone: '123',
      recipient_name: 'Numero Errato',
      message_text: 'Ciao test',
    });
    assert.strictEqual(badWaSend.status, 422);
    assert.strictEqual(badWaSend.json.sent_via, 'invalid_phone');

    // Valid semiautomatic wa.me send + log creation
    const manualWaSend = await req('POST', '/api/admin/whatsapp/send', {
      recipient_phone: '+39 331 555 0001',
      recipient_name: 'Cliente Semiauto',
      message_text: 'Ciao test semiautomatico',
      trigger_source: 'manual',
    });
    assert.strictEqual(manualWaSend.status, 200);
    assert.strictEqual(manualWaSend.json.sent, true);
    assert.strictEqual(manualWaSend.json.sent_via, 'wa_me');
    assert(String(manualWaSend.json.wa_url || '').startsWith('https://wa.me/393315550001?text='));

    // Appointment reminder via semiautomatic WhatsApp marks reminder_sent_at automatically
    const remApptRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: tomorrowIso,
      start_time: '11:00',
      duration_minutes: 60,
      services_summary: 'Semipermanente Rinforzato',
      total_price: 45,
      client_name: 'Marta Promemoria WA',
      client_phone: '+39 339 111 2233',
      privacy_accepted: true,
      send_whatsapp: false,
    });
    assert.strictEqual(remApptRes.status, 201);
    assert.strictEqual(remApptRes.json.whatsapp_sent, false);

    const remSendRes = await req('POST', '/api/admin/whatsapp/send', {
      client_id: remApptRes.json.client_id,
      appointment_id: remApptRes.json.id,
      recipient_phone: '+39 339 111 2233',
      recipient_name: 'Marta Promemoria WA',
      template_code: 'reminder_tomorrow',
      vars: {
        nome: 'Marta Promemoria WA',
        data: tomorrowIso,
        ora: '11:00',
        trattamenti: 'Semipermanente Rinforzato',
        operatore: 'Sara',
      },
      trigger_source: 'manual',
    });
    assert.strictEqual(remSendRes.status, 200);
    assert.strictEqual(remSendRes.json.sent_via, 'wa_me');

    const apptsCheckRem = await req('GET', `/api/admin/appointments?start_date=${tomorrowIso}&end_date=${tomorrowIso}`);
    const updatedRemAppt = apptsCheckRem.json.appointments.find((a) => Number(a.id) === Number(remApptRes.json.id));
    assert(updatedRemAppt && updatedRemAppt.reminder_sent_at, 'reminder_sent_at deve aggiornarsi dopo invio semiautomatico');

    // Privacy OTP semiautomatic WhatsApp dispatch MUST work without Meta API!
    const privReqRes = await req('POST', `/api/admin/clients/${remApptRes.json.client_id}/privacy-request`, {
      send_whatsapp: true,
    });
    assert.strictEqual(privReqRes.status, 201);
    assert(privReqRes.json.request.otp_code && privReqRes.json.request.token);
    assert.strictEqual(privReqRes.json.whatsapp_dispatch.sent, true);
    assert.strictEqual(privReqRes.json.whatsapp_dispatch.sent_via, 'wa_me');
    assert(String(privReqRes.json.whatsapp_dispatch.wa_url || '').startsWith('https://wa.me/393391112233?text='));
    assert(
      decodeURIComponent(privReqRes.json.whatsapp_dispatch.wa_url).includes(privReqRes.json.request.otp_code),
      'Il link wa.me Privacy OTP deve contenere il codice OTP generato'
    );

    // Optional appointment creation confirmation link when send_whatsapp: true
    const optConfirmAppt = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: '2026-12-03',
      start_time: '14:30',
      duration_minutes: 60,
      services_summary: 'Manicure Spa',
      total_price: 35,
      client_name: 'Elena Conferma WA',
      client_phone: '+39 333 777 8899',
      privacy_accepted: true,
      send_whatsapp: true,
    });
    assert.strictEqual(optConfirmAppt.status, 201);
    assert.strictEqual(optConfirmAppt.json.whatsapp_sent, true);
    assert(String(optConfirmAppt.json.whatsapp_dispatch?.wa_url || '').startsWith('https://wa.me/393337778899?text='));

    const msgsAfter = await req('GET', '/api/admin/messages');
    assert(msgsAfter.json.logs.some((l) => l.status === 'wa_me' && l.trigger_source === 'auto_privacy'));
    assert(msgsAfter.json.logs.some((l) => l.status === 'wa_me' && l.template_code === 'reminder_tomorrow'));

    // GDPR default false checks: creating client / appointment without explicit consent stores privacy_accepted=0
    const noGdprApptRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: '2026-12-10',
      start_time: '12:00',
      duration_minutes: 30,
      services_summary: 'Consulenza',
      total_price: 0,
      client_name: 'Sofia NoGdpr',
      client_phone: '+39 349 888 7766',
      status: 'confirmed',
      send_whatsapp: false,
    });
    assert.strictEqual(noGdprApptRes.status, 201);
    const noGdprClientRes = await req('GET', `/api/admin/clients?id=${noGdprApptRes.json.client_id}`);
    assert.strictEqual(noGdprClientRes.status, 200);
    assert.strictEqual(Number(noGdprClientRes.json.client.privacy_accepted), 0);

    // Promo pricing impact on Agenda & Public Storefront bookings
    const ciPromoCreateRes = await req('POST', '/api/admin/promotions', {
      action: 'create',
      title: 'Promo Test Sguardo & Mani',
      badge_text: 'Offerta CI',
      month_label: 'Dicembre 2026',
      description: 'Pacchetto promozionale test CI',
      services: [
        { id: 'nails-12', name: 'Manicure + Semipermanente', price: 35, duration: 60 },
        { id: 'lashes-6', name: 'Mappatura Sopracciglia + Tinta', price: 25, duration: 30 },
      ],
      original_price: 60,
      promo_price: 44.9,
      duration_minutes: 90,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      active: 1,
      featured: 1,
      show_on_hero: 0,
      sort_order: 1,
    });
    assert.strictEqual(ciPromoCreateRes.status, 201);
    const ciPricingPromoId = Number(ciPromoCreateRes.json.promotion?.id);
    assert(ciPricingPromoId > 0, 'Promo creata senza id');

    const adminPromoApptRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: '2026-12-12',
      start_time: '10:00',
      duration_minutes: 105,
      services: [
        {
          id: `promo-${ciPricingPromoId}`,
          is_promotion: true,
          promo_id: ciPricingPromoId,
          name: 'Promo: Promo Test Sguardo & Mani',
          price: 44.9,
          original_price: 60,
          duration: 90,
        },
        { id: 'nails-3', name: 'Manicure Spa', price: 20, duration: 15 },
      ],
      services_summary: 'Promo: Promo Test Sguardo & Mani + Manicure Spa',
      total_price: 64.9,
      client_name: 'Elena PromoAdmin',
      client_phone: '+39 340 123 4567',
      status: 'confirmed',
      send_whatsapp: false,
    });
    assert.strictEqual(adminPromoApptRes.status, 201);

    const publicPromoBookRes = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-12',
      start_time: '15:00',
      duration_minutes: 90,
      operator_id: sara.id,
      services: [
        {
          id: `promo-${ciPricingPromoId}`,
          is_promotion: true,
          promo_id: ciPricingPromoId,
          name: 'Promo: Promo Test Sguardo & Mani',
          price: 999, // Verify backend enforces authoritative promo_price 44.90
          original_price: 60,
          duration: 90,
        },
      ],
      total_price: 999,
      client_name: 'Chiara PromoWeb',
      client_phone: '+39 348 987 6543',
      payment_method: 'studio',
      privacy_accepted: true,
    });
    assert.strictEqual(publicPromoBookRes.status, 201);

    const promoDayAppts = await req('GET', '/api/admin/appointments?start_date=2026-12-12&end_date=2026-12-12');
    assert.strictEqual(promoDayAppts.status, 200);
    const savedAdminPromo = promoDayAppts.json.appointments.find((a) => a.client_name === 'Elena PromoAdmin');
    const savedWebPromo = promoDayAppts.json.appointments.find((a) => a.booking_code === publicPromoBookRes.json.booking_code);
    assert(savedAdminPromo && Math.abs(Number(savedAdminPromo.total_price) - 64.9) < 0.01, `Atteso 64.90 su appt admin promo, trovato ${savedAdminPromo?.total_price}`);
    assert(savedWebPromo && Math.abs(Number(savedWebPromo.total_price) - 44.9) < 0.01, `Atteso promo_price 44.90 su appt web promo, trovato ${savedWebPromo?.total_price}`);

    // 13. Payments, Cassa & Stripe Checkout Regression Suite
    const initPubPayRes = await req('GET', '/api/public/payment-config');
    assert.strictEqual(initPubPayRes.status, 200);
    assert.strictEqual(initPubPayRes.json.config.stripe_ready, false);
    assert.strictEqual(initPubPayRes.json.config.paypal_ready, false);

    const stripeWebhookSecret = 'whsec_ci_secret_test_987654';
    const savePayCfgRes = await req('POST', '/api/admin/payments/settings', {
      stripe_enabled: true,
      stripe_mode: 'test',
      stripe_publishable_key: 'pk_test_ci_123',
      stripe_secret_key: 'sk_test_ci_secret_abcdef',
      stripe_webhook_secret: stripeWebhookSecret,
      allow_pay_in_studio: true,
      allow_online_full: true,
      allow_online_deposit: true,
      deposit_percent: 30,
      auto_confirm_on_paid: true,
    });
    assert.strictEqual(savePayCfgRes.status, 200);
    assert.strictEqual(savePayCfgRes.json.settings.has_secret_key, true);
    assert.strictEqual(savePayCfgRes.json.settings.stripe_secret_key, undefined);
    assert.strictEqual(savePayCfgRes.json.settings.stripe_webhook_secret, undefined);

    const pubPayReadyRes = await req('GET', '/api/public/payment-config');
    assert.strictEqual(pubPayReadyRes.status, 200);
    assert.strictEqual(pubPayReadyRes.json.config.stripe_ready, true);
    assert.strictEqual(pubPayReadyRes.json.config.deposit_percent, 30);

    const stripeSessions = new Map();
    globalThis.__GBS_STRIPE_FETCH__ = async (url, opts) => {
      const target = String(url);
      if (target.endsWith('/v1/account')) {
        return new Response(
          JSON.stringify({ id: 'acct_ci_test', charges_enabled: true, business_profile: { name: 'Giulia Beauty Test' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.endsWith('/v1/checkout/sessions') && String(opts?.method).toUpperCase() === 'POST') {
        const params = new URLSearchParams(String(opts.body || ''));
        const sid = `cs_test_${stripeSessions.size + 1}`;
        const amountTotal = Number(params.get('line_items[0][price_data][unit_amount]') || 0);
        const sessObj = {
          id: sid,
          url: `https://checkout.stripe.com/c/pay/${sid}`,
          client_reference_id: params.get('client_reference_id'),
          amount_total: amountTotal,
          payment_status: 'paid',
          status: 'complete',
          payment_intent: `pi_test_${stripeSessions.size + 1}`,
          metadata: {
            booking_code: params.get('metadata[booking_code]'),
            pay_scope: params.get('metadata[pay_scope]'),
            charge_amount: params.get('metadata[charge_amount]'),
          },
        };
        stripeSessions.set(sid, sessObj);
        return new Response(JSON.stringify(sessObj), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('/v1/checkout/sessions/cs_test_')) {
        const sid = target.split('/').pop().split('?')[0];
        const sessObj = stripeSessions.get(sid);
        return new Response(JSON.stringify(sessObj || { error: { message: 'Not found' } }), {
          status: sessObj ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.endsWith('/v1/refunds')) {
        return new Response(JSON.stringify({ id: 're_test_1', status: 'succeeded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'Unexpected Stripe route' } }), { status: 400 });
    };

    const stripeConnRes = await req('POST', '/api/admin/payments/test-stripe', {});
    assert.strictEqual(stripeConnRes.status, 200);
    assert.strictEqual(stripeConnRes.json.ok, true);

    // Online 30% deposit checkout (€100 total -> €30 online)
    const depositBookRes = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-18',
      start_time: '11:00',
      duration_minutes: 60,
      services: [{ id: 'ci-srv-1', name: 'Ricostruzione Gel Luxury', price: 100, duration: 60 }],
      total_price: 100,
      client_name: 'Sara Stripe Acconto',
      client_phone: '+39 333 9001122',
      payment_method: 'stripe_deposit',
      privacy_accepted: true,
    });
    assert.strictEqual(depositBookRes.status, 201);
    assert.strictEqual(depositBookRes.json.requires_stripe_redirect, true);
    assert.strictEqual(depositBookRes.json.charge_amount, 30);

    const verifyDepRes1 = await req('POST', '/api/public/stripe/verify-session', {
      session_id: depositBookRes.json.stripe_session_id,
      booking_code: depositBookRes.json.booking_code,
    });
    assert.strictEqual(verifyDepRes1.status, 200);
    assert.strictEqual(verifyDepRes1.json.paid, true);
    assert.strictEqual(verifyDepRes1.json.receipt.payment_status, 'partial');
    assert.strictEqual(verifyDepRes1.json.receipt.paid_amount, 30);
    assert.strictEqual(verifyDepRes1.json.receipt.remaining_amount, 70);
    assert.strictEqual(verifyDepRes1.json.receipt.status, 'confirmed');

    // Idempotent 2nd verify-session must not double-record
    const verifyDepRes2 = await req('POST', '/api/public/stripe/verify-session', {
      session_id: depositBookRes.json.stripe_session_id,
      booking_code: depositBookRes.json.booking_code,
    });
    assert.strictEqual(verifyDepRes2.status, 200);
    assert.strictEqual(verifyDepRes2.json.duplicate, true);

    // Admin records remaining €70 in Contanti -> full €100 paid, 2 ledger rows
    const payBalanceRes = await req('POST', '/api/admin/appointments', {
      action: 'record_payment',
      id: depositBookRes.json.appointment_id,
      payment_method: 'contanti',
      payment_status: 'paid',
      paid_amount: 100,
    });
    assert.strictEqual(payBalanceRes.status, 200);
    assert.strictEqual(payBalanceRes.json.appointment.payment_status, 'paid');
    assert.strictEqual(Number(payBalanceRes.json.appointment.paid_amount), 100);
    assert.strictEqual(Number(payBalanceRes.json.transaction.amount), 70);

    // Full online checkout + HMAC-SHA256 webhook verification
    const fullBookRes = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-18',
      start_time: '15:00',
      duration_minutes: 60,
      services: [{ id: 'ci-srv-2', name: 'Make up Cerimonia', price: 80, duration: 60 }],
      total_price: 80,
      client_name: 'Giulia Webhook',
      client_phone: '+39 333 9003344',
      payment_method: 'stripe_full',
      privacy_accepted: true,
    });
    assert.strictEqual(fullBookRes.status, 201);
    assert.strictEqual(fullBookRes.json.charge_amount, 80);

    const whPayload = JSON.stringify({
      id: 'evt_ci_1',
      type: 'checkout.session.completed',
      data: { object: stripeSessions.get(fullBookRes.json.stripe_session_id) },
    });
    const badWhRes = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=100,v1=invalid' },
      body: whPayload,
    });
    assert.strictEqual(badWhRes.status, 400);

    const whTs = Math.floor(Date.now() / 1000);
    const whSig = crypto.createHmac('sha256', stripeWebhookSecret).update(`${whTs}.${whPayload}`).digest('hex');
    const goodWhRes = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${whTs},v1=${whSig}` },
      body: whPayload,
    });
    assert.strictEqual(goodWhRes.status, 200);

    const ledgerRes = await req('GET', '/api/admin/payments');
    assert.strictEqual(ledgerRes.status, 200);
    assert.strictEqual(ledgerRes.json.transactions.length, 3);
    assert.strictEqual(Number(ledgerRes.json.summary.all_time_net), 180);

    // Refund full Stripe booking via Admin API
    const refundRes = await req('POST', '/api/admin/payments/refund', {
      appointment_id: fullBookRes.json.appointment_id,
      amount: 80,
      call_stripe: true,
    });
    assert.strictEqual(refundRes.status, 200);
    assert.strictEqual(refundRes.json.stripe_refund_id, 're_test_1');
    assert.strictEqual(refundRes.json.appointment.payment_status, 'refunded');
    assert.strictEqual(Number(refundRes.json.appointment.paid_amount), 0);

    // Cancel unpaid pending Stripe booking frees slot
    const cancelTestBook = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-18',
      start_time: '17:00',
      duration_minutes: 60,
      services: [{ id: 'ci-srv-3', name: 'Manicure Spa', price: 30, duration: 60 }],
      total_price: 30,
      client_name: 'Clara Annulla',
      client_phone: '+39 333 9005566',
      payment_method: 'stripe_full',
      privacy_accepted: true,
    });
    assert.strictEqual(cancelTestBook.status, 201);
    const cancelRes = await req('POST', '/api/public/payment-cancel-pending', {
      booking_code: cancelTestBook.json.booking_code,
      session_id: cancelTestBook.json.stripe_session_id,
    });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.json.receipt.status, 'cancelled');

    // 13B. PayPal Checkout REST v2 Regression Suite (Sandbox mock)
    const paypalWebhookId = 'WH_PAYPAL_CI_789';
    const savePaypalCfgRes = await req('POST', '/api/admin/payments/settings', {
      paypal_enabled: true,
      paypal_mode: 'sandbox',
      paypal_client_id: 'AZ_ci_paypal_client_id_123',
      paypal_client_secret: 'EL_ci_paypal_secret_456',
      paypal_webhook_id: paypalWebhookId,
    });
    assert.strictEqual(savePaypalCfgRes.status, 200);
    assert.strictEqual(savePaypalCfgRes.json.settings.has_paypal_client_secret, true);
    assert.strictEqual(savePaypalCfgRes.json.settings.paypal_client_secret, undefined);
    assert.strictEqual(savePaypalCfgRes.json.settings.paypal_ready, true);
    assert(savePaypalCfgRes.json.paypal_webhook_url.endsWith('/api/webhooks/paypal'));

    const pubPaypalReadyRes = await req('GET', '/api/public/payment-config');
    assert.strictEqual(pubPaypalReadyRes.status, 200);
    assert.strictEqual(pubPaypalReadyRes.json.config.paypal_ready, true);
    assert.strictEqual(pubPaypalReadyRes.json.config.paypal_mode, 'sandbox');
    assert.strictEqual(pubPaypalReadyRes.json.config.paypal_client_id, 'AZ_ci_paypal_client_id_123');
    assert.strictEqual(pubPaypalReadyRes.json.config.paypal_client_secret, undefined);
    assert.strictEqual(pubPaypalReadyRes.json.config.online_ready, true);

    const paypalOrders = new Map();
    globalThis.__GBS_PAYPAL_FETCH__ = async (url, opts) => {
      const target = String(url);
      const method = String(opts?.method || 'GET').toUpperCase();
      if (target.endsWith('/v1/oauth2/token') && method === 'POST') {
        return new Response(
          JSON.stringify({
            access_token: 'pp_ci_token_1',
            app_id: 'APP-CI-123',
            scope: 'https://uri.paypal.com/services/payments/payment/authcapture',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.endsWith('/v2/checkout/orders') && method === 'POST') {
        const bodyObj = JSON.parse(String(opts.body || '{}'));
        const pu = bodyObj.purchase_units?.[0] || {};
        const oid = `PP_ORD_${paypalOrders.size + 1}`;
        const ordObj = {
          id: oid,
          status: 'CREATED',
          purchase_units: [{ reference_id: pu.reference_id, custom_id: pu.custom_id, amount: pu.amount }],
          links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${oid}` }],
        };
        paypalOrders.set(oid, ordObj);
        return new Response(JSON.stringify(ordObj), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('/v2/checkout/orders/') && target.endsWith('/capture') && method === 'POST') {
        const oid = target.split('/v2/checkout/orders/')[1].replace('/capture', '');
        const ord = paypalOrders.get(oid);
        if (!ord) {
          return new Response(JSON.stringify({ message: 'Order not found' }), { status: 404 });
        }
        const pu = ord.purchase_units[0];
        const capId = `PP_CAP_${oid}`;
        const capturedOrd = {
          ...ord,
          status: 'COMPLETED',
          purchase_units: [
            {
              ...pu,
              payments: {
                captures: [{ id: capId, status: 'COMPLETED', amount: pu.amount }],
              },
            },
          ],
        };
        paypalOrders.set(oid, capturedOrd);
        return new Response(JSON.stringify(capturedOrd), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (target.includes('/v2/checkout/orders/') && method === 'GET') {
        const oid = target.split('/v2/checkout/orders/')[1].split('?')[0];
        const ord = paypalOrders.get(oid);
        return new Response(JSON.stringify(ord || { message: 'Not found' }), { status: ord ? 200 : 404 });
      }
      if (target.includes('/v2/payments/captures/') && target.endsWith('/refund') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'PP_REFUND_1', status: 'COMPLETED' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.endsWith('/v1/notifications/verify-webhook-signature') && method === 'POST') {
        const verifyBody = JSON.parse(String(opts.body || '{}'));
        const okSig = verifyBody.transmission_sig === 'GOOD_PP_SIG';
        return new Response(
          JSON.stringify({ verification_status: okSig ? 'SUCCESS' : 'FAILURE' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ message: `Unexpected PayPal route: ${target}` }), { status: 400 });
    };

    const paypalConnRes = await req('POST', '/api/admin/payments/test-paypal', {});
    assert.strictEqual(paypalConnRes.status, 200);
    assert.strictEqual(paypalConnRes.json.ok, true);
    assert.strictEqual(paypalConnRes.json.mode, 'sandbox');
    assert.strictEqual(paypalConnRes.json.app_id, 'APP-CI-123');

    // PayPal 30% deposit booking (€100 total -> €30 online)
    const paypalDepBookRes = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-19',
      start_time: '11:00',
      duration_minutes: 60,
      services: [{ id: 'ci-pp-1', name: 'Biab Rinforzante Luxury', price: 100, duration: 60 }],
      total_price: 100,
      client_name: 'Elena PayPal Acconto',
      client_phone: '+39 333 9007788',
      payment_method: 'paypal_deposit',
      privacy_accepted: true,
    });
    assert.strictEqual(paypalDepBookRes.status, 201);
    assert.strictEqual(paypalDepBookRes.json.requires_payment_redirect, true);
    assert.strictEqual(paypalDepBookRes.json.requires_stripe_redirect, false);
    assert.strictEqual(paypalDepBookRes.json.payment_provider, 'paypal');
    assert.strictEqual(paypalDepBookRes.json.charge_amount, 30);
    assert(paypalDepBookRes.json.checkout_url.includes('sandbox.paypal.com'));

    const captureDep1 = await req('POST', '/api/public/paypal/capture-order', {
      order_id: paypalDepBookRes.json.paypal_order_id,
      booking_code: paypalDepBookRes.json.booking_code,
    });
    assert.strictEqual(captureDep1.status, 200);
    assert.strictEqual(captureDep1.json.paid, true);
    assert.strictEqual(captureDep1.json.receipt.payment_status, 'partial');
    assert.strictEqual(captureDep1.json.receipt.payment_method, 'paypal_online');
    assert.strictEqual(Number(captureDep1.json.receipt.paid_amount), 30);
    assert.strictEqual(Number(captureDep1.json.receipt.remaining_amount), 70);
    assert.strictEqual(captureDep1.json.receipt.status, 'confirmed');

    // Idempotent second capture does not double-book transaction
    const captureDep2 = await req('POST', '/api/public/paypal/capture-order', {
      order_id: paypalDepBookRes.json.paypal_order_id,
      booking_code: paypalDepBookRes.json.booking_code,
    });
    assert.strictEqual(captureDep2.status, 200);
    assert.strictEqual(captureDep2.json.duplicate, true);

    // Full PayPal checkout + Webhook signature validation
    const fullPaypalBook = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-19',
      start_time: '15:00',
      duration_minutes: 60,
      services: [{ id: 'ci-pp-2', name: 'Laminazione Ciglia + Sopracciglia', price: 90, duration: 60 }],
      total_price: 90,
      client_name: 'Francesca PayPal Full',
      client_phone: '+39 333 9008899',
      payment_method: 'paypal_full',
      privacy_accepted: true,
    });
    assert.strictEqual(fullPaypalBook.status, 201);
    assert.strictEqual(fullPaypalBook.json.charge_amount, 90);

    const ppWhEvent = {
      id: 'WH-EVT-PP-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'PP_CAP_WH_99',
        status: 'COMPLETED',
        amount: { currency_code: 'EUR', value: '90.00' },
        supplementary_data: { related_ids: { order_id: fullPaypalBook.json.paypal_order_id } },
      },
    };
    const badPpWhRes = await fetch(`${baseUrl}/api/webhooks/paypal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paypal-Transmission-Id': 'tx-1',
        'Paypal-Transmission-Time': '2026-12-19T12:00:00Z',
        'Paypal-Cert-Url': 'https://api-m.sandbox.paypal.com/cert.pem',
        'Paypal-Auth-Algo': 'SHA256withRSA',
        'Paypal-Transmission-Sig': 'BAD_SIG',
      },
      body: JSON.stringify(ppWhEvent),
    });
    assert.strictEqual(badPpWhRes.status, 400);

    const goodPpWhRes = await fetch(`${baseUrl}/api/webhooks/paypal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Paypal-Transmission-Id': 'tx-1',
        'Paypal-Transmission-Time': '2026-12-19T12:00:00Z',
        'Paypal-Cert-Url': 'https://api-m.sandbox.paypal.com/cert.pem',
        'Paypal-Auth-Algo': 'SHA256withRSA',
        'Paypal-Transmission-Sig': 'GOOD_PP_SIG',
      },
      body: JSON.stringify(ppWhEvent),
    });
    assert.strictEqual(goodPpWhRes.status, 200);

    const ppApptsRes = await req('GET', '/api/admin/appointments?date=2026-12-19');
    const paidFullPpAppt = ppApptsRes.json.appointments.find((a) => a.id === fullPaypalBook.json.appointment_id);
    assert.strictEqual(paidFullPpAppt.payment_status, 'paid');
    assert.strictEqual(paidFullPpAppt.payment_method, 'paypal_online');
    assert.strictEqual(paidFullPpAppt.status, 'confirmed');
    assert.strictEqual(paidFullPpAppt.paypal_capture_id, 'PP_CAP_WH_99');

    // Refund PayPal booking via Admin API
    const ppRefundRes = await req('POST', '/api/admin/payments/refund', {
      appointment_id: fullPaypalBook.json.appointment_id,
      amount: 90,
      call_paypal: true,
    });
    assert.strictEqual(ppRefundRes.status, 200);
    assert.strictEqual(ppRefundRes.json.paypal_refund_id, 'PP_REFUND_1');
    assert.strictEqual(ppRefundRes.json.appointment.payment_status, 'refunded');
    assert.strictEqual(Number(ppRefundRes.json.appointment.paid_amount), 0);

    // Cancel unpaid pending PayPal booking frees slot
    const cancelPaypalBook = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-19',
      start_time: '17:00',
      duration_minutes: 60,
      services: [{ id: 'ci-pp-3', name: 'Manicure Deluxe', price: 35, duration: 60 }],
      total_price: 35,
      client_name: 'Marta PayPal Annulla',
      client_phone: '+39 333 9001199',
      payment_method: 'paypal_full',
      privacy_accepted: true,
    });
    assert.strictEqual(cancelPaypalBook.status, 201);
    const cancelPpRes = await req('POST', '/api/public/payment-cancel-pending', {
      booking_code: cancelPaypalBook.json.booking_code,
      order_id: cancelPaypalBook.json.paypal_order_id,
    });
    assert.strictEqual(cancelPpRes.status, 200);
    assert.strictEqual(cancelPpRes.json.receipt.status, 'cancelled');

    // 14. Configurable Service Catalog Regression Suite
    const pubCatInitial = await req('GET', '/api/public/catalog');
    assert.strictEqual(pubCatInitial.status, 200);
    assert.strictEqual(pubCatInitial.json.total_count, 43);

    const adminCatInitial = await req('GET', '/api/admin/catalog');
    assert.strictEqual(adminCatInitial.status, 200);
    assert.strictEqual(adminCatInitial.json.categories.length, 6);
    assert.strictEqual(adminCatInitial.json.services.length, 43);

    // Create custom category + custom service + test storefront/agenda visibility
    const createCatRes = await req('POST', '/api/admin/catalog', {
      action: 'create_category',
      title: 'MASSAGGI & CORPO',
      motto: 'Relax completo in atelier',
      column_side: 'right',
      sort_order: 80,
    });
    assert.strictEqual(createCatRes.status, 201);
    assert.ok(createCatRes.json.category.slug);
    const customCatId = createCatRes.json.category.id;
    const customCatSlug = createCatRes.json.category.slug;

    const createSrvRes = await req('POST', '/api/admin/catalog', {
      action: 'create_service',
      category_slug: customCatSlug,
      subgroup_label: 'Benessere Corpo',
      name: 'Massaggio Rilassante 50m',
      price: 55,
      duration_minutes: 50,
      description: 'Oli essenziali caldi.',
      show_in_storefront: true,
    });
    assert.strictEqual(createSrvRes.status, 201);
    const newSrvId = createSrvRes.json.service.id;

    // Non-empty category cannot be deleted
    const delNonEmptyCat = await req('POST', '/api/admin/catalog', {
      action: 'delete_category',
      id: customCatId,
    });
    assert.strictEqual(delNonEmptyCat.status, 409);

    // Public catalog reflects new category & treatment (+1 = 44)
    const pubCatUpdated = await req('GET', '/api/public/catalog');
    assert.strictEqual(pubCatUpdated.status, 200);
    assert.strictEqual(pubCatUpdated.json.total_count, 44);

    // Update service -> internal only (show_in_storefront: false) & new price
    const updSrvRes = await req('POST', '/api/admin/catalog', {
      action: 'update_service',
      id: newSrvId,
      price: 60,
      show_in_storefront: false,
    });
    assert.strictEqual(updSrvRes.status, 200);
    assert.strictEqual(updSrvRes.json.service.price, 60);

    const pubAfterHide = await req('GET', '/api/public/catalog');
    assert.strictEqual(pubAfterHide.json.total_count, 43);
    const adminAfterHide = await req('GET', '/api/admin/catalog');
    assert.strictEqual(adminAfterHide.json.services.length, 44);

    // Delete custom service -> empty category can now be deleted cleanly
    const delSrvRes = await req('POST', '/api/admin/catalog', { action: 'delete_service', id: newSrvId });
    assert.strictEqual(delSrvRes.status, 200);
    const delCatRes = await req('POST', '/api/admin/catalog', { action: 'delete_category', id: customCatId });
    assert.strictEqual(delCatRes.status, 200);

    console.log('[CI] API Regression Suite OK');
  } finally {
    delete globalThis.__GBS_STRIPE_FETCH__;
    delete globalThis.__GBS_PAYPAL_FETCH__;
    await new Promise((r) => server.close(r));
    if (fs.existsSync(TMP_DB_PATH)) fs.unlinkSync(TMP_DB_PATH);
  }
}

function checkGdprDefaults() {
  const agendaHtml = fs.readFileSync(path.join(ROOT_DIR, 'agenda.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  const privacySignHtml = fs.readFileSync(path.join(ROOT_DIR, 'privacy-sign.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT_DIR, 'admin.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'app.js'), 'utf8');
  const { GBS_LEGAL_DOCS } = require(path.join(ROOT_DIR, 'legal-content.js'));

  assert(!/id="apptNewClientPrivacy"[^>]*\bchecked\b/i.test(agendaHtml), 'agenda.html #apptNewClientPrivacy non deve avere checked');
  assert(!/id="clientPrivacyCrmCheck"[^>]*\bchecked\b/i.test(agendaHtml), 'agenda.html #clientPrivacyCrmCheck non deve avere checked');
  assert(!/id="privacyConsentCheckbox"[^>]*\bchecked\b/i.test(indexHtml), 'index.html #privacyConsentCheckbox non deve avere checked');
  assert(!/id="acceptPrivacyCheck"[^>]*\bchecked\b/i.test(privacySignHtml), 'privacy-sign.html #acceptPrivacyCheck non deve avere checked');
  assert(!/id="acceptMarketingCheck"[^>]*\bchecked\b/i.test(privacySignHtml), 'privacy-sign.html #acceptMarketingCheck non deve avere checked');
  assert(indexHtml.includes('legal-content.js'), 'index.html deve includere legal-content.js');
  assert(privacySignHtml.includes('legal-content.js'), 'privacy-sign.html deve includere legal-content.js');
  assert(privacySignHtml.includes('signLegalPanelPrivacy') && privacySignHtml.includes('signLegalPanelTerms') && privacySignHtml.includes('signLegalPanelCookies'), 'privacy-sign.html deve esporre i 3 pannelli legali condivisi con la vetrina');
  assert(GBS_LEGAL_DOCS.privacy.includes('Art. 13 Regolamento UE 2016/679'), 'legal-content.js deve contenere informativa Art. 13 completa');
  assert(GBS_LEGAL_DOCS.terms.includes('Termini e Condizioni di Prenotazione'), 'legal-content.js deve contenere i Termini e Condizioni completi');
  assert(GBS_LEGAL_DOCS.cookies.includes('Informativa sull’uso dei Cookie'), 'legal-content.js deve contenere la Cookie Policy completa');
  assert(adminJs.includes("document.getElementById('apptNewClientPrivacy').checked = false;"), 'admin.js deve azzerare apptNewClientPrivacy a false');
  assert(adminJs.includes("document.getElementById('clientPrivacyCrmCheck').checked = false;"), 'admin.js deve azzerare clientPrivacyCrmCheck a false');
  assert(!adminJs.includes("document.getElementById('apptNewClientPrivacy').checked = true;"));
  assert(!adminJs.includes("document.getElementById('clientPrivacyCrmCheck').checked = true;"));
  assert(!/privacy_accepted:\s*true/.test(appJs), 'app.js non deve inviare privacy_accepted hardcoded a true');
  assert(adminJs.includes('const CAL_END_HOUR = 21'), 'admin.js CAL_END_HOUR deve essere 21 (ultimo blocco 20:00-21:00)');
  assert(adminJs.includes("opForm.querySelectorAll('.op-sched-row[data-day]')"), 'admin.js deve leggere solo righe operatore con data-day');
  assert(!adminJs.includes('op-sched-row is-head'), 'admin.js non deve riusare .op-sched-row per la riga intestazione');
  assert(agendaHtml.includes('id="apptPromoAppliedHint"'), 'agenda.html deve contenere #apptPromoAppliedHint');
  assert(/id="apptPriceInput"[^>]*step="0\.01"/.test(agendaHtml), 'agenda.html #apptPriceInput deve accettare centesimi (step="0.01")');
  assert(/id="promoPriceInput"[^>]*step="0\.01"/.test(agendaHtml), 'agenda.html #promoPriceInput deve accettare centesimi (step="0.01")');
  assert(adminJs.includes('function computePromoCombinedQuote('), 'admin.js deve esporre computePromoCombinedQuote');
  assert(adminJs.includes('function findBestMatchingPromoForCheckedIds('), 'admin.js deve rilevare automaticamente le promo sui trattamenti spuntati');
  assert(adminJs.includes('promo-sync-agenda-btn'), 'admin.js deve includere il pulsante Applica Agenda per le promo');
  assert(appJs.includes('function reconcileStorefrontBagPromotions('), 'app.js deve riconciliare le promo attive nel carrello vetrina');
  assert(agendaHtml.includes('id="stripeSettingsForm"') && agendaHtml.includes('id="apptCassaBox"'), 'agenda.html deve contenere pannello Stripe e box Cassa');
  assert(agendaHtml.includes('id="paypalSettingsForm"') && agendaHtml.includes('value="paypal_online"'), 'agenda.html deve contenere pannello PayPal e opzione paypal_online');
  assert(adminJs.includes('function initPaymentSettingsControls(') && adminJs.includes('pay-contanti'), 'admin.js deve gestire impostazioni Stripe e cassa rapida');
  assert(adminJs.includes("paypal_online: 'PayPal Online'") && adminJs.includes('admin/payments/test-paypal'), 'admin.js deve gestire impostazioni e test PayPal');
  assert(appJs.includes('function handleStripeReturnFromQuery(') && appJs.includes('paypal_success') && appJs.includes('paypal_full'), 'app.js deve gestire opzioni e rientro Stripe + PayPal Checkout');
  assert(agendaHtml.includes('id="apptQuickNewServiceToggleBtn"') && agendaHtml.includes('id="catalogServiceForm"'), 'agenda.html deve contenere gestione listino configurabile e quick-add in modale');
  assert(adminJs.includes('function initCatalogControls(') && adminJs.includes('function renderCatalogView('), 'admin.js deve gestire CRUD listino configurabile');
  assert(appJs.includes('function loadPublicCatalog(') && appJs.includes('function renderPublicCategoryPills('), 'app.js deve caricare il listino dinamico e i filtri categoria');
  const serverJs = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf8');
  const whatsappJs = fs.readFileSync(path.join(ROOT_DIR, 'backend', 'whatsapp.js'), 'utf8');
  assert(!agendaHtml.includes('id="waAutomationPanel"'), 'agenda.html non deve contenere il vecchio pannello Meta API');
  assert(!serverJs.includes('sendWhatsAppCloudMessage') && !whatsappJs.includes('graph.facebook.com'), 'Nessun riferimento a Meta Graph API deve restare');
  assert(adminJs.includes('async function sendWhatsAppSemiautomatic('), 'admin.js deve usare sendWhatsAppSemiautomatic');
  console.log('[CI] GDPR Defaults & Shared Legal Parity OK');
}

(async () => {
  const jsFiles = [
    'server.js',
    'gbs-loader.js',
    'legal-content.js',
    'app.js',
    'admin.js',
    'morpho.js',
    'catalog.js',
    ...fs
      .readdirSync(path.join(ROOT_DIR, 'backend'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join('backend', f)),
  ];
  checkSyntax(jsFiles);
  checkDomIds(['admin.js', 'morpho.js'], ['agenda.html', 'admin.html']);
  checkDomIds(['app.js'], ['index.html']);
  console.log('[CI] DOM Alignment OK');
  checkGdprDefaults();
  await runApiSuite();
})().catch((err) => {
  console.error('[CI FAILED]', err);
  process.exit(1);
});
