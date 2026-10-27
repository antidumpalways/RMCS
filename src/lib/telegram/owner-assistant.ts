import { prisma } from '@/lib/prisma';
import { jakartaTodayBounds } from '@/lib/sale-chat';
import { catalogSearchTerms, rankCatalogProducts } from '@/lib/catalog-search';
import { respectsNumericAttributes, semanticCatalogSearch } from '@/lib/semantic-catalog';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { parseOwnerRupiah, telegramOwnerAuthorized, validateOwnerIntent, type OwnerIntent } from './owner-intent';
import { interpretOwnerTurn, planStockInPricing, type OwnerAgentAction, type OwnerChatMessage } from './owner-agent';

type OwnerMessage = { chat: { id: number; type: string }; from?: { id: number; first_name?: string; last_name?: string }; text?: string };
type OwnerCallback = { id: string; from: { id: number }; data?: string; message?: { chat: { id: number; type: string } } };
type CatalogProduct = {
  id: number; name: string; sku: string | null; provider: string | null; validity: string | null;
  stock: number; minStock: number; costPrice: bigint; sellPrice: bigint; locationId: number | null;
  updatedAt: Date; category: { name: string }; location: { name: string } | null;
};
type ExpectedProduct = { stock: number; costPrice: string; sellPrice: string; locationId: number | null; locationName: string | null; updatedAt: string };
type OwnerOperation = {
  version: 1; kind: 'STOCK_IN' | 'STOCK_ADJUST' | 'PRICE_UPDATE' | 'LOCATION_MOVE'; ownerId: string;
  productId: number; productName: string; expected: ExpectedProduct;
  proposed: { quantity?: number; unitCost?: string; supplier?: string | null; newStock?: number; reason?: string;
    field?: 'sellPrice' | 'costPrice'; amount?: string; targetLocationId?: number; targetLocationName?: string };
};
type OwnerSelection = { version: 1; intent: OwnerIntent; candidateIds: number[] };
type OwnerBatch = { version: 2; ownerId: string; operations: OwnerOperation[]; labels: string[] };
type OwnerChatState = { version: 1; ownerId: string; history: OwnerChatMessage[]; actions: OwnerAgentAction[];
  selected: Array<{ actionIndex: number; query: string; productId: number }>; pendingMatches: Array<{ actionIndex: number; query: string; candidateIds: number[] }>;
  proposalDraftId: string | null; preview: string | null };
const DRAFT_TTL = 15 * 60_000;
const CHAT_TTL = 7 * 24 * 60 * 60_000;
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatIdr = (value: bigint) => idr.format(value);

function expectedProduct(product: CatalogProduct): ExpectedProduct {
  return { stock: product.stock, costPrice: product.costPrice.toString(), sellPrice: product.sellPrice.toString(),
    locationId: product.locationId, locationName: product.location?.name ?? null, updatedAt: product.updatedAt.toISOString() };
}
function keyboard(rows: InlineKeyboard['inline_keyboard']): InlineKeyboard { return { inline_keyboard: rows }; }
function ownerActionKeyboard(draftId: string): InlineKeyboard {
  return keyboard([[{ text: 'Ya, terapkan perubahan', callback_data: 'rcms:owner:confirm:' + draftId }],
    [{ text: 'Batal', callback_data: 'rcms:owner:cancel:' + draftId }]]);
}
function candidateKeyboard(draftId: string, products: CatalogProduct[]): InlineKeyboard {
  return keyboard(products.slice(0, 5).map(product => [{
    text: product.name.slice(0, 55) + ' · stok ' + product.stock,
    callback_data: 'rcms:owner:select:' + draftId + ':' + product.id,
  }]));
}
function agentCandidateKeyboard(ownerId: number, actionIndex: number, products: CatalogProduct[]): InlineKeyboard {
  return keyboard(products.slice(0, 5).map(product => [{
    text: product.name.slice(0, 48) + ' · stok ' + product.stock,
    callback_data: `rcms:owner:pick:${ownerId}:${actionIndex}:${product.id}`,
  }]));
}

async function getCatalog(): Promise<CatalogProduct[]> {
  return prisma.product.findMany({
    take: 3001, orderBy: { name: 'asc' },
    select: { id: true, name: true, sku: true, provider: true, validity: true, stock: true, minStock: true, updatedAt: true,
      costPrice: true, sellPrice: true, locationId: true, category: { select: { name: true } }, location: { select: { name: true } } },
  });
}

