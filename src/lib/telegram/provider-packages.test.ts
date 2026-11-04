import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuota, normalizeValidity, planProviderNormalize, planProviderPackages, slotName, type CatalogRow } from './provider-packages';

const row = (id: number, name: string, validity: string | null, sell: bigint, cost: bigint, stock = 5): CatalogRow =>
  ({ id, name, provider: 'Axis', validity, stock, costPrice: cost, sellPrice: sell, categoryId: 1, subcategoryId: null });

// Katalog lama: nama memuat kuota.
const oldAxis = [
  row(1, 'Paket Data 10GB Axis', '3 hari', 16000n, 14000n),
  row(2, 'Paket Data 6GB Axis', '5 hari', 16000n, 14500n),
  row(3, 'Paket Data 13GB Axis', '7 hari', 26000n, 23500n),
];
const pkg = (validity: string | null, sell: bigint, cost: bigint | null = null, stock: number | null = null, quota: string | null = null) => ({ validity, sellPrice: sell, costPrice: cost, stock, quota });

test('hari dan kuota dinormalkan', () => {
  assert.equal(normalizeValidity('3hari'), '3 hari');
  assert.equal(normalizeValidity('7 HR'), '7 hari');
  assert.equal(normalizeValidity('Standard'), 'Standard');
  assert.equal(normalizeQuota('1,5 GB'), '1.5GB');
  assert.equal(slotName('Axis', '3 hari'), 'Axis 3 Hari');
  assert.equal(slotName('Axis', 'standard'), 'Axis Standard');
});

test('daftar harian cukup hari + harga; katalog lama otomatis jadi per hari tanpa kuota', () => {
  const plan = planProviderPackages('axis', oldAxis, [pkg('3 hari', 15000n), pkg('5 hari', 15000n), pkg('7 hari', 25000n)]);
  assert.equal(plan.creates.length, 0);
  assert.deepEqual(plan.updates.map(update => [update.id, update.to.name, update.to.sellPrice]), [[1, 'Axis 3 Hari', 15000n], [2, 'Axis 5 Hari', 15000n], [3, 'Axis 7 Hari', 25000n]]);
  assert.ok(plan.updates.every(update => update.kind === 'RENAME'));
  assert.equal(plan.updates[0].to.costPrice, 14000n);
});

test('kuota berubah: TIDAK ada yang perlu diubah, yang diketik tetap hari dan harga', () => {
  const current = [row(1, 'Axis 3 Hari', '3 hari', 15000n, 13000n), row(2, 'Axis 5 Hari', '5 hari', 15000n, 13500n)];
  const same = planProviderPackages('axis', current, [pkg('3 hari', 15000n, null, null, '8GB'), pkg('5 hari', 15000n)]);
  assert.deepEqual(same.updates.map(update => update.kind), ['SAME', 'SAME']);
  assert.equal(same.creates.length, 0);
  const priceOnly = planProviderPackages('axis', current, [pkg('3 hari', 16000n)]);
  assert.equal(priceOnly.updates[0].kind, 'PRICE');
  assert.equal(priceOnly.updates[0].to.name, 'Axis 3 Hari');
});

test('hari baru dibuat sebagai produk baru dengan nama per hari; modal dari margin biasa ditandai', () => {
  const current = [row(1, 'Axis 3 Hari', '3 hari', 15000n, 13000n)];
  const plan = planProviderPackages('axis', current, [pkg('3 hari', 15000n), pkg('30 hari', 50000n, null, 1)]);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].name, 'Axis 30 Hari');
  assert.equal(plan.creates[0].costPrice, 48000n);
  assert.equal(plan.creates[0].costEstimated, true);
  assert.equal(plan.creates[0].stock, 1);
});

test('provider yang belum punya produk: nama tetap per hari dan kategori ditanyakan nanti', () => {
  const plan = planProviderPackages('xl', [], [pkg('7 hari', 30000n)]);
  assert.equal(plan.creates[0].name, 'Xl 7 Hari');
  assert.equal(plan.creates[0].categoryId, null);
  assert.equal(plan.creates[0].costPrice, 0n);
});

test('katalog lama dengan dua produk di hari yang sama: kuota yang disebut membedakan, kalau tidak ditanyakan', () => {
  const dup = [...oldAxis, row(9, 'Paket Data 12GB Axis', '3 hari', 18000n, 16000n)];
  const chosen = planProviderPackages('axis', dup, [pkg('3 hari', 15000n, null, null, '12gb')]);
  assert.equal(chosen.updates[0].id, 9);
  const ask = planProviderPackages('axis', dup, [pkg('3 hari', 15000n)]);
  assert.equal(ask.ambiguous.length, 1);
  assert.equal(ask.updates.length, 0);
});

test('masa aktif tidak disebut atau dobel dilaporkan; provider lain tidak tersentuh', () => {
  const other = { ...row(50, 'Paket Data 10GB Three', '3 hari', 15000n, 13000n), provider: 'Three' };
  const plan = planProviderPackages('axis', [...oldAxis, other], [pkg(null, 15000n), pkg('3 hari', 15000n), pkg('3hari', 16000n)]);
  assert.equal(plan.invalid.length, 2);
  assert.equal(plan.missing.some(item => item.id === 50), false);
});

test('rapikan katalog lama: ganti nama jadi per hari tanpa menyentuh harga dan stok', () => {
  const plan = planProviderNormalize('axis', [...oldAxis, row(7, 'Voucher Axis Bronet', null, 20000n, 18000n)]);
  assert.deepEqual(plan.updates.map(update => update.to.name), ['Axis 3 Hari', 'Axis 5 Hari', 'Axis 7 Hari']);
  assert.ok(plan.updates.every(update => update.to.sellPrice === update.from.sellPrice && update.to.costPrice === update.from.costPrice));
  assert.deepEqual(plan.missing.map(item => item.id), [7]);
});
