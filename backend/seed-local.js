/**
 * Local Test Account Initializer (Clean Database, Zero Fake Clients/Appointments)
 * Usage: node backend/seed-local.js
 */
require('dotenv').config();
process.env.DB_MODE = 'local';

const fs = require('fs');
const path = require('path');
const storeLocal = require('./store-local');
const { hashPassword } = require('./helpers');

(async () => {
  const dbPath = path.resolve(process.cwd(), process.env.LOCAL_DB_FILE || '.local-dev-db.json');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const demoUsername = process.env.DEMO_ADMIN_USER || 'giulia@prova.local';
  const demoPassword = process.env.DEMO_ADMIN_PASS || 'GiuliaProva2026!';

  await storeLocal.createInitialAdmin({
    username: demoUsername,
    displayName: 'Giulia',
    passwordHash: hashPassword(demoPassword),
  });

  console.log('======================================================');
  console.log('DATABASE LOCALE PULITO (ZERO DATI DI PROVA FAKE)');
  console.log(`URL Login:  http://localhost:${process.env.PORT || 3000}/admin.html`);
  console.log(`Username:   ${demoUsername}`);
  console.log(`Password:   ${demoPassword}`);
  console.log('======================================================');
})();