export async function findProductCandidates(query: string, catalog: CatalogProduct[]): Promise<CatalogProduct[]> {
  const cleanSkuQuery = query.trim().replace(/^(?:sku|kode(?:\s+barang)?)\s*[:#-]?\s*/i, '');
  const normalizedSkuQuery = cleanSkuQuery.toLocaleLowerCase('id-ID');
  const skuMatches = catalog.filter(product => product.sku?.toLocaleLowerCase('id-ID') === normalizedSkuQuery ||
    (normalizedSkuQuery.length >= 3 && product.sku?.toLocaleLowerCase('id-ID').includes(normalizedSkuQuery)));
  if (skuMatches.length) return skuMatches.slice(0, 5);
  const terms = catalogSearchTerms(query);
  const ranked = rankCatalogProducts(catalog.map(product => ({ ...product, categoryName: product.category.name })), terms);
  if (ranked.length) {
    const best = ranked[0];
    const threshold = Math.max(0.65, best.score * 0.72);
    const eligible = ranked.filter(item => item.score >= threshold && item.matched >= Math.min(2, terms.length) &&
      respectsNumericAttributes(query, { id: item.product.id, name: item.product.name, categoryName: item.product.categoryName,
        provider: item.product.provider, validity: item.product.validity })).slice(0, 5);
    if (eligible.length) return eligible.map(item => catalog.find(product => product.id === item.product.id)!).filter(Boolean);
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || catalog.length > 3000) return [];
  try {
    const semantic = await semanticCatalogSearch(query, catalog.map(product => ({
      id: product.id, name: product.name, categoryName: product.category.name, provider: product.provider, validity: product.validity,
    })), apiKey);
    const ids = semantic.filter(match => match.confidence !== 'low').map(match => match.id).slice(0, 5);
    return ids.map(id => catalog.find(product => product.id === id)!).filter(Boolean);
  } catch { return []; }
}

function productDescription(product: CatalogProduct): string {
  const margin = product.sellPrice - product.costPrice;
  const marginPct = product.costPrice === 0n ? 'tidak tersedia (modal 0)' :
    ((Number(margin) / Number(product.costPrice)) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';
  return [
    '📦 ' + product.name + (product.sku ? ' · SKU ' + product.sku : ''),
    'Kategori: ' + product.category.name + (product.provider ? ' · ' + product.provider : '') + (product.validity ? ' · ' + product.validity : ''),
    'Stok: ' + product.stock + ' unit' + (product.location?.name ? ' · Lokasi: ' + product.location.name : ''),
    'Harga jual: ' + formatIdr(product.sellPrice),
    'Harga modal: ' + formatIdr(product.costPrice),
    'Margin kotor/unit: ' + formatIdr(margin) + ' (' + marginPct + ')',
  ].join('\n');
}

function reportedRecapTotal(payload: unknown, category: 'sale' | 'service_fee' | 'expense'): bigint {
  if (!payload || typeof payload !== 'object' || !('totals' in payload)) return 0n;
  const totals = (payload as { totals?: unknown }).totals;
  if (!totals || typeof totals !== 'object' || !(category in totals)) return 0n;
  const value = (totals as Record<string, unknown>)[category];
  return typeof value === 'string' && /^\d{1,16}$/.test(value) ? BigInt(value) : 0n;
}

async function saveSelection(chatId: bigint, intent: OwnerIntent, products: CatalogProduct[], kind: string): Promise<string> {
  const draft = await prisma.telegramDraft.create({
    data: { chatId, kind, payload: { version: 1, intent, candidateIds: products.map(product => product.id) },
      status: 'PENDING', expiresAt: new Date(Date.now() + DRAFT_TTL) },
    select: { id: true },
  });
  return draft.id;
}

async function createOperationDraft(chatId: bigint, operation: OwnerOperation, preview: string) {
  const draft = await prisma.telegramDraft.create({
    data: { chatId, kind: 'OWNER_OPERATION', payload: operation as object, status: 'PENDING', expiresAt: new Date(Date.now() + DRAFT_TTL) },
    select: { id: true },
  });
  return sendTelegramMessage(chatId, preview + '\n\nBelum ada perubahan. Tekan tombol untuk menerapkan, berlaku 15 menit.', ownerActionKeyboard(draft.id));
}

async function prepareProductIntent(chatId: bigint, ownerId: bigint, intent: OwnerIntent, product: CatalogProduct) {
  if (intent.kind === 'product_info') return sendTelegramMessage(chatId, productDescription(product));
  if (intent.kind === 'stock_in') {
    if (!intent.quantity || intent.quantity < 1) return sendTelegramMessage(chatId, 'Berapa jumlah barang yang masuk? Tulis jumlahnya, misalnya: tambah 20 pcs.');
    const cost = parseOwnerRupiah(intent.unitCost);
    if (cost === null || cost <= 0n) return sendTelegramMessage(chatId, 'Harga modal per unit belum jelas. Tulis nominalnya, misalnya “modal 19rb”.');
    if (product.stock + intent.quantity > 1_000_000) return sendTelegramMessage(chatId, 'Jumlah stok setelah barang masuk melewati batas sistem. Periksa kembali jumlahnya.');
    const operation: OwnerOperation = { version: 1, kind: 'STOCK_IN', ownerId: ownerId.toString(), productId: product.id,
      productName: product.name, expected: expectedProduct(product), proposed: { quantity: intent.quantity, unitCost: cost.toString(), supplier: intent.supplier } };
    return createOperationDraft(chatId, operation,
      'Barang masuk — ' + product.name + '\nStok: ' + product.stock + ' → ' + (product.stock + intent.quantity) + '\nModal/unit: ' + formatIdr(product.costPrice) + ' → ' + formatIdr(cost) +
      (intent.supplier ? '\nPemasok: ' + intent.supplier : ''));
  }
  if (intent.kind === 'stock_adjust') {
    if (intent.newStock === null) return sendTelegramMessage(chatId, 'Jumlah stok fisik belum jelas. Sebutkan jumlah akhirnya, misalnya “jadi 35 pcs”.');
    if (!intent.reason?.trim()) return sendTelegramMessage(chatId, 'Koreksi stok perlu alasan. Contoh: “karena hasil opname”.');
    if (intent.newStock === product.stock) return sendTelegramMessage(chatId, product.name + ' sudah memiliki stok ' + product.stock + ' unit. Tidak ada perubahan.');
    const operation: OwnerOperation = { version: 1, kind: 'STOCK_ADJUST', ownerId: ownerId.toString(), productId: product.id,
      productName: product.name, expected: expectedProduct(product), proposed: { newStock: intent.newStock, reason: intent.reason } };
    return createOperationDraft(chatId, operation,
      'Koreksi stok — ' + product.name + '\nStok sistem: ' + product.stock + ' → stok fisik: ' + intent.newStock + '\nAlasan: ' + intent.reason);
  }
  if (intent.kind === 'price_update') {
    if (!intent.field) return sendTelegramMessage(chatId, 'Harga yang ingin diubah belum jelas. Tulis “harga jual” atau “harga modal”.');
    const amount = parseOwnerRupiah(intent.amount);
    if (amount === null) return sendTelegramMessage(chatId, 'Nominal harga belum jelas. Contoh: “jadi 35rb”.');
    const oldPrice = intent.field === 'sellPrice' ? product.sellPrice : product.costPrice;
    if (oldPrice === amount) return sendTelegramMessage(chatId, 'Harga ' + product.name + ' sudah ' + formatIdr(amount) + '. Tidak ada perubahan.');
    const operation: OwnerOperation = { version: 1, kind: 'PRICE_UPDATE', ownerId: ownerId.toString(), productId: product.id,
      productName: product.name, expected: expectedProduct(product), proposed: { field: intent.field, amount: amount.toString() } };
    return createOperationDraft(chatId, operation,
      'Perubahan harga — ' + product.name + '\n' + (intent.field === 'sellPrice' ? 'Harga jual' : 'Harga modal') + ': ' + formatIdr(oldPrice) + ' → ' + formatIdr(amount));
  }
  if (intent.kind === 'location_move') {
    if (!intent.targetLocation) return sendTelegramMessage(chatId, 'Sebutkan lokasi tujuan, misalnya “pindah ke Gudang”.');
    const matches = await prisma.location.findMany({ where: { name: { contains: intent.targetLocation, mode: 'insensitive' } }, orderBy: { name: 'asc' }, take: 6 });
    if (matches.length !== 1) return sendTelegramMessage(chatId, matches.length
      ? 'Ada beberapa lokasi yang cocok: ' + matches.map(location => location.name).join(', ') + '. Kirim nama lokasi yang persis.'
      : 'Lokasi “' + intent.targetLocation + '” tidak ditemukan. Saya tidak membuat lokasi baru dari chat.');
    const location = matches[0];
    if (location.id === product.locationId) return sendTelegramMessage(chatId, product.name + ' sudah berada di ' + location.name + '.');
    const operation: OwnerOperation = { version: 1, kind: 'LOCATION_MOVE', ownerId: ownerId.toString(), productId: product.id,
      productName: product.name, expected: expectedProduct(product), proposed: { targetLocationId: location.id, targetLocationName: location.name } };
    return createOperationDraft(chatId, operation,
      'Pindah lokasi produk — ' + product.name + '\nLokasi: ' + (product.location?.name ?? 'belum ditentukan') + ' → ' + location.name +
      '\nStok fisik di RMCS tetap ' + product.stock + ' unit; model RMCS menyimpan satu lokasi per produk.');
  }
}

async function showBusinessReport(chatId: bigint, requestedDate: string | null, shift: string | null) {
  const today = jakartaTodayBounds();
  const date = requestedDate ?? today.date;
  const start = requestedDate ? new Date(requestedDate + 'T00:00:00+07:00') : today.start;
  const end = new Date(start.getTime() + 86_400_000);
  const shiftFilter = shift ? { user: { is: { shift: { equals: shift, mode: 'insensitive' as const } } } } : {};
  const [sales, services, expenses, productRows, recapReports] = await Promise.all([
    prisma.saleTransaction.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { totalRevenue: true, totalProfit: true } }),
    prisma.serviceTransaction.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { profit: true } }),
    prisma.expense.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { amount: true } }),
    prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { createdAt: { gte: start, lt: end }, ...shiftFilter } },
      _sum: { qty: true, revenue: true }, orderBy: { _sum: { revenue: 'desc' } }, take: 8 }),
    prisma.telegramShiftReport.findMany({ where: { confirmedAt: { gte: start, lt: end },
      ...(shift ? { shiftLabel: { equals: shift, mode: 'insensitive' as const } } : {}) }, select: { payload: true } }),
  ]);
  const salesRevenue = sales.reduce((sum, sale) => sum + sale.totalRevenue, 0n);
  const goodsProfit = sales.reduce((sum, sale) => sum + sale.totalProfit, 0n);
  const serviceProfit = services.reduce((sum, service) => sum + service.profit, 0n);
  const totalRevenue = salesRevenue + serviceProfit;
  const grossProfit = goodsProfit + serviceProfit;
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0n);
  const recapSales = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'sale'), 0n);
  const recapFees = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'service_fee'), 0n);
  const recapExpenses = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'expense'), 0n);
  const ids = productRows.map(row => row.productId);
  const names = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameById = new Map(names.map(product => [product.id, product.name]));
  const breakdown = productRows.map(row => '• ' + (nameById.get(row.productId) ?? 'Barang dihapus') + ': ' +
    (row._sum.qty ?? 0) + ' unit · ' + formatIdr(row._sum.revenue ?? 0n));
  return sendTelegramMessage(chatId, 'Ringkasan tercatat — ' + date + ' (WIB)' + (shift ? ' · shift ' + shift : '') + '\nOmzet barang + admin jasa: ' + formatIdr(totalRevenue) +
    '\nLaba kotor tercatat: ' + formatIdr(grossProfit) + '\nPengeluaran: ' + formatIdr(totalExpenses) +
    '\nLaba setelah pengeluaran: ' + formatIdr(grossProfit - totalExpenses) +
    '\n\nBarang teratas:\n' + (breakdown.length ? breakdown.join('\n') : 'Belum ada penjualan barang tercatat.') +
    '\n\nRekap shift Telegram terkonfirmasi (dilaporkan terpisah, tidak dijumlahkan):\nOmzet barang: ' + formatIdr(recapSales) +
    '\nAdmin jasa: ' + formatIdr(recapFees) + '\nPengeluaran: ' + formatIdr(recapExpenses) +
    '\nJumlah laporan: ' + recapReports.length +
    '\n\nLaba hanya dihitung dari transaksi yang menyimpan harga jual dan modal. Angka rekap agregat tidak digabung dengan transaksi Web App agar tidak menghitung ganda.');
}

