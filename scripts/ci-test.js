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
    console.log('[CI] API Regression Suite OK');
  } finally {
    await new Promise((r) => server.close(r));
    if (fs.existsSync(TMP_DB_PATH)) fs.unlinkSync(TMP_DB_PATH);
  }
}

(async () => {
  const jsFiles = [
    'server.js',
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
  await runApiSuite();
})().catch((err) => {
  console.error('[CI FAILED]', err);
  process.exit(1);
});
