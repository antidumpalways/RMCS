import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedOwnerPrivateChat, fallbackOwnerIntent, parseOwnerRupiah, telegramOwnerAuthorized, validateOwnerIntent } from './owner-intent';

test('owner authorization accepts only an exact numeric Telegram ID', () => {
  assert.equal(telegramOwnerAuthorized(123456, '123456, 789'), true);
  assert.equal(telegramOwnerAuthorized(123456, '1234567'), false);
  assert.equal(telegramOwnerAuthorized(0, '0'), false);
  assert.equal(telegramOwnerAuthorized(123456, undefined), false);
  assert.equal(authorizedOwnerPrivateChat(123456, 123456, '123456'), true);
  assert.equal(authorizedOwnerPrivateChat(123456, -100123, '123456'), false);
  assert.equal(authorizedOwnerPrivateChat(123456, 123456, '1234567'), false);
});

test('owner request examples are extracted into typed intents without product IDs', () => {
  assert.deepEqual(fallbackOwnerIntent('Stok charger Type-C berapa?'), { kind: 'product_info', query: 'charger Type-C' });
  assert.deepEqual(fallbackOwnerIntent('Tambah charger Type-C 20 pcs, modal 19rb.'), {
    kind: 'stock_in', query: 'charger Type-C', quantity: 20, unitCost: '19rb', supplier: null,
  });
  assert.deepEqual(fallbackOwnerIntent('Ubah stok anti gores iPhone 11 jadi 35 pcs karena hasil opname.'), {
    kind: 'stock_adjust', query: 'anti gores iPhone 11', newStock: 35, reason: 'hasil opname.',
  });
  assert.deepEqual(fallbackOwnerIntent('Ubah harga jual charger 20W jadi 35rb.'), {
    kind: 'price_update', query: 'charger 20W', field: 'sellPrice', amount: '35rb',
  });
  assert.deepEqual(fallbackOwnerIntent('Barang mana yang stoknya hampir habis?'), { kind: 'low_stock' });
  const report = fallbackOwnerIntent('Berapa omzet dan laba toko hari ini?');
  assert.equal(report.kind, 'business_report_today');
  if (report.kind === 'business_report_today') assert.deepEqual({ date: report.date, shift: report.shift }, { date: null, shift: null });
});

test('unexplained stock changes remain incomplete and cannot be silently accepted', () => {
  const intent = validateOwnerIntent({ kind: 'stock_adjust', query: 'charger', newStock: 7 });
  assert.deepEqual(intent, { kind: 'stock_adjust', query: 'charger', newStock: 7, reason: null });
  assert.equal(validateOwnerIntent({ kind: 'price_update', query: 'charger', amount: '35rb', field: 'delete' }).kind, 'price_update');
  assert.equal(validateOwnerIntent({ kind: 'stock_in', query: 'charger', quantity: -4 }).kind, 'stock_in');
  assert.equal(validateOwnerIntent({ kind: 'unknown' }).kind, 'unknown');
});

test('IDR parser handles explicit Indonesian units and refuses ambiguous decimals', () => {
  assert.equal(parseOwnerRupiah('19rb'), 19_000n);
  assert.equal(parseOwnerRupiah('2,5jt'), 2_500_000n);
  assert.equal(parseOwnerRupiah('1.500'), 1_500n);
  assert.equal(parseOwnerRupiah('1,5'), null);
  assert.equal(parseOwnerRupiah('35rb?'), null);
  assert.equal(parseOwnerRupiah('9999999999999'), null);
});