async function showProductIntent(chatId: bigint, ownerId: number, intent: OwnerIntent) {
  if (intent.kind === 'low_stock') {
    const catalog = await getCatalog();
    if (catalog.length > 3000) return sendTelegramMessage(BigInt(ownerId), 'Katalog melebihi batas pemeriksaan stok minimum. Minta administrator meninjau laporan di Web App.');
    const products = catalog.filter(product => product.stock <= product.minStock).sort((a, b) => a.stock - b.stock);
    if (!products.length) return sendTelegramMessage(chatId, 'Tidak ada barang yang mencapai batas stok minimum saat ini.');
    return sendTelegramMessage(chatId, 'Barang dengan stok menipis/habis (' + products.length + '):\n' +
      products.slice(0, 25).map(product => '• ' + product.name.slice(0, 80) + ': ' + product.stock + ' (minimum ' + product.minStock + ')' +
        (product.location?.name ? ' · ' + product.location.name : '')).join('\n') +
      (products.length > 25 ? '\n…dan ' + (products.length - 25) + ' barang lainnya.' : ''));
  }
  if (intent.kind === 'inventory_value') {
    const products = await getCatalog();
    if (products.length > 3000) return sendTelegramMessage(chatId, 'Katalog melebihi batas kalkulasi laporan. Nilai persediaan belum dihitung.');
    const modal = products.reduce((sum, product) => sum + product.costPrice * BigInt(product.stock), 0n);
    const retail = products.reduce((sum, product) => sum + product.sellPrice * BigInt(product.stock), 0n);
    return sendTelegramMessage(chatId, 'Nilai persediaan saat ini (' + products.length + ' produk):\nModal stok: ' + formatIdr(modal) +
      '\nNilai jual stok: ' + formatIdr(retail) + '\nPotensi selisih jual-modal: ' + formatIdr(retail - modal));
  }
  if (intent.kind === 'business_report_today') return showBusinessReport(BigInt(ownerId), intent.date, intent.shift);
  if (intent.kind !== 'product_info' && intent.kind !== 'stock_in' && intent.kind !== 'stock_adjust' &&
      intent.kind !== 'price_update' && intent.kind !== 'location_move') {
    return sendTelegramMessage(BigInt(ownerId), 'Saya belum memahami maksudnya. Coba tanya stok/harga, barang masuk, koreksi stok beserta alasan, ubah harga, atau laporan hari ini.');
  }
  const catalog = await getCatalog();
  if (catalog.length > 3000) return sendTelegramMessage(BigInt(ownerId), 'Katalog melebihi batas pencarian. Minta administrator meninjau sebelum saya memilih barang.');
  const candidates = await findProductCandidates(intent.query, catalog);
  if (!candidates.length) return sendTelegramMessage(BigInt(ownerId), 'Saya belum menemukan barang yang cocok di katalog untuk “' + intent.query + '”. Saya tidak membuat barang atau memilih sendiri. Coba kirim nama, SKU, provider, atau kategori yang lebih spesifik.');
  if (candidates.length > 1) {
    const selectionKind = intent.kind === 'product_info' ? 'OWNER_SELECT_INFO' : 'OWNER_SELECT_WRITE';
    const draftId = await saveSelection(BigInt(ownerId), intent, candidates, selectionKind);
    return sendTelegramMessage(BigInt(ownerId), 'Saya menemukan beberapa barang yang mungkin cocok. Pilih barang yang tepat:', candidateKeyboard(draftId, candidates));
  }
  return prepareProductIntent(BigInt(ownerId), BigInt(ownerId), intent, candidates[0]);
}

async function claimPendingDraft(draftId: string, chatId: bigint, kind: string, now = new Date()) {
  return prisma.telegramDraft.updateMany({
    where: { id: draftId, chatId, kind, status: 'PENDING', expiresAt: { gt: now } },
    data: { status: 'PROCESSING' },
  });
}

function ownerConversationId(ownerId: number) { return 'owner-agent-' + ownerId; }
function parseOwnerChatState(value: unknown, ownerId: number): OwnerChatState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Partial<OwnerChatState>;
  if (state.version !== 1 || state.ownerId !== String(ownerId) || !Array.isArray(state.history) ||
      !Array.isArray(state.actions) || !Array.isArray(state.selected)) return null;
  return { version: 1, ownerId: String(ownerId), history: state.history.slice(-12), actions: state.actions,
    selected: state.selected, pendingMatches: Array.isArray(state.pendingMatches) ? state.pendingMatches : [],
    proposalDraftId: typeof state.proposalDraftId === 'string' ? state.proposalDraftId : null,
    preview: typeof state.preview === 'string' ? state.preview : null } as OwnerChatState;
}

async function getOwnerChatState(chatId: bigint, ownerId: number): Promise<{ rowId: string; state: OwnerChatState }> {
  const rowId = ownerConversationId(ownerId), now = new Date();
  const existing = await prisma.telegramDraft.findUnique({ where: { id: rowId } });
  const saved = existing && existing.kind === 'OWNER_CONVERSATION' && existing.chatId === chatId &&
    ['PENDING', 'PROCESSING'].includes(existing.status) && existing.expiresAt > now ? parseOwnerChatState(existing.payload, ownerId) : null;
  if (saved) return { rowId, state: saved };
  const initial: OwnerChatState = { version: 1, ownerId: String(ownerId), history: [], actions: [], selected: [],
    pendingMatches: [], proposalDraftId: null, preview: null };
  await prisma.telegramDraft.upsert({ where: { id: rowId },
    create: { id: rowId, chatId, kind: 'OWNER_CONVERSATION', payload: initial as object, status: 'PENDING', expiresAt: new Date(Date.now() + CHAT_TTL) },
    update: { chatId, kind: 'OWNER_CONVERSATION', payload: initial as object, status: 'PENDING', expiresAt: new Date(Date.now() + CHAT_TTL), confirmedAt: null },
  });
  return { rowId, state: initial };
}

