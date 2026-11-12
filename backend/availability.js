/**
 * GIULIA BEAUTY STUDIO — Multi-Operator Schedule, Absences & Slot Availability Engine
 */
const { isValidIsoDate, timeToMinutes, slotOverlapsBooked } = require('./helpers');

const CANDIDATE_SLOTS = ['09:30', '11:00', '14:30', '16:00', '17:30', '18:30'];

function buildDefaultSchedule() {
  // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  return {
    0: { enabled: false, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    1: { enabled: true, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    2: { enabled: false, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    3: { enabled: true, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    4: { enabled: true, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    5: { enabled: true, start: '09:00', end: '19:30', break_start: '', break_end: '' },
    6: { enabled: true, start: '09:00', end: '19:30', break_start: '', break_end: '' },
  };
}

function parseOperatorSchedule(raw) {
  const base = buildDefaultSchedule();
  if (!raw) return base;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      for (let dow = 0; dow <= 6; dow += 1) {
        const entry = parsed[String(dow)] || parsed[dow];
        if (entry && typeof entry === 'object') {
          base[dow] = {
            enabled: Boolean(entry.enabled),
            start: /^\d{2}:\d{2}$/.test(entry.start || '') ? entry.start : '09:00',
            end: /^\d{2}:\d{2}$/.test(entry.end || '') ? entry.end : '19:30',
            break_start: /^\d{2}:\d{2}$/.test(entry.break_start || '') ? entry.break_start : '',
            break_end: /^\d{2}:\d{2}$/.test(entry.break_end || '') ? entry.break_end : '',
          };
        }
      }
    }
  } catch {
    return base;
  }
  return base;
}

function getIsoWeekday(dateStr) {
  if (!isValidIsoDate(dateStr)) return 1;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isOperatorWorkingAtSlot(operator, dateStr, slotTime, durationMinutes, absences = []) {
  if (!operator || Number(operator.active) === 0) return false;

  const schedule = parseOperatorSchedule(operator.weekly_schedule_json);
  const dow = getIsoWeekday(dateStr);
  const dayCfg = schedule[dow];
  if (!dayCfg || !dayCfg.enabled) return false;

  const slotStart = timeToMinutes(slotTime);
  const slotEnd = slotStart + Math.max(15, Number(durationMinutes) || 60);
  const workStart = timeToMinutes(dayCfg.start);
  const workEnd = timeToMinutes(dayCfg.end);
  if (slotStart < workStart || slotEnd > workEnd) return false;

  if (dayCfg.break_start && dayCfg.break_end) {
    const bStart = timeToMinutes(dayCfg.break_start);
    const bEnd = timeToMinutes(dayCfg.break_end);
    if (slotStart < bEnd && bStart < slotEnd) return false;
  }

  const opId = Number(operator.id);
  for (const abs of absences) {
    if (Number(abs.operator_id) !== opId) continue;
    if (dateStr < abs.start_date || dateStr > abs.end_date) continue;
    // Whole-day absence
    if (!abs.start_time || !abs.end_time) return false;
    const aStart = timeToMinutes(abs.start_time);
    const aEnd = timeToMinutes(abs.end_time);
    if (slotStart < aEnd && aStart < slotEnd) return false;
  }

  return true;
}

function getAvailableOperatorsForSlot({
  dateStr,
  slotTime,
  durationMinutes,
  operators = [],
  absences = [],
  bookedRows = [],
  requestedOperatorId = 0,
}) {
  const activeOps = operators.filter((o) => Number(o.active) !== 0);
  if (activeOps.length === 0) return [];

  const primaryOpId = Number(activeOps[0].id);
  const targetOps =
    requestedOperatorId > 0
      ? activeOps.filter((o) => Number(o.id) === Number(requestedOperatorId))
      : activeOps;

  return targetOps.filter((op) => {
    if (!isOperatorWorkingAtSlot(op, dateStr, slotTime, durationMinutes, absences)) {
      return false;
    }
    const opId = Number(op.id);
    const opBooked = bookedRows.filter((row) => {
      const rowOpId = Number(row.operator_id || 0);
      if (rowOpId === 0) return opId === primaryOpId;
      return rowOpId === opId;
    });
    return !slotOverlapsBooked(slotTime, durationMinutes, opBooked);
  });
}

function computeDateSlotAvailability({
  dateStr,
  durationMinutes,
  operators = [],
  absences = [],
  bookedRows = [],
  requestedOperatorId = 0,
}) {
  const activeOps = operators.filter((o) => Number(o.active) !== 0);
  const dow = getIsoWeekday(dateStr);

  // Check if at least one relevant operator has that weekday enabled & isn't absent all day
  const relevantOps =
    requestedOperatorId > 0
      ? activeOps.filter((o) => Number(o.id) === Number(requestedOperatorId))
      : activeOps;

  const workingOpsOnDate = relevantOps.filter((op) => {
    const sched = parseOperatorSchedule(op.weekly_schedule_json);
    if (!sched[dow]?.enabled) return false;
    const fullDayAbs = absences.some(
      (abs) =>
        Number(abs.operator_id) === Number(op.id) &&
        dateStr >= abs.start_date &&
        dateStr <= abs.end_date &&
        (!abs.start_time || !abs.end_time)
    );
    return !fullDayAbs;
  });

  if (workingOpsOnDate.length === 0) {
    return {
      closed: true,
      bookedSlots: [...CANDIDATE_SLOTS],
      freeSlots: [],
    };
  }

  const bookedSlots = [];
  const freeSlots = [];

  for (const slot of CANDIDATE_SLOTS) {
    const availOps = getAvailableOperatorsForSlot({
      dateStr,
      slotTime: slot,
      durationMinutes,
      operators: activeOps,
      absences,
      bookedRows,
      requestedOperatorId,
    });
    if (availOps.length === 0) {
      bookedSlots.push(slot);
    } else {
      freeSlots.push(slot);
    }
  }

  return {
    closed: false,
    bookedSlots,
    freeSlots,
  };
}

module.exports = {
  CANDIDATE_SLOTS,
  buildDefaultSchedule,
  parseOperatorSchedule,
  isOperatorWorkingAtSlot,
  getAvailableOperatorsForSlot,
  computeDateSlotAvailability,
};
