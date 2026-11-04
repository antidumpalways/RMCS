import assert from 'node:assert/strict';
import test from 'node:test';
import { isImplicitCatalogQuestion, lateEntryText, looksLikeCatalogQuestion, removeBotMention, splitRecapStart, stripRecapHeader } from './group-routing';
import { answerTelegramCallback, sendTelegramLongMessage, tryAnswerTelegramCallback } from './client';
import { inventoryCallback, normalizeStockUnit, parseInventoryCallback, parseStockCountLines, resolveInventoryProduct } from './inventory';
import { planLateEntry } from './late-entry-plan';
import { strictProductMatch } from './product-match';
import { applySpecReplacement, specPairs, swapSpec } from './spec-swap';
import { applyExtraction, cleanItemLabel, inputDuplicateKey, deterministicExtraction, emptyRecap, parseIndonesianRupiah, recapIssues } from './recap';

test('catatan penjualan bukan pertanyaan katalog, pertanyaan harga/stok tetap ke asisten', () => {
  assert.equal(looksLikeCatalogQuestion('Axis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs'), false);
  assert.equal(looksLikeCatalogQuestion('Barang terjual\nAxis 13 gb 7 hari: 2 pcs'), false);
  assert.equal(looksLikeCatalogQuestion('Rokok 3 bungkus'), false);
  assert.equal(looksLikeCatalogQuestion('harga axis 13gb berapa?'), true);
  assert.equal(looksLikeCatalogQuestion('cek stok charger type c'), true);
  assert.equal(looksLikeCatalogQuestion('ada kabel data?'), true);
});

test('judul "Rekap" atau "Barang terjual" dibuang bila ada isi di bawahnya', () => {
  assert.equal(stripRecapHeader('Rekap\nAxis 13 gb 7 hari: 2 pcs'), 'Axis 13 gb 7 hari: 2 pcs');
  assert.equal(stripRecapHeader('Barang terjual\nAxis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs'), 'Axis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs');
  assert.equal(stripRecapHeader('Rekap'), 'Rekap');
  assert.equal(stripRecapHeader('Admin 45rb'), 'Admin 45rb');
});

test('pesan "rekap" dengan isi di baris berikutnya membuka rekap sekaligus mencatat isinya', () => {
  assert.deepEqual(splitRecapStart('Rekap\nAxis 13 gb 7 hari: 2 pcs'), { shiftLabel: null, rest: 'Axis 13 gb 7 hari: 2 pcs' });
  assert.deepEqual(splitRecapStart('mau rekap shift malam'), { shiftLabel: 'malam', rest: '' });
  assert.equal(splitRecapStart('Axis 13 gb: 2 pcs'), null);
});

test('baris barang bernama panjang terbaca tanpa AI', () => {
  const x = deterministicExtraction('Axis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs');
  assert.deepEqual(x.inventoryLines?.map(line => [line.label, line.quantity, line.unit]), [['Axis 13 gb 7 hari', '2', 'pcs'], ['Telkomsel 7gb 5 hari', '2', 'pcs']]);
  assert.equal(x.entries.length, 0);
});

test('menghapus mention bot tidak menggabungkan baris rekap', () => {
  assert.equal(removeBotMention('@RCell25_Bot Rekap\nAxis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs', 'rcell25_bot'), 'Rekap\nAxis 13 gb 7 hari: 2 pcs\nTelkomsel 7gb 5 hari : 2 pcs');
  assert.equal(removeBotMention('Axis: 2 pcs\nTelkomsel: 2 pcs', ''), 'Axis: 2 pcs\nTelkomsel: 2 pcs');
});

test('menambah catatan tidak menghilangkan id pesan draf yang sedang aktif', () => {
  const draft = { ...emptyRecap(), draftMessageId: 321 };
  const next = applyExtraction(draft, deterministicExtraction('Admin 45rb'), 'Admin 45rb', 'u1');
  assert.equal(next.draftMessageId, 321);
});

