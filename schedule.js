// Pure schedule / supply logic. No DOM access, so it can be used from Node
// (tests and the reminder job) as well as the browser.
(function (root) {
  const DAY_MS = 86400000;
  const EPS = 1e-6;

  // Rotation order for injection sites.
  const SITES = ['Right thigh', 'Left thigh', 'Right belly', 'Left belly', 'Right arm', 'Left arm'];

  // Dates are 'YYYY-MM-DD' strings in local time; arithmetic is done at UTC
  // midnight so daylight-saving changes can't shift a day.
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
  function localToday(now = new Date(), timeZone) {
    if (timeZone) {
      // en-CA formats as YYYY-MM-DD
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    }
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }
  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  // Plan every day from the start date through untilIso.
  // Doses alternate A, B, A, B... by injections actually given: a night marked
  // "missed" gets its dose carried to the next scheduled night, and the
  // alternation continues from there. Unlogged nights are assumed given.
  function computePlans(settings, log, untilIso) {
    const plans = new Map();
    const A = Number(settings.doseA);
    const B = Number(settings.doseB);
    let next = A;
    let given = 0;
    let day = 1;
    for (let d = settings.startDate; d <= untilIso; d = addDays(d, 1), day++) {
      if (weekday(d) === Number(settings.restDay)) {
        plans.set(d, { iso: d, dayNumber: day, scheduled: false, rest: true });
        continue;
      }
      plans.set(d, { iso: d, dayNumber: day, scheduled: true, injectionNumber: given + 1, dose: next });
      const e = log[d];
      if (e && e.status === 'skipped') continue;
      given++;
      const mg = e && e.status === 'given' ? Number(e.mg) : next;
      next = Math.abs(mg - A) < EPS ? B : A;
    }
    return plans;
  }

  function planFor(iso, settings, log, plans) {
    if (iso < settings.startDate) {
      return { iso, dayNumber: diffDays(settings.startDate, iso) + 1, before: true, scheduled: false };
    }
    if (!plans || !plans.has(iso)) plans = computePlans(settings, log, iso);
    return plans.get(iso);
  }

  function currentCartridge(state) {
    const carts = state.cartridges || [];
    return carts[carts.length - 1] || null;
  }

  // Remaining mg in the current (most recently started) cartridge.
  function cartridgeStatus(state) {
    const cur = currentCartridge(state);
    if (!cur) return { cartridge: null, used: 0, left: 0, size: Number(state.settings.cartridgeMg) || 1 };
    let used = 0;
    for (const e of Object.values(state.log)) {
      if (e.status === 'given' && e.cartridgeId === cur.id) used += Number(e.mg);
    }
    const left = Math.max(0, round2(Number(cur.mg) - used - Number(cur.adjust || 0)));
    return { cartridge: cur, used: round2(used), left, size: Number(cur.mg) };
  }

  // Needles on hand: the count last set, minus doses given since then.
  function needlesLeft(state) {
    const n = state.settings.needles;
    if (!n || n.count === undefined || n.count === null || n.count === '') return null;
    let used = 0;
    for (const e of Object.values(state.log)) {
      if (e.status === 'given' && e.at && e.at > n.asOf) used++;
    }
    return Number(n.count) - used;
  }

  // Most recent given injection strictly before beforeIso that recorded a site.
  function lastSite(log, beforeIso) {
    let best = null;
    for (const [iso, e] of Object.entries(log)) {
      if (e.status !== 'given' || !e.site || iso >= beforeIso) continue;
      if (!best || iso > best.iso) best = { iso, site: e.site };
    }
    return best;
  }

  function nextSite(last) {
    if (!last) return SITES[0];
    const i = SITES.indexOf(last.site);
    return SITES[(i + 1) % SITES.length];
  }

  // Look ahead from fromIso, assuming every scheduled dose is given:
  // how many doses the current cartridge covers, when a new cartridge is needed,
  // and the last date medicine (including spare cartridges) and needles cover.
  function forecast(state, fromIso, horizonDays = 400) {
    const s = state.settings;
    const until = addDays(fromIso, horizonDays);
    const plans = computePlans(s, state.log, until);
    let cur = cartridgeStatus(state).left;
    let spares = Number(s.spareCartridges) || 0;
    let needles = needlesLeft(state);
    const out = { dosesInCartridge: 0, newCartridgeOn: null, medsThrough: null, needlesThrough: null, medsOut: false, needlesOut: false };
    for (let d = fromIso; d <= until; d = addDays(d, 1)) {
      const p = plans.get(d);
      if (!p || !p.scheduled) continue;
      if (!out.medsOut) {
        if (cur + EPS < p.dose) {
          if (!out.newCartridgeOn) out.newCartridgeOn = d;
          if (spares > 0) { spares--; cur = Number(s.cartridgeMg); }
          else out.medsOut = true;
        }
        if (!out.medsOut) {
          cur -= p.dose;
          if (!out.newCartridgeOn) out.dosesInCartridge++;
          out.medsThrough = d;
        }
      }
      if (needles !== null && !out.needlesOut) {
        if (needles <= 0) out.needlesOut = true;
        else { needles--; out.needlesThrough = d; }
      }
      if (out.medsOut && (needles === null || out.needlesOut)) break;
    }
    return out;
  }

  // ---- height tracking (heights are stored in cm: { id: { date, cm, note } }) ----
  const CM_PER_IN = 2.54;
  const toCm = (v, unit) => (unit === 'cm' ? v : v * CM_PER_IN);
  const fromCm = (cm, unit) => (unit === 'cm' ? cm : cm / CM_PER_IN);

  // Parse a typed length: "59.125", "59 1/8", "59-1/8", "59⅛", "1/2". Returns NaN if unreadable.
  const GLYPHS = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
  function parseLength(text) {
    const t = String(text == null ? '' : text).trim().replace(/[”″"]|in(ches)?$/gi, '').trim();
    const m = t.match(/^(\d+(?:\.\d+)?)?\s*[- ]?\s*(?:(\d+)\s*\/\s*(\d+)|([½¼¾⅛⅜⅝⅞]))?$/);
    if (!m || (m[1] === undefined && m[2] === undefined && m[4] === undefined)) return NaN;
    let v = m[1] !== undefined ? parseFloat(m[1]) : 0;
    if (m[2] !== undefined) {
      if (Number(m[3]) === 0) return NaN;
      v += Number(m[2]) / Number(m[3]);
    } else if (m[4] !== undefined) {
      v += GLYPHS[m[4]];
    }
    return v;
  }

  function heightSeries(heights) {
    return Object.entries(heights || {})
      .map(([id, h]) => ({ id, ...h }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  }

  // Average growth in cm/year from the first to the latest measurement.
  // Needs at least 90 days between them; shorter spans are too noisy to annualize.
  function growthRate(series) {
    if (series.length < 2) return null;
    const first = series[0];
    const last = series[series.length - 1];
    const days = diffDays(first.date, last.date);
    if (days < 90) return null;
    return { cmPerYear: ((last.cm - first.cm) / days) * 365.25, days, from: first.date, to: last.date };
  }

  const api = {
    CM_PER_IN, toCm, fromCm, parseLength, heightSeries, growthRate,
    SITES, addDays, diffDays, weekday, localToday, round2,
    computePlans, planFor, currentCartridge, cartridgeStatus, needlesLeft, lastSite, nextSite, forecast,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schedule = api;
})(this);
