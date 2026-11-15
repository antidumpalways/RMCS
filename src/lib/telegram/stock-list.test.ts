import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStockList } from './stock-list';

const read = (text: string, lenient = false) => parseStockList(text, { lenient })?.items.map(item => `${item.label}=${item.stock}${item.group ? ` [${item.group}]` : ''}`) ?? null;

test('daftar stok banyak baris terbaca tanpa AI', () => {
  assert.deepEqual(read('AXIS 3 HARI 5\nAXIS 5 HARI 4\nAXIS 7 HARI 3'), ['AXIS 3 hari=5', 'AXIS 5 hari=4', 'AXIS 7 hari=3']);
  assert.deepEqual(read('TELKOMSEL 3 HARI : 52\nTELKOMSEL 5 HARI : 31\n\nIM3 3 HARI : 4 '), ['TELKOMSEL 3 hari=52', 'TELKOMSEL 5 hari=31', 'IM3 3 hari=4']);
});

test('judul kelompok, baris kosong nilai, dan satuan', () => {
  const list = parseStockList('Update stok: \n\nXL 3 HARI : \nAXIS 5HARI : 5\n\nROKOK : \nSAMPOERNA : 7\nMILLENIUM BOLD:7\nSamsu Ketengan : 11 batang');
  assert.deepEqual(list?.items.map(item => [item.label, item.stock, item.group]), [['AXIS 5 hari', 5, null], ['SAMPOERNA', 7, 'ROKOK'], ['MILLENIUM BOLD', 7, 'ROKOK'], ['Samsu Ketengan', 11, 'ROKOK']]);
  assert.deepEqual(list?.skipped, ['XL 3 hari']);
});

test('kuota/hari di bawah judul provider memakai judulnya', () => {
  assert.deepEqual(read('AXIS\n\n10gb/ 3 hari : 5\n6gb / 5 hari : 4\n15/ 7 hari : 3'), ['AXIS 10gb 3 hari=5 [AXIS]', 'AXIS 6gb 5 hari=4 [AXIS]', 'AXIS 15 7 hari=3 [AXIS]']);
});

test('satu baris: perlu kata stok, titik dua, atau menu koreksi stok', () => {
  assert.deepEqual(read('XL 3 HARI STOK 10'), ['XL 3 hari=10']);
  assert.deepEqual(read('Axis 5 hari : 4'), ['Axis 5 hari=4']);
  assert.deepEqual(read('By U 5 hari : 8 pcs'), ['By U 5 hari=8']);
  assert.equal(read('Axis 6gb 5 hari 4'), null);
  assert.deepEqual(read('Axis 6gb 5 hari 4', true), ['Axis 6gb 5 hari=4']);
});

test('bukan daftar stok: harga, tambah stok, pertanyaan, obrolan', () => {
  for (const text of ['axis\n3 hari 15rb\n5 hari 15rb', 'tambah stok axis 3 hari 10', 'stok axis 5 hari berapa lagi', 'Stok nya berpaa', 'Baru masuk', 'axis 3 hari harga 15000 stok 1', 'oke', 'By U 5 hari']) {
    assert.equal(parseStockList(text, { lenient: true }), null, text);
  }
});
