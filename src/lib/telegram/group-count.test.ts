import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceExplanation, countMode, dedupeCounts, differenceHints, interpretMoney, isCountMessage, parseCountMessage, soldFromCounts } from './group-count';
import { looseUnitConflict } from './variant-guard';

test('pesan "Update stok" karyawan: stok, Admin, dan Total', () => {
  const message = parseCountMessage('Update stok\nTELKOMSEL 3 HARI : 38\nTELKOMSEL 5 HARI : 24\n\nROKOK :\nSAMPOERNA : 7\nSamsu Ketengan : 11 batang\n\nAdmin: 82\nTotal: 34463', 30_000_000);
  assert.deepEqual(message?.items.map(item => [item.label, item.stock, item.group]), [['TELKOMSEL 3 hari', 38, null], ['TELKOMSEL 5 hari', 24, null], ['SAMPOERNA', 7, 'ROKOK'], ['Samsu Ketengan', 11, 'ROKOK']]);
  assert.deepEqual(message?.admin, { raw: '82', amount: 82_000, assumedThousands: true });
  assert.deepEqual(message?.total, { raw: '34463', amount: 34_463_000, assumedThousands: true });
  assert.equal(isCountMessage('Update stok\naxis 3 hari : 2'), true);
  assert.equal(isCountMessage('axis 3 hari : 2'), false);
  assert.equal(isCountMessage('update stok'), false);
});

test('tafsir uang: satuan eksplisit apa adanya, angka kecil = ribuan', () => {
  assert.equal(interpretMoney('82rb', 'admin').amount, 82_000);
  assert.equal(interpretMoney('82.000', 'admin').amount, 82_000);
  assert.equal(interpretMoney('45000', 'admin').amount, 45_000);
  assert.equal(interpretMoney('82', 'admin').amount, 82_000);
  assert.equal(interpretMoney('34.463.000', 'total').amount, 34_463_000);
  assert.equal(interpretMoney('34,4jt', 'total').amount, 34_400_000);
  assert.equal(interpretMoney('34463', 'total', 30_000_000).amount, 34_463_000);
  assert.equal(interpretMoney('34463', 'total', 30_000_000).assumedThousands, true);
  assert.equal(interpretMoney('34463000', 'total', 30_000_000).amount, 34_463_000);
  assert.equal(interpretMoney('5', 'total', 30_000_000).amount, null);
  assert.equal(interpretMoney('abc', 'admin').amount, null);
});

test('barang laku dari selisih stok sistem dan hitungan', () => {
  const catalog = [
    { id: 1, name: 'Telkomsel 3 Hari', stock: 40, sellPrice: 15_000n, validity: '3 hari' },
    { id: 2, name: 'Paket Data 10GB Three', stock: 5, sellPrice: 15_000n, validity: '3 hari' },
    { id: 3, name: 'Paket Data 10GB Three', stock: 4, sellPrice: 16_000n, validity: '5 hari' },
    { id: 4, name: 'SAMPOERNA', stock: 7, sellPrice: 31_000n, validity: null },
    { id: 5, name: 'BULL', stock: 3, sellPrice: 12_000n, validity: null },
  ];
  const item = (label: string, stock: number) => ({ label, stock, group: null, sourceText: `${label} : ${stock}` });
  const result = soldFromCounts([
    { item: item('TELKOMSEL 3 hari', 38), product: catalog[0] },
    { item: item('THREE 3 hari', 2), product: catalog[1] },
    { item: item('THREE 5 hari', 4), product: catalog[2] },
    { item: item('SAMPOERNA', 7), product: catalog[3] },
    { item: item('BULL', 9), product: catalog[4] },
    { item: item('IM3 3 hari', 3), product: null },
  ], catalog);
  assert.deepEqual(result.sold.map(line => [line.label, line.sold]), [['Telkomsel 3 Hari', 2], ['Paket Data 10GB Three (3 hari)', 3]]);
  assert.equal(result.same, 2);
  assert.deepEqual(result.unmatched, ['IM3 3 hari (3)']);
  assert.match(result.notes[0], /BULL: hitungan 9 lebih banyak dari stok sistem 3/);
});

