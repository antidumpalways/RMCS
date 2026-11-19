import assert from 'node:assert/strict';
import test from 'node:test';
import { isReceiptMessage, parseReceiptMessage } from './stock-receipt';

const NL = String.fromCharCode(10);

test('pesan barang masuk dikenali dari kop, bukan dari pesan lain', () => {
  assert.equal(isReceiptMessage(['Barang masuk:', 'Axis 3 hari : 10'].join(NL)), true);
  assert.equal(isReceiptMessage(['stok masuk', 'Axis 3 hari : 10'].join(NL)), true);
  assert.equal(isReceiptMessage(['Restock', 'Axis 3 hari : 10'].join(NL)), true);
  assert.equal(isReceiptMessage('barang masuk axis 3 hari : 10'), true);
  assert.equal(isReceiptMessage('barang masuk'), false);
  assert.equal(isReceiptMessage(['Update stok pagi', 'Axis 3 hari : 10'].join(NL)), false);
  assert.equal(isReceiptMessage('axis 3 hari 2'), false);
});

test('jumlah barang masuk dibaca per baris, termasuk judul kelompok dan baris rusak', () => {
  const parsed = parseReceiptMessage(['Barang masuk:', 'TELKOMSEL 3 HARI : 10', 'ROKOK :', 'SAMPOERNA : 5', 'harga naik 2rb'].join(NL));
  assert.deepEqual(parsed?.items.map(item => [item.label, item.stock, item.group]), [['TELKOMSEL 3 hari', 10, null], ['SAMPOERNA', 5, 'ROKOK']]);
  assert.deepEqual(parsed?.invalid, ['harga naik 2rb']);
  assert.equal(parseReceiptMessage('Barang masuk:')?.items.length ?? 0, 0);
});
