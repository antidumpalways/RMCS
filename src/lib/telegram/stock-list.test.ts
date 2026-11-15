import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStockList } from './stock-list';

const read = (text: string, lenient = false) => parseStockList(text, { lenient })?.items.map(item => `${item.label}=${item.stock}${item.group ? ` [${item.group}]` : ''}`) ?? null;

test('daftar stok hanya diproses bila diawali "update stok"', () => {
  assert.deepEqual(read('Update stok:\nAXIS 3 HARI 5\nAXIS 5 HARI 4\nAXIS 7 HARI 3'), ['AXIS 3 hari=5', 'AXIS 5 hari=4', 'AXIS 7 hari=3']);
  assert.deepEqual(read('update stok\nTELKOMSEL 3 HARI : 52\nTELKOMSEL 5 HARI : 31\n\nIM3 3 HARI : 4 '), ['TELKOMSEL 3 hari=52', 'TELKOMSEL 5 hari=31', 'IM3 3 hari=4']);
  assert.deepEqual(read('update stok xl 3 hari 10'), ['xl 3 hari=10']);
  assert.deepEqual(read('Update stok: Axis 5 hari : 4'), ['Axis 5 hari=4']);
});

test('tanpa "update stok" tidak diproses langsung', () => {
  for (const text of ['AXIS 3 HARI 5\nAXIS 5 HARI 4\nAXIS 7 HARI 3', 'TELKOMSEL 3 HARI : 52\nTELKOMSEL 5 HARI : 31', 'XL 3 HARI STOK 10', 'Axis 5 hari : 4', 'stok:\naxis 3 hari 5']) {
    assert.equal(parseStockList(text), null, text);
  }
});

test('judul kelompok, baris kosong nilai, dan satuan', () => {
  const list = parseStockList('Update stok: \n\nXL 3 HARI : \nAXIS 5HARI : 5\n\nROKOK : \nSAMPOERNA : 7\nMILLENIUM BOLD:7\nSamsu Ketengan : 11 batang');
  assert.deepEqual(list?.items.map(item => [item.label, item.stock, item.group]), [['AXIS 5 hari', 5, null], ['SAMPOERNA', 7, 'ROKOK'], ['MILLENIUM BOLD', 7, 'ROKOK'], ['Samsu Ketengan', 11, 'ROKOK']]);
  assert.deepEqual(list?.skipped, ['XL 3 hari']);
});

test('kuota/hari di bawah judul provider memakai judulnya', () => {
  assert.deepEqual(read('update stok\nAXIS\n\n10gb/ 3 hari : 5\n6gb / 5 hari : 4\n15/ 7 hari : 3'), ['AXIS 10gb 3 hari=5 [AXIS]', 'AXIS 6gb 5 hari=4 [AXIS]', 'AXIS 15 7 hari=3 [AXIS]']);
});

test('menu Koreksi stok menerima daftar tanpa kata pembuka', () => {
  assert.deepEqual(read('Axis 6gb 5 hari 4', true), ['Axis 6gb 5 hari=4']);
  assert.deepEqual(read('XL 3 HARI STOK 10', true), ['XL 3 hari=10']);
});

test('bukan daftar stok: harga, tambah stok, pertanyaan, obrolan', () => {
  for (const text of ['update stok\naxis\n3 hari 15rb\n5 hari 15rb', 'update stok tambah axis 3 hari 10', 'stok axis 5 hari berapa lagi', 'update stok nya berapa', 'Baru masuk', 'update stok axis 3 hari harga 15000 stok 1', 'update stok', 'By U 5 hari']) {
    assert.equal(parseStockList(text, { lenient: true }), null, text);
  }
});

test('update harga / modal / margin memakai format yang sama', async () => {
  const { parseUpdateList } = await import('./stock-list');
  const show = (text: string, lenient = false) => parseUpdateList(text, { lenient })?.items.map(item => `${item.kind}:${item.label}=${item.value}`) ?? null;
  assert.deepEqual(show('Update harga:\nTELKOMSEL 3 HARI : 15rb\nAXIS 5 HARI : 16.000\nXL 7 HARI 25000\nROKOK :\nSAMPOERNA : 31rb'),
    ['sellPrice:TELKOMSEL 3 hari=15000', 'sellPrice:AXIS 5 hari=16000', 'sellPrice:XL 7 hari=25000', 'sellPrice:SAMPOERNA=31000']);
  assert.deepEqual(show('update margin\naxis 3 hari : 2rb\naxis 5 hari : 2500'), ['margin:axis 3 hari=2000', 'margin:axis 5 hari=2500']);
  assert.deepEqual(show('Update modal: telkomsel 3 hari 13rb'), ['costPrice:telkomsel 3 hari=13000']);
  // Beberapa bagian dalam satu pesan.
  assert.deepEqual(show('Update stok:\naxis 3 hari : 5\n\nUpdate harga:\naxis 3 hari : 15rb\n\nUpdate margin:\naxis 3 hari : 2rb'),
    ['stock:axis 3 hari=5', 'sellPrice:axis 3 hari=15000', 'margin:axis 3 hari=2000']);
  // Angka terlalu kecil tidak ditebak; baris kosong dilewati.
  const odd = parseUpdateList('update harga\naxis 3 hari : 15\nxl 3 hari :\naxis 5 hari : 16rb');
  assert.deepEqual(odd?.invalid, ['axis 3 hari (15)']);
  assert.deepEqual(odd?.skipped, ['xl 3 hari']);
  assert.equal(odd?.items.length, 1);
  // Tanpa kop tidak diproses; pertanyaan tidak diproses.
  assert.equal(show('TELKOMSEL 3 HARI : 15rb\nAXIS 5 HARI : 16rb'), null);
  assert.equal(show('update harga axis 3 hari berapa?'), null);
  assert.equal(show('update harga'), null);
  // Menu Koreksi stok tetap menerima stok tanpa kop.
  assert.deepEqual(show('Axis 6gb 5 hari 4', true), ['stock:Axis 6gb 5 hari=4']);
});