async function saveOwnerChatState(rowId: string, chatId: bigint, state: OwnerChatState, status: 'PENDING' | 'PROCESSING' = 'PENDING') {
  await prisma.telegramDraft.update({ where: { id: rowId }, data: {
    chatId, kind: 'OWNER_CONVERSATION', payload: state as object, status, expiresAt: new Date(Date.now() + CHAT_TTL),
  } });
}

function actionQuery(action: OwnerAgentAction): string | null {
  return 'query' in action ? action.query : null;
}
function sameActions(left: OwnerAgentAction[], right: OwnerAgentAction[]) { return JSON.stringify(left) === JSON.stringify(right); }
function selectedProduct(state: OwnerChatState, index: number, query: string): number | null {
  return state.selected.find(item => item.actionIndex === index && item.query === query)?.productId ?? null;
}

function validateBatch(value: unknown): OwnerBatch | null {
  if (!value || typeof value !== 'object') return null;
  const batch = value as Partial<OwnerBatch>;
  if (batch.version !== 2 || !/^\d{1,20}$/.test(batch.ownerId ?? '') || !Array.isArray(batch.operations) ||
      !batch.operations.length || !Array.isArray(batch.labels) || batch.operations.length !== batch.labels.length ||
      !batch.operations.every(operation => parseOperation(operation) !== null) || !batch.labels.every(label => typeof label === 'string')) return null;
  return batch as OwnerBatch;
}

function makeOwnerOperation(ownerId: number, kind: OwnerOperation['kind'], product: CatalogProduct,
  proposed: OwnerOperation['proposed']): OwnerOperation {
  return { version: 1, kind, ownerId: String(ownerId), productId: product.id, productName: product.name,
    expected: expectedProduct(product), proposed };
}

export async function planOwnerOperations(action: OwnerAgentAction, product: CatalogProduct, ownerId: number):
  Promise<{ operations: OwnerOperation[]; labels: string[]; clarification?: string }> {
  if (action.kind === 'propose_stock_in') {
    if (!action.quantity || action.quantity < 1) return { operations: [], labels: [], clarification: `Berapa unit ${product.name} yang masuk?` };
    const pricing = planStockInPricing(action), sell = pricing.sellPrice, margin = parseOwnerRupiah(action.margin);
    if (pricing.clarification) return { operations: [], labels: [], clarification: `${pricing.clarification} Tolong pastikan angkanya.` };
    const cost = pricing.unitCost;
    if (cost === null || cost <= 0n) return { operations: [], labels: [], clarification: `Sebutkan modal per unit ${product.name}, atau harga jual dan margin per unit agar saya hitung modalnya.` };
    if (product.stock + action.quantity > 1_000_000) return { operations: [], labels: [], clarification: `Stok ${product.name} melewati batas sistem. Periksa jumlahnya.` };
    const operations = [makeOwnerOperation(ownerId, 'STOCK_IN', product,
      { quantity: action.quantity, unitCost: cost.toString(), supplier: action.supplier })];
    const labels = [`Barang masuk ${action.quantity} unit; stok ${product.stock} → ${product.stock + action.quantity}; modal/unit ${formatIdr(product.costPrice)} → ${formatIdr(cost)}${pricing.derived ? ` (diturunkan dari jual ${formatIdr(sell!)} − margin ${formatIdr(margin!)})` : ''}`];
    if (sell !== null && sell !== product.sellPrice) {
      operations.push(makeOwnerOperation(ownerId, 'PRICE_UPDATE', product, { field: 'sellPrice', amount: sell.toString() }));
      labels.push(`Harga jual ${formatIdr(product.sellPrice)} → ${formatIdr(sell)}${margin !== null ? `; margin/unit ${formatIdr(margin)} dipertahankan` : ''}`);
    }
    return { operations, labels };
  }
  if (action.kind === 'propose_stock_adjustment') {
    if (action.targetStock === null || !action.reason) return { operations: [], labels: [], clarification: `Sebutkan jumlah stok fisik dan alasan koreksi ${product.name}.` };
    if (action.targetStock === product.stock) return { operations: [], labels: [`Stok ${product.name} sudah ${product.stock}; tidak perlu diubah.`] };
    return { operations: [makeOwnerOperation(ownerId, 'STOCK_ADJUST', product, { newStock: action.targetStock, reason: action.reason })],
      labels: [`Koreksi stok ${product.stock} → ${action.targetStock}; alasan: ${action.reason}`] };
  }
  if (action.kind === 'propose_price_update') {
    const amount = parseOwnerRupiah(action.amount);
    if (amount === null || action.field === null) return { operations: [], labels: [], clarification: `Harga atau jenis perubahan untuk ${product.name} belum jelas.` };
    if (action.field === 'margin') {
      const sell = product.costPrice + amount;
      if (sell > 1_000_000_000_000n) return { operations: [], labels: [], clarification: `Hasil harga jual untuk ${product.name} melewati batas sistem.` };
      return { operations: [makeOwnerOperation(ownerId, 'PRICE_UPDATE', product, { field: 'sellPrice', amount: sell.toString() })],
        labels: [`Margin/unit ${formatIdr(product.sellPrice - product.costPrice)} → ${formatIdr(amount)}; harga jual ${formatIdr(product.sellPrice)} → ${formatIdr(sell)} (dihitung dari modal ${formatIdr(product.costPrice)} + margin)`] };
    }
    const current = action.field === 'sellPrice' ? product.sellPrice : product.costPrice;
    if (amount === current) return { operations: [], labels: [`${action.field === 'sellPrice' ? 'Harga jual' : 'Modal'} ${product.name} sudah ${formatIdr(amount)}.`] };
    return { operations: [makeOwnerOperation(ownerId, 'PRICE_UPDATE', product, { field: action.field, amount: amount.toString() })],
      labels: [`${action.field === 'sellPrice' ? 'Harga jual' : 'Modal'} ${formatIdr(current)} → ${formatIdr(amount)}`] };
  }
  if (action.kind === 'propose_location_change') {
    if (!action.location) return { operations: [], labels: [], clarification: `Lokasi tujuan ${product.name} belum disebutkan.` };
    const matches = await prisma.location.findMany({ where: { name: { contains: action.location, mode: 'insensitive' } }, orderBy: { name: 'asc' }, take: 6 });
    if (matches.length !== 1) return { operations: [], labels: [], clarification: matches.length
      ? `Saya menemukan beberapa lokasi untuk ${product.name}: ${matches.map(item => item.name).join(', ')}. Pilih satu nama lokasi.`
      : `Lokasi “${action.location}” tidak ditemukan. Saya tidak membuat lokasi baru.` };
    const location = matches[0];
    if (location.id === product.locationId) return { operations: [], labels: [`${product.name} sudah berada di ${location.name}.`] };
    return { operations: [makeOwnerOperation(ownerId, 'LOCATION_MOVE', product,
      { targetLocationId: location.id, targetLocationName: location.name })],
      labels: [`Lokasi ${product.location?.name ?? 'belum ditentukan'} → ${location.name}; stok fisik ${product.stock} tetap.`] };
  }
  return { operations: [], labels: [] };
}

