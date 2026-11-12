/**
 * GIULIA BEAUTY STUDIO — MySQL2 Connection Pool & Schema Bootstrapper
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

function isDbConfigured() {
  return Boolean(process.env.DB_NAME && process.env.DB_USER);
}

function getPool() {
  if (pool) return pool;
  if (!isDbConfigured()) {
    const err = new Error(
      'Configurazione MySQL mancante. Copia .env.example in .env e inserisci DB_HOST, DB_NAME, DB_USER e DB_PASS.'
    );
    err.code = 'DB_CONFIG_MISSING';
    err.status = 503;
    throw err;
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || '',
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  return pool;
}

async function applySchema(targetPool = getPool()) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const raw = fs.readFileSync(schemaPath, 'utf8');
  const statements = raw
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && !/^SET\s+/i.test(s));

  for (const stmt of statements) {
    await targetPool.query(stmt);
  }
}

module.exports = {
  isDbConfigured,
  getPool,
  applySchema,
};