test('pesan tanpa angka tidak memblokir rekap yang sudah berisi barang', () => {
  const withItems = applyExtraction(emptyRecap(), deterministicExtraction('Axis 13 gb 7 hari: 2 pcs'), 'Axis 13 gb 7 hari: 2 pcs', 'u1');
  const afterChatter = applyExtraction(withItems, { entries: [], unresolved: ['Belum ada nominal rekap yang terbaca.'] }, 'oke', 'u2');
  assert.equal(recapIssues(afterChatter).includes('Belum ada nominal rekap yang terbaca.'), false);
});

test('susulan dikenali hanya bila diawali kata susulan atau lupa catat', () => {
  assert.equal(lateEntryText('susulan Axis 13gb 7 hari 1 pcs'), 'Axis 13gb 7 hari 1 pcs');
  assert.equal(lateEntryText('Susulan: admin 5rb'), 'admin 5rb');
  assert.equal(lateEntryText('lupa catat rokok 2 bungkus'), 'rokok 2 bungkus');
  assert.equal(lateEntryText('susulan'), '');
  assert.equal(lateEntryText('hp saya ketinggalan di rumah'), null);
  assert.equal(lateEntryText('Axis 13gb 1 pcs'), null);
});

test('beberapa barang dalam satu baris dipecah, bukan jadi satu barang palsu', () => {
  const x = deterministicExtraction('Axis 13 gb 7 hari: 2 pcs Telkomsel 7gb 5 hari : 2 pcs');
  assert.deepEqual(x.inventoryLines?.map(line => [line.label, line.quantity]), [['Axis 13 gb 7 hari', '2'], ['Telkomsel 7gb 5 hari', '2']]);
});

test('tombol hapus baris barang valid dan muat di batas callback Telegram', () => {
  const data = inventoryCallback('remove', 'cmr1234567890123456789012', '3', '-', 12);
  assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
  assert.equal(parseInventoryCallback(data)?.action, 'remove');
});

test('jawaban tombol yang kedaluwarsa tidak menggagalkan pemrosesan pesan', async () => {
  const original = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: query is too old' }), { status: 400 });
  try {
    assert.equal(await tryAnswerTelegramCallback('q1', 'x'), false);
    await assert.doesNotReject(answerTelegramCallback('q1', 'x'));
  } finally {
    globalThis.fetch = original;
  }
});

test('koreksi tanpa baris sebelumnya tidak hilang diam-diam: peringatan muncul di draf', () => {
  const draft = applyExtraction(emptyRecap(), deterministicExtraction('axis salah bukan 7 pcs tapi 5 pcs'), 'axis salah bukan 7 pcs tapi 5 pcs', 'u1');
  assert.ok(draft.unresolved.some(item => item.includes('axis')));
  assert.equal(draft.inventoryLines?.length, 0);
});

test('peringatan lama untuk sebuah barang hilang setelah barang itu berhasil ditulis', () => {
  const warned = applyExtraction(emptyRecap(), deterministicExtraction('axis salah bukan 7 pcs tapi 5 pcs'), 'x', 'u1');
  const fixed = applyExtraction(warned, deterministicExtraction('axis: 5 pcs'), 'axis: 5 pcs', 'u2');
  assert.equal(fixed.unresolved.length, 0);
  assert.equal(fixed.inventoryLines?.[0].quantity, 5);
});

test('barang tidak dicocokkan otomatis bila ada kata atau angka yang tidak cocok', () => {
  const mk = (id: number, name: string, validity: string) => ({ id, name, sku: null, provider: 'Axis', validity, categoryName: 'Voucher', stock: 10, locationId: null });
  const single = [mk(1, 'Voucher Axis 13GB', '7 hari')];
  assert.equal(resolveInventoryProduct('axis 8gb', single).status, 'AMBIGUOUS');
  const two = [mk(1, 'Voucher Axis 13GB', '7 hari'), mk(2, 'Voucher Axis 3GB', '3 hari')];
  assert.notEqual(resolveInventoryProduct('axis 13gb 10 hari', two).productId, 1);
  assert.equal(resolveInventoryProduct('axis 13gb 7 hari', two).productId, 1);
});