test('keterangan lebih/kurang menyebut pertalite, aksesori, bon, dan setara berapa pcs', () => {
  const hints = differenceHints(30_000n, [{ name: 'Telkomsel 3 Hari', sellPrice: 15_000n }, { name: 'SAMPOERNA', sellPrice: 31_000n }, { name: 'Axis 3 Hari', sellPrice: 30_000n }]);
  assert.deepEqual(hints, ['1 pcs Axis 3 Hari', '2 pcs Telkomsel 3 Hari']);
  const excess = balanceExplanation('EXCESS', 'Rp 30.000', hints);
  assert.match(excess, /lebih Rp 30\.000/);
  assert.match(excess, /pertalite\/aksesori/);
  assert.match(excess, /bon/);
  assert.match(excess, /setara 1 pcs Axis 3 Hari/);
  assert.match(balanceExplanation('SHORT', 'Rp 5.000'), /bon \(belum dibayar\)/);
  assert.equal(balanceExplanation('MATCH', 'Rp 0'), '');
});

test('pesan hanya berisi Admin dan Total tetap terbaca', () => {
  const message = parseCountMessage(['Update stok', 'Admin: 82', 'Total: 34463'].join(String.fromCharCode(10)), 30_000_000);
  assert.equal(message?.items.length, 0);
  assert.equal(message?.total?.amount, 34_463_000);
});

test('Modal dibaca sama seperti Total; kop pagi/sore menentukan mode', () => {
  const NL = String.fromCharCode(10);
  const message = parseCountMessage(['Update stok pagi', 'Axis 3 hari : 5', 'Modal: 34463'].join(NL), 30_000_000);
  assert.equal(message?.total?.amount, 34_463_000);
  assert.equal(message?.items.length, 1);
  assert.equal(parseCountMessage(['Update stok', 'Modal awal: 34,4jt'].join(NL))?.total?.amount, 34_400_000);
  assert.equal(countMode('Update stok pagi' + NL + 'x : 1'), 'open');
  assert.equal(countMode('Update stok buka' + NL + 'x : 1'), 'open');
  assert.equal(countMode('Update stok sore' + NL + 'x : 1'), 'close');
  assert.equal(countMode('Update stok tutup' + NL + 'x : 1'), 'close');
  assert.equal(countMode('Update stok' + NL + 'x : 1'), null);
  assert.equal(isCountMessage('Update stok pagi' + NL + 'Axis 3 hari : 5'), true);
});

test('Uang keluar terbaca, ikut gaya ribuan Total, dan tidak membuang daftar stok', () => {
  const NL = String.fromCharCode(10);
  const message = parseCountMessage(['Update stok', 'TELKOMSEL 3 HARI : 58', 'BATANGAN FELOZ : 16 BATANG', 'ROKOK :', 'SAMPOERNA : 8', 'Uang keluar: 1190', 'Admin: 154', 'Total: 37954'].join(NL), 37_000_000);
  assert.equal(message?.items.length, 3);
  assert.equal(message?.expense?.amount, 1_190_000);
  assert.equal(message?.admin?.amount, 154_000);
  assert.equal(message?.total?.amount, 37_954_000);
  // Satuan eksplisit tidak dikalikan lagi.
  assert.equal(parseCountMessage(['Update stok', 'Axis 3 hari : 5', 'Uang keluar: 90rb', 'Admin: 154', 'Total: 37954'].join(NL), 37_000_000)?.expense?.amount, 90_000);
  // Baris kosong dan baris tak terbaca tidak menjatuhkan daftar.
  const messy = parseCountMessage(['Update stok', 'Axis 3 hari : 5', 'harga axis 15rb', 'Uang keluar: ', 'Admin: ', 'Total:'].join(NL));
  assert.equal(messy?.items.length, 1);
  assert.deepEqual(messy?.invalid, ['harga axis 15rb']);
});

