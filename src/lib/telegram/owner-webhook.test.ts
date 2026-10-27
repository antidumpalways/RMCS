import test from 'node:test';
import assert from 'node:assert/strict';

let middlewareInstalled = false;
let productReadCount = 0;
let businessWriteCounts = { product: 0, movement: 0 };
let throwCatalogQuery = false;
let fakeProducts: unknown[] = [];
let draftSequence = 0;
const fakeDrafts = new Map<string, Record<string, unknown>>();
async function modules() {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  const [{ prisma }, bot] = await Promise.all([import('../prisma'), import('./bot')]);
  if (!middlewareInstalled) {
    prisma.$use(async (params, next) => {
      if (params.model === 'TelegramUpdate') return params.args.data ?? {};
      if (params.model === 'TelegramDraft') {
        if (params.action === 'findUnique') return fakeDrafts.get(String(params.args.where.id)) ?? null;
        if (params.action === 'upsert') {
          const id = String(params.args.where.id), row = fakeDrafts.get(id) ?? { id, ...params.args.create };
          fakeDrafts.set(id, { ...row, ...params.args.update }); return fakeDrafts.get(id);
        }
        if (params.action === 'create') {
          const id = `owner-proposal-${++draftSequence}`, row = { id, ...params.args.data };
          fakeDrafts.set(id, row); return { id };
        }
        if (params.action === 'updateMany') {
          const id = params.args.where.id ? String(params.args.where.id) : null, row = id ? fakeDrafts.get(id) : null;
          if (!row || (params.args.where.status && row.status !== params.args.where.status)) return { count: 0 };
          fakeDrafts.set(id!, { ...row, ...params.args.data }); return { count: 1 };
        }
        if (params.action === 'update') {
          const id = String(params.args.where.id), row = fakeDrafts.get(id) ?? { id };
          fakeDrafts.set(id, { ...row, ...params.args.data }); return fakeDrafts.get(id);
        }
      }
      if (params.model === 'Product' && params.action === 'findMany') {
        productReadCount++;
        if (throwCatalogQuery) throw new Error('synthetic database failure with private details');
        return fakeProducts;
      }
      if (params.model === 'Product' && params.action === 'update') { businessWriteCounts.product++; return {}; }
      if (params.model === 'InventoryMovement' && params.action === 'create') { businessWriteCounts.movement++; return {}; }
      return next(params);
    });
    middlewareInstalled = true;
  }
  return { prisma, handleTelegramWebhook: bot.handleTelegramWebhook };
}

function privateUpdate(updateId: number, text: string) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: 700123, type: 'private' },
    from: { id: 700123, first_name: 'Owner' }, text } };
}

async function withTelegramFetch<T>(fn: (sent: Array<Record<string, unknown>>) => Promise<T>, deepseekContent?: string | string[]) {
  const original = globalThis.fetch;
  const sent: Array<Record<string, unknown>> = [];
  let deepseekIndex = 0;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('api.deepseek.com')) {
      if (!deepseekContent) return new Response('unexpected DeepSeek call', { status: 503 });
      const content = Array.isArray(deepseekContent) ? deepseekContent[Math.min(deepseekIndex++, deepseekContent.length - 1)] : deepseekContent;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200,
        headers: { 'content-type': 'application/json' } });
    }
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200,
      headers: { 'content-type': 'application/json' } });
  };
  try { return await fn(sent); }
  finally { globalThis.fetch = original; delete process.env.TELEGRAM_BOT_TOKEN; }
}

async function webhook(handleTelegramWebhook: (request: Request) => Promise<{ status: number; body: unknown }>, update: unknown) {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
  return handleTelegramWebhook(new Request('https://example.test/api/telegram/webhook', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'test-secret', 'content-type': 'application/json' },
    body: JSON.stringify(update),
  }));
}

test('Telegram update-to-response: /whoami works without the owner allowlist and reveals only its sender ID', async t => {
  const { handleTelegramWebhook } = await modules();
  delete process.env.TELEGRAM_OWNER_IDS;
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(901, '/whoami'));
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'ID Telegram Anda: 700123. Kirim angka ini kepada owner bila perlu ditambahkan sebagai owner bot.');
    assert.equal(sent[0].chat_id, '700123');
  });
});

test('Telegram update-to-response: owner actions fail closed when allowlist is empty', async t => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '';
  productReadCount = 0;
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(902, 'tambah charger 20 pcs modal 19rb'));
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].text), /hanya tersedia untuk owner yang telah diotorisasi/);
    assert.equal(productReadCount, 0);
  });
});

