(function () {
  const S = window.Schedule;
  const STORE_KEY = 'gh-tracker-v1';
  const VERSION = '0.1.0';

  const DEFAULTS = {
    settings: {
      name: '',
      startDate: '2026-10-04',
      doseA: 1.6,
      doseB: 1.8,
      restDay: 6, // Saturday
      cartridgeMg: 12,
    },
    // log: { 'YYYY-MM-DD': { status: 'given' | 'skipped', mg, at, cartridgeId } }
    log: {},
    cartridges: [{ id: 'c1', mg: 12, startedAt: '2026-10-04T00:00:00', adjust: 0 }],
  };

  let state = load();
  let viewDate = S.localToday();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through to defaults */ }
    return structuredClone(DEFAULTS);
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save on this device'); }
  }

  const $ = (id) => document.getElementById(id);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (mg) => Number(mg).toFixed(1);

  function prettyDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function relLabel(iso) {
    const diff = S.diffDays(S.localToday(), iso);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff === 1) return 'Tomorrow';
    return null;
  }

  function render() {
    const s = state.settings;
    const today = S.localToday();
    const plan = S.planFor(viewDate, s);
    const entry = state.log[viewDate];
    const isFuture = viewDate > today;

    $('date-label').textContent = relLabel(viewDate) || prettyDate(viewDate).split(',')[0];
    $('day-label').textContent = prettyDate(viewDate) + (plan.dayNumber >= 1 ? ` · Day ${plan.dayNumber}` : '');

    const hero = $('hero');
    hero.className = 'hero';
    const give = $('give-btn');
    const skip = $('skip-btn');
    give.hidden = skip.hidden = false;
    give.disabled = false;

    const who = s.name ? `${s.name}'s` : '';
    const cap = (t) => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);
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
      $('hero-sub').textContent = 'No injection scheduled';
      give.hidden = skip.hidden = true;
    } else {
      $('hero-caption').textContent = cap(viewDate === today ? `${who} dose tonight` : `${who} dose`);
      $('hero-value').textContent = fmt(plan.dose);
      $('hero-unit').textContent = 'mg';
      $('hero-sub').textContent = `Injection #${plan.injectionNumber}`;

      if (entry && entry.status === 'given') {
        hero.classList.add('done');
        const t = entry.at ? new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        $('hero-sub').textContent = `✓ Given ${fmt(entry.mg)} mg${t ? ' at ' + t : ''}`;
        give.textContent = 'Undo';
        give.className = 'give-btn secondary';
        skip.hidden = true;
      } else if (entry && entry.status === 'skipped') {
        hero.classList.add('missed');
        $('hero-sub').textContent = 'Marked as missed';
        give.textContent = `Mark ${fmt(plan.dose)} mg given`;
        give.className = 'give-btn';
        skip.textContent = 'Clear "missed"';
      } else {
        if (viewDate < today) hero.classList.add('missed');
        give.textContent = isFuture ? 'Upcoming' : `Mark ${fmt(plan.dose)} mg given`;
        give.className = 'give-btn';
        give.disabled = isFuture;
        skip.textContent = 'Mark as missed';
        skip.hidden = isFuture;
      }
    }

    renderCartridge();
    renderForecast(today);
    renderHistory(today);
  }

  function renderCartridge() {
    const s = state.settings;
    const c = S.cartridgeStatus(state);
    const today = S.localToday();
    $('cart-left').textContent = fmt(c.left);
    $('cart-bar').style.width = `${Math.min(100, (c.left / c.size) * 100)}%`;

    // Count coverage starting from today, or tomorrow if today's dose is already given.
    const todayEntry = state.log[today];
    const from = todayEntry ? S.addDays(today, 1) : today;
    const covered = S.dosesCovered(c.left, from, s);
    $('cart-doses').textContent = `≈ ${covered} dose${covered === 1 ? '' : 's'} left`;

    const next = nextScheduled(from);
    const warn = $('cart-warn');
    const bar = $('cart-bar');
    if (next && c.left + 1e-9 < next.dose) {
      warn.textContent = `Not enough for the next ${fmt(next.dose)} mg dose. Start a new cartridge.`;
      bar.classList.add('low');
    } else if (covered <= 1) {
      warn.textContent = 'Cartridge almost empty. Have a new one ready.';
      bar.classList.add('low');
    } else {
      warn.textContent = '';
      bar.classList.remove('low');
    }
  }

  function nextScheduled(from) {
    let d = from;
    for (let i = 0; i < 8; i++, d = S.addDays(d, 1)) {
      const p = S.planFor(d, state.settings);
      if (p.scheduled) return p;
    }
    return null;
  }

  function renderForecast(today) {
    const box = $('forecast');
    box.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const d = S.addDays(today, i);
      const p = S.planFor(d, state.settings);
      const e = state.log[d];
      const el = document.createElement('button');
      el.className = 'fc-day' + (d === viewDate ? ' active' : '');
      const dow = i === 0 ? 'Today' : DOW[S.weekday(d)];
      let val = p.scheduled ? fmt(p.dose) : p.before ? '—' : 'Rest';
      let mark = e && e.status === 'given' ? '✓' : '';
      el.innerHTML = `<span class="fc-dow">${dow}</span><span class="fc-val ${p.scheduled ? '' : 'rest'}">${val}</span><span class="fc-mark">${mark}</span>`;
      el.addEventListener('click', () => { viewDate = d; render(); });
      box.appendChild(el);
    }
  }

  function renderHistory(today) {
    const ul = $('history');
    ul.innerHTML = '';
    const s = state.settings;
    let d = today;
    for (let i = 0; i < 14 && d >= s.startDate; i++, d = S.addDays(d, -1)) {
      const p = S.planFor(d, s);
      const e = state.log[d];
      const li = document.createElement('li');
      let status, cls;
      if (!p.scheduled) { status = 'Rest night'; cls = 'rest'; }
      else if (e && e.status === 'given') { status = `✓ ${fmt(e.mg)} mg given`; cls = 'given'; }
      else if (e && e.status === 'skipped') { status = `✗ Missed (${fmt(p.dose)} mg)`; cls = 'missed'; }
      else if (d === today) { status = `${fmt(p.dose)} mg due`; cls = 'due'; }
      else { status = `? ${fmt(p.dose)} mg not logged`; cls = 'missed'; }
      const label = relLabel(d) || `${DOW[S.weekday(d)]} ${d.slice(5).replace('-', '/')}`;
      li.className = cls;
      li.innerHTML = `<span>${label} <small>Day ${p.dayNumber}</small></span><span>${status}</span>`;
      li.addEventListener('click', () => { viewDate = d; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      ul.appendChild(li);
    }
  }

  // ---- actions ----
  function onGive() {
    const plan = S.planFor(viewDate, state.settings);
    const entry = state.log[viewDate];
    if (entry && entry.status === 'given') {
      if (!confirm('Undo this dose?')) return;
      delete state.log[viewDate];
      save(); render();
      return;
    }
    const c = S.cartridgeStatus(state);
    if (c.left + 1e-9 < plan.dose &&
        !confirm(`The cartridge only shows ${fmt(c.left)} mg left. Log this ${fmt(plan.dose)} mg dose anyway?`)) return;
    state.log[viewDate] = {
      status: 'given',
      mg: plan.dose,
      at: new Date().toISOString(),
      cartridgeId: c.cartridge.id,
    };
    save(); render();
    toast(`Logged ${fmt(plan.dose)} mg`);
  }

  function onSkip() {
    const entry = state.log[viewDate];
    if (entry && entry.status === 'skipped') delete state.log[viewDate];
    else state.log[viewDate] = { status: 'skipped', at: new Date().toISOString() };
    save(); render();
  }

  function onNewCartridge() {
    const c = S.cartridgeStatus(state);
    if (!confirm(`Start a new ${fmt(state.settings.cartridgeMg)} mg cartridge? The current one has ${fmt(c.left)} mg left.`)) return;
    state.cartridges.push({
      id: 'c' + (state.cartridges.length + 1) + '-' + Date.now(),
      mg: Number(state.settings.cartridgeMg),
      startedAt: new Date().toISOString(),
      adjust: 0,
    });
    save(); render();
    toast('New cartridge started');
  }

  function onAdjust() {
    const v = parseFloat($('adjust-left').value);
    if (isNaN(v) || v < 0) return toast('Enter the mg left');
    const cur = state.cartridges[state.cartridges.length - 1];
    const c = S.cartridgeStatus(state);
    cur.adjust = S.round1(Number(cur.mg) - c.used - v);
    save(); render();
    $('adjust-left').value = '';
    toast(`Cartridge set to ${fmt(v)} mg`);
  }

  // ---- settings ----
  function openSettings() {
    const f = $('settings-form');
    for (const [k, v] of Object.entries(state.settings)) if (f.elements[k]) f.elements[k].value = v;
    $('view-today').classList.add('hidden');
    $('view-settings').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function closeSettings() {
    $('view-settings').classList.add('hidden');
    $('view-today').classList.remove('hidden');
    render();
  }
  function onSaveSettings(ev) {
    ev.preventDefault();
    const f = ev.target.elements;
    state.settings = {
      name: f.name.value.trim(),
      startDate: f.startDate.value,
      doseA: Number(f.doseA.value),
      doseB: Number(f.doseB.value),
      restDay: Number(f.restDay.value),
      cartridgeMg: Number(f.cartridgeMg.value),
    };
    save();
    toast('Settings saved');
    closeSettings();
  }

  function onExport() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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
      state = data; save(); toast('Backup restored'); closeSettings();
    }).catch(() => toast('That file is not a valid backup'));
    ev.target.value = '';
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---- wiring ----
  $('prev-day').addEventListener('click', () => { viewDate = S.addDays(viewDate, -1); render(); });
  $('next-day').addEventListener('click', () => { viewDate = S.addDays(viewDate, 1); render(); });
  $('date-label').addEventListener('click', () => { viewDate = S.localToday(); render(); });
  $('give-btn').addEventListener('click', onGive);
  $('skip-btn').addEventListener('click', onSkip);
  $('new-cart-btn').addEventListener('click', onNewCartridge);
  $('open-settings').addEventListener('click', openSettings);
  $('close-settings').addEventListener('click', closeSettings);
  $('settings-form').addEventListener('submit', onSaveSettings);
  $('adjust-btn').addEventListener('click', onAdjust);
  $('export-btn').addEventListener('click', onExport);
  $('import-file').addEventListener('change', onImport);
  $('version').textContent = `Version ${VERSION}`;

  // Jump back to today when the app is reopened on a new day.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { viewDate = S.localToday(); render(); }
  });

  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