test('Admin atau Uang keluar terisi berarti sore; template kosong ditentukan dari keadaan shift', () => {
  const NL = String.fromCharCode(10);
  assert.equal(countMode(['Update stok', 'Axis 3 hari : 5', 'Uang keluar: ', 'Admin: 154', 'Total: 37954'].join(NL)), 'close');
  assert.equal(countMode(['Update stok', 'Axis 3 hari : 5', 'Uang keluar: 1190', 'Admin: ', 'Total:'].join(NL)), 'close');
  assert.equal(countMode(['Update stok', 'Axis 3 hari : 5', 'Uang keluar: ', 'Admin: ', 'Total:'].join(NL)), null);
  assert.equal(countMode(['Update stok', 'Axis 3 hari : 5', 'Modal: 34463'].join(NL)), null);
});

test('dua baris ke barang yang sama tidak saling menimpa dan batangan bukan bungkus', () => {
  const product = (id: number, name: string, stock: number, quota?: string) => ({ id, name, stock, sellPrice: 15_000n, validity: null, quota: quota ?? null });
  const item = (label: string, stock: number) => ({ label, stock, group: null, sourceText: `${label} : ${stock}` });
  const im3 = product(1, 'IM3 4GB 3 Hari', 2, '4GB'), samsu = product(2, 'Samsu Ketengan', 9);
  const result = dedupeCounts([
    { item: item('IM3 10 GB 3 hari', 1), product: im3 }, { item: item('IM3 4 GB 3 hari', 2), product: im3 },
    { item: item('Samsu Ketengan', 9), product: samsu }, { item: item('SAMSUE', 5), product: samsu },
  ]);
  // Kuota cocok menang walau ditulis belakangan; pada Samsu yang pertama menang.
  assert.deepEqual(result.counts.map(entry => entry.product?.id ?? null), [null, 1, 2, null]);
  assert.equal(result.notes.length, 2);
  assert.equal(soldFromCounts(result.counts, [im3, samsu]).sold.length, 0);
  assert.equal(looseUnitConflict('BATANGAN FELOZ', 'FELOZ'), true);
  assert.equal(looseUnitConflict('Samsu Ketengan', 'Samsu Ketengan'), false);
  assert.equal(looseUnitConflict('FELOZ', 'FELOZ'), false);
});

test('kejadian uang: uang masuk, uang keluar, dan bon dengan keterangan, boleh berulang', () => {
  const NL = String.fromCharCode(10);
  const message = parseCountMessage(['Update stok sore', 'Axis 3 hari : 5', 'Admin: 100', 'Uang masuk: 500 bayar utang pak Budi', 'Uang masuk: 1,5jt hp oppo a18',
    'Uang keluar: 1190 belanja pertalite', 'Uang keluar: 50rb parkir', 'Bon: 30 bu Sari 2 voucher', 'Total: 34940'].join(NL), 34_000_000);
  assert.deepEqual(message?.events.map(event => [event.kind, event.money.amount, event.note]), [
    ['in', 500_000, 'bayar utang pak Budi'], ['in', 1_500_000, 'hp oppo a18'], ['out', 1_190_000, 'belanja pertalite'], ['out', 50_000, 'parkir'], ['bon', 30_000, 'bu Sari 2 voucher'],
  ]);
  // Semua uang keluar dijumlahkan menjadi pengeluaran; stok tidak terpengaruh baris-baris ini.
  assert.equal(message?.expense?.amount, 1_240_000);
  assert.equal(message?.items.length, 1);
  // Tanpa keterangan dan angka rusak.
  const plain = parseCountMessage(['Update stok sore', 'Bon: 200', 'Uang masuk: abc'].join(NL), 34_000_000);
  assert.equal(plain?.events[0].money.amount, 200_000);
  assert.equal(plain?.events[0].note, '');
  assert.equal(plain?.events[1].money.amount, null);
});
