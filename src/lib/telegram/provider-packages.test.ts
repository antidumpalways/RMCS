import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuota, normalizeValidity, planProviderPackages, type CatalogRow } from './provider-packages';

const row = (id: number, name: string, validity: string | null, sell: bigint, cost: bigint, stock = 5): CatalogRow =>
  ({ id, name, provider: 'Axis', validity, stock, costPrice: cost, sellPrice: sell, categoryId: 1, subcategoryId: null });

const axis = [
  row(1, 'Paket Data 10GB Axis', '3 hari', 16000n, 14000n),
  row(2, 'Paket Data 6GB Axis', '5 hari', 16000n, 14500n),
  row(3, 'Paket Data 13GB Axis', '7 hari', 26000n, 23500n),
];
const pkg = (quota: string, validity: string | null, sell: bigint, cost: bigint | null = null, stock: number | null = null) => ({ quota, validity, sellPrice: sell, costPrice: cost, stock });

test('kuota dan masa aktif dinormalkan dari berbagai tulisan', () => {
  assert.equal(normalizeQuota('10gb'), '10GB');
  assert.equal(normalizeQuota('1,5 GB'), '1.5GB');
  assert.equal(normalizeQuota('500mb'), '500MB');
  assert.equal(normalizeQuota('abc'), null);
  assert.equal(normalizeValidity('3hari'), '3 hari');
  assert.equal(normalizeValidity('7 HR'), '7 hari');
  assert.equal(normalizeValidity('Standard'), 'Standard');
  assert.equal(normalizeValidity(''), null);
});

test('daftar yang sama: hanya harga berubah, tanpa produk baru', () => {
  const plan = planProviderPackages('axis', axis, [pkg('10GB', '3 hari', 15000n), pkg('6GB', '5 hari', 15000n), pkg('13GB', '7 hari', 25000n)]);
  assert.equal(plan.creates.length, 0);
  assert.deepEqual(plan.updates.map(update => [update.id, update.kind, update.to.sellPrice]), [[1, 'PRICE', 15000n], [2, 'PRICE', 15000n], [3, 'PRICE', 25000n]]);
  assert.equal(plan.missing.length, 0);
});

test('kuota berubah pada masa aktif yang sama: produk yang sama diganti, bukan dibuat baru', () => {
  const plan = planProviderPackages('Axis', axis, [pkg('8GB', '3 hari', 15000n), pkg('6GB', '5 hari', 16000n), pkg('13GB', '7 hari', 26000n)]);
  const renamed = plan.updates.find(update => update.id === 1)!;
  assert.equal(renamed.kind, 'RENAME');
  assert.equal(renamed.to.name, 'Paket Data 8GB Axis');
  assert.equal(renamed.to.costPrice, 14000n);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.find(update => update.id === 2)!.kind, 'SAME');
});

test('masa aktif baru dibuat sebagai produk baru dengan nama meniru gaya katalog dan modal dari margin biasa', () => {
  const plan = planProviderPackages('axis', axis, [pkg('10GB', '3 hari', 15000n), pkg('20GB', '30 hari', 50000n, null, 1)]);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].name, 'Paket Data 20GB Axis');
  assert.equal(plan.creates[0].validity, '30 hari');
  assert.equal(plan.creates[0].costEstimated, true);
  assert.equal(plan.creates[0].costPrice, 50000n - 2000n);
  assert.equal(plan.creates[0].stock, 1);
  assert.deepEqual(plan.missing.map(item => item.id), [2, 3]);
});

test('modal yang disebut dipakai apa adanya; dua produk di slot yang sama ditanyakan, bukan ditebak', () => {
  const plan = planProviderPackages('axis', axis, [pkg('10GB', '3 hari', 15000n, 13000n)]);
  assert.equal(plan.updates[0].to.costPrice, 13000n);
  const dup = [...axis, row(9, 'Paket Data 12GB Axis', '3 hari', 18000n, 16000n)];
  const ambiguous = planProviderPackages('axis', dup, [pkg('8GB', '3 hari', 15000n)]);
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.equal(ambiguous.updates.length, 0);
  assert.equal(ambiguous.creates.length, 0);
});

test('kuota yang tidak terbaca dilaporkan; provider lain tidak tersentuh', () => {
  const other = { ...row(50, 'Paket Data 10GB Three', '3 hari', 15000n, 13000n), provider: 'Three' };
  const plan = planProviderPackages('axis', [...axis, other], [pkg('banyak', '3 hari', 15000n)]);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.missing.some(item => item.id === 50), false);
});

test('paket tanpa masa aktif tercatat dicocokkan lewat kuota dan masa aktifnya diisi', () => {
  const noValidity = [row(1, 'Paket Data 10GB Axis', null, 16000n, 14000n)];
  const plan = planProviderPackages('axis', noValidity, [pkg('10GB', '3 hari', 15000n)]);
  assert.equal(plan.updates[0].id, 1);
  assert.equal(plan.updates[0].to.validity, '3 hari');
  assert.equal(plan.updates[0].kind, 'RENAME');
});
