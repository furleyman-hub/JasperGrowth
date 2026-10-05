// Data storage. Uses Firebase (shared between phones) when firebase-config.js
// has a config, otherwise keeps everything in this browser's localStorage.
(function () {
  const LOCAL_KEY = 'gh-tracker-v1';
  const FB = 'https://www.gstatic.com/firebasejs/12.19.0/';

  const timeZone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; }
  };

  const DEFAULT_SETTINGS = {
    name: '',
    startDate: '2026-10-04',
    doseA: 1.6,
    doseB: 1.8,
    restDay: 6, // Saturday
    cartridgeMg: 12,
    reminderTime: '20:00',
    timeZone: timeZone(),
    spareCartridges: 0,
    needles: null, // { count, asOf }
    nextDelivery: '',
    heightUnit: 'in',
  };
  const DEFAULT_CARTRIDGE = { id: 'c1', mg: 12, startedAt: '2026-10-04T00:00:00', adjust: 0 };

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
        d.heights = d.heights || {};
        return d;
      }
    } catch (e) { /* use defaults */ }
    return { settings: { ...DEFAULT_SETTINGS }, log: {}, cartridges: [{ ...DEFAULT_CARTRIDGE }], heights: {} };
  }

  function makeLocal() {
    let state = loadLocal();
    const subs = [];
    const emit = () => subs.forEach((f) => f());
    const save = () => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
      emit();
    };
    return {
      mode: 'local',
      status: 'ready',
      user: null,
      get state() { return state; },
      onChange(f) { subs.push(f); },
      async setSettings(p) { state.settings = { ...state.settings, ...p }; save(); },
      async setDay(iso, e) { if (e) state.log[iso] = e; else delete state.log[iso]; save(); },
      async setHeight(id, h) { state.heights[id] = h; save(); },
      async delHeight(id) { delete state.heights[id]; save(); },
      async addCartridge(c) { state.cartridges.push(c); save(); },
      async updateCartridge(id, p) { Object.assign(state.cartridges.find((c) => c.id === id), p); save(); },
      async replaceAll(d) { state = { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings }, heights: d.heights || {} }; save(); },
    };
  }

  async function makeCloud(cfg) {
    const [appM, authM, fs] = await Promise.all([
      import(FB + 'firebase-app.js'),
      import(FB + 'firebase-auth.js'),
      import(FB + 'firebase-firestore.js'),
    ]);
    const app = appM.initializeApp(cfg);
    const auth = authM.getAuth(app);
    let db;
    try {
      // Offline cache: the app keeps working without signal and syncs later.
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch (e) {
      db = fs.getFirestore(app);
    }

    const st = { settings: { ...DEFAULT_SETTINGS }, log: {}, cartridges: [], heights: {} };
    const subs = [];
    const emit = () => subs.forEach((f) => f());
    let unsubs = [];

    const store = {
      mode: 'cloud',
      status: 'loading', // loading | signed-out | denied | error | ready
      user: null,
      error: '',
      get state() { return st; },
      onChange(f) { subs.push(f); },

      async signIn() {
        const provider = new authM.GoogleAuthProvider();
        try {
          await authM.signInWithPopup(auth, provider);
        } catch (e) {
          if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
            return authM.signInWithRedirect(auth, provider);
          }
          throw e;
        }
      },
      signOut() { return authM.signOut(auth); },

      setSettings(p) { return fs.setDoc(fs.doc(db, 'settings', 'main'), p, { merge: true }); },
      setDay(iso, e) {
        const ref = fs.doc(db, 'days', iso);
        return e ? fs.setDoc(ref, e) : fs.deleteDoc(ref);
      },
      addCartridge(c) {
        const { id, ...rest } = c;
        return fs.setDoc(fs.doc(db, 'cartridges', id), rest);
      },
      setHeight(id, h) { return fs.setDoc(fs.doc(db, 'heights', id), h); },
      delHeight(id) { return fs.deleteDoc(fs.doc(db, 'heights', id)); },
      updateCartridge(id, p) { return fs.setDoc(fs.doc(db, 'cartridges', id), p, { merge: true }); },

      async enableReminders() {
        const m = await import(FB + 'firebase-messaging.js');
        if (!(await m.isSupported())) throw new Error('This browser does not support notifications.');
        if (!window.FIREBASE_VAPID_KEY) throw new Error('Reminders are not set up yet (missing VAPID key).');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them in the phone settings.');
        const reg = await navigator.serviceWorker.ready;
        const token = await m.getToken(m.getMessaging(app), {
          vapidKey: window.FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: reg,
        });
        await fs.setDoc(fs.doc(db, 'devices', token), {
          email: auth.currentUser.email,
          name: store.user.name,
          device: navigator.userAgent.slice(0, 200),
          createdAt: new Date().toISOString(),
        });
        try { localStorage.setItem('gh-reminder-token', token); } catch (e) { /* ignore */ }
      },
      async disableReminders() {
        let token = null;
        try { token = localStorage.getItem('gh-reminder-token'); } catch (e) { /* ignore */ }
        if (token) await fs.deleteDoc(fs.doc(db, 'devices', token));
        try { localStorage.removeItem('gh-reminder-token'); } catch (e) { /* ignore */ }
      },
      remindersOn() {
        try { return !!localStorage.getItem('gh-reminder-token') && Notification.permission === 'granted'; }
        catch (e) { return false; }
      },
    };

    // First sign-in to an empty database: copy this phone's local data up.
    async function seedFromLocal() {
      const local = loadLocal();
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'settings', 'main'), { ...local.settings, timeZone: timeZone() });
      for (const [iso, e] of Object.entries(local.log)) batch.set(fs.doc(db, 'days', iso), e);
      const carts = local.cartridges.length ? local.cartridges : [DEFAULT_CARTRIDGE];
      for (const { id, ...rest } of carts) batch.set(fs.doc(db, 'cartridges', id), rest);
      for (const [id, h] of Object.entries(local.heights || {})) batch.set(fs.doc(db, 'heights', id), h);
      await batch.commit();
    }

    authM.onAuthStateChanged(auth, (u) => {
      unsubs.forEach((f) => f());
      unsubs = [];
      if (!u) {
        store.user = null;
        store.status = 'signed-out';
        emit();
        return;
      }
      store.user = { email: u.email, name: (u.displayName || u.email).split(/[ @]/)[0] };
      store.status = 'loading';
      emit();

      const fail = (e) => {
        store.status = e.code === 'permission-denied' ? 'denied' : 'error';
        store.error = e.message;
        emit();
      };
      let seeded = false;
      unsubs.push(fs.onSnapshot(fs.doc(db, 'settings', 'main'), (snap) => {
        if (!snap.exists()) {
          if (!snap.metadata.fromCache && !seeded) {
            seeded = true;
            seedFromLocal().catch(fail);
          }
          return;
        }
        st.settings = { ...DEFAULT_SETTINGS, ...snap.data() };
        store.status = 'ready';
        emit();
      }, fail));
      unsubs.push(fs.onSnapshot(fs.collection(db, 'days'), (qs) => {
        st.log = {};
        qs.forEach((d) => { st.log[d.id] = d.data(); });
        emit();
      }, fail));
      unsubs.push(fs.onSnapshot(fs.collection(db, 'cartridges'), (qs) => {
        st.cartridges = qs.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
        emit();
      }, fail));
      unsubs.push(fs.onSnapshot(fs.collection(db, 'heights'), (qs) => {
        st.heights = {};
        qs.forEach((d) => { st.heights[d.id] = d.data(); });
        emit();
      }, fail));
    });

    return store;
  }

  window.Store = {
    DEFAULT_SETTINGS,
    timeZone,
    async create() {
      if (!window.FIREBASE_CONFIG) return makeLocal();
      try {
        return await makeCloud(window.FIREBASE_CONFIG);
      } catch (e) {
        // Don't silently fall back to local data: that would split the records.
        return { mode: 'cloud', status: 'error', error: 'Could not load Firebase. Check the connection and reopen the app.', state: null, onChange() {} };
      }
    },
  };
})();
