import assert from 'node:assert/strict';
import test from 'node:test';
import { isLikelySaleNote, parseItemCorrection, parseItemLine, parseItemSegments } from './item-line';
import { applyExtraction, deterministicExtraction, emptyRecap } from './recap';

const read = (text: string) => { const item = parseItemLine(text); return item && !item.ambiguity ? `${item.label} x${item.quantity}` : item ? 'AMBIGU' : null; };

test('barang terbaca tanpa kata pcs', () => {
  assert.equal(read('axis 13gb 2'), 'axis 13gb x2');
  assert.equal(read('2 axis 13gb'), 'axis 13gb x2');
  assert.equal(read('axis 13gb dua'), 'axis 13gb x2');
  assert.equal(read('surya 2 bungkus'), 'surya x2');
  assert.equal(read('charger type c x3'), 'charger type c x3');
  assert.equal(read('jual 3 voucher tri'), 'voucher tri x3');
  assert.equal(read('Axis 13gb 7 hari: 1 pcs'), 'Axis 13gb 7 hari x1');
});

test('provider + masa aktif tanpa jumlah dianggap 1', () => {
  assert.equal(read('telkomsel 3 hari'), 'telkomsel 3 hari x1');
  assert.equal(read('tsel 3hr'), 'telkomsel 3 hari x1');
  assert.equal(read('xl 7 hari 2'), 'xl 7 hari x2');
  assert.equal(read('laku axis 5 hari'), 'axis 5 hari x1');
  assert.equal(read('3 hari telkomsel'), '3 hari telkomsel x1');
});

test('voucher tanpa masa aktif + angka ditanyakan, bukan ditebak', () => {
  assert.equal(read('axis 7'), 'AMBIGU');
  assert.equal(read('telkomsel 3'), 'AMBIGU');
  assert.equal(read('surya 3'), 'surya x3');
});

test('baris uang, pertanyaan, dan obrolan bukan barang', () => {
  for (const text of ['admin 45rb', 'saldo akhir 26jt', 'tf 500rb', 'beli plastik 10rb', 'harga axis 13gb berapa?', 'axis 3 hari ada?', 'oke siap', 'bentar ya', 'pulsa 50rb', 'pengeluaran 20000']) {
    assert.equal(parseItemLine(text), null, text);
  }
});

test('harga di ujung baris diabaikan', () => {
  assert.equal(read('axis 3 hari 2 pcs 30rb'), 'axis 3 hari x2');
  assert.equal(read('telkomsel 5 hari 25.000'), 'telkomsel 5 hari x1');
});

test('beberapa barang dalam satu baris', () => {
  assert.deepEqual(parseItemSegments('axis 13gb 2 sama xl 7 hari 1')?.map(item => `${item.label} x${item.quantity}`), ['axis 13gb x2', 'xl 7 hari x1']);
  assert.deepEqual(parseItemSegments('telkomsel 3 hari, axis 5 hari 2')?.map(item => `${item.label} x${item.quantity}`), ['telkomsel 3 hari x1', 'axis 5 hari x2']);
  assert.equal(parseItemSegments('admin 45rb dan saldo 26jt'), null);
});

test('catatan penjualan di luar sesi rekap dikenali dengan ketat', () => {
  assert.equal(isLikelySaleNote('axis 13gb 2 pcs'), true);
  assert.equal(isLikelySaleNote('telkomsel 3 hari'), true);
  assert.equal(isLikelySaleNote('telkomsel 3 hari\naxis 5 hari 2'), true);
  assert.equal(isLikelySaleNote('surya 3'), false);
  assert.equal(isLikelySaleNote('axis 7'), false);
  assert.equal(isLikelySaleNote('aku telat 5 menit'), false);
  assert.equal(isLikelySaleNote('besok libur 2 hari'), false);
  assert.equal(isLikelySaleNote('lupa rekap tadi maaf ya'), false);
});

test('koreksi dan hapus barang tanpa satuan', () => {
  assert.deepEqual(parseItemCorrection('axis 3 hari bukan 7 tapi 5'), { sourceText: 'axis 3 hari bukan 7 tapi 5', label: 'axis 3 hari', quantity: 5 });
  assert.equal(parseItemCorrection('eh tsel 3hr harusnya 4')?.label, 'telkomsel 3 hari');
  assert.equal(parseItemCorrection('hapus axis 3 hari')?.quantity, 0);
  assert.equal(parseItemCorrection('xl 7 hari gak jadi')?.label, 'xl 7 hari');
  assert.equal(parseItemCorrection('admin bukan 45rb tapi 50rb'), null);
  assert.equal(parseItemCorrection('batal rekap'), null);
});

test('rekap: tulis singkat, koreksi, lalu hapus', () => {
  let draft = applyExtraction(emptyRecap(), deterministicExtraction('telkomsel 3 hari\naxis 5 hari 2\nsaldo 26jt'), 'a', 'u1');
  assert.deepEqual(draft.inventoryLines?.map(line => [line.label, line.quantity, line.unit]), [['telkomsel 3 hari', 1, 'pcs'], ['axis 5 hari', 2, 'pcs']]);
  assert.equal(draft.entries.find(entry => entry.category === 'total_balance')?.amount, '26000000');
  draft = applyExtraction(draft, deterministicExtraction('axis 5 hari harusnya 3'), 'b', 'u2');
  assert.equal(draft.inventoryLines?.find(line => line.label === 'axis 5 hari')?.quantity, 3);
  draft = applyExtraction(draft, deterministicExtraction('hapus tsel 3 hari'), 'c', 'u3');
  assert.deepEqual(draft.inventoryLines?.map(line => line.label), ['axis 5 hari']);
  assert.deepEqual(draft.unresolved, []);
});

test('pertanyaan harga sederhana dijawab lewat jalur cepat', async () => {
  const { quickCatalogQuery } = await import('./group-routing');
  assert.equal(quickCatalogQuery('harga axis 3 hari berapa?'), 'axis 3 hari');
  assert.equal(quickCatalogQuery('telkomsel 5 hari ada?'), 'telkomsel 5 hari');
  assert.equal(quickCatalogQuery('stok charger type c masih ada gak?'), 'charger type c');
  assert.equal(quickCatalogQuery('berapa?'), null);
  assert.equal(quickCatalogQuery('yang 7 hari?'), null);
  assert.equal(quickCatalogQuery('axis 3 hari 2 pcs'), null);
});
