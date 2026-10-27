import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveUnitCost, interpretOwnerTurn, OwnerAgentUnavailable, planStockInPricing, type OwnerAgentAction } from './owner-agent';

function jsonResponse(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status,
    headers: { 'content-type': 'application/json' } });
}

test('AI turn supports informal Indonesian and multiple structured actions', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const actions: OwnerAgentAction[] = [
    { kind: 'propose_stock_in', query: 'charger zbox', quantity: 20, unitCost: null, sellPrice: '50rb', margin: '20rb', supplier: null },
    { kind: 'propose_price_update', query: 'kabel data', field: 'sellPrice', amount: '15rb' },
  ];
  const turn = await interpretOwnerTurn({ text: 'tmbahin charger zbox 20 pcs, harga 50rb margin 20rb, kabel data jadi 15rb ya',
    history: [], currentActions: [], apiKey: 'test-only', fetcher: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return jsonResponse(JSON.stringify({ reply: 'Siap, saya siapkan dua perubahan untuk dicek.', clarification: null, actions }));
    } });
  assert.equal(turn.actions.length, 2);
  assert.equal(turn.actions[0].kind, 'propose_stock_in');
  assert.equal((requestBody?.response_format as { type?: string }).type, 'json_object');
  assert.match((requestBody?.messages as Array<{ content: string }>)[0].content, /harga 50rb, margin 20rb” means sellPrice=50rb/);
});

test('conversational correction receives earlier context and returns a replacement proposal', async () => {
  const previous = { kind: 'propose_price_update', query: 'charger zbox', field: 'sellPrice', amount: '50rb' };
  let requestMessages: Array<{ role: string; content: string }> = [];
  const turn = await interpretOwnerTurn({ text: 'eh harga jualnya 55rb aja',
    history: [{ role: 'user', content: 'Ubah harga charger zbox jadi 50rb.' },
      { role: 'assistant', content: 'Saya siapkan usulannya.' }],
    currentActions: [previous as OwnerAgentAction], apiKey: 'test-only', fetcher: async (_url, init) => {
      requestMessages = (JSON.parse(String(init?.body)).messages as typeof requestMessages);
      return jsonResponse(JSON.stringify({ reply: 'Harga jual saya ubah menjadi Rp55.000.', clarification: null,
        actions: [{ kind: 'propose_price_update', query: 'charger zbox', field: 'sellPrice', amount: '55rb' }] }));
    } });
  assert.equal(requestMessages.some(message => message.content.includes('Ubah harga charger zbox jadi 50rb.')), true);
  assert.equal(requestMessages.at(-1)?.content.includes('current_proposal'), true);
  assert.equal(turn.actions.length, 1);
  assert.equal(turn.actions[0].kind, 'propose_price_update');
  if (turn.actions[0].kind === 'propose_price_update') assert.equal(turn.actions[0].amount, '55rb');
});

test('margin example derives modal arithmetically without floating point', () => {
  assert.equal(deriveUnitCost(50_000n, 20_000n), 30_000n);
  assert.equal(deriveUnitCost(20_000n, 50_000n), null);
});

test('stock-in plan derives and discloses Rp30rb modal from Rp50rb selling price and Rp20rb margin', () => {
  const plan = planStockInPricing({ kind: 'propose_stock_in', query: 'charger zbox', quantity: 20,
    unitCost: null, sellPrice: '50rb', margin: '20rb', supplier: null });
  assert.equal(plan.unitCost, 30_000n);
  assert.equal(plan.sellPrice, 50_000n);
  assert.equal(plan.derived, true);
  assert.equal(plan.clarification, null);
  const inconsistent = planStockInPricing({ kind: 'propose_stock_in', query: 'charger zbox', quantity: 20,
    unitCost: '35rb', sellPrice: '50rb', margin: '20rb', supplier: null });
  assert.equal(inconsistent.unitCost, null);
  assert.equal(inconsistent.clarification !== null, true);
});

test('provider timeout and HTTP failures become a safe unavailable result', async () => {
  await assert.rejects(() => interpretOwnerTurn({ text: 'stok kabel berapa', history: [], currentActions: [], apiKey: 'test-only',
    fetcher: async () => new Response('unavailable', { status: 503 }) }), OwnerAgentUnavailable);
  await assert.rejects(() => interpretOwnerTurn({ text: 'stok kabel berapa', history: [], currentActions: [], apiKey: 'test-only', timeoutMs: 1,
    fetcher: async (_url, init) => { await new Promise((resolve, reject) => {
      const signal = init?.signal; signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }); return jsonResponse('{}'); } }), OwnerAgentUnavailable);
});

test('malformed structured output is rejected rather than interpreted as an action', async () => {
  await assert.rejects(() => interpretOwnerTurn({ text: 'hapus barang', history: [], currentActions: [], apiKey: 'test-only',
    fetcher: async () => jsonResponse('{not json}') }), OwnerAgentUnavailable);
});
