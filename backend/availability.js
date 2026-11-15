/**
 * GIULIA BEAUTY STUDIO — Multi-Operator Schedule, Absences & Slot Availability Engine
 */
const { isValidIsoDate, timeToMinutes, slotOverlapsBooked, getRomeNowParts } = require('./helpers');

const SLOT_STEP_MINUTES = 15;
const DEFAULT_SAME_DAY_LEAD_MINUTES = 60;
const CANDIDATE_SLOTS = ['09:00', '09:30', '11:00', '13:00', '14:30', '16:00', '17:30', '18:30', '19:30'];

// 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
const STUDIO_WEEKLY_HOURS = {
  0: { enabled: false, start: '09:00', end: '18:00', break_start: '', break_end: '' },
  1: { enabled: true, start: '09:00', end: '15:00', break_start: '', break_end: '' },
  2: { enabled: false, start: '09:00', end: '18:00', break_start: '', break_end: '' },
  3: { enabled: true, start: '09:00', end: '18:00', break_start: '', break_end: '' },
  4: { enabled: true, start: '13:00', end: '21:00', break_start: '', break_end: '' },
  5: { enabled: true, start: '09:00', end: '19:00', break_start: '', break_end: '' },
  6: { enabled: true, start: '09:00', end: '18:00', break_start: '', break_end: '' },
};

function buildDefaultSchedule() {
  const out = {};
  for (let dow = 0; dow <= 6; dow += 1) {
    out[dow] = { ...STUDIO_WEEKLY_HOURS[dow] };
  }
  return out;
}

function isLegacyDefaultSchedule(raw) {
  if (!raw) return false;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return false;
    for (let dow = 0; dow <= 6; dow += 1) {
      const entry = parsed[String(dow)] || parsed[dow];
      if (!entry || typeof entry !== 'object') return false;
      const shouldEnable = dow !== 0 && dow !== 2;
      if (Boolean(entry.enabled) !== shouldEnable) return false;
      if ((entry.start || '') !== '09:00' || (entry.end || '') !== '19:30') return false;
      if ((entry.break_start || '') !== '' || (entry.break_end || '') !== '') return false;
    }
    return true;
  } catch {
    return false;
  }
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
            start: /^\d{2}:\d{2}$/.test(entry.start || '') ? entry.start : base[dow].start,
            end: /^\d{2}:\d{2}$/.test(entry.end || '') ? entry.end : base[dow].end,
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

function minutesToTimeStr(totalMins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(totalMins) || 0)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function subtractInterval(intervals, cutStart, cutEnd) {
  if (cutEnd <= cutStart) return intervals;
  const out = [];
  for (const iv of intervals) {
    if (cutEnd <= iv.startMin || cutStart >= iv.endMin) {
      out.push(iv);
      continue;
    }
    if (cutStart > iv.startMin) out.push({ startMin: iv.startMin, endMin: cutStart });
    if (cutEnd < iv.endMin) out.push({ startMin: cutEnd, endMin: iv.endMin });
  }
  return out;
}

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const merged = [];
  for (const iv of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev || iv.startMin > prev.endMin) {
      merged.push({ startMin: iv.startMin, endMin: iv.endMin });
    } else {
      prev.endMin = Math.max(prev.endMin, iv.endMin);
    }
  }
  return merged;
}

function getMinimumAllowedStartMinutes(
  dateStr,
  minLeadMinutes = DEFAULT_SAME_DAY_LEAD_MINUTES,
  nowRome = null
) {
  if (!isValidIsoDate(dateStr)) return 0;
  const parts = nowRome || getRomeNowParts();
  if (dateStr < parts.date) return 24 * 60;
  if (dateStr > parts.date) return 0;
  const nowMin = timeToMinutes(String(parts.datetime || '').slice(11, 16));
  const lead = Math.max(0, Number(minLeadMinutes) || 0);
  return nowMin + lead;
}

/**
 * Compute continuous open working windows [startMin, endMin) for an operator on dateStr,
 * excluding scheduled daily breaks (optionally also subtracting partial-day absences).
 */
function getOperatorWorkingWindowsForDate(operator, dateStr, absences = [], { includeAbsences = true } = {}) {
  if (!operator || Number(operator.active) === 0) return [];

  const schedule = parseOperatorSchedule(operator.weekly_schedule_json);
  const dow = getIsoWeekday(dateStr);
  const dayCfg = schedule[dow];
  if (!dayCfg || !dayCfg.enabled) return [];

  const workStart = timeToMinutes(dayCfg.start);
  const workEnd = timeToMinutes(dayCfg.end);
  if (workEnd <= workStart) return [];

  let windows = [{ startMin: workStart, endMin: workEnd }];
  if (dayCfg.break_start && dayCfg.break_end) {
    const bStart = timeToMinutes(dayCfg.break_start);
    const bEnd = timeToMinutes(dayCfg.break_end);
    windows = subtractInterval(windows, bStart, bEnd);
  }

  const opId = Number(operator.id);
  for (const abs of absences) {
    if (Number(abs.operator_id) !== opId) continue;
    if (dateStr < abs.start_date || dateStr > abs.end_date) continue;
    if (!abs.start_time || !abs.end_time) return [];
    if (includeAbsences) {
      windows = subtractInterval(windows, timeToMinutes(abs.start_time), timeToMinutes(abs.end_time));
    }
  }

  return windows.filter((w) => w.endMin > w.startMin);
}

