// Pure schedule/cartridge logic. No DOM access, so it can be tested in Node.
(function (root) {
  const DAY_MS = 86400000;

  // Dates are handled as 'YYYY-MM-DD' strings in local time; arithmetic is
  // done at UTC midnight so daylight-saving changes can't shift a day.
  function toUTC(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fromUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    return fromUTC(toUTC(iso) + n * DAY_MS);
  }
  function diffDays(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
  }
  function weekday(iso) {
    return new Date(toUTC(iso)).getUTCDay();
  }
  function localToday(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }

  // Describe the plan for a given date.
  // The dose alternates by scheduled injection number, so the rest night
  // doesn't break the alternation and a missed dose doesn't shift it.
  function planFor(iso, s) {
    const dayNumber = diffDays(s.startDate, iso) + 1;
    if (dayNumber < 1) return { iso, dayNumber, before: true, scheduled: false };
    const rest = weekday(iso) === Number(s.restDay);
    if (rest) return { iso, dayNumber, scheduled: false, rest: true };
    let n = 0;
    for (let d = s.startDate; d <= iso; d = addDays(d, 1)) {
      if (weekday(d) !== Number(s.restDay)) n++;
    }
    const dose = n % 2 === 1 ? Number(s.doseA) : Number(s.doseB);
    return { iso, dayNumber, scheduled: true, injectionNumber: n, dose };
  }

  // Remaining mg in the current (most recent) cartridge.
  function cartridgeStatus(state) {
    const carts = state.cartridges;
    const cur = carts[carts.length - 1];
    let used = 0;
    for (const entry of Object.values(state.log)) {
      if (entry.status === 'given' && entry.cartridgeId === cur.id) used += Number(entry.mg);
    }
    const left = Math.max(0, round1(Number(cur.mg) - used - Number(cur.adjust || 0)));
    return { cartridge: cur, used: round1(used), left, size: Number(cur.mg) };
  }

  // How many upcoming scheduled doses (starting at fromIso) the remaining mg covers.
  function dosesCovered(left, fromIso, s) {
    let count = 0;
    let remaining = left;
    let d = fromIso;
    for (let i = 0; i < 60; i++, d = addDays(d, 1)) {
      const p = planFor(d, s);
      if (!p.scheduled) continue;
      if (remaining + 1e-9 < p.dose) break;
      remaining -= p.dose;
      count++;
    }
    return count;
  }

  function round1(x) {
    return Math.round(x * 100) / 100;
  }

  const api = { addDays, diffDays, weekday, localToday, planFor, cartridgeStatus, dosesCovered, round1 };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Schedule = api;
})(this);
