# Growth Tracker

A phone app (installable web app / PWA) for tracking daily growth hormone injections, shared across the family.

- **Today view**: tonight's dose shown big, like the temperature in a weather app
- Alternating doses (1.6 / 1.8 mg), 6 nights a week, Saturday rest night (configurable)
- **Missed doses carry over**: if a night is marked missed, the next injection night gets that same dose and the alternation continues from there
- Injection site picker with rotation (suggests the next site) and "last site used" on the day view
- Cartridge tracking: mg left, doses left, warning when the next dose won't fit
- Supplies: needles (1 per dose, count can be corrected), spare cartridges, next delivery date, "medicine lasts through" estimate
- **Growth tab**: latest height shown big, a height-over-time chart (tap a point for its value), average growth rate, and a measurement list you can edit or delete. Inches or centimeters in Settings
- Shared records via Firebase (each entry shows who logged it), offline support
- Evening reminder notifications if the dose hasn't been logged (plus one follow-up 2 hours later)

## How the dose schedule works

Day 1 = first injection date. Dose #1 = "first dose" setting, then alternate.
Rest nights don't affect the alternation. A night marked **missed** pushes its dose to the next
injection night. A night that's simply not logged is assumed given (it's flagged "not logged" in history).

## Files

| File | What |
|---|---|
| `index.html`, `style.css`, `app.js` | The app UI |
| `schedule.js` | Dose/cartridge/supply logic (shared with the reminder job, tested in `test/`) |
| `store.js` | Storage: Firebase when configured, otherwise this phone only |
| `firebase-config.js` | Firebase web config + VAPID key (public values) |
| `firestore.rules` | Database security rules (paste into Firebase console again whenever this file changes) |
| `sw.js` | Offline cache + notification display |
| `.github/workflows/reminder.yml`, `.github/scripts/remind.cjs` | Scheduled reminder sender |

## One-time setup

### 1. Hosting (GitHub Pages)
Repo **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
The app will be at `https://furleyman-hub.github.io/JasperGrowth/`.
(Pages on a private repo needs a paid GitHub plan.)

### 2. Firebase project (Spark / free plan)
1. <https://console.firebase.google.com> → **Add project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
   Then **Settings → Authorized domains → Add domain → `furleyman-hub.github.io`**.
3. **Build → Firestore Database → Create database** (production mode, pick a US location).
   - **Rules** tab: paste the contents of `firestore.rules` → **Publish**.
   - **Data** tab: **Start collection** `allowed`, add one document per family member with the
     **Document ID = their Google email in lowercase** (e.g. `someone@gmail.com`) and any field (e.g. `name: "Dad"`).
4. **Project settings (gear) → General → Your apps → Web (`</>`)** → register app → copy the `firebaseConfig` object into `firebase-config.js`.
5. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair** → copy the key into `FIREBASE_VAPID_KEY` in `firebase-config.js`.

### 3. Reminders (GitHub Actions)
1. Firebase **Project settings → Service accounts → Generate new private key** (downloads a JSON file).
2. GitHub repo **Settings → Secrets and variables → Actions → New repository secret**:
   name `FIREBASE_SERVICE_ACCOUNT`, value = the whole JSON file contents. Keep this file private and delete the download afterwards.
3. On each phone: open the app → **Settings → Reminders → Turn on for this phone**.

The reminder workflow runs every 30 minutes from 5pm to 2am US Eastern (daylight time), sends a reminder
at the reminder time set in the app (default 8:00 PM) if the dose isn't logged, and one follow-up 2 hours later.
GitHub may run it a few minutes late. GitHub pauses scheduled workflows after 60 days with no
commits to the repo; re-enable it from the **Actions** tab if that happens.

### Install on Android
Open the Pages URL in Chrome → menu (⋮) → **Add to Home screen / Install app** → sign in with Google.

The first person to sign in uploads anything already logged on that phone.

## Development

No build step. Serve the folder (`python3 -m http.server`) and open it; with `FIREBASE_CONFIG = null`
the app runs in single-phone mode using localStorage. Run tests with `node --test test/*.test.js`.

When you change app files, bump `CACHE` in `sw.js` so installed phones pick up the update.
