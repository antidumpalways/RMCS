import assert from 'node:assert/strict';
import test from 'node:test';
import { brandKnown, catalogTokens, parseNewProductSpec, parsePriceReply } from './new-product';

test('nama barang baru dari baris voucher dan non-voucher', () => {
  assert.deepEqual(parseNewProductSpec('IM3 4 GB 3 hari', null), { name: 'IM3 3 Hari', provider: 'IM3', validity: '3 hari', quota: '4GB', group: null, voucher: true });
  assert.equal(parseNewProductSpec('xl 7 HARI', null)?.name, 'XL 7 Hari');
  assert.equal(parseNewProductSpec('TSEL 5 hari', null)?.name, 'Tsel 5 Hari');
  assert.equal(parseNewProductSpec('BY U 10 GB 5 hari', null)?.name, 'BY U 5 Hari');
  assert.deepEqual(parseNewProductSpec('BULL', 'ROKOK'), { name: 'BULL', provider: null, validity: null, quota: null, group: 'ROKOK', voucher: false });
  assert.equal(parseNewProductSpec('3 hari', null), null);
});

test('merek yang sudah dikenal tidak dibuat baru; merek baru dibuat', () => {
  const known = catalogTokens(['Paket Data 11GB By.U', 'SP BY U 11GB', 'Axis 3 Hari', 'Three 3 Hari', 'Telkomsel 3 Hari', 'Marlong Kecil', 'MILENIUM BOLD', 'Surya Kecil']);
  assert.equal(brandKnown('IM3 4 GB 3 hari', known), false);
  assert.equal(brandKnown('BY U 10 GB 5 hari', known), true);
  assert.equal(brandKnown('tri 3 hari', known), true);
  assert.equal(brandKnown('BULL', known), false);
  assert.equal(brandKnown('MANCHESTER', known), false);
  assert.equal(brandKnown('MILLENIUM BOLD', known), true);
  assert.equal(brandKnown('onbold kecil', catalogTokens(['On Bold Kecil'])), false);
});

test('balasan modal + harga jual', () => {
  const one = [{ id: 1, name: 'IM3 3 Hari' }];
  assert.deepEqual(parsePriceReply('modal 13rb jual 15rb', one), [{ id: 1, costPrice: 13000, sellPrice: 15000, warning: null }]);
  assert.deepEqual(parsePriceReply('13rb 15rb', one)?.[0], { id: 1, costPrice: 13000, sellPrice: 15000, warning: null });
  assert.deepEqual(parsePriceReply('harga jual 15.000 modal 13.000', one)?.[0], { id: 1, costPrice: 13000, sellPrice: 15000, warning: null });
  const many = [{ id: 1, name: 'IM3 3 Hari' }, { id: 2, name: 'IM3 5 Hari' }];
  assert.deepEqual(parsePriceReply('modal 13rb jual 15rb', many)?.map(item => item.id), [1, 2]);
  assert.deepEqual(parsePriceReply('IM3 3 hari : 13rb 15rb\nIM3 5 hari : modal 14rb jual 16rb', many)?.map(item => [item.id, item.costPrice, item.sellPrice]), [[1, 13000, 15000], [2, 14000, 16000]]);
  assert.equal(parsePriceReply('13rb 12rb', one)?.[0].warning, 'IM3 3 Hari: harga jual di bawah modal.');
  // Bukan balasan harga.
  for (const text of ['oke', 'berapa modalnya?', 'tambah stok axis 3 hari 10', 'IM3 3 hari : 13rb', '15', 'Update stok:\nIM3 3 HARI : 3']) assert.equal(parsePriceReply(text, one), null, text);
});
