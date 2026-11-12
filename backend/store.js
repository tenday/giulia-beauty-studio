/**
 * Picks MySQL (production/cPanel) by default or local JSON store when DB_MODE=local
 */
const mysqlStore = require('./store-mysql');
const localStore = require('./store-local');

function getStore() {
  return process.env.DB_MODE === 'local' ? localStore : mysqlStore;
}

module.exports = { getStore };