test('Telegram update-to-response: DeepSeek outage gets a safe response and no catalog lookup', async t => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  delete process.env.DEEPSEEK_API_KEY;
  productReadCount = 0;
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(903, 'tmbahin charger zbox 20 pcs, harga 50rb margin 20rb'));
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].text), /gangguan sementara/);
    assert.match(String(sent[0].text), /belum ada perubahan usaha yang diterapkan/);
    assert.equal(productReadCount, 0);
  });
});

test('AI failure preserves the existing pending proposal and its confirmation draft', async () => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  process.env.DEEPSEEK_API_KEY = 'test-api-key';
  fakeDrafts.clear();
  const proposal = { kind: 'propose_price_update', query: 'charger zbox', field: 'sellPrice', amount: '50rb' };
  const statePayload = { version: 1, ownerId: '700123', history: [], actions: [proposal], selected: [], pendingMatches: [],
    proposalDraftId: 'owner-proposal-existing', preview: 'Rencana lama: harga jual Rp40.000 → Rp50.000.' };
  fakeDrafts.set('owner-agent-700123', { id: 'owner-agent-700123', chatId: 700123n, kind: 'OWNER_CONVERSATION',
    payload: statePayload, status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) });
  const oldDraft = { id: 'owner-proposal-existing', chatId: 700123n, kind: 'OWNER_OPERATION', payload: { version: 2 },
    status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) };
  fakeDrafts.set(oldDraft.id, oldDraft);
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(909, 'eh ubah lagi jadi 55rb'));
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].text), /gangguan sementara/);
    assert.equal(fakeDrafts.get(oldDraft.id)?.status, 'PENDING');
    assert.deepEqual(fakeDrafts.get('owner-agent-700123')?.payload, statePayload);
    assert.equal(fakeDrafts.get('owner-agent-700123')?.status, 'PENDING');
  });
});

test('catalog database errors are logged by sanitized stage and do not leak exception text', async () => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  process.env.DEEPSEEK_API_KEY = 'test-api-key';
  fakeDrafts.clear();
  throwCatalogQuery = true;
  const originalError = console.error;
  const diagnostics: string[] = [];
  console.error = (...args: unknown[]) => { diagnostics.push(args.map(String).join(' ')); };
  const ai = JSON.stringify({ reply: 'Saya periksa.', clarification: null, actions: [
    { kind: 'get_product_details', query: 'axis 13gb' },
  ] });
  try {
    await withTelegramFetch(async sent => {
      const result = await webhook(handleTelegramWebhook, privateUpdate(910, 'cek stok axis 13gb'));
      assert.equal(result.status, 200);
      assert.equal(sent.length, 1);
      assert.match(String(sent[0].text), /belum berhasil memeriksa/);
    }, ai);
  } finally {
    console.error = originalError;
    throwCatalogQuery = false;
  }
  assert.ok(diagnostics.some(line => line.includes('"stage":"product_catalog_lookup"') && line.includes('"category":"database_error"')));
  assert.equal(diagnostics.some(line => line.includes('synthetic database failure') || line.includes('cek stok axis 13gb')), false);
});

test('Telegram update-to-response: natural multi-field stock request creates one preview but no business write before confirmation', async () => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  process.env.DEEPSEEK_API_KEY = 'test-api-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-flash';
  fakeProducts = [{ id: 7, name: 'Charger Zbox', sku: 'CZ-1', provider: null, validity: null, stock: 4, minStock: 2,
    costPrice: 25_000n, sellPrice: 40_000n, locationId: null, updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    category: { name: 'Aksesoris' }, location: null }];
  businessWriteCounts = { product: 0, movement: 0 };
  fakeDrafts.clear();
  const deepseek = JSON.stringify({ reply: 'Saya siapkan rencana.', clarification: null, actions: [
    { kind: 'propose_stock_in', query: 'charger zbox', quantity: 20, unitCost: null, sellPrice: '50rb', margin: '20rb', supplier: null },
  ] });
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(904, 'tambah stok charger zbox 20 pcs, harga 50rb margin 20rb'));
    assert.equal(result.status, 200);
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].text), /diturunkan dari jual Rp\s50\.000 − margin Rp\s20\.000/);
    assert.match(String(sent[0].text), /Belum ada yang diubah/);
    const keyboard = sent[0].reply_markup as { inline_keyboard?: Array<Array<{ callback_data: string }>> };
    assert.match(keyboard.inline_keyboard?.[0]?.[0]?.callback_data ?? '', /^rcms:owner:confirm:/);
    assert.equal(businessWriteCounts.product, 0);
    assert.equal(businessWriteCounts.movement, 0);
  }, deepseek);
});