async function createBatchDraft(chatId: bigint, ownerId: number, operations: OwnerOperation[], labels: string[]) {
  const batch: OwnerBatch = { version: 2, ownerId: String(ownerId), operations, labels };
  const row = await prisma.telegramDraft.create({ data: { chatId, kind: 'OWNER_OPERATION', payload: batch as object,
    status: 'PENDING', expiresAt: new Date(Date.now() + DRAFT_TTL) }, select: { id: true } });
  const preview = `Rencana perubahan (${operations.length} langkah):\n${operations.map((operation, index) =>
    `${index + 1}. ${operation.productName} — ${labels[index]}`).join('\n')}\n\nBelum ada yang diubah. Tinjau semua rincian lalu tekan tombol konfirmasi untuk menerapkan semuanya sekaligus.`;
  return { draftId: row.id, preview };
}

function queryForAction(action: OwnerAgentAction): string | null {
  if ('query' in action) return action.query;
  return null;
}

async function renderOwnerActions(chatId: bigint, ownerId: number, rowId: string, state: OwnerChatState,
  reply: string, priorActions: OwnerAgentAction[]) {
  const previousDraftId = state.proposalDraftId;
  const existing = previousDraftId ? await prisma.telegramDraft.findUnique({ where: { id: previousDraftId } }) : null;
  if (sameActions(priorActions, state.actions) && existing?.kind === 'OWNER_OPERATION' && existing.status === 'PENDING' && existing.expiresAt > new Date() && state.preview) {
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, `${reply}\n\n${state.preview}`, ownerActionKeyboard(previousDraftId!));
  }
  if (previousDraftId) await prisma.telegramDraft.updateMany({ where: { id: previousDraftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
  state.proposalDraftId = null; state.preview = null; state.pendingMatches = [];
  const catalog = state.actions.some(action => 'query' in action || action.kind === 'get_low_stock') ? await getCatalog() : [];
  if (catalog.length > 3000) {
    state.proposalDraftId = null;
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, 'Katalog terlalu besar untuk ditinjau dengan aman sekarang. Belum ada perubahan data; coba pecah permintaan menjadi satu barang per pesan.');
  }
  const operations: OwnerOperation[] = [], labels: string[] = [], responses: string[] = [];
  let clarification: string | null = null;
  for (let index = 0; index < state.actions.length; index++) {
    const action = state.actions[index];
    if (action.kind === 'request_clarification') { clarification ??= action.question; continue; }
    if (action.kind === 'get_business_report') { await showBusinessReport(chatId, action.date, action.shift); continue; }
    if (action.kind === 'get_low_stock') {
      const lowStock = catalog.filter(product => product.stock <= product.minStock).sort((a, b) => a.stock - b.stock);
      responses.push(lowStock.length
        ? `Barang yang perlu dicek stoknya (${lowStock.length}):\n${lowStock.slice(0, 25).map(product => `• ${product.name}: ${product.stock} (minimum ${product.minStock})${product.location?.name ? ` · ${product.location.name}` : ''}`).join('\n')}${lowStock.length > 25 ? `\n…dan ${lowStock.length - 25} barang lain.` : ''}`
        : 'Tidak ada barang yang mencapai batas stok minimum saat ini.');
      continue;
    }
    if (action.kind === 'get_inventory' && !action.query) {
      const modal = catalog.reduce((sum, product) => sum + product.costPrice * BigInt(product.stock), 0n);
      const retail = catalog.reduce((sum, product) => sum + product.sellPrice * BigInt(product.stock), 0n);
      responses.push(`Nilai stok dari katalog RMCS (${catalog.length} produk): modal ${formatIdr(modal)}; nilai jual ${formatIdr(retail)}.`);
      continue;
    }
    const query = queryForAction(action);
    if (!query) { clarification ??= 'Barang yang dimaksud belum jelas. Sebutkan nama, SKU, atau ciri barangnya.'; continue; }
    let products: CatalogProduct[] = [];
    const selectedId = selectedProduct(state, index, query);
    if (selectedId) products = catalog.filter(product => product.id === selectedId);
    if (!products.length) products = await findProductCandidates(query, catalog);
    if (!products.length) {
      if (action.kind.startsWith('propose_')) clarification ??= `Saya belum menemukan “${query}” di katalog RMCS. Perubahan tetap ditahan; sebutkan nama atau SKU yang lebih tepat.`;
      else responses.push(`Saya belum menemukan barang “${query}” di katalog RMCS.`);
      continue;
    }
    if (products.length > 1 && (action.kind.startsWith('propose_') || action.kind === 'get_product_details' || action.kind === 'get_inventory')) {
      state.pendingMatches.push({ actionIndex: index, query, candidateIds: products.map(product => product.id) });
      continue;
    }
    if (action.kind === 'search_products') {
      responses.push(`Hasil katalog untuk “${query}”:\n${products.slice(0, 5).map(product => `• ${product.name} · stok ${product.stock} · ${formatIdr(product.sellPrice)}`).join('\n')}`);
    } else if (action.kind === 'get_product_details' || action.kind === 'get_inventory') {
      responses.push(productDescription(products[0]));
    } else if (action.kind.startsWith('propose_')) {
      const proposal = await planOwnerOperations(action, products[0], ownerId);
      if (proposal.operations.length) { operations.push(...proposal.operations); labels.push(...proposal.labels); }
      else responses.push(...proposal.labels);
      clarification ??= proposal.clarification ?? null;
    }
  }
  if (!clarification && operations.length > 1) {
    const seen = new Set<string>();
    for (const operation of operations) {
      const fields = operation.kind === 'STOCK_IN' ? ['stock', 'costPrice']
        : operation.kind === 'STOCK_ADJUST' ? ['stock']
          : operation.kind === 'LOCATION_MOVE' ? ['location'] : [operation.proposed.field ?? 'price'];
      for (const field of fields) {
        const key = `${operation.productId}:${field}`;
        if (seen.has(key)) { clarification = `Ada beberapa perubahan yang saling bertabrakan untuk ${operation.productName}. Pisahkan menjadi beberapa pesan agar setiap pratinjau jelas.`; break; }
        seen.add(key);
      }
      if (clarification) break;
    }
  }
  await saveOwnerChatState(rowId, chatId, state, 'PROCESSING');
  const content = [state.actions.length ? '' : reply, ...responses].filter(Boolean).join('\n\n');
  if (state.pendingMatches.length) {
    await saveOwnerChatState(rowId, chatId, state);
    for (const pending of state.pendingMatches) {
      const matches = catalog.filter(product => pending.candidateIds.includes(product.id));
      await sendTelegramMessage(chatId, `Saya menemukan beberapa barang untuk “${pending.query}”. Pilih yang tepat; rincian permintaan tetap tersimpan.`,
        agentCandidateKeyboard(ownerId, pending.actionIndex, matches));
    }
    if (content) await sendTelegramMessage(chatId, content);
    return;
  }
  if (clarification) {
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, [content, clarification, 'Belum ada perubahan.'].filter(Boolean).join('\n\n'));
  }
  if (operations.length) {
    const batch = await createBatchDraft(chatId, ownerId, operations, labels);
    state.proposalDraftId = batch.draftId; state.preview = batch.preview;
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, [content, batch.preview].filter(Boolean).join('\n\n'), ownerActionKeyboard(batch.draftId));
  }
  await saveOwnerChatState(rowId, chatId, state);
  return sendTelegramMessage(chatId, content || 'Saya belum menangkap maksudnya. Coba ceritakan dengan kata-kata sendiri; kalau ada angka yang belum jelas, saya akan tanyakan.');
}

function parseOperation(value: unknown): OwnerOperation | null {
  if (!value || typeof value !== 'object') return null;
  const operation = value as Partial<OwnerOperation>;
  if (operation.version !== 1 || !['STOCK_IN', 'STOCK_ADJUST', 'PRICE_UPDATE', 'LOCATION_MOVE'].includes(operation.kind ?? '') ||
      !Number.isSafeInteger(operation.productId) || !operation.expected || !operation.proposed || !/^\d{1,20}$/.test(operation.ownerId ?? '')) return null;
  return operation as OwnerOperation;
}

