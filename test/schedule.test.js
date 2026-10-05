// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const S = require('../schedule.js');

const settings = { startDate: '2026-10-04', doseA: 1.6, doseB: 1.8, restDay: 6, cartridgeMg: 12, spareCartridges: 0 };
const doses = (log, from, n) => {
  const plans = S.computePlans(settings, log, S.addDays(from, n));
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = plans.get(S.addDays(from, i));
    out.push(p.scheduled ? p.dose : 'rest');
  }
  return out;
};

test('alternates 6 nights a week with Saturday rest', () => {
  assert.deepStrictEqual(doses({}, '2026-10-04', 9), [1.6, 1.8, 1.6, 1.8, 1.6, 1.8, 'rest', 1.6, 1.8]);
});

test('missed dose is carried to the next night', () => {
  // Tue Oct 6 should be 1.6; mark it missed -> Wed gets 1.6, Thu 1.8
  const log = { '2026-10-06': { status: 'skipped' } };
  assert.deepStrictEqual(doses(log, '2026-10-04', 6), [1.6, 1.8, 1.6, 1.6, 1.8, 1.6]);
});

test('missed dose before rest night carries over the weekend', () => {
  const log = { '2026-10-09': { status: 'skipped' } }; // Fri 1.8 missed
  assert.deepStrictEqual(doses(log, '2026-10-09', 3), [1.8, 'rest', 1.8]);
});

test('cartridge and needle tracking', () => {
  const state = {
    settings: { ...settings, needles: { count: 10, asOf: '2026-10-01T00:00:00Z' } },
    log: {
      '2026-10-04': { status: 'given', mg: 1.6, cartridgeId: 'c1', at: '2026-10-05T01:00:00Z', site: 'Right thigh' },
      '2026-10-05': { status: 'given', mg: 1.8, cartridgeId: 'c1', at: '2026-10-06T01:00:00Z', site: 'Left thigh' },
    },
    cartridges: [{ id: 'c1', mg: 12, startedAt: '2026-10-04T00:00:00', adjust: 0 }],
  };
  assert.strictEqual(S.cartridgeStatus(state).left, 8.6);
  assert.strictEqual(S.needlesLeft(state), 8);
  assert.deepStrictEqual(S.lastSite(state.log, '2026-10-06'), { iso: '2026-10-05', site: 'Left thigh' });
  assert.strictEqual(S.nextSite(S.lastSite(state.log, '2026-10-06')), 'Right belly');
  const f = S.forecast(state, '2026-10-06');
  // 8.6 mg covers Tue 1.6, Wed 1.8, Thu 1.6, Fri 1.8 (=6.8), leaving 1.8 -> Sun 1.6 too (8.4)
  assert.strictEqual(f.dosesInCartridge, 5);
  assert.strictEqual(f.newCartridgeOn, '2026-10-12');
  assert.strictEqual(f.medsThrough, '2026-10-11');
  assert.strictEqual(f.needlesThrough, '2026-10-14');
});
