import assert from 'node:assert/strict';
import test from 'node:test';
import { planCatalogList, type ListItem, type ListRow } from './catalog-list';

const row = (id: number, name: string, category: string, sell: bigint, cost: bigint, stock: number): ListRow =>
  ({ id, name, provider: null, validity: null, sku: null, stock, costPrice: cost, sellPrice: sell, categoryId: category === 'Rokok' ? 1 : 2, categoryName: category, subcategoryId: null });
const item = (name: string, sell: bigint | null = null, cost: bigint | null = null, stock: number | null = null, extra: Partial<ListItem> = {}): ListItem =>
  ({ name, sellPrice: sell, costPrice: cost, stock, newName: null, provider: null, validity: null, category: null, ...extra });

const rokok = [row(1, 'Surya 12', 'Rokok', 30000n, 28000n, 30), row(2, 'Surya 16', 'Rokok', 38000n, 36000n, 30), row(3, 'Sampoerna A Mild 12', 'Rokok', 31000n, 29000n, 30), row(4, 'Marlboro Red 12', 'Rokok', 33000n, 31000n, 20)];

test('daftar rokok apa saja: yang ada diperbarui, yang belum ada dibuat (modal dari margin biasa)', () => {
  const plan = planCatalogList(rokok, [item('surya 12', 31000n), item('Sampoerna A Mild 12', 31000n, null, 40), item('Gudang Garam Filter 12', 28000n, null, 10)], { defaultCategory: 'Rokok' });
  assert.deepEqual(plan.updates.map(update => [update.id, update.to.sellPrice, update.to.stock]), [[1, 31000n, 30], [3, 31000n, 40]]);
  assert.equal(plan.updates[0].changed, true);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].name, 'Gudang Garam Filter 12');
  assert.equal(plan.creates[0].categoryId, 1);
  assert.equal(plan.creates[0].costEstimated, true);
  assert.equal(plan.creates[0].costPrice, 26000n);
  assert.equal(plan.creates[0].stock, 10);
  assert.equal(plan.missing.length, 2);
});

test('nama yang mirip beberapa barang: dipilih yang paling pendek bila jelas, kalau tidak ditanyakan', () => {
  const catalog = [row(1, 'Surya 12', 'Rokok', 30000n, 28000n, 5), row(2, 'Surya Merah 12', 'Rokok', 31000n, 29000n, 5), row(3, 'Surya Hijau 12', 'Rokok', 31000n, 29000n, 5)];
  assert.equal(planCatalogList(catalog, [item('surya 12', 32000n)]).updates[0].id, 1);
  const ask = planCatalogList(catalog.slice(1), [item('surya 12', 32000n)]);
  assert.equal(ask.ambiguous.length, 1);
  assert.equal(ask.updates.length, 0);
});

test('ganti semua: yang tidak disebut dipensiunkan, hanya di kategori yang disebut', () => {
  const catalog = [...rokok, row(9, 'Minyak Goreng 1L', 'Minyak', 20000n, 18000n, 15)];
  const plan = planCatalogList(catalog, [item('Surya 12', 31000n), item('Surya 16', 39000n)], { defaultCategory: 'Rokok', replaceAll: true });
  assert.deepEqual(plan.retire.map(entry => entry.id).sort(), [3, 4]);
  assert.equal(plan.retire.some(entry => entry.id === 9), false);
  const noScope = planCatalogList(catalog, [item('Surya 12', 31000n)], { replaceAll: true });
  assert.equal(noScope.retire.length, 0);
  assert.equal(noScope.invalid.length, 1);
});

test('barang baru tanpa harga ditolak; ganti nama lewat newName; perubahan kosong ditandai tidak berubah', () => {
  const plan = planCatalogList(rokok, [item('Barang Baru'), item('Surya 12', null, null, null, { newName: 'Surya Pro 12' }), item('Surya 16')], { defaultCategory: 'Rokok' });
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.updates.find(update => update.id === 1)!.to.name, 'Surya Pro 12');
  assert.equal(plan.updates.find(update => update.id === 2)!.changed, false);
});

test('kategori berbeda tidak tertukar: nama sama di kategori lain tidak ikut tersentuh', () => {
  const catalog = [row(1, 'Kopi Hitam', 'Rokok', 5000n, 4000n, 5), row(2, 'Kopi Hitam', 'Minyak', 6000n, 5000n, 5)];
  const plan = planCatalogList(catalog, [item('Kopi Hitam', 7000n)], { defaultCategory: 'Minyak' });
  assert.equal(plan.updates[0].id, 2);
});
