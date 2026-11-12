/**
 * GIULIA BEAUTY STUDIO — Security, Crypto, Date & Booking Helpers (Node.js)
 */
const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'gbs_studio_session';
const SESSION_TTL_HOURS = 12;

function hashPassword(plainText) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plainText), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plainText, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  const derived = crypto.scryptSync(String(plainText), salt, 64);
  const expected = Buffer.from(hexDigest, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function hashSessionToken(rawToken) {
  const secret = process.env.SESSION_SECRET || 'gbs-fallback-session-secret-change-in-env';
  return crypto.createHmac('sha256', secret).update(String(rawToken)).digest('hex');
}

function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function normalizePhone(phone) {
  let digits = String(phone || '').trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) {
    digits = '+' + digits.slice(2);
  }
  if (digits && !digits.startsWith('+')) {
    digits = '+39' + digits;
  }
  return digits;
}

function isValidIsoDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isClosedDay(dateStr) {
  if (!isValidIsoDate(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  // 0 = Domenica, 2 = Martedì
  return dow === 0 || dow === 2;
}

function getRomeNowParts(offsetMs = 0) {
  const target = new Date(Date.now() + offsetMs);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = {};
  for (const part of formatter.formatToParts(target)) {
    map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    datetime: `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second}`,
  };
}

function formatRomeNow() {
  return getRomeNowParts(0).datetime;
}

function getRomeToday() {
  return getRomeNowParts(0).date;
}

function getSessionExpirySql() {
  return getRomeNowParts(SESSION_TTL_HOURS * 60 * 60 * 1000).datetime;
}

function hashIp(req) {
  const rawIp =
    (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
    req.socket?.remoteAddress ||
    '0.0.0.0';
  const salt = process.env.IP_HASH_SALT || 'gbs-default-salt';
  return crypto.createHash('sha256').update(`${rawIp}|${salt}`).digest('hex');
}

function timeToMinutes(timeStr) {
  const [h = 0, m = 0] = String(timeStr || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function slotOverlapsBooked(slotTime, slotDuration, bookedRows) {
  const slotStart = timeToMinutes(slotTime);
  const slotEnd = slotStart + Math.max(15, Number(slotDuration) || 60);

  for (const row of bookedRows) {
    const bStart = timeToMinutes(row.start_time);
    const bDuration = Math.max(15, Number(row.duration_minutes) || 60);
    const bEnd = bStart + bDuration;
    if (slotStart < bEnd && bStart < slotEnd) {
      return true;
    }
  }
  return false;
}

async function generateBookingCode(conn) {
  for (let i = 0; i < 8; i += 1) {
    const num = crypto.randomInt(100000, 1000000);
    const code = `GBS-${num}`;
    const [rows] = await conn.query('SELECT id FROM appointments WHERE booking_code = ? LIMIT 1', [code]);
    if (rows.length === 0) return code;
  }
  return `GBS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_HOURS,
  hashPassword,
  verifyPassword,
  hashSessionToken,
  parseCookies,
  normalizePhone,
  isValidIsoDate,
  isClosedDay,
  getRomeNowParts,
  formatRomeNow,
  getRomeToday,
  getSessionExpirySql,
  hashIp,
  timeToMinutes,
  slotOverlapsBooked,
  generateBookingCode,
  escapeHtml,
};
