import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceExplanation, countMode, differenceHints, interpretMoney, isCountMessage, parseCountMessage, soldFromCounts } from './group-count';

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
