// Sends the evening dose reminder to every phone that turned reminders on.
// Run on a schedule by .github/workflows/reminder.yml.
//   - first reminder at settings.reminderTime (in settings.timeZone)
//   - one follow-up FOLLOW_UP_MIN later if the dose still isn't logged
// Needs the FIREBASE_SERVICE_ACCOUNT secret (service account JSON).
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const S = require('../../schedule.js');

const FOLLOW_UP_MIN = 120;
const MAX_REMINDERS = 2;
const fmt = (mg) => Number(mg).toFixed(1);

async function main() {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();

  const settingsSnap = await db.doc('settings/main').get();
  if (!settingsSnap.exists) return console.log('No settings yet. Nothing to do.');
  const settings = settingsSnap.data();
  const tz = settings.timeZone || 'America/New_York';
  const now = new Date();
  const today = S.localToday(now, tz);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const reminderTime = settings.reminderTime || '20:00';
  console.log(`Local time ${today} ${hhmm} (${tz}), reminder at ${reminderTime}`);
  if (hhmm < reminderTime) return console.log('Too early.');

  const log = {};
  (await db.collection('days').get()).forEach((d) => { log[d.id] = d.data(); });
  const plan = S.planFor(today, settings, log);
  if (!plan || !plan.scheduled) return console.log('No injection scheduled today.');
  if (log[today]) return console.log(`Already logged: ${log[today].status}.`);

  const remRef = db.doc(`reminders/${today}`);
  const rem = (await remRef.get()).data() || { count: 0 };
  if (rem.count >= MAX_REMINDERS) return console.log('All reminders already sent.');
  if (rem.lastSent && now - new Date(rem.lastSent) < FOLLOW_UP_MIN * 60000) return console.log('Follow-up not due yet.');

  const devices = await db.collection('devices').get();
  const tokens = devices.docs.map((d) => d.id);
  if (!tokens.length) return console.log('No phones have reminders turned on.');

  const cartridges = (await db.collection('cartridges').get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const cart = S.cartridgeStatus({ settings, log, cartridges });
  const site = S.nextSite(S.lastSite(log, today));

  const who = settings.name ? `${settings.name}'s ` : '';
  const title = rem.count === 0 ? `${fmt(plan.dose)} mg tonight` : `Still to log: ${fmt(plan.dose)} mg`;
  let body = `${who}injection #${plan.injectionNumber}. Suggested site: ${site}.`;
  if (cart.cartridge && cart.left + 1e-6 < plan.dose) body += ` Cartridge has only ${fmt(cart.left)} mg left. Start a new one.`;

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title, body, tag: `dose-${today}` },
    webpush: { headers: { Urgency: 'high', TTL: String(4 * 3600) } },
  });
  console.log(`Sent ${res.successCount}/${tokens.length}.`);

  // Drop phones that uninstalled the app or revoked permission.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
      dead.push(db.doc(`devices/${tokens[i]}`).delete());
    } else if (r.error) {
      console.log(`Send error: ${code} ${r.error.message}`);
    }
  });
  await Promise.all(dead);
  if (dead.length) console.log(`Removed ${dead.length} stale device(s).`);

  if (res.successCount > 0) await remRef.set({ count: rem.count + 1, lastSent: now.toISOString() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