async function confirmBatchOperation(callback: OwnerCallback, ownerId: number, draftId: string, batch: OwnerBatch) {
  const chatId = BigInt(callback.message!.chat.id);
  if (batch.ownerId !== String(ownerId) || batch.operations.some(operation => operation.ownerId !== String(ownerId))) {
    return answerTelegramCallback(callback.id, 'Operasi tidak valid atau bukan milik akun ini.');
  }
  let result: 'APPLIED' | 'STALE' | 'USED' = 'USED';
  try {
    result = await prisma.$transaction(async tx => {
      const claimed = await tx.telegramDraft.updateMany({
        where: { id: draftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count !== 1) return 'USED';
      const productIds = [...new Set(batch.operations.map(operation => operation.productId))].sort((a, b) => a - b);
      for (const productId of productIds) await tx.$queryRawUnsafe('SELECT "id" FROM "Product" WHERE "id" = $1 FOR UPDATE', productId);
      const products = new Map<number, { id: number; name: string; stock: number; costPrice: bigint; sellPrice: bigint;
        locationId: number | null; updatedAt: Date; location: { name: string } | null }>();
      for (const productId of productIds) {
        const product = await tx.product.findUnique({ where: { id: productId }, include: { location: { select: { name: true } } } });
        if (product) products.set(productId, product);
      }
      for (const operation of batch.operations) {
        const product = products.get(operation.productId);
        if (!product || product.name !== operation.productName || product.stock !== operation.expected.stock ||
            product.costPrice.toString() !== operation.expected.costPrice || product.sellPrice.toString() !== operation.expected.sellPrice ||
            product.locationId !== operation.expected.locationId || (product.location?.name ?? null) !== operation.expected.locationName ||
            product.updatedAt.toISOString() !== operation.expected.updatedAt) {
          await tx.telegramDraft.update({ where: { id: draftId }, data: { status: 'STALE' } });
          return 'STALE';
        }
      }
      for (const operation of batch.operations) {
        const product = products.get(operation.productId)!;
        if (operation.kind === 'STOCK_IN') {
          const quantity = operation.proposed.quantity, cost = operation.proposed.unitCost;
          if (!Number.isSafeInteger(quantity) || !quantity || quantity < 1 || quantity > 1_000_000 ||
              !cost || !/^\d{1,13}$/.test(cost) || BigInt(cost) <= 0n || product.stock + quantity > 1_000_000) throw new Error('OWNER_DRAFT_INVALID');
          await tx.product.update({ where: { id: product.id }, data: { stock: { increment: quantity }, costPrice: BigInt(cost) } });
          await tx.inventoryMovement.create({ data: { productId: product.id, type: 'IN', qty: quantity, costAtTime: BigInt(cost),
            supplier: operation.proposed.supplier?.trim() || null, note: 'Barang masuk Telegram owner ' + ownerId, userId: null } });
        } else if (operation.kind === 'STOCK_ADJUST') {
          const newStock = operation.proposed.newStock, reason = operation.proposed.reason?.trim();
          if (!Number.isSafeInteger(newStock) || newStock === undefined || newStock < 0 || newStock > 1_000_000 || !reason) throw new Error('OWNER_DRAFT_INVALID');
          const diff = newStock - product.stock;
          if (!diff) throw new Error('OWNER_DRAFT_INVALID');
          await tx.product.update({ where: { id: product.id }, data: { stock: newStock } });
          await tx.inventoryMovement.create({ data: { productId: product.id, type: 'ADJUST', qty: diff, costAtTime: product.costPrice,
            note: 'Koreksi Telegram owner ' + ownerId + ': ' + reason, userId: null } });
        } else if (operation.kind === 'PRICE_UPDATE') {
          const field = operation.proposed.field, amount = operation.proposed.amount;
          if ((field !== 'sellPrice' && field !== 'costPrice') || !amount || !/^\d{1,13}$/.test(amount) || BigInt(amount) > 1_000_000_000_000n) throw new Error('OWNER_DRAFT_INVALID');
          await tx.product.update({ where: { id: product.id }, data: field === 'sellPrice' ? { sellPrice: BigInt(amount) } : { costPrice: BigInt(amount) } });
        } else {
          const locationId = operation.proposed.targetLocationId;
          if (!Number.isSafeInteger(locationId) || !locationId || !operation.proposed.targetLocationName) throw new Error('OWNER_DRAFT_INVALID');
          const location = await tx.location.findUnique({ where: { id: locationId } });
          if (!location || location.name !== operation.proposed.targetLocationName) throw new Error('OWNER_LOCATION_STALE');
          await tx.product.update({ where: { id: product.id }, data: { locationId } });
          await tx.inventoryMovement.create({ data: { productId: product.id, type: 'LOCATION_TRANSFER', qty: 0, costAtTime: product.costPrice,
            note: 'Lokasi Telegram owner ' + ownerId + ': ' + (operation.expected.locationName ?? 'belum ditentukan') + ' → ' + location.name, userId: null } });
        }
      }
      await tx.telegramDraft.update({ where: { id: draftId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      return 'APPLIED';
    }, { isolationLevel: 'Serializable', timeout: 15_000 });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'OWNER_DRAFT_INVALID' || message === 'OWNER_LOCATION_STALE') {
      await prisma.telegramDraft.updateMany({ where: { id: draftId, chatId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED' } });
      return answerTelegramCallback(callback.id, 'Rencana sudah tidak valid. Tidak ada perubahan diterapkan. Kirim ulang pesan untuk meninjau nilai terbaru.');
    }
    throw error;
  }
  if (result === 'APPLIED') {
    await answerTelegramCallback(callback.id, 'Semua perubahan berhasil diterapkan.');
    await sendTelegramMessage(chatId, `✅ ${batch.operations.length} perubahan diterapkan ke katalog RMCS. Perubahan stok memiliki catatan audit.`);
  } else if (result === 'STALE') {
    await answerTelegramCallback(callback.id, 'Data berubah; tidak ada perubahan diterapkan.');
    await sendTelegramMessage(chatId, 'Data barang berubah sejak pratinjau dibuat. Tidak ada perubahan diterapkan; kirim ulang permintaan agar data terbaru diperiksa.');
  } else await answerTelegramCallback(callback.id, 'Tombol ini sudah dipakai atau kedaluwarsa.');
}

async function confirmOperation(callback: OwnerCallback, ownerId: number, draftId: string) {
  const chatId = BigInt(callback.message!.chat.id);
  const row = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  if (!row || row.chatId !== chatId || row.kind !== 'OWNER_OPERATION' || row.status !== 'PENDING' || row.expiresAt <= new Date()) {
    return answerTelegramCallback(callback.id, 'Draf tidak aktif. Tidak ada perubahan.');
  }
  const batch = validateBatch(row.payload);
  if (batch) return confirmBatchOperation(callback, ownerId, draftId, batch);
  const operation = parseOperation(row.payload);
  if (!operation || operation.ownerId !== String(ownerId)) return answerTelegramCallback(callback.id, 'Operasi tidak valid atau bukan milik akun ini.');
  let result: 'APPLIED' | 'STALE' | 'USED' = 'USED';
  try {
    result = await prisma.$transaction(async tx => {
      const claimed = await tx.telegramDraft.updateMany({
        where: { id: row.id, chatId, kind: 'OWNER_OPERATION', status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count !== 1) return 'USED';
      await tx.$queryRawUnsafe('SELECT \"id\" FROM \"Product\" WHERE \"id\" = $1 FOR UPDATE', operation.productId);
      const product = await tx.product.findUnique({ where: { id: operation.productId }, include: { location: { select: { name: true } } } });
      if (!product || product.name !== operation.productName || product.stock !== operation.expected.stock ||
          product.costPrice.toString() !== operation.expected.costPrice || product.sellPrice.toString() !== operation.expected.sellPrice ||
          product.locationId !== operation.expected.locationId ||
          (product.location?.name ?? null) !== operation.expected.locationName ||
          product.updatedAt.toISOString() !== operation.expected.updatedAt) {
        await tx.telegramDraft.update({ where: { id: row.id }, data: { status: 'STALE' } });
        return 'STALE';
      }
      if (operation.kind === 'STOCK_IN') {
        const quantity = operation.proposed.quantity, cost = operation.proposed.unitCost;
        if (!Number.isSafeInteger(quantity) || !quantity || quantity < 1 || quantity > 1_000_000 ||
            !cost || !/^\d{1,13}$/.test(cost) || BigInt(cost) <= 0n || product.stock + quantity > 1_000_000) throw new Error('OWNER_DRAFT_INVALID');
        await tx.product.update({ where: { id: product.id }, data: { stock: { increment: quantity }, costPrice: BigInt(cost) } });
        await tx.inventoryMovement.create({ data: { productId: product.id, type: 'IN', qty: quantity, costAtTime: BigInt(cost),
          supplier: operation.proposed.supplier?.trim() || null, note: 'Barang masuk Telegram owner ' + ownerId, userId: null } });
      } else if (operation.kind === 'STOCK_ADJUST') {
        const newStock = operation.proposed.newStock, reason = operation.proposed.reason?.trim();
        if (!Number.isSafeInteger(newStock) || newStock === undefined || newStock < 0 || newStock > 1_000_000 || !reason) throw new Error('OWNER_DRAFT_INVALID');
        const diff = newStock - product.stock;
        if (!diff) throw new Error('OWNER_DRAFT_INVALID');
        await tx.product.update({ where: { id: product.id }, data: { stock: newStock } });
        await tx.inventoryMovement.create({ data: { productId: product.id, type: 'ADJUST', qty: diff, costAtTime: product.costPrice,
          note: 'Koreksi Telegram owner ' + ownerId + ': ' + reason, userId: null } });
      } else if (operation.kind === 'PRICE_UPDATE') {
        const field = operation.proposed.field, amount = operation.proposed.amount;
        if ((field !== 'sellPrice' && field !== 'costPrice') || !amount || !/^\d{1,13}$/.test(amount) || BigInt(amount) > 1_000_000_000_000n) throw new Error('OWNER_DRAFT_INVALID');
        if (field === 'sellPrice') await tx.product.update({ where: { id: product.id }, data: { sellPrice: BigInt(amount) } });
        else await tx.product.update({ where: { id: product.id }, data: { costPrice: BigInt(amount) } });
      } else {
        const locationId = operation.proposed.targetLocationId;
        if (!Number.isSafeInteger(locationId) || !locationId || !operation.proposed.targetLocationName) throw new Error('OWNER_DRAFT_INVALID');
        const location = await tx.location.findUnique({ where: { id: locationId } });
        if (!location || location.name !== operation.proposed.targetLocationName) throw new Error('OWNER_LOCATION_STALE');
        await tx.product.update({ where: { id: product.id }, data: { locationId } });
        await tx.inventoryMovement.create({ data: { productId: product.id, type: 'LOCATION_TRANSFER', qty: 0, costAtTime: product.costPrice,
          note: 'Lokasi Telegram owner ' + ownerId + ': ' + (operation.expected.locationName ?? 'belum ditentukan') + ' → ' + location.name, userId: null } });
      }
      await tx.telegramDraft.update({ where: { id: row.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
      return 'APPLIED';
    }, { isolationLevel: 'Serializable', timeout: 15_000 });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'OWNER_DRAFT_INVALID' || message === 'OWNER_LOCATION_STALE') {
      await prisma.telegramDraft.updateMany({ where: { id: row.id, chatId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED' } });
      return answerTelegramCallback(callback.id, 'Data tujuan sudah berubah atau draf tidak valid. Tidak ada perubahan tersimpan.');
    }
    throw error;
  }
  if (result === 'APPLIED') {
    await answerTelegramCallback(callback.id, 'Perubahan berhasil diterapkan.');
    await sendTelegramMessage(chatId, '✅ Perubahan ' + operation.productName + ' berhasil diterapkan di katalog RMCS.' +
      (operation.kind === 'STOCK_IN' || operation.kind === 'STOCK_ADJUST' ? ' Catatan audit stok sudah dibuat.' : ''));
  } else if (result === 'STALE') {
    await answerTelegramCallback(callback.id, 'Data barang berubah. Tidak ada perubahan diterapkan.');
    await sendTelegramMessage(chatId, operation.productName + ' berubah sejak draf dibuat. Periksa kembali data terbaru dan kirim permintaan baru.');
  } else await answerTelegramCallback(callback.id, 'Tombol ini sudah dipakai atau draf kedaluwarsa.');
}

async function selectCandidate(callback: OwnerCallback, ownerId: number, draftId: string, productId: number) {
  const chatId = BigInt(callback.message!.chat.id);
  const row = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  if (!row || row.chatId !== chatId || !['OWNER_SELECT_INFO', 'OWNER_SELECT_WRITE'].includes(row.kind) || row.status !== 'PENDING' || row.expiresAt <= new Date()) {
    return answerTelegramCallback(callback.id, 'Pilihan sudah kedaluwarsa.');
  }
  const selection = row.payload as unknown as OwnerSelection;
  if (selection.version !== 1 || !selection.candidateIds.includes(productId)) return answerTelegramCallback(callback.id, 'Pilihan barang tidak valid.');
  const claimed = await claimPendingDraft(row.id, chatId, row.kind);
  if (claimed.count !== 1) return answerTelegramCallback(callback.id, 'Pilihan ini sudah diproses.');
  await prisma.telegramDraft.update({ where: { id: row.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: { select: { name: true } }, location: { select: { name: true } } } });
  if (!product) return answerTelegramCallback(callback.id, 'Barang sudah tidak tersedia.');
  await answerTelegramCallback(callback.id, 'Barang dipilih.');
  if (row.kind === 'OWNER_SELECT_INFO') return sendTelegramMessage(chatId, productDescription(product));
  return prepareProductIntent(chatId, BigInt(ownerId), validateOwnerIntent(selection.intent), product);
}

async function selectAgentCandidate(callback: OwnerCallback, ownerId: number, actionIndex: number, productId: number) {
  const chatId = BigInt(callback.message!.chat.id), rowId = ownerConversationId(ownerId);
  const row = await prisma.telegramDraft.findUnique({ where: { id: rowId } });
  const state = row?.kind === 'OWNER_CONVERSATION' && row.chatId === chatId && row.status === 'PENDING'
    ? parseOwnerChatState(row.payload, ownerId) : null;
  const pending = state?.pendingMatches.find(match => match.actionIndex === actionIndex);
  if (!state || !pending || !pending.candidateIds.includes(productId)) return answerTelegramCallback(callback.id, 'Pilihan barang sudah kedaluwarsa atau tidak cocok.');
  const claimed = await prisma.telegramDraft.updateMany({ where: { id: rowId, chatId, kind: 'OWNER_CONVERSATION', status: 'PENDING', expiresAt: { gt: new Date() } },
    data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return answerTelegramCallback(callback.id, 'Pesan sebelumnya masih diproses. Pilihan ini belum diterapkan; coba lagi sebentar.');
  const query = queryForAction(state.actions[actionIndex]);
  if (!query || query !== pending.query) {
    await saveOwnerChatState(rowId, chatId, state);
    return answerTelegramCallback(callback.id, 'Konteks pilihan sudah berubah. Kirim ulang permintaan.');
  }
  state.selected = state.selected.filter(item => item.actionIndex !== actionIndex);
  state.selected.push({ actionIndex, query, productId });
  state.pendingMatches = state.pendingMatches.filter(item => item.actionIndex !== actionIndex);
  await saveOwnerChatState(rowId, chatId, state);
  await answerTelegramCallback(callback.id, 'Barang dipilih. Saya meninjau ulang seluruh rencana.');
  return renderOwnerActions(chatId, ownerId, rowId, state, 'Saya sudah memilih barang yang Anda maksud.', state.actions);
}

export async function handleOwnerCallback(callback: OwnerCallback, ownerId: number) {
  const chat = callback.message?.chat;
  if (!telegramOwnerAuthorized(callback.from.id) || callback.from.id !== ownerId || !chat || chat.type !== 'private' || chat.id !== ownerId) {
    return answerTelegramCallback(callback.id, 'Akses ditolak.');
  }
  const data = callback.data ?? '';
  const pick = /^rcms:owner:pick:(\d{1,20}):(\d{1,2}):(\d{1,10})$/.exec(data);
  if (pick) {
    if (pick[1] !== String(ownerId) || Number(pick[1]) !== callback.from.id) return answerTelegramCallback(callback.id, 'Akses ditolak.');
    return selectAgentCandidate(callback, ownerId, Number(pick[2]), Number(pick[3]));
  }
  const select = /^rcms:owner:select:([A-Za-z0-9_-]{10,40}):(\d{1,10})$/.exec(data);
  const action = /^rcms:owner:(confirm|cancel):([A-Za-z0-9_-]{10,40})$/.exec(data);
  if (select) return selectCandidate(callback, ownerId, select[1], Number(select[2]));
  if (!action) return answerTelegramCallback(callback.id, 'Tombol tidak dikenali.');
  const draftId = action[2], chatId = BigInt(chat.id);
  if (action[1] === 'cancel') {
    const changed = await prisma.telegramDraft.updateMany({ where: { id: draftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (changed.count) {
      const stateId = ownerConversationId(ownerId), stateRow = await prisma.telegramDraft.findUnique({ where: { id: stateId } });
      const state = stateRow?.kind === 'OWNER_CONVERSATION' && stateRow.chatId === chatId ? parseOwnerChatState(stateRow.payload, ownerId) : null;
      if (state?.proposalDraftId === draftId) {
        state.actions = []; state.selected = []; state.pendingMatches = []; state.proposalDraftId = null; state.preview = null;
        state.history = [...state.history, { role: 'assistant' as const, content: 'Rencana dibatalkan; jangan jalankan ulang tanpa permintaan baru.' }].slice(-12);
        await saveOwnerChatState(stateId, chatId, state);
      }
    }
    return answerTelegramCallback(callback.id, changed.count ? 'Perubahan dibatalkan; data tetap sama.' : 'Draf sudah diproses atau kedaluwarsa.');
  }
  return confirmOperation(callback, ownerId, draftId);
}

export async function handleOwnerMessage(message: OwnerMessage, ownerId: number) {
  const chatId = BigInt(message.chat.id);
  if (!message.from || !telegramOwnerAuthorized(message.from.id) || message.from.id !== ownerId ||
      message.chat.type !== 'private' || message.chat.id !== ownerId) {
    return sendTelegramMessage(chatId, 'Asisten administrasi hanya tersedia untuk owner yang telah diotorisasi.');
  }
  const text = message.text?.trim() ?? '';
  if (!text) return sendTelegramMessage(chatId, 'Kirim pertanyaan atau perintah dalam bentuk teks.');
  const command = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (command?.[1].toLowerCase() === 'start' || command?.[1].toLowerCase() === 'help') {
    return sendTelegramMessage(chatId, 'Hai, saya asisten toko R-CELL. Tanyakan atau ceritakan kebutuhan Anda dengan kata-kata sendiri—saya bisa membantu mencari barang, membaca stok, merangkum usaha, dan menyiapkan perubahan untuk diperiksa.\n\nSetiap perubahan tetap menunggu tombol konfirmasi sebelum diterapkan. /whoami menampilkan ID Telegram Anda.');
  }
  try {
    const { rowId, state } = await getOwnerChatState(chatId, ownerId);
    const claimed = await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
    if (claimed.count !== 1) return sendTelegramMessage(chatId, 'Saya sedang menyusun pesan sebelumnya. Tunggu sebentar lalu kirim lagi; belum ada perubahan yang diterapkan.');
    try {
      if (command?.[1].toLowerCase() === 'batal') {
        if (state.proposalDraftId) await prisma.telegramDraft.updateMany({ where: { id: state.proposalDraftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
        state.actions = []; state.selected = []; state.pendingMatches = []; state.proposalDraftId = null; state.preview = null;
        state.history = [...state.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: 'Rencana dibatalkan.' }].slice(-12);
        await saveOwnerChatState(rowId, chatId, state);
        return sendTelegramMessage(chatId, 'Rencana dibatalkan. Data RMCS tidak berubah.');
      }
      if (state.proposalDraftId) await prisma.telegramDraft.updateMany({ where: { id: state.proposalDraftId, chatId,
        kind: 'OWNER_OPERATION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
      const priorActions = state.actions;
      const turn = await interpretOwnerTurn({ text, history: state.history, currentActions: state.actions,
        apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
      const ownerEvidence = [...state.history.filter(message => message.role === 'user').map(message => message.content), text]
        .join(' ').toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
      const validatedActions = turn.actions.map(action => action.kind === 'propose_stock_adjustment' && action.reason &&
        !ownerEvidence.includes(action.reason.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ')) ? { ...action, reason: null } : action);
      state.actions = turn.clarification && !validatedActions.some(action => action.kind === 'request_clarification')
        ? [...validatedActions, { kind: 'request_clarification', question: turn.clarification }] : validatedActions;
      state.selected = state.selected.filter(item => queryForAction(state.actions[item.actionIndex]) === item.query);
      const reply = [turn.reply, turn.clarification].filter(Boolean).join('\n');
      const historyReply = state.actions.length ? 'Saya sudah meninjau permintaan. Rencana perubahan hanya akan diterapkan setelah tombol konfirmasi ditekan.' : reply;
      state.history = [...state.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: historyReply }].slice(-12);
      if (!state.actions.length && state.proposalDraftId) {
        await prisma.telegramDraft.updateMany({ where: { id: state.proposalDraftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING' }, data: { status: 'CANCELLED' } });
        state.proposalDraftId = null; state.preview = null;
      }
      return await renderOwnerActions(chatId, ownerId, rowId, state, reply, priorActions);
    } catch {
      state.history = [...state.history, { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: 'Maaf, saya belum berhasil memeriksa permintaan itu.' }].slice(-12);
      try { await saveOwnerChatState(rowId, chatId, state); } catch { /* Keep the user-facing fallback independent of draft persistence. */ }
      return await sendTelegramMessage(chatId, 'Maaf, saya belum berhasil memeriksa permintaan itu. Tidak ada perubahan usaha yang diterapkan. Coba kirim ulang sebentar lagi.');
    }
  } catch {
    return sendTelegramMessage(chatId, 'Maaf, saya belum bisa memeriksa data toko sekarang. Tidak ada perubahan yang diterapkan; coba lagi sebentar.');
  }
}
