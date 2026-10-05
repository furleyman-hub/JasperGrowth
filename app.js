(async function () {
  const S = window.Schedule;
  const VERSION = '0.6.1';

  const $ = (id) => document.getElementById(id);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (mg) => Number(mg).toFixed(1);
  const cap = (t) => { t = t.trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

  const store = await window.Store.create();
  let viewDate = S.localToday();
  let selectedSite = null; // site chosen in the picker for viewDate
  let selectedBy = null;   // who gave it, chosen in the picker for viewDate
  let editBy = null;       // who gave it, in the time/person editor
  let tab = 'today';       // 'today' | 'growth'
  let editingHeight = null; // null | 'new' | height id
  let chartSel = null;     // selected measurement id on the chart
  const CAREGIVERS = ['Julian', 'Jen', 'Jasper'];
  let settingsOpen = false;
  let editingTime = false; // time editor open for viewDate

  function prettyDate(iso, opts = { weekday: 'long', month: 'long', day: 'numeric' }) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  }
  const shortDate = (iso) => prettyDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  function relLabel(iso) {
    const diff = S.diffDays(S.localToday(), iso);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const hhmmOf = (isoTs) => { const d = new Date(isoTs); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // Timestamp for a dose given on the evening of iso at hh:mm. Times before 5am
  // count as after midnight, i.e. the next calendar day.
  function atFor(iso, hhmm) {
    const [y, m, d] = iso.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const dt = new Date(y, m - 1, d, h, mi);
    if (h < 5) dt.setDate(dt.getDate() + 1);
    return dt.toISOString();
  }
  const timeOf = (isoTs) => new Date(isoTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function show(view) {
    for (const v of ['view-gate', 'view-today', 'view-growth', 'view-settings']) $(v).classList.toggle('hidden', v !== view);
    const main = view === 'view-today' || view === 'view-growth';
    $('tabs').classList.toggle('hidden', !main);
    document.body.classList.toggle('has-tabs', main);
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === (view === 'view-growth' ? 'growth' : 'today'));
  }

  function run(promise, okMsg) {
    Promise.resolve(promise)
      .then(() => okMsg && toast(okMsg))
      .catch((e) => toast(e && e.message ? e.message : 'Something went wrong'));
  }

  // ---------- rendering ----------
  function render() {
    if (store.status !== 'ready') return renderGate();
    if (settingsOpen) { show('view-settings'); return renderSettingsStatus(); }
    if (tab === 'growth') { show('view-growth'); return renderGrowth(); }
    show('view-today');
    renderToday();
  }

  function renderGate() {
    show('view-gate');
    const msg = $('gate-msg');
    $('signin-btn').classList.toggle('hidden', store.status !== 'signed-out');
    $('gate-signout').classList.toggle('hidden', store.status !== 'denied');
    if (store.status === 'signed-out') msg.textContent = 'Sign in so the whole family sees the same records.';
    else if (store.status === 'denied') msg.textContent = `${store.user ? store.user.email : 'This account'} isn't on the family list yet. Ask to have it added.`;
    else if (store.status === 'error') msg.textContent = store.error || 'Something went wrong.';
    else msg.textContent = 'Loading…';
  }

  function renderToday() {
    const state = store.state;
    const s = state.settings;
    const today = S.localToday();
    const plans = S.computePlans(s, state.log, S.addDays(today, 60) > viewDate ? S.addDays(today, 60) : viewDate);
    const plan = S.planFor(viewDate, s, state.log, plans);
    const entry = state.log[viewDate];
    const isFuture = viewDate > today;

    $('date-label').textContent = relLabel(viewDate) || prettyDate(viewDate, { weekday: 'long' });
    $('day-label').textContent = prettyDate(viewDate) + (plan.dayNumber >= 1 ? ` · Day ${plan.dayNumber}` : '');

    const hero = $('hero');
    hero.className = 'hero';
    const give = $('give-btn');
    const skip = $('skip-btn');
    give.hidden = skip.hidden = false;
    give.disabled = false;
    let showPicker = false;
    const isGiven = !!(entry && entry.status === 'given');
    $('time-btn').classList.toggle('hidden', !isGiven || editingTime);
    $('time-edit').classList.toggle('hidden', !isGiven || !editingTime);

    const last = S.lastSite(state.log, viewDate);
    const lastText = last ? `Last site: ${last.site} · ${relLabel(last.iso) || shortDate(last.iso)}` : '';
    $('hero-site').textContent = '';

    const who = s.name ? `${s.name}'s` : '';
    if (plan.before) {
      $('hero-caption').textContent = 'Before treatment';
      $('hero-value').textContent = '—';
      $('hero-unit').textContent = '';
      $('hero-sub').textContent = `Starts ${prettyDate(s.startDate)}`;
      give.hidden = skip.hidden = true;
    } else if (!plan.scheduled) {
      hero.classList.add('rest');
      $('hero-caption').textContent = cap(`${who} rest night`);
      $('hero-value').textContent = 'Rest';
      $('hero-unit').textContent = '';
      $('hero-sub').textContent = 'No injection tonight';
      $('hero-site').textContent = lastText;
      give.hidden = skip.hidden = true;
    } else {
      $('hero-caption').textContent = cap(viewDate === today ? `${who} dose tonight` : `${who} dose`);
      $('hero-value').textContent = fmt(plan.dose);
      $('hero-unit').textContent = 'mg';
      $('hero-sub').textContent = `Injection #${plan.injectionNumber}`;

      if (entry && entry.status === 'given') {
        hero.classList.add('done');
        $('hero-value').textContent = fmt(entry.mg);
        const by = entry.by ? ` by ${entry.by}` : '';
        $('hero-sub').textContent = `✓ Given${entry.at ? ' at ' + timeOf(entry.at) : ''}${by}`;
        $('hero-site').textContent = entry.site ? `Site: ${entry.site}` : lastText;
        give.textContent = 'Undo';
        give.className = 'give-btn secondary';
        skip.hidden = true;
      } else if (entry && entry.status === 'skipped') {
        hero.classList.add('missed');
        $('hero-sub').textContent = 'Missed. This dose moves to the next night';
        $('hero-site').textContent = lastText;
        give.textContent = `Mark ${fmt(plan.dose)} mg given`;
        give.className = 'give-btn';
        skip.textContent = 'Clear "missed"';
        showPicker = true;
      } else {
        if (viewDate < today) {
          hero.classList.add('missed');
          $('hero-sub').textContent = `Injection #${plan.injectionNumber} · not logged`;
        }
        $('hero-site').textContent = lastText;
        give.textContent = isFuture ? 'Upcoming' : `Mark ${fmt(plan.dose)} mg given`;
        give.className = 'give-btn';
        give.disabled = isFuture;
        skip.textContent = 'Mark as missed';
        skip.hidden = isFuture;
        showPicker = !isFuture;
      }
    }

    renderSitePicker(showPicker, last);
    renderByPicker(showPicker);
    renderCartridge(today);
    renderSupplies(today);
    renderForecast(today, plans);
    renderHistory(today, plans);
  }

  // Names to offer: the family list plus any other name already on an entry.
  function byOptions(extra) {
    const names = [...CAREGIVERS];
    for (const n of [extra, ...Object.values(store.state.log).map((e) => e.by)]) {
      if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
    }
    return names;
  }
  function defaultBy() {
    const me = byName().toLowerCase();
    const match = CAREGIVERS.find((n) => n.toLowerCase() === me);
    if (match) return match;
    let best = null;
    for (const [iso, e] of Object.entries(store.state.log)) {
      if (e.by && (!best || iso > best.iso)) best = { iso, by: e.by };
    }
    return best ? best.by : null;
  }
  function renderByChips(box, selected, pick, extra) {
    box.innerHTML = '';
    for (const n of byOptions(extra)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (n === selected ? ' on' : '');
      b.textContent = n;
      b.addEventListener('click', () => pick(n));
      box.appendChild(b);
    }
  }
  function renderByPicker(visible) {
    $('by-picker').classList.toggle('hidden', !visible);
    if (!visible) return;
    if (!selectedBy) selectedBy = defaultBy();
    renderByChips($('by-chips'), selectedBy, (n) => { selectedBy = n; renderToday(); });
  }

  function renderSitePicker(visible, last) {
    $('site-picker').classList.toggle('hidden', !visible);
    if (!visible) return;
    const suggested = S.nextSite(last);
    if (!selectedSite) selectedSite = suggested;
    const box = $('site-chips');
    box.innerHTML = '';
    for (const site of S.SITES) {
      const b = document.createElement('button');
      b.className = 'chip' + (site === selectedSite ? ' on' : '');
      b.innerHTML = `${site}${site === suggested ? '<small>suggested</small>' : ''}`;
      b.addEventListener('click', () => { selectedSite = site; renderToday(); });
      box.appendChild(b);
    }
  }

  function supplyFrom(today) {
    // Count from today, or tomorrow if today's dose is already logged.
    return store.state.log[today] ? S.addDays(today, 1) : today;
  }

  function renderCartridge(today) {
    const state = store.state;
    const c = S.cartridgeStatus(state);
    const f = S.forecast({ ...state, settings: { ...state.settings, spareCartridges: 0 } }, supplyFrom(today));
    $('cart-left').textContent = fmt(c.left);
    $('cart-bar').style.width = `${Math.min(100, (c.left / c.size) * 100)}%`;
    const n = f.dosesInCartridge;
    $('cart-doses').textContent = `≈ ${n} dose${n === 1 ? '' : 's'} left`;

    const warn = $('cart-warn');
    const bar = $('cart-bar');
    if (f.newCartridgeOn && f.newCartridgeOn === supplyFrom(today)) {
      warn.textContent = 'Not enough for the next dose. Start a new cartridge.';
      bar.classList.add('low');
    } else if (n <= 1 && f.newCartridgeOn) {
      warn.textContent = `Last dose in this cartridge. New one needed ${relLabel(f.newCartridgeOn) || shortDate(f.newCartridgeOn)}.`;
      bar.classList.add('low');
    } else {
      warn.textContent = '';
      bar.classList.remove('low');
    }
  }

  function renderSupplies(today) {
    const state = store.state;
    const s = state.settings;
    const needles = S.needlesLeft(state);
    $('needles-left').textContent = needles === null ? 'not set' : needles;
    $('spare-carts').textContent = s.spareCartridges || 0;
    $('next-delivery').textContent = s.nextDelivery ? shortDate(s.nextDelivery) : 'not set';

    const f = S.forecast(state, supplyFrom(today));
    const parts = [];
    if (f.medsThrough) parts.push(`Medicine lasts through ${shortDate(f.medsThrough)}`);
    else parts.push('Out of medicine');
    if (needles !== null) parts.push(f.needlesThrough ? `needles through ${shortDate(f.needlesThrough)}` : 'out of needles');
    $('supply-note').textContent = parts.join(' · ');

    const warn = [];
    const soon = S.addDays(today, 7);
    if (f.medsOut && (!f.medsThrough || f.medsThrough <= soon)) {
      if (!s.nextDelivery || s.nextDelivery > (f.medsThrough || today)) warn.push('Medicine runs out within a week. Order a refill.');
    }
    if (needles !== null && f.needlesOut && (!f.needlesThrough || f.needlesThrough <= S.addDays(today, 14))) {
      warn.push('Needles run out within 2 weeks.');
    }
    $('supply-warn').textContent = warn.join(' ');
  }

  function renderForecast(today, plans) {
    const box = $('forecast');
    box.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const d = S.addDays(today, i);
      const p = S.planFor(d, store.state.settings, store.state.log, plans);
      const e = store.state.log[d];
      const el = document.createElement('button');
      el.className = 'fc-day' + (d === viewDate ? ' active' : '');
      const dow = i === 0 ? 'Today' : DOW[S.weekday(d)];
      const val = p.scheduled ? fmt(e && e.status === 'given' ? e.mg : p.dose) : p.before ? '—' : 'Rest';
      const mark = e && e.status === 'given' ? '✓' : e && e.status === 'skipped' ? '✗' : '';
      el.innerHTML = `<span class="fc-dow">${dow}</span><span class="fc-val ${p.scheduled ? '' : 'rest'}">${val}</span><span class="fc-mark ${mark === '✗' ? 'bad' : ''}">${mark}</span>`;
      el.addEventListener('click', () => go(d));
      box.appendChild(el);
    }
  }

  function renderHistory(today, plans) {
    const ul = $('history');
    ul.innerHTML = '';
    const s = store.state.settings;
    let d = today;
    for (let i = 0; i < 14 && d >= s.startDate; i++, d = S.addDays(d, -1)) {
      const p = S.planFor(d, s, store.state.log, plans);
      const e = store.state.log[d];
      const li = document.createElement('li');
      let status, cls;
      if (!p.scheduled) { status = 'Rest night'; cls = 'rest'; }
      else if (e && e.status === 'given') { status = `✓ ${fmt(e.mg)} mg${e.site ? ' · ' + e.site : ''}`; cls = 'given'; }
      else if (e && e.status === 'skipped') { status = `✗ Missed ${fmt(p.dose)} mg`; cls = 'missed'; }
      else if (d === today) { status = `${fmt(p.dose)} mg due`; cls = 'due'; }
      else { status = `? ${fmt(p.dose)} mg not logged`; cls = 'missed'; }
      const label = relLabel(d) || `${DOW[S.weekday(d)]} ${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
      li.className = cls;
      li.innerHTML = `<span>${label} <small>Day ${p.dayNumber}</small></span><span>${status}</span>`;
      li.addEventListener('click', () => { go(d); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      ul.appendChild(li);
    }
  }

  function go(d) {
    viewDate = d;
    selectedSite = null;
    selectedBy = null;
    editingTime = false;
    renderToday();
  }

  // ---------- actions ----------
  function byName() {
    return store.user ? store.user.name : '';
  }

  function onGive() {
    const state = store.state;
    const plan = S.planFor(viewDate, state.settings, state.log);
    const entry = state.log[viewDate];
    if (entry && entry.status === 'given') {
      if (!confirm('Undo this dose?')) return;
      run(store.setDay(viewDate, null));
      return;
    }
    if (!selectedBy) return toast('Pick who gave it');
    const c = S.cartridgeStatus(state);
    if (c.left + 1e-6 < plan.dose &&
        !confirm(`The cartridge only shows ${fmt(c.left)} mg left. Log this ${fmt(plan.dose)} mg dose anyway?`)) return;
    const e = {
      status: 'given',
      mg: plan.dose,
      // Logged after the fact: assume that evening's reminder time (editable afterwards).
      at: viewDate < S.localToday() ? atFor(viewDate, state.settings.reminderTime || '20:00') : new Date().toISOString(),
      cartridgeId: c.cartridge ? c.cartridge.id : null,
      site: selectedSite || S.nextSite(S.lastSite(state.log, viewDate)),
      by: selectedBy,
    };
    run(store.setDay(viewDate, e));
    toast(`Logged ${fmt(plan.dose)} mg · ${e.site} · ${e.by}`);
  }

  function onEditTime() {
    const entry = store.state.log[viewDate];
    $('time-input').value = entry && entry.at ? hhmmOf(entry.at) : (store.state.settings.reminderTime || '20:00');
    editBy = (entry && entry.by) || null;
    renderEditBy();
    editingTime = true;
    renderToday();
    $('time-input').focus();
  }

  function renderEditBy() {
    const entry = store.state.log[viewDate];
    renderByChips($('by-edit-chips'), editBy, (n) => { editBy = n; renderEditBy(); }, entry && entry.by);
  }

  function onSaveTime() {
    const entry = store.state.log[viewDate];
    const v = $('time-input').value;
    if (!entry || !v) return toast('Pick a time');
    editingTime = false;
    const updated = { ...entry, at: atFor(viewDate, v) };
    if (editBy) updated.by = editBy; else delete updated.by;
    run(store.setDay(viewDate, updated), 'Saved');
    renderToday();
  }

  function onSkip() {
    const entry = store.state.log[viewDate];
    if (entry && entry.status === 'skipped') {
      run(store.setDay(viewDate, null));
      return;
    }
    const plan = S.planFor(viewDate, store.state.settings, store.state.log);
    if (!confirm(`Mark the ${fmt(plan.dose)} mg dose as missed? The next injection night will get ${fmt(plan.dose)} mg instead.`)) return;
    const e = { status: 'skipped', at: new Date().toISOString() };
    if (byName()) e.by = byName();
    run(store.setDay(viewDate, e));
  }

  function onNewCartridge() {
    const s = store.state.settings;
    const c = S.cartridgeStatus(store.state);
    const spares = Number(s.spareCartridges) || 0;
    if (!confirm(`Start a new ${fmt(s.cartridgeMg)} mg cartridge? The current one has ${fmt(c.left)} mg left.` +
      (spares ? `\nSpare cartridges goes from ${spares} to ${spares - 1}.` : ''))) return;
    run(store.addCartridge({
      id: 'c' + Date.now(),
      mg: Number(s.cartridgeMg),
      startedAt: new Date().toISOString(),
      adjust: 0,
    }));
    if (spares > 0) run(store.setSettings({ spareCartridges: spares - 1 }));
    toast('New cartridge started');
  }

  function setNeedles(count) {
    run(store.setSettings({ needles: { count, asOf: new Date().toISOString() } }));
  }

  function onAddNeedles() {
    const cur = S.needlesLeft(store.state);
    const next = (cur === null ? 0 : Math.max(0, cur)) + 100;
    if (!confirm(`Add a box of 100 needles? Count becomes ${next}.`)) return;
    setNeedles(next);
    toast(`Needles: ${next}`);
  }

  function onSpare(delta) {
    const n = Math.max(0, (Number(store.state.settings.spareCartridges) || 0) + delta);
    run(store.setSettings({ spareCartridges: n }));
  }

  function onAdjust() {
    const v = parseFloat($('adjust-left').value);
    if (isNaN(v) || v < 0) return toast('Enter the mg left');
    const c = S.cartridgeStatus(store.state);
    if (!c.cartridge) return toast('No cartridge started yet');
    run(store.updateCartridge(c.cartridge.id, { adjust: S.round2(Number(c.cartridge.mg) - c.used - v) }), `Cartridge set to ${fmt(v)} mg`);
    $('adjust-left').value = '';
  }

  function onSetNeedles() {
    const v = parseInt($('adjust-needles').value, 10);
    if (isNaN(v) || v < 0) return toast('Enter the number of needles');
    setNeedles(v);
    toast(`Needles set to ${v}`);
    $('adjust-needles').value = '';
  }

  // ---------- growth ----------
  const unitOf = () => store.state.settings.heightUnit === 'cm' ? 'cm' : 'in';
  const hv = (cm, unit) => Number(S.fromCm(cm, unit).toFixed(unit === 'cm' ? 1 : 3));
  // Inches show as fractions when they land on an eighth (59⅛, 58½, 56); otherwise two decimals.
  const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];
  function hFmt(cm, unit) {
    const v = S.fromCm(cm, unit);
    if (unit === 'cm') return v.toFixed(1);
    const e = Math.round(v * 8);
    if (Math.abs(v - e / 8) < 0.004) return `${Math.floor(e / 8)}${EIGHTHS[e % 8]}`;
    return v.toFixed(2);
  }
  const dFmt = (iso) => prettyDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

  function renderGrowth() {
    const unit = unitOf();
    const series = S.heightSeries(store.state.heights);
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const name = store.state.settings.name;

    $('growth-sub').textContent = series.length ? `${series.length} measurement${series.length === 1 ? '' : 's'}` : '';
    $('gh-caption').textContent = cap(name ? `${name}'s latest height` : 'Latest height');
    $('gh-unit').textContent = last ? unit : '';
    $('growth-hero').className = last ? 'hero' : 'hero rest';
    if (!last) {
      $('gh-value').textContent = '—';
      $('gh-sub').textContent = 'No measurements yet';
    } else {
      $('gh-value').textContent = hFmt(last.cm, unit);
      let sub = shortDate(last.date);
      if (prev) {
        const d = Number(S.fromCm(last.cm - prev.cm, unit).toFixed(2));
        sub += ` · ${sign(d)}${Math.abs(d)} ${unit} since ${shortDate(prev.date)}`;
      }
      $('gh-sub').textContent = sub;
    }

    renderHeightForm(unit);
    renderChart(series, unit);
    renderRate(series, unit);

    const ul = $('height-list');
    ul.innerHTML = '';
    if (!series.length) ul.innerHTML = '<li class="rest"><span>Tap "Add measurement" to record the first one.</span></li>';
    series.slice().reverse().forEach((h, i, arr) => {
      const older = arr[i + 1];
      const change = older ? Number(S.fromCm(h.cm - older.cm, unit).toFixed(2)) : null;
      const li = document.createElement('li');
      li.innerHTML = `<span>${dFmt(h.date)}${h.note ? ` <small>${h.note.replace(/</g, '&lt;')}</small>` : ''}</span>` +
        `<span>${hFmt(h.cm, unit)} ${unit}${change === null ? '' : ` <small>${sign(change)}${Math.abs(change)}</small>`}</span>`;
      li.addEventListener('click', () => { editingHeight = h.id; renderGrowth(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      ul.appendChild(li);
    });
  }

  function renderHeightForm(unit) {
    const form = $('height-form');
    form.classList.toggle('hidden', !editingHeight);
    $('add-height-btn').classList.toggle('hidden', !!editingHeight);
    if (!editingHeight) return;
    const existing = editingHeight === 'new' ? null : store.state.heights[editingHeight];
    $('height-form-title').textContent = existing ? 'Edit measurement' : 'New measurement';
    $('height-label').textContent = `Height (${unit})`;
    $('height-value').placeholder = unit === 'in' ? 'e.g. 59 1/8 or 59.125' : 'e.g. 150.5';
    $('height-delete').classList.toggle('hidden', !existing);
    // Only fill the fields when the form first opens, not on every re-render.
    if (form.dataset.for !== String(editingHeight)) {
      form.dataset.for = String(editingHeight);
      $('height-date').value = existing ? existing.date : S.localToday();
      $('height-date').max = S.localToday();
      $('height-value').value = existing ? hv(existing.cm, unit) : '';
      $('height-note').value = existing ? existing.note || '' : '';
    }
  }

  function onHeightSave(ev) {
    ev.preventDefault();
    const unit = unitOf();
    const date = $('height-date').value;
    const v = S.parseLength($('height-value').value);
    const cm = S.toCm(v, unit);
    if (!date || isNaN(v) || cm < 30 || cm > 250) return toast(unit === 'in' ? 'Enter a height in inches, like 59 1/8' : 'Enter a height in cm, like 150.5');
    const entry = { date, cm: Math.round(cm * 1000) / 1000 };
    const note = $('height-note').value.trim();
    if (note) entry.note = note;
    const id = editingHeight === 'new' ? 'h' + Date.now() : editingHeight;
    chartSel = id;
    run(store.setHeight(id, entry), 'Measurement saved');
    closeHeightForm();
  }
  function closeHeightForm() {
    editingHeight = null;
    $('height-form').dataset.for = '';
    renderGrowth();
  }
  function onHeightDelete() {
    if (!confirm('Delete this measurement?')) return;
    chartSel = null;
    run(store.delHeight(editingHeight), 'Deleted');
    closeHeightForm();
  }

  function renderRate(series, unit) {
    const r = S.growthRate(series);
    if (!r) {
      $('rate-big').textContent = '–';
      $('rate-note').textContent = series.length < 2
        ? 'Add a second measurement to start tracking.'
        : 'Needs two measurements at least 3 months apart.';
      return;
    }
    const per = Number(S.fromCm(r.cmPerYear, unit).toFixed(1));
    $('rate-big').innerHTML = `${per} <small>${unit} / year</small>`;
    $('rate-note').textContent = `Average from ${dFmt(r.from)} to ${dFmt(r.to)}.`;
  }

  // Line chart of height over time. One series, so no legend; the latest value is
  // labeled directly and a tap/hover on any point shows its date and value above.
  function renderChart(series, unit) {
    const box = $('chart');
    const readout = $('chart-readout');
    if (!series.length) {
      box.innerHTML = '';
      readout.textContent = 'No measurements yet';
      return;
    }
    const W = 340, H = 210, L = 40, R = 18, T = 22, B = 30;
    const DAY = 864e5;
    const pts = series.map((h) => ({ ...h, v: S.fromCm(h.cm, unit), t: Date.parse(h.date + 'T00:00:00Z') }));
    let t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t1 === t0) { t0 -= 15 * DAY; t1 += 15 * DAY; }
    const vmin = Math.min(...pts.map((p) => p.v));
    const vmax = Math.max(...pts.map((p) => p.v));
    const span = Math.max(vmax - vmin, unit === 'cm' ? 4 : 1.5);
    const raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    const ymin = Math.floor((vmin - span * 0.15) / step) * step;
    const ymax = Math.ceil((vmax + span * 0.15) / step) * step;
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);

    let g = '';
    for (let v = ymin; v <= ymax + 1e-9; v += step) {
      const y = Y(v).toFixed(1);
      g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>` +
           `<text class="ch-tick" x="${L - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${Number(v.toFixed(2))}</text>`;
    }
    const xl = pts.length === 1
      ? `<text class="ch-tick" x="${X(pts[0].t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${dFmt(pts[0].date)}</text>`
      : `<text class="ch-tick" x="${L}" y="${H - 8}" text-anchor="start">${dFmt(pts[0].date)}</text>` +
        `<text class="ch-tick" x="${W - R}" y="${H - 8}" text-anchor="end">${dFmt(pts[pts.length - 1].date)}</text>`;
    const line = pts.length > 1
      ? `<polyline class="ch-line" points="${pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}"/>` : '';
    const lastP = pts[pts.length - 1];
    const lx = X(lastP.t), ly = Y(lastP.v);
    const label = `<text class="ch-label" x="${Math.min(lx, W - R).toFixed(1)}" y="${(ly < T + 14 ? ly + 22 : ly - 12).toFixed(1)}" text-anchor="${lx > W - 60 ? 'end' : 'middle'}">${hFmt(lastP.cm, unit)}</text>`;
    const dots = pts.map((p, i) =>
      `<circle class="ch-dot" data-i="${i}" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="5"/>`).join('');
    const hits = pts.map((p, i) =>
      `<circle class="ch-hit" data-i="${i}" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="18"/>`).join('');

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Height over time, ${unit}. ${pts.length} measurements.">` +
      `${g}${xl}${line}${dots}${label}${hits}</svg>`;

    const select = (i) => {
      const p = pts[i];
      chartSel = p.id;
      readout.innerHTML = `<b>${hFmt(p.cm, unit)} ${unit}</b> · ${dFmt(p.date)}${p.note ? ' · ' + p.note.replace(/</g, '&lt;') : ''}`;
      box.querySelectorAll('.ch-dot').forEach((d) => d.classList.toggle('sel', Number(d.dataset.i) === i));
    };
    box.querySelectorAll('.ch-hit').forEach((h) => {
      h.addEventListener('pointerenter', () => select(Number(h.dataset.i)));
      h.addEventListener('click', () => select(Number(h.dataset.i)));
    });
    const keep = pts.findIndex((p) => p.id === chartSel);
    select(keep >= 0 ? keep : pts.length - 1);
  }

  function setTab(t) {
    tab = t;
    editingHeight = null;
    $('height-form').dataset.for = '';
    window.scrollTo(0, 0);
    render();
  }

  // ---------- settings ----------
  function openSettings() {
    settingsOpen = true;
    const f = $('settings-form');
    for (const [k, v] of Object.entries(store.state.settings)) {
      if (f.elements[k] && typeof v !== 'object') f.elements[k].value = v;
    }
    render();
    window.scrollTo(0, 0);
  }
  function closeSettings() {
    settingsOpen = false;
    render();
  }
  function renderSettingsStatus() {
    const cloud = store.mode === 'cloud';
    $('account-card').classList.toggle('hidden', !cloud);
    if (cloud && store.user) $('account-msg').textContent = `Signed in as ${store.user.email}. Records are shared with the family.`;

    const rc = $('reminder-card');
    if (!cloud) {
      $('reminder-msg').textContent = 'Reminders need the shared Firebase setup.';
      $('reminder-btn').classList.add('hidden');
    } else {
      const on = store.remindersOn();
      $('reminder-msg').textContent = on
        ? `On. This phone gets a reminder at ${store.state.settings.reminderTime || '20:00'} if the dose isn't logged, and again 2 hours later.`
        : 'Off. Turn on to get a notification when the dose hasn\'t been logged.';
      $('reminder-btn').classList.remove('hidden');
      $('reminder-btn').textContent = on ? 'Turn off on this phone' : 'Turn on for this phone';
    }
    rc.classList.remove('hidden');
    $('import-label').classList.toggle('hidden', cloud);
    $('backup-msg').textContent = cloud
      ? 'Records are stored in Firebase. Export a copy now and then anyway.'
      : 'Records are stored only on this phone. Export a backup now and then.';
  }
  function onSaveSettings(ev) {
    ev.preventDefault();
    const f = ev.target.elements;
    run(store.setSettings({
      name: f.name.value.trim(),
      startDate: f.startDate.value,
      doseA: Number(f.doseA.value),
      doseB: Number(f.doseB.value),
      restDay: Number(f.restDay.value),
      cartridgeMg: Number(f.cartridgeMg.value),
      heightUnit: f.heightUnit.value,
      reminderTime: f.reminderTime.value || '20:00',
      nextDelivery: f.nextDelivery.value,
      timeZone: window.Store.timeZone(),
    }), 'Settings saved');
    closeSettings();
  }
  function onReminderToggle() {
    const btn = $('reminder-btn');
    btn.disabled = true;
    const p = store.remindersOn() ? store.disableReminders() : store.enableReminders();
    p.then(() => toast(store.remindersOn() ? 'Reminders on' : 'Reminders off'))
      .catch((e) => toast(e.message || 'Could not change reminders'))
      .finally(() => { btn.disabled = false; renderSettingsStatus(); });
  }

  function onExport() {
    const { settings, log, cartridges, heights } = store.state;
    const blob = new Blob([JSON.stringify({ settings, log, cartridges, heights }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `growth-tracker-backup-${S.localToday()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function onImport(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data.settings || !data.log || !data.cartridges) throw new Error('bad file');
      if (!confirm('Replace all data on this phone with the backup?')) return;
      return store.replaceAll(data).then(() => { toast('Backup restored'); closeSettings(); });
    }).catch(() => toast('That file is not a valid backup'));
    ev.target.value = '';
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- wiring ----------
  $('prev-day').addEventListener('click', () => go(S.addDays(viewDate, -1)));
  $('next-day').addEventListener('click', () => go(S.addDays(viewDate, 1)));
  $('date-label').addEventListener('click', () => go(S.localToday()));
  $('give-btn').addEventListener('click', onGive);
  $('skip-btn').addEventListener('click', onSkip);
  $('time-btn').addEventListener('click', onEditTime);
  $('time-save').addEventListener('click', onSaveTime);
  $('time-cancel').addEventListener('click', () => { editingTime = false; renderToday(); });
  $('new-cart-btn').addEventListener('click', onNewCartridge);
  $('add-needles-btn').addEventListener('click', onAddNeedles);
  $('spare-minus').addEventListener('click', () => onSpare(-1));
  $('spare-plus').addEventListener('click', () => onSpare(1));
  $('open-settings').addEventListener('click', openSettings);
  $('open-settings-g').addEventListener('click', openSettings);
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('add-height-btn').addEventListener('click', () => { editingHeight = 'new'; renderGrowth(); });
  $('height-form').addEventListener('submit', onHeightSave);
  $('height-cancel').addEventListener('click', closeHeightForm);
  $('height-delete').addEventListener('click', onHeightDelete);
  $('close-settings').addEventListener('click', closeSettings);
  $('settings-form').addEventListener('submit', onSaveSettings);
  $('adjust-btn').addEventListener('click', onAdjust);
  $('needles-btn').addEventListener('click', onSetNeedles);
  $('export-btn').addEventListener('click', onExport);
  $('import-file').addEventListener('change', onImport);
  $('reminder-btn').addEventListener('click', onReminderToggle);
  $('signin-btn').addEventListener('click', () => run(store.signIn()));
  $('signout-btn').addEventListener('click', () => { settingsOpen = false; run(store.signOut()); });
  $('gate-signout').addEventListener('click', () => run(store.signOut()));
  $('version').textContent = `Version ${VERSION}`;

  // Jump back to today when the app is reopened on a new day.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && viewDate !== S.localToday()) { viewDate = S.localToday(); selectedSite = null; selectedBy = null; editingTime = false; render(); }
  });

  store.onChange(render);
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