test('satuan bungkus dan pack dihitung sebagai pcs', () => {
  assert.equal(normalizeStockUnit('bungkus'), 'pcs');
  assert.equal(normalizeStockUnit('pack'), 'pcs');
  assert.equal(normalizeStockUnit('box'), null);
});

test('menambah catatan mempertahankan id pesan draf dan pesan pilihan barang', () => {
  const draft = { ...emptyRecap(), draftMessageId: 11, choiceMessageId: 12 };
  const next = applyExtraction(draft, deterministicExtraction('Admin 45rb'), 'Admin 45rb', 'u9');
  assert.equal(next.draftMessageId, 11);
  assert.equal(next.choiceMessageId, 12);
});

test('callback pilih barang untuk id produk besar tetap muat dan terbaca', () => {
  const data = inventoryCallback('select', 'cmr1234567890123456789012', '7', '2147483647', 2147483647);
  assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
  assert.deepEqual([parseInventoryCallback(data)?.action, parseInventoryCallback(data)?.lineIndex, parseInventoryCallback(data)?.value], ['select', 7, '2147483647']);
});

test('obrolan tanpa angka bukan susulan, dan kalimat rekap dengan awalan ada/stok bukan pertanyaan katalog', () => {
  assert.equal(lateEntryText('lupa rekap tadi, maaf ya'), null);
  assert.equal(lateEntryText('susulan ya'), null);
  assert.equal(looksLikeCatalogQuestion('ada selisih admin 5rb'), false);
  assert.equal(looksLikeCatalogQuestion('ada tf 500rb'), false);
  assert.equal(looksLikeCatalogQuestion('Stok Axis tinggal 5'), false);
  assert.equal(looksLikeCatalogQuestion('stok axis 13gb ada?'), true);
  assert.equal(looksLikeCatalogQuestion('cek stok charger'), true);
});

test('saldo akhir ditulis dalam berbagai urutan kata tetap terbaca', () => {
  for (const text of ['saldo akhir total 26jt', 'saldo total akhir 26jt', 'Saldo akhir 26jt', 'total saldo 26jt', 'saldo total: 26.000.000']) {
    const x = deterministicExtraction(text);
    assert.equal(parseIndonesianRupiah(x.entries.find(entry => entry.category === 'total_balance')?.amount ?? ''), 26000000n, text);
    assert.equal(x.unresolved.length, 0, text);
  }
});

test('selisih stok akhir: nama longgar dicocokkan, nomor tetap diterima, nama asing dilaporkan', () => {
  const lines = [
    { productId: 1, name: 'Paket Data 13GB Axis', sku: null, provider: 'Axis', actualQty: 4, expectedQty: 4 },
    { productId: 2, name: 'Voucher Telkomsel 7GB/5 Hari', sku: null, provider: 'Telkomsel', actualQty: 18, expectedQty: 18 },
    { productId: 3, name: 'Surya 12', sku: null, provider: null, actualQty: 30, expectedQty: 30 },
  ];
  const ok = parseStockCountLines('Axis 13GB 3', lines);
  assert.deepEqual([...ok.updates], [[1, 3]]);
  assert.equal(ok.unknown.length, 0);
  assert.deepEqual([...parseStockCountLines('3 28', lines).updates], [[3, 28]]);
  assert.deepEqual([...parseStockCountLines('Surya 12 28 pcs', lines).updates], [[3, 28]]);
  assert.equal(parseStockCountLines('barang misterius 5', lines).unknown.length, 1);
});

test('peringatan "Kategori total" hilang setelah saldo ditulis dengan benar', () => {
  const stuck = { ...emptyRecap(), unresolved: ['Kategori total perlu diperjelas: omzet barang, volume jasa, atau biaya.'] };
  const fixed = applyExtraction(stuck, deterministicExtraction('saldo akhir 26jt'), 'saldo akhir 26jt', 'u1');
  assert.equal(recapIssues(fixed).some(item => item.includes('Kategori total')), false);
  assert.equal(recapIssues(fixed).some(item => item.includes('saldo akhir')), false);
});