function isOperatorWorkingAtSlot(operator, dateStr, slotTime, durationMinutes, absences = []) {
  const slotStart = timeToMinutes(slotTime);
  const slotEnd = slotStart + Math.max(15, Number(durationMinutes) || 60);
  const windows = getOperatorWorkingWindowsForDate(operator, dateStr, absences, { includeAbsences: true });
  return windows.some((w) => slotStart >= w.startMin && slotEnd <= w.endMin);
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
  stepMinutes = SLOT_STEP_MINUTES,
  minLeadMinutes = DEFAULT_SAME_DAY_LEAD_MINUTES,
  nowRome = null,
}) {
  const step = Math.max(5, Number(stepMinutes) || SLOT_STEP_MINUTES);
  const lead = Math.max(0, Number(minLeadMinutes ?? DEFAULT_SAME_DAY_LEAD_MINUTES) || 0);
  const nowParts = nowRome || getRomeNowParts();
  const minAllowedStartMin = getMinimumAllowedStartMinutes(dateStr, lead, nowParts);

  const activeOps = operators.filter((o) => Number(o.active) !== 0);
  const relevantOps =
    requestedOperatorId > 0
      ? activeOps.filter((o) => Number(o.id) === Number(requestedOperatorId))
      : activeOps;

  // Base schedule windows (excluding full-day absences and daily breaks; partial absences render as busy slots)
  const workingWindows = [];
  for (const op of relevantOps) {
    const wins = getOperatorWorkingWindowsForDate(op, dateStr, absences, { includeAbsences: false });
    workingWindows.push(...wins);
  }
  const mergedWindows = mergeIntervals(workingWindows);

  if (mergedWindows.length === 0) {
    return {
      closed: true,
      past: dateStr < nowParts.date,
      stepMinutes: step,
      minLeadMinutes: lead,
      bookedSlots: [...CANDIDATE_SLOTS],
      freeSlots: [],
      daySlots: [],
    };
  }

  // Generate every step-aligned start time inside the active working windows
  const startMinutesSet = new Set();
  for (const win of mergedWindows) {
    const firstTick = Math.ceil(win.startMin / step) * step;
    for (let m = firstTick; m < win.endMin; m += step) {
      startMinutesSet.add(m);
    }
  }
  const sortedMinutes = Array.from(startMinutesSet).sort((a, b) => a - b);

  const bookedSet = new Set();
  const freeSlots = [];
  const daySlots = [];
  const evaluatedTimes = new Set();

  for (const startMin of sortedMinutes) {
    const slot = minutesToTimeStr(startMin);
    evaluatedTimes.add(slot);
    const isTooSoon = startMin < minAllowedStartMin;
    const availOps = isTooSoon
      ? []
      : getAvailableOperatorsForSlot({
          dateStr,
          slotTime: slot,
          durationMinutes,
          operators: activeOps,
          absences,
          bookedRows,
          requestedOperatorId,
        });
    const isFree = availOps.length > 0;
    if (isFree) {
      freeSlots.push(slot);
    } else {
      bookedSet.add(slot);
    }
    daySlots.push({ time: slot, available: isFree });
  }

  // Preserve legacy CANDIDATE_SLOTS outside working windows in bookedSlots for API callers
  for (const legacySlot of CANDIDATE_SLOTS) {
    if (!evaluatedTimes.has(legacySlot)) {
      bookedSet.add(legacySlot);
    }
  }

  return {
    closed: false,
    past: dateStr < nowParts.date,
    stepMinutes: step,
    minLeadMinutes: lead,
    bookedSlots: Array.from(bookedSet),
    freeSlots,
    daySlots,
  };
}

function findNextAvailableDate({
  fromDateStr,
  durationMinutes,
  operators = [],
  absences = [],
  bookedRowsByDate = new Map(),
  requestedOperatorId = 0,
  maxDays = 35,
  stepMinutes = SLOT_STEP_MINUTES,
  minLeadMinutes = DEFAULT_SAME_DAY_LEAD_MINUTES,
  nowRome = null,
}) {
  const nowParts = nowRome || getRomeNowParts();
  const baseStr = isValidIsoDate(fromDateStr) && fromDateStr >= nowParts.date ? fromDateStr : nowParts.date;
  const [y, m, d] = baseStr.split('-').map(Number);

  for (let offset = 0; offset < maxDays; offset += 1) {
    const dt = new Date(Date.UTC(y, m - 1, d + offset));
    const iso = dt.toISOString().slice(0, 10);
    const dayBooked = bookedRowsByDate.get(iso) || [];
    const dayAbsences = absences.filter((abs) => iso >= abs.start_date && iso <= abs.end_date);
    const avail = computeDateSlotAvailability({
      dateStr: iso,
      durationMinutes,
      operators,
      absences: dayAbsences,
      bookedRows: dayBooked,
      requestedOperatorId,
      stepMinutes,
      minLeadMinutes,
      nowRome: nowParts,
    });
    if (!avail.closed && avail.freeSlots.length > 0) {
      return {
        found: true,
        date: iso,
        first_slot: avail.freeSlots[0],
        available_count: avail.freeSlots.length,
      };
    }
  }
  return { found: false, date: null, first_slot: null, available_count: 0 };
}

module.exports = {
  SLOT_STEP_MINUTES,
  DEFAULT_SAME_DAY_LEAD_MINUTES,
  CANDIDATE_SLOTS,
  STUDIO_WEEKLY_HOURS,
  buildDefaultSchedule,
  isLegacyDefaultSchedule,
  parseOperatorSchedule,
  minutesToTimeStr,
  getMinimumAllowedStartMinutes,
  getOperatorWorkingWindowsForDate,
  isOperatorWorkingAtSlot,
  getAvailableOperatorsForSlot,
  computeDateSlotAvailability,
  findNextAvailableDate,
};
