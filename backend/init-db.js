/**
 * CLI Schema Initializer: npm run init-db
 */
require('dotenv').config();
const { applySchema, getPool } = require('./db');

(async () => {
  try {
    const pool = getPool();
    await applySchema(pool);
    console.log('[OK] Schema MySQL inizializzato correttamente.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[ERRORE] Impossibile inizializzare il database:', err.message);
    process.exit(1);
  }
})();
