'use strict';

const STEP = 15 * 60 * 1000;

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function instant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !dateOnly(value.slice(0, 10))
  )
    return NaN;
  return Date.parse(value);
}

// One formatter per dataset, not per observation (six years contain >210,000 rows).
function clock(timezone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  function parts(ms) {
    const p = Object.fromEntries(formatter.formatToParts(ms).map((v) => [v.type, v.value]));
    const date = `${p.year}-${p.month}-${p.day}`;
    return {
      date,
      slot: `${p.hour}:${p.minute}`,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    };
  }
  function midnight(date) {
    const target = Date.parse(`${date}T00:00:00Z`);
    let ms = target;
    for (let i = 0; i < 4; i++) {
      const p = parts(ms);
      const delta = Date.parse(`${p.date}T${p.slot}:00Z`) - target;
      if (!delta) return ms;
      ms -= delta;
    }
    throw new Error(`Local midnight cannot be resolved for ${date} in ${timezone}`);
  }
  return { parts, midnight };
}

// Restrict origins to unambiguous local times, including DST change days.
function forecastOrigin(time, date, config = {}) {
  const slot = config.issue_time || '00:00';
  if (!['00:00', '07:00', '18:00'].includes(slot))
    throw new Error('issue_time must be 00:00, 07:00 or 18:00.');
  const day = shiftDate(date, -1);
  let ms = time.midnight(day) + Number(slot.slice(0, 2)) * 3600000;
  for (let i = 0; i < 4; i++) {
    const p = time.parts(ms);
    const delta = Date.parse(`${p.date}T${p.slot}:00Z`) - Date.parse(`${day}T${slot}:00Z`);
    if (!delta) return ms;
    ms -= delta;
  }
  throw new Error('Cannot resolve forecast origin.');
}
module.exports = { STEP, dateOnly, shiftDate, instant, clock, forecastOrigin };