test('Telegram follow-up correction revises the persistent preview instead of duplicating the old operation', async () => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  process.env.DEEPSEEK_API_KEY = 'test-api-key';
  fakeDrafts.clear(); draftSequence = 0;
  fakeProducts = [{ id: 7, name: 'Charger Zbox', sku: 'CZ-1', provider: null, validity: null, stock: 4, minStock: 2,
    costPrice: 25_000n, sellPrice: 40_000n, locationId: null, updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    category: { name: 'Aksesoris' }, location: null }];
  const initial = JSON.stringify({ reply: 'Rencana awal.', clarification: null, actions: [
    { kind: 'propose_stock_in', query: 'charger zbox', quantity: 20, unitCost: null, sellPrice: '50rb', margin: '20rb', supplier: null },
  ] });
  const corrected = JSON.stringify({ reply: 'Harga jual diperbarui.', clarification: null, actions: [
    { kind: 'propose_stock_in', query: 'charger zbox', quantity: 20, unitCost: null, sellPrice: '55rb', margin: '20rb', supplier: null },
  ] });
  await withTelegramFetch(async sent => {
    await webhook(handleTelegramWebhook, privateUpdate(905, 'tambah charger zbox 20 pcs, harga 50rb margin 20rb'));
    await webhook(handleTelegramWebhook, privateUpdate(906, 'eh harga jualnya 55rb aja'));
    assert.equal(sent.length, 2);
    assert.match(String(sent[1].text), /Harga jual Rp\s40\.000 → Rp\s55\.000/);
    const drafts = [...fakeDrafts.values()].filter(row => row.kind === 'OWNER_OPERATION');
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].status, 'CANCELLED');
    assert.equal(drafts[1].status, 'PENDING');
    const batch = drafts[1].payload as { operations: Array<{ kind: string; proposed: Record<string, unknown> }> };
    assert.equal(batch.operations.find(operation => operation.kind === 'STOCK_IN')?.proposed.unitCost, '35000');
    assert.equal(batch.operations.find(operation => operation.kind === 'PRICE_UPDATE')?.proposed.amount, '55000');
    assert.deepEqual(businessWriteCounts, { product: 0, movement: 0 });
  }, [initial, corrected]);
});

test('ambiguous owner product stays unresolved until a Telegram choice, then receives one confirmation preview', async () => {
  const { handleTelegramWebhook } = await modules();
  process.env.TELEGRAM_OWNER_IDS = '700123';
  process.env.DEEPSEEK_API_KEY = 'test-api-key';
  fakeDrafts.clear(); draftSequence = 0;
  const base = { sku: null, provider: null, validity: null, stock: 5, minStock: 1, costPrice: 2_000n, sellPrice: 5_000n,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'), locationId: null, category: { name: 'Aksesoris' }, location: null };
  fakeProducts = [{ ...base, id: 12, name: 'Anti Gores iPhone 12' }, { ...base, id: 13, name: 'Anti Gores iPhone 13' }];
  businessWriteCounts = { product: 0, movement: 0 };
  const deepseek = JSON.stringify({ reply: 'Saya siapkan perubahan.', clarification: null, actions: [
    { kind: 'propose_price_update', query: 'anti gores', field: 'sellPrice', amount: '15rb' },
  ] });
  await withTelegramFetch(async sent => {
    const result = await webhook(handleTelegramWebhook, privateUpdate(907, 'ubah harga anti gores jadi 15rb'));
    assert.equal(result.status, 200);
    const choiceKeyboard = sent[0].reply_markup as { inline_keyboard?: Array<Array<{ callback_data: string }>> };
    const pickData = choiceKeyboard.inline_keyboard?.[0]?.[0]?.callback_data;
    assert.match(pickData ?? '', /^rcms:owner:pick:/);
    assert.equal([...fakeDrafts.values()].filter(row => row.kind === 'OWNER_OPERATION').length, 0);
    const callbackResult = await webhook(handleTelegramWebhook, { update_id: 908, callback_query: { id: 'callback-908',
      from: { id: 700123, first_name: 'Owner' }, data: pickData,
      message: { message_id: 100, chat: { id: 700123, type: 'private' } } } });
    assert.equal(callbackResult.status, 200);
    const preview = sent.find(payload => typeof payload.text === 'string' && String(payload.text).includes('Harga jual Rp'));
    assert.ok(preview);
    assert.match(String(preview.text), /Rp\s5\.000 → Rp\s15\.000/);
    assert.match(String(preview.text), /Belum ada yang diubah/);
    assert.equal(businessWriteCounts.product, 0);
    assert.equal(businessWriteCounts.movement, 0);
  }, deepseek);
});
