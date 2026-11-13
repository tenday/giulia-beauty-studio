/**
 * CLI Schema Initializer: npm run init-db
 */
require('dotenv').config();
const { ensureSchemaMigrations, getPool } = require('./db');

(async () => {
  try {
    const pool = getPool();
    await ensureSchemaMigrations(pool);
    console.log('[OK] Schema MySQL e migrazioni verificati correttamente.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[ERRORE] Impossibile inizializzare il database:', err.message);
    process.exit(1);
  }
})();