test('susulan: stok dipotong, saldo hanya dari uang yang ditulis, stok kurang ditolak', () => {
  const line = (id: string, productId: number, quantity: number) => ({ id, sourceText: 'x', label: 'axis', quantity, unit: 'pcs', productId, candidateProductIds: [productId],
    mappingStatus: 'MATCHED' as const, coverage: 'UNRECORDED_ONLY' as const });
  const products = [{ id: 7, name: 'Voucher Telkomsel 7GB/5 Hari', stock: 13, sellPrice: 25000n }];
  const ok = planLateEntry([line('a', 7, 2)], 5000n, products);
  assert.equal(ok.status, 'OK');
  if (ok.status === 'OK') {
    assert.equal(ok.itemMoney, 50000n);
    assert.equal(ok.balanceDelta, 5000n);
    assert.equal(ok.groups[0].qty, 2);
  }
  const merged = planLateEntry([line('a', 7, 2), line('b', 7, 3)], 0n, products);
  assert.equal(merged.status === 'OK' ? merged.groups[0].qty : -1, 5);
  assert.equal(planLateEntry([line('a', 7, 14)], 0n, products).status, 'REFUSED');
  assert.equal(planLateEntry([{ ...line('a', 7, 1), mappingStatus: 'AMBIGUOUS' as const }], 0n, products).status, 'REFUSED');
  assert.equal(planLateEntry([], -20000n, products).status === 'OK' ? 'OK' : 'REFUSED', 'OK');
  assert.equal(planLateEntry([], 5_000_000n, products).status, 'REFUSED');
  assert.equal(planLateEntry([], -1_000_001n, products).status, 'REFUSED');
});

test('pertanyaan harga/stok tanpa tag bot ditangkap, catatan rekap dan obrolan tidak', () => {
  for (const text of ['harga axis 13gb berapa?', 'Axis 13gb 7 hari harganya berapa', 'berapaan charger type c', 'ada kabel data type c?', 'stok axis 13gb ada?', 'ready voucher telkomsel?']) {
    assert.equal(isImplicitCatalogQuestion(text), true, text);
  }
  for (const text of ['Axis 13 gb 7 hari: 2 pcs', 'Admin harga 45rb', 'saldo akhir 25.000.000', 'ada tf 500rb?', 'ada selisih admin 5rb', 'oke siap', 'harga axis\naxis 2 pcs', 'ada 2 pcs axis?', '/rekap']) {
    assert.equal(isImplicitCatalogQuestion(text.replace('\n', String.fromCharCode(10))), false, text);
  }
});

test('"rekap voucher telkomsel 7gb 5 hari laku 5 pcs" membuka rekap dan terbaca sebagai satu barang', () => {
  const started = splitRecapStart('rekap voucher telkomsel 7gb 5 hari laku 5 pcs');
  assert.equal(started?.rest, 'voucher telkomsel 7gb 5 hari laku 5 pcs');
  assert.equal(stripRecapHeader('rekap voucher telkomsel 7gb 5 hari laku 5 pcs'), 'voucher telkomsel 7gb 5 hari laku 5 pcs');
  const x = deterministicExtraction(started!.rest);
  assert.deepEqual(x.inventoryLines?.map(line => [line.label, line.quantity]), [['voucher telkomsel 7gb 5 hari', '5']]);
  const catalog = [
    { id: 1, name: 'Voucher Telkomsel 7GB/5 Hari', sku: null, provider: 'Telkomsel', validity: '5 hari', categoryName: 'Voucher', stock: 18, locationId: null },
    { id: 2, name: 'Telkomsel 5GB 3 Hari', sku: null, provider: 'Telkomsel', validity: '3 hari', categoryName: 'Voucher', stock: 60, locationId: null },
  ];
  assert.equal(resolveInventoryProduct('rekap voucher telkomsel 7gb 5 hari laku', catalog).productId, 1);
  assert.equal(splitRecapStart('rekap nanti jam 5 ya'), null);
  assert.equal(splitRecapStart('lapor pak saya sudah sampai'), null);
});

