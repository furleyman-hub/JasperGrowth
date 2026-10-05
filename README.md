# Growth Tracker

A simple phone app (installable web app / PWA) for tracking daily growth hormone injections.

- **Today view**: tonight's dose is shown big, like the temperature in a weather app
- Alternating doses (e.g. 1.6 / 1.8 mg), 6 nights a week with a configurable rest night
- Tap to mark the dose as given (or missed); undo is available
- Cartridge tracking: mg left, about how many doses remain, and a warning when the next dose won't fit
- 7-day lookahead and 14-day history
- Works offline. Data stays on the phone, with Export/Import for backup

## How the schedule works

- Day 1 = the first injection date (set in Settings)
- Doses alternate by **scheduled injection number**: injection #1 = first dose, #2 = alternate dose, and so on.
  Rest nights don't break the alternation, and a missed dose doesn't shift it.

## Install on Android

1. Turn on GitHub Pages: repo **Settings → Pages → Source: Deploy from a branch → `main` / root**.
2. Open the Pages URL (e.g. `https://<user>.github.io/<repo>/`) in Chrome on the phone.
3. Chrome menu (⋮) → **Add to Home screen / Install app**.

## Development

No build step: plain HTML/CSS/JS. Open `index.html` in a browser, or serve the folder
(`python3 -m http.server`). Schedule logic is in `schedule.js` and can be `require`d from Node for testing.

When you change files, bump `CACHE` in `sw.js` so installed phones pick up the update.
