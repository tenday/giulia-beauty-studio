/**
 * GIULIA BEAUTY STUDIO — MySQL2 Connection Pool & Schema Bootstrapper
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;
let migrationsChecked = false;

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

async function ensureColumn(targetPool, tableName, columnName, alterSql) {
  const [rows] = await targetPool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  if (rows.length === 0) {
    await targetPool.query(alterSql);
  }
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

async function ensureSchemaMigrations(targetPool = getPool()) {
  if (migrationsChecked) return;
  // Ensure new tables exist on pre-existing MySQL databases via CREATE TABLE IF NOT EXISTS
  await applySchema(targetPool);
  await ensureColumn(
    targetPool,
    'admin_users',
    'role',
    "ALTER TABLE `admin_users` ADD COLUMN `role` VARCHAR(40) NOT NULL DEFAULT 'owner' AFTER `display_name`"
  );
  await ensureColumn(
    targetPool,
    'clients',
    'birth_date',
    'ALTER TABLE `clients` ADD COLUMN `birth_date` DATE NULL DEFAULT NULL AFTER `email`'
  );
  await ensureColumn(
    targetPool,
    'appointments',
    'operator_id',
    'ALTER TABLE `appointments` ADD COLUMN `operator_id` INT UNSIGNED NULL DEFAULT NULL AFTER `client_id`'
  );
  await ensureColumn(
    targetPool,
    'appointments',
    'reminder_sent_at',
    'ALTER TABLE `appointments` ADD COLUMN `reminder_sent_at` DATETIME NULL DEFAULT NULL AFTER `notes`'
  );
  await ensureColumn(
    targetPool,
    'message_templates',
    'meta_template_name',
    'ALTER TABLE `message_templates` ADD COLUMN `meta_template_name` VARCHAR(120) NULL DEFAULT NULL AFTER `body_template`'
  );
  await ensureColumn(
    targetPool,
    'message_templates',
    'meta_template_lang',
    "ALTER TABLE `message_templates` ADD COLUMN `meta_template_lang` VARCHAR(20) NOT NULL DEFAULT 'it' AFTER `meta_template_name`"
  );
  await ensureColumn(
    targetPool,
    'message_logs',
    'status',
    "ALTER TABLE `message_logs` ADD COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'sent' AFTER `message_text`"
  );
  await ensureColumn(
    targetPool,
    'message_logs',
    'external_message_id',
    'ALTER TABLE `message_logs` ADD COLUMN `external_message_id` VARCHAR(120) NULL DEFAULT NULL AFTER `status`'
  );
  await ensureColumn(
    targetPool,
    'message_logs',
    'error_message',
    'ALTER TABLE `message_logs` ADD COLUMN `error_message` VARCHAR(400) NULL DEFAULT NULL AFTER `external_message_id`'
  );
  await ensureColumn(
    targetPool,
    'message_logs',
    'trigger_source',
    "ALTER TABLE `message_logs` ADD COLUMN `trigger_source` VARCHAR(40) NOT NULL DEFAULT 'manual' AFTER `error_message`"
  );
  await ensureColumn(
    targetPool,
    'message_logs',
    'meta_payload_type',
    "ALTER TABLE `message_logs` ADD COLUMN `meta_payload_type` VARCHAR(20) NOT NULL DEFAULT 'text' AFTER `trigger_source`"
  );
  migrationsChecked = true;
}

module.exports = {
  isDbConfigured,
  getPool,
  ensureSchemaMigrations,
  applySchema,
};
