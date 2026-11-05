import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOnlyStatement, parseProviderLists } from './provider-list-parser';

test('daftar Telkomsel persis seperti yang diketik owner dibaca tanpa AI, termasuk dua paket di hari yang sama', () => {
  const lists = parseProviderLists(['Telkomsel, ganti semua', '3 hari 5gb modal 13300 harga jual 15000', '5 hari 5gb modal 15000 harga jual 17000',
    '5 hari 7gb modal 18000 harga jual 20000', '7 hari 8gb modal 28000 harga jual 30000'].join('\n'));
  assert.ok(lists);
  assert.equal(lists!.length, 1);
  assert.equal(lists![0].provider, 'Telkomsel');
  assert.equal(lists![0].replaceAll, true);
  assert.deepEqual(lists![0].packages.map(item => [item.validity, item.quota, item.sellPrice, item.costPrice]),
    [['3 hari', '5gb', '15000', '13300'], ['5 hari', '5gb', '17000', '15000'], ['5 hari', '7gb', '20000', '18000'], ['7 hari', '8gb', '30000', '28000']]);
});

test('nama provider di tiap baris, singkatan hr, desimal, koma, dan "jual" saja', () => {
  const lists = parseProviderLists(['XL 3hr 6.5gb modal 13000 , harga jual 15000', 'XL 5hr 10gb modal 18000 jual 20rb', 'XL 7hr 14gb modal 2300 harga jual 25000'].join('\n'));
  assert.ok(lists);
  assert.equal(lists![0].provider, 'XL');
  assert.equal(lists![0].replaceAll, false);
  assert.deepEqual(lists![0].packages.map(item => [item.validity, item.quota, item.sellPrice, item.costPrice]),
    [['3 hari', '6.5gb', '15000', '13000'], ['5 hari', '10gb', '20rb', '18000'], ['7 hari', '14gb', '25000', '2300']]);
});

test('beberapa provider dalam satu pesan; stok dibaca; tanpa kuota boleh', () => {
  const lists = parseProviderLists(['axis', '3 hari harga jual 15rb stok 2', '5 hari jual 15rb', '', 'three timpa semua', '3 hari 10gb hj 12000'].join('\n'));
  assert.ok(lists);
  assert.deepEqual(lists!.map(list => [list.provider, list.replaceAll, list.packages.length]), [['axis', false, 2], ['three', true, 1]]);
  assert.equal(lists![0].packages[0].stock, 2);
  assert.equal(lists![0].packages[0].quota, null);
});

test('kalimat bebas atau baris yang tidak dikenali diserahkan ke AI (null)', () => {
  assert.equal(parseProviderLists('tolong naikkan harga axis 3 hari jadi 16rb ya'), null);
  assert.equal(parseProviderLists('Axis\n3 hari 15rb\nkalau bisa besok dikirim ya'), null);
  assert.equal(parseProviderLists('harga axis berapa?'), null);
  assert.equal(parseProviderLists('3 hari'), null);
});

test('kalimat bebas yang kebetulan memuat hari dan harga TIDAK ditangkap (diserahkan ke AI)', () => {
  assert.equal(parseProviderLists('tambah barang baru Telkomsel Voucher Telkomsel 7GB 5 Hari kategori Voucher harga jual 25000 modal 22000 stok 4'), null);
  assert.equal(parseProviderLists('naikkan harga axis 3 hari jadi harga jual 16000'), null);
  assert.equal(parseProviderLists('Axis\n3 hari harga jual 15rb tolong ya'), null);
});

test('"X yang kita jual cuma Y" dibaca tanpa AI; kalimat lain tidak ikut tertangkap', () => {
  assert.deepEqual(parseOnlyStatement('Minyak yg kita jual itu cuma pertalite'), { category: 'Minyak', items: [{ name: 'Pertalite', sellPrice: null, costPrice: null }] });
  assert.deepEqual(parseOnlyStatement('oke catat, rokok yang dijual hanya Surya dan Sampoerna aja.'), { category: 'rokok', items: [{ name: 'Surya', sellPrice: null, costPrice: null }, { name: 'Sampoerna', sellPrice: null, costPrice: null }] });
  assert.equal(parseOnlyStatement('harga pertalite berapa?'), null);
  assert.equal(parseOnlyStatement('kita jual banyak macam minyak, bukan cuma pertalite'), null);
  assert.equal(parseOnlyStatement('tolong hapus semua yang kita jual cuma yang murah'), null);
});

test('kalimat owner persis: "hapus semua minyak, ... yg kita jual hanya minyak pertalite modal 11000 harga jual 12000"', () => {
  assert.deepEqual(parseOnlyStatement('hapus semua minyak, ganti kan yg kita jual hanya minyak pertalite modal 11000 harga jual 12000'),
    { category: 'minyak', items: [{ name: 'Pertalite', sellPrice: '12000', costPrice: '11000' }] });
  assert.deepEqual(parseOnlyStatement('Minyak yg kita jual hanya pertalite modal 11000 harga jual 12000')?.items[0], { name: 'Pertalite', sellPrice: '12000', costPrice: '11000' });
  assert.equal(parseOnlyStatement('hapus semua minyak'), null);
});

test('parseDeleteStatement: hapus semua kategori / beberapa barang; perintah lain tidak dibajak', async () => {
  const { parseDeleteStatement } = await import('./provider-list-parser');
  assert.deepEqual(parseDeleteStatement('hapus semua rokok'), { category: 'rokok', names: [] });
  assert.deepEqual(parseDeleteStatement('Hapus Surya 12, Gudang Garam dan Djarum'), { category: null, names: ['Surya 12', 'Gudang Garam', 'Djarum'] });
  assert.equal(parseDeleteStatement('hapus kategori rokok'), null);
  assert.equal(parseDeleteStatement('hapus semua minyak, yang kita jual hanya pertalite'), null);
  assert.equal(parseDeleteStatement('hapus utang budi'), null);
  assert.equal(parseDeleteStatement('hapus pertalite harga 12000'), null);
});
