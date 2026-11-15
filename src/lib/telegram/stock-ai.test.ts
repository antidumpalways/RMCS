import assert from 'node:assert/strict';
import test from 'node:test';
import { matchLinesWithAi, narrowCatalog, validateAiMatches, type AiCatalogProduct } from './stock-ai';

const catalog: AiCatalogProduct[] = [
  { id: 1, name: 'Paket Data 5GB IM3', category: 'Voucher', provider: 'Indosat', validity: '3 hari', quota: null },
  { id: 2, name: 'Telkomsel 5 Hari (5GB)', category: 'Voucher', provider: 'Telkomsel', validity: '5 hari', quota: '5GB' },
  { id: 3, name: 'Telkomsel 5 Hari (7GB)', category: 'Voucher', provider: 'Telkomsel', validity: '5 hari', quota: '7GB' },
];
const lines = [{ index: 0, label: 'IM3 3 hari', group: null }, { index: 1, label: 'TELKOMSEL 5 hari', group: null }];

test('hanya jawaban yakin, id valid, dan indeks valid yang diterima', () => {
  assert.deepEqual(validateAiMatches({ matches: [
    { index: 0, productId: 1, confidence: 'high' },
    { index: 1, productId: 2, confidence: 'low' },
    { index: 1, productId: 99, confidence: 'high' },
    { index: 7, productId: 3, confidence: 'high' },
    { index: 0, productId: 3, confidence: 'high' },
  ] }, lines, catalog), [{ index: 0, productId: 1 }]);
  assert.deepEqual(validateAiMatches('rusak', lines, catalog), []);
  assert.deepEqual(validateAiMatches({ matches: [{ index: 1, productId: null, confidence: 'high' }] }, lines, catalog), []);
});

test('pencocok AI memakai jawaban model yang valid dan gagal dengan aman', async () => {
  const reply = (content: string) => (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;
  const ok = await matchLinesWithAi(lines, catalog, { apiKey: 'k', fetcher: reply(JSON.stringify({ matches: [{ index: 0, productId: 1, confidence: 'high' }, { index: 1, productId: null, confidence: 'low' }] })) });
  assert.deepEqual(ok, [{ index: 0, productId: 1 }]);
  assert.deepEqual(await matchLinesWithAi(lines, catalog, { apiKey: 'k', fetcher: (async () => new Response('x', { status: 503 })) as unknown as typeof fetch }), []);
  assert.deepEqual(await matchLinesWithAi(lines, catalog, { apiKey: 'k', fetcher: (async () => { throw new Error('timeout'); }) as unknown as typeof fetch }), []);
  assert.deepEqual(await matchLinesWithAi(lines, catalog, { apiKey: '' }), []);
});

test('katalog besar dipersempit ke barang yang relevan', () => {
  const big: AiCatalogProduct[] = Array.from({ length: 2000 }, (_, i) => ({ id: i + 10, name: `Barang ${i}`, category: 'Lain', provider: null, validity: null, quota: null }));
  const narrowed = narrowCatalog([...big, ...catalog], lines);
  assert.ok(narrowed.length < 50);
  assert.ok(narrowed.some(product => product.id === 1));
});
