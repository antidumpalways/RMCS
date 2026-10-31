import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRecapSummaries, formatRecapReport, jakartaDateKey, parseBalanceTaskTarget, recapNetAfterExpense, reportedRecapTotal, sumRecapReports } from './shift-summary';
import { MAX_UPDATE_ATTEMPTS, duplicateUpdateDisposition } from './core';
import { deterministicExtraction } from './recap';

const report = (iso: string, sale: string, fee: string, expense: string, shiftLabel: string | null = null) =>
  ({ confirmedAt: new Date(iso), shiftLabel, payload: { totals: { sale, service_fee: fee, expense } } });

test('reportedRecapTotal reads only well-formed numeric strings', () => {
  assert.equal(reportedRecapTotal({ totals: { sale: '175000' } }, 'sale'), 175000n);
  assert.equal(reportedRecapTotal({ totals: { sale: '-5' } }, 'sale'), 0n);
  assert.equal(reportedRecapTotal({ totals: { sale: 175000 } }, 'sale'), 0n);
  assert.equal(reportedRecapTotal(null, 'sale'), 0n);
  assert.equal(reportedRecapTotal({}, 'expense'), 0n);
});

test('sumRecapReports adds every confirmed report', () => {
  const total = sumRecapReports([report('2026-10-31T01:00:00Z', '100000', '20000', '5000'), report('2026-10-31T09:00:00Z', '50000', '10000', '0')]);
  assert.deepEqual(total, { sale: 150000n, serviceFee: 30000n, expense: 5000n, count: 2 });
  assert.equal(recapNetAfterExpense(total), 175000n);
});

test('jakartaDateKey uses the WIB calendar day', () => {
  assert.equal(jakartaDateKey(new Date('2026-10-31T17:30:00Z')), '2026-11-01');
  assert.equal(jakartaDateKey(new Date('2026-10-31T16:59:00Z')), '2026-10-31');
});

test('dailyRecapSummaries groups by WIB day, newest first', () => {
  const days = dailyRecapSummaries([
    report('2026-10-30T02:00:00Z', '10', '0', '0'), report('2026-10-31T02:00:00Z', '20', '0', '0'), report('2026-10-31T10:00:00Z', '30', '0', '0'),
  ]);
  assert.deepEqual(days.map(day => [day.date, day.sale, day.count]), [['2026-10-31', 50n, 2], ['2026-10-30', 10n, 1]]);
});

test('formatRecapReport states plainly when no recap exists and never claims profit', () => {
  const text = formatRecapReport({ dateLabel: '2026-10-31', shift: null, today: sumRecapReports([]), recent: [], topItems: [], formatMoney: value => 'Rp' + value });
  assert.match(text, /Belum ada rekap shift terkonfirmasi/);
  assert.match(text, /Laba tidak dihitung/);
});

test('parseBalanceTaskTarget requires all three numeric fields', () => {
  const ok = { check: { openingBalance: '1000', expectedBalance: '1500', actualBalance: '1400' } };
  assert.deepEqual(parseBalanceTaskTarget(ok), { actual: 1400n, expected: 1500n, opening: 1000n });
  assert.equal(parseBalanceTaskTarget({ check: { openingBalance: '1000', expectedBalance: '1500' } }), null);
  assert.equal(parseBalanceTaskTarget({ check: { openingBalance: '1000', expectedBalance: 'x', actualBalance: '1' } }), null);
  assert.equal(parseBalanceTaskTarget('nope'), null);
});

test('failed updates are retried only up to the attempt limit', () => {
  const now = new Date();
  assert.equal(duplicateUpdateDisposition('FAILED', null, now, 1), 'CLAIMED');
  assert.equal(duplicateUpdateDisposition('FAILED', null, now, MAX_UPDATE_ATTEMPTS), 'PROCESSED');
  assert.equal(duplicateUpdateDisposition('PROCESSING', new Date(now.getTime() - 1000), now, MAX_UPDATE_ATTEMPTS), 'PROCESSED');
  assert.equal(duplicateUpdateDisposition('PROCESSING', new Date(now.getTime() + 60_000), now, 1), 'BUSY');
  assert.equal(duplicateUpdateDisposition('DEAD', null, now, 9), 'PROCESSED');
  assert.equal(duplicateUpdateDisposition('PROCESSED', null, now, 1), 'PROCESSED');
});

test('offline recap parser does not read a balance out of words that merely end in "kas"', () => {
  const result = deterministicExtraction('bukas 5000');
  assert.equal(result.entries.some(entry => entry.category === 'total_balance'), false);
});

test('offline recap parser still reads a plain cash balance', () => {
  const result = deterministicExtraction('kas akhir 2jt');
  assert.equal(result.entries.find(entry => entry.category === 'total_balance')?.amount, '2000000');
});
