/**
 * CI Pre-Deploy Verification Suite:
 * 1. Syntax check across all JavaScript files
 * 2. DOM element ID alignment across HTML & frontend JS
 * 3. Isolated local-store end-to-end API regression suite
 */
const assert = require('assert');
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
    // WhatsApp Business Cloud API + Automated Jobs Regression Suite
    // =========================================================================
    const { getRomeToday } = require(path.join(ROOT_DIR, 'backend', 'helpers'));
    const { addDaysIso } = require(path.join(ROOT_DIR, 'backend', 'jobs'));
    const todayIso = getRomeToday();
    const tomorrowIso = addDaysIso(todayIso, 1);
    const oldVisitIso = addDaysIso(todayIso, -65);

    const autoInit = await req('GET', '/api/admin/automation');
    assert.strictEqual(autoInit.status, 200);
    assert.strictEqual(autoInit.json.settings.active, false);

    // Unconfigured fallback wa.me test
    const fbSend = await req('POST', '/api/admin/whatsapp/send', {
      recipient_phone: '+39 331 555 0001',
      recipient_name: 'Cliente Fallback',
      message_text: 'Ciao test fallback',
      trigger_source: 'manual',
    });
    assert.strictEqual(fbSend.status, 200);
    assert.strictEqual(fbSend.json.sent, false);
    assert.strictEqual(fbSend.json.sent_via, 'fallback_wa_me');
    assert(String(fbSend.json.fallback_url || '').startsWith('https://wa.me/393315550001'));

    // Save Meta Cloud API settings & check token masking
    const saveWa = await req('POST', '/api/admin/automation/settings', {
      enabled: true,
      phone_number_id: '1234567890',
      business_account_id: '987654321',
      access_token: 'EAAG-ci-secret-token-9988',
      cron_secret: 'ci-cron-secret-token',
      auto_booking_confirmed: true,
      auto_reminder_tomorrow: true,
      auto_birthday_wishes: true,
      auto_winback_inactive: true,
      winback_inactive_days: 30,
      winback_cooldown_days: 30,
    });
    assert.strictEqual(saveWa.status, 200);
    assert.strictEqual(saveWa.json.settings.active, true);
    assert.strictEqual(saveWa.json.settings.has_access_token, true);
    assert.strictEqual(saveWa.json.settings.access_token_masked, 'EAAG••••••••9988');
    assert(!saveWa.text.includes('EAAG-ci-secret-token-9988'), 'Token raw non deve mai essere esposto!');

    // Prepare mock Meta Graph API transport
    const metaCalls = [];
    let mockMetaMode = 'ok';
    let mockIdCounter = 0;
    globalThis.__GBS_WHATSAPP_FETCH__ = async (url, opts) => {
      const bodyObj = JSON.parse(opts.body);
      metaCalls.push({ url, headers: opts.headers, body: bodyObj });
      if (mockMetaMode === 'error') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: { code: 131047, message: 'Re-engagement message outside 24h window' },
          }),
        };
      }
      mockIdCounter += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ wa_id: bodyObj.to }],
          messages: [{ id: `wamid.ci.${mockIdCounter}` }],
        }),
      };
    };

    // Cloud API direct text send
    const cloudSend = await req('POST', '/api/admin/whatsapp/send', {
      recipient_phone: '331 555 0002',
      recipient_name: 'Cliente Cloud',
      message_text: 'Messaggio diretto via Meta API',
      trigger_source: 'manual',
    });
    assert.strictEqual(cloudSend.status, 200);
    assert.strictEqual(cloudSend.json.sent, true);
    assert.strictEqual(cloudSend.json.sent_via, 'cloud_api');
    assert.strictEqual(cloudSend.json.external_message_id, 'wamid.ci.1');
    assert.strictEqual(metaCalls[0].headers.Authorization, 'Bearer EAAG-ci-secret-token-9988');
    assert.strictEqual(metaCalls[0].body.to, '393315550002');
    assert.strictEqual(metaCalls[0].body.type, 'text');

    // Meta approved template payload support
    const tplSave = await req('POST', '/api/admin/messages/templates', {
      code: 'reminder_tomorrow',
      title: 'Promemoria Appuntamento',
      body_template: 'Ciao {nome} appuntamento domani alle {ora} con {operatore} ({trattamenti})',
      meta_template_name: 'promemoria_studio_v1',
      meta_template_lang: 'it',
    });
    assert.strictEqual(tplSave.status, 200);
    assert.strictEqual(tplSave.json.template.meta_template_name, 'promemoria_studio_v1');

    // Public booking auto confirmation webhook trigger
    const pubBookRes = await req('POST', '/api/public/book', {
      mode: 'booking',
      appointment_date: '2026-12-03',
      start_time: '14:30',
      duration_minutes: 60,
      operator_id: sara.id,
      services: [{ name: 'Manicure Spa', price: 35, duration: 60 }],
      total_price: 35,
      client_name: 'Elena AutoConfirm',
      client_phone: '+39 333 777 8899',
      privacy_accepted: true,
    });
    assert.strictEqual(pubBookRes.status, 201);
    assert.strictEqual(pubBookRes.json.whatsapp_sent, true);
    assert(metaCalls.some((c) => c.body.to === '393337778899'));

    // Seed clients + appointments for all 3 automated jobs:
    // 1) Tomorrow appointment (reminder_tomorrow -> template mode)
    const remApptRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: tomorrowIso,
      start_time: '11:00',
      duration_minutes: 60,
      services_summary: 'Semipermanente Rinforzato',
      total_price: 45,
      client_name: 'Marta Promemoria',
      client_phone: '+39 339 111 2233',
      client_birth_date: `1992-${todayIso.slice(5, 10)}`, // also matches birthday today!
      privacy_accepted: true,
      send_whatsapp: false, // keep direct trigger off so job picks it up
    });
    assert.strictEqual(remApptRes.status, 201);

    // 2) Inactive client 65 days ago (winback_inactive)
    const inactApptRes = await req('POST', '/api/admin/appointments', {
      action: 'create',
      operator_id: sara.id,
      appointment_date: oldVisitIso,
      start_time: '15:00',
      duration_minutes: 45,
      services_summary: 'Pulizia Viso',
      total_price: 55,
      client_name: 'Laura Inattiva',
      client_phone: '+39 338 444 5566',
      status: 'completed',
      privacy_accepted: true,
      send_whatsapp: false,
    });
    assert.strictEqual(inactApptRes.status, 201);

    // Cron secret security check + full jobs execution
    const badCron = await fetch(`${baseUrl}/api/cron/run-jobs?secret=wrong-secret`);
    assert.strictEqual(badCron.status, 401);

    const goodCronRes = await fetch(`${baseUrl}/api/cron/run-jobs?force=1`, {
      method: 'POST',
      headers: { 'x-cron-secret': 'ci-cron-secret-token' },
    });
    assert.strictEqual(goodCronRes.status, 200);
    const goodCronJson = await goodCronRes.json();
    assert.strictEqual(goodCronJson.ok, true);
    const rRem = goodCronJson.results.find((r) => r.job_name === 'reminder_tomorrow');
    const rBday = goodCronJson.results.find((r) => r.job_name === 'birthday_wishes');
    const rWin = goodCronJson.results.find((r) => r.job_name === 'winback_inactive');
    assert(rRem && rRem.sent >= 1, 'Job reminder_tomorrow deve inviare almeno 1 promemoria');
    assert(rBday && rBday.sent >= 1, 'Job birthday_wishes deve inviare almeno 1 augurio');
    assert(rWin && rWin.sent >= 1, 'Job winback_inactive deve inviare almeno 1 richiamo');

    // Assert Meta template format was used for reminder_tomorrow
    const tplCall = metaCalls.find((c) => c.body.type === 'template');
    assert(tplCall && tplCall.body.template.name === 'promemoria_studio_v1');
    assert(tplCall.body.template.components[0].parameters.length >= 4);

    // Idempotency check: running again must send 0 duplicates!
    const rerunRes = await req('POST', '/api/admin/automation/run', {});
    assert.strictEqual(rerunRes.status, 200);
    for (const r of rerunRes.json.results) {
      assert.strictEqual(r.sent, 0, `Idempotenza fallita su ${r.job_name}: sent=${r.sent}`);
    }

    // Meta API error resilience check
    mockMetaMode = 'error';
    const failTestRes = await req('POST', '/api/admin/automation/test-whatsapp', {
      to_phone: '+39 331 999 8877',
    });
    assert.strictEqual(failTestRes.status, 400);
    assert.strictEqual(failTestRes.json.sent, false);
    assert(String(failTestRes.json.error || '').includes('131047'));

    const msgsAfter = await req('GET', '/api/admin/messages');
    assert(msgsAfter.json.logs.some((l) => l.status === 'failed' && l.trigger_source === 'test'));
    assert(msgsAfter.json.logs.some((l) => l.status === 'sent' && l.trigger_source === 'job_reminder'));
    assert(msgsAfter.json.logs.some((l) => l.status === 'sent' && l.trigger_source === 'job_birthday'));
    assert(msgsAfter.json.logs.some((l) => l.status === 'sent' && l.trigger_source === 'job_winback'));

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

    console.log('[CI] API Regression Suite OK');
  } finally {
    delete globalThis.__GBS_WHATSAPP_FETCH__;
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