test('pesan rekap yang sama persis terdeteksi walau beda spasi dan tanda baca', () => {
  assert.equal(inputDuplicateKey('Voucher Telkomsel 7GB 5 hari: 5 pcs'), inputDuplicateKey('  voucher telkomsel 7gb 5 hari  5 PCS '));
  assert.notEqual(inputDuplicateKey('Axis 2 pcs'), inputDuplicateKey('Axis 3 pcs'));
});

test('label dari AI dibersihkan dari kata rekap dan laku', () => {
  assert.equal(cleanItemLabel('rekap voucher telkomsel 7gb 5 hari laku'), 'voucher telkomsel 7gb 5 hari');
  assert.equal(cleanItemLabel('Axis 13gb'), 'Axis 13gb');
});

test('pergantian spesifikasi: 10GB/3 hari jadi 8GB/3 hari mengubah produk yang sama', () => {
  assert.deepEqual(specPairs('10gb/3 hari', '8gb/3 hari'), [['10gb', '8gb']]);
  assert.equal(swapSpec('Paket Data 10GB Axis', '10gb', '8gb'), 'Paket Data 8gb Axis');
  assert.equal(swapSpec('Paket Data 10 GB Axis', '10gb', '8GB'), 'Paket Data 8GB Axis');
  assert.equal(swapSpec('Paket Data 13GB Axis', '3gb', '8gb'), null);
  const swapped = applySpecReplacement({ name: 'Paket Data 10GB Axis', validity: '3 hari' }, '10gb/3 hari', '8GB/3 hari');
  assert.equal(swapped.name, 'Paket Data 8GB Axis');
  assert.equal(swapped.nameChanged, true);
  assert.equal(swapped.validityChanged, false);
  const days = applySpecReplacement({ name: 'Voucher Telkomsel 5GB 3 Hari', validity: '3 hari' }, '3 hari', '5 hari');
  assert.equal(days.name, 'Voucher Telkomsel 5GB 5 Hari');
  assert.equal(days.validity, '5 hari');
  assert.equal(applySpecReplacement({ name: 'Axis 13GB', validity: null }, '99gb', '1gb').nameChanged, false);
});

test('susulan barang saja tidak mengubah saldo; yang tidak mengubah apa pun ditolak', () => {
  const products = [{ id: 7, name: 'Voucher Telkomsel 7GB/5 Hari', stock: 13, sellPrice: 25000n }];
  const line = { id: 'a', sourceText: 'x', label: 'axis', quantity: 1, unit: 'pcs', productId: 7, candidateProductIds: [7], mappingStatus: 'MATCHED' as const, coverage: 'UNRECORDED_ONLY' as const };
  const plan = planLateEntry([line], 0n, products);
  assert.equal(plan.status === 'OK' ? plan.balanceDelta : -1n, 0n);
  assert.equal(plan.status === 'OK' ? plan.itemMoney : -1n, 25000n);
  assert.equal(planLateEntry([], 0n, products).status, 'REFUSED');
});

test('"penjualan 45rb" terbaca sebagai uang penjualan tanpa AI', () => {
  const x = deterministicExtraction('penjualan 45rb');
  assert.equal(x.entries[0]?.category, 'sale');
  assert.equal(x.unresolved.length, 0);
});

test('pencocokan ketat: merek/varian berbeda tidak boleh dianggap produk yang sama', () => {
  const axis5 = { name: 'Paket Data 5GB Axis', provider: 'Axis', validity: '3 hari', sku: null };
  assert.equal(strictProductMatch('Paket Data AXIS 5GB/3 Hari', axis5), true);
  assert.equal(strictProductMatch('Tri 5GB 3 hari', axis5), false);
  assert.equal(strictProductMatch('axis 8gb', axis5), false);
  const noDay = { name: 'Paket Data 13GB Axis', provider: 'Axis', validity: null, sku: null };
  assert.equal(strictProductMatch('Paket Data AXIS 13GB/7 hari', noDay), true);
  assert.equal(strictProductMatch('Kabel Data Type C', { name: 'Kabel Data Micro', provider: null, validity: null, sku: null }), false);
  assert.equal(strictProductMatch('AG-VY12', { name: 'Anti Gores', provider: null, validity: null, sku: 'ag-vy12' }), true);
});

