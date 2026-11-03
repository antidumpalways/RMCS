import assert from 'node:assert/strict';
import test from 'node:test';
import { formatOwnerDigest } from './owner-digest';

const empty = { sale: 0n, serviceFee: 0n, expense: 0n, count: 0 };

test('laporan harian menandai hari tanpa rekap dan tetap menampilkan stok menipis', () => {
  const text = formatOwnerDigest({ dateLabel: '2026-11-03', recap: empty, sold: [], itemMoney: 0n, balance: 25168000n, lateEntries: 0,
    lowStock: [{ name: 'Axis 13GB', stock: 1, minStock: 3 }] });
  assert.ok(text.includes('Belum ada rekap shift hari ini'));
  assert.ok(text.includes('Axis 13GB: 1 (minimum 3)'));
  assert.ok(text.includes('Saldo sekarang'));
});

test('laporan harian merangkum rekap, barang terjual, dan susulan', () => {
  const text = formatOwnerDigest({ dateLabel: '2026-11-03', recap: { sale: 0n, serviceFee: 200000n, expense: 50000n, count: 2 },
    sold: [{ name: 'Voucher Telkomsel 7GB/5 Hari', qty: 5 }], itemMoney: 125000n, balance: null, lateEntries: 1, lowStock: [] });
  assert.ok(text.includes('Rekap shift disimpan: 2'));
  assert.ok(text.includes('Voucher Telkomsel 7GB/5 Hari — 5 pcs'));
  assert.ok(text.includes('Susulan dicatat: 1'));
  assert.equal(text.includes('Saldo sekarang'), false);
});