test('voucher per hari: karyawan boleh menulis "axis 3 hari" atau menyebut kuota lama, tetap cocok ke "Axis 3 Hari"', () => {
  const mk = (id: number, name: string, validity: string) => ({ id, name, sku: null, provider: 'Axis', validity, categoryName: 'Voucher', stock: 10, locationId: null });
  const perDay = [mk(1, 'Axis 3 Hari', '3 hari'), mk(2, 'Axis 5 Hari', '5 hari'), mk(3, 'Axis 7 Hari', '7 hari'),
    { ...mk(9, 'Telkomsel 3 Hari', '3 hari'), provider: 'Telkomsel' }];
  assert.equal(resolveInventoryProduct('axis 3 hari', perDay).productId, 1);
  assert.equal(resolveInventoryProduct('Axis 13 gb 7 hari', perDay).productId, 3);
  assert.equal(resolveInventoryProduct('axis 10gb 3 hari', perDay).productId, 1);
  assert.equal(resolveInventoryProduct('telkomsel 3 hari', perDay).productId, 9);
  assert.equal(strictProductMatch('axis 13gb 7 hari', { name: 'Axis 7 Hari', provider: 'Axis', validity: '7 hari', sku: null }), true);
  assert.equal(strictProductMatch('tri 7 hari', { name: 'Axis 7 Hari', provider: 'Axis', validity: '7 hari', sku: null }), false);
});

test('kuota hari ini ikut dikenali: "axis 10gb 2 pcs" cocok ke Axis 3 Hari; kuota lama + hari tetap cocok', () => {
  const mk = (id: number, name: string, validity: string, quota: string) => ({ id, name, sku: null, provider: 'Axis', validity: validity + ' ' + quota, categoryName: 'Voucher', stock: 10, locationId: null });
  const catalog = [mk(1, 'Axis 3 Hari', '3 hari', '10GB'), mk(2, 'Axis 5 Hari', '5 hari', '6GB'), mk(3, 'Axis 7 Hari', '7 hari', '13GB')];
  assert.equal(resolveInventoryProduct('axis 10gb', catalog).productId, 1);
  assert.equal(resolveInventoryProduct('axis 13gb', catalog).productId, 3);
  assert.equal(resolveInventoryProduct('axis 3 hari', catalog).productId, 1);
  assert.equal(resolveInventoryProduct('axis 8gb 3 hari', catalog).productId, 1);
  const product = { name: 'Axis 3 Hari', provider: 'Axis', validity: '3 hari', sku: null, quota: '10GB' };
  assert.equal(strictProductMatch('axis 10gb', product), true);
  assert.equal(strictProductMatch('axis 3 hari', product), true);
  assert.equal(strictProductMatch('axis 99gb', product), false);
});

test('pesan panjang dipecah di bawah batas Telegram dan tombol hanya di potongan terakhir', async () => {
  const original = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const sent: Array<{ text: string; reply_markup?: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  };
  try {
    const text = Array.from({ length: 200 }, (_, index) => '• Barang nomor ' + index + ' — stok jadi ' + index + ' (perubahan berhasil dicatat)').join(String.fromCharCode(10));
    assert.ok(text.length > 4096);
    await sendTelegramLongMessage(1, text, { inline_keyboard: [[{ text: 'Batalkan', callback_data: 'x' }]] });
    assert.ok(sent.length >= 2);
    assert.ok(sent.every(message => message.text.length <= 3800));
    assert.equal(sent.filter(message => message.reply_markup).length, 1);
    assert.ok(sent[sent.length - 1].reply_markup);
    assert.equal(sent.map(message => message.text).join(String.fromCharCode(10)), text);
  } finally {
    globalThis.fetch = original;
  }
});
