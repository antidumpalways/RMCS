Warning: truncated output (original token count: 28525)
Total output lines: 1338

import { prisma } from '@/lib/prisma';
import { withTelegramOwnerUser } from '@/lib/auth';
import { withAssistantAuthorization } from '@/lib/assistant-authorization';
import { applyAssistantDraft } from '@/lib/assistant-actions';
import { isAssistantAction, type AssistantAction, type AssistantDraft } from '@/lib/assistant-draft';
import { saleSnapshotSignature } from '@/lib/sale-chat';
import { analyzeCatalog, cleanupsForKinds, AUDIT_KINDS, type AuditKind } from '@/lib/catalog-audit';
import { jakartaTodayBounds } from '@/lib/sale-chat';
import { catalogSearchTerms, rankCatalogProducts } from '@/lib/catalog-search';
import { respectsNumericAttributes, semanticCatalogSearch } from '@/lib/semantic-catalog';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { parseOwnerRupiah, telegramOwnerAuthorized, validateOwnerIntent, type OwnerIntent } from './owner-intent';
import { composeOwnerReply, interpretOwnerTurn, OwnerAgentUnavailable, planStockInPricing, type OwnerAgentAction, type OwnerBusinessKind, type OwnerChatMessage } from './owner-agent';

type OwnerMessage = { chat: { id: number; type: string }; from?: { id: number; first_name?: string; last_name?: string }; text?: string };
type OwnerCallback = { id: string; from: { id: number }; data?: string; message?: { chat: { id: number; type: string } } };
export type CatalogProduct = {
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
type OwnerProductCreate = { version: 1; kind: 'PRODUCT_CREATE'; ownerId: string; name: string; categoryId: number; categoryName: string;
  subcategoryId: number | null; subcategoryName: string | null; sku: string | null; provider: string | null; validity: string | null;
  locationId: number | null; locationName: string | null; costPrice: string; sellPrice: string; stock: number; minStock: number };
type OwnerBatchOperation = OwnerOperation | OwnerProductCreate;
type OwnerBatch = { version: 2; ownerId: string; operations: OwnerBatchOperation[]; labels: string[] };
type OwnerChatState = { version: 1; ownerId: string; history: OwnerChatMessage[]; actions: OwnerAgentAction[];
  selected: Array<{ actionIndex: number; query: string; productId: number }>; pendingMatches: Array<{ actionIndex: number; query: string; candidateIds: number[] }>;
  proposalDraftId: string | null; preview: string | null };
const DRAFT_TTL = 15 * 60_000;
const CHAT_TTL = 7 * 24 * 60 * 60_000;
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatIdr = (value: bigint) => idr.format(value);

function logOwnerDiagnostic(stage: string, category: string, startedAt: number) {
  console.error(JSON.stringify({ event: 'owner_assistant_failure', stage, category, durationMs: Date.now() - startedAt }));
}

class OwnerAssistantDatabaseError extends Error {
  constructor(readonly stage: string) { super('OWNER_ASSISTANT_DATABASE_ERROR'); this.name = 'OwnerAssistantDatabaseError'; }
}

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

export async function getCatalog(): Promise<CatalogProduct[]> {
  const startedAt = Date.now();
  try {
    return await prisma.product.findMany({
      take: 3001, orderBy: { name: 'asc' },
      select: { id: true, name: true, sku: true, provider: true, validity: true, stock: true, minStock: true, updatedAt: true,
        costPrice: true, sellPrice: true, locationId: true, category: { select: { name: true } }, location: { select: { name: true } } },
    });
  } catch {
    logOwnerDiagnostic('product_catalog_lookup', 'database_error', startedAt);
    throw new OwnerAssistantDatabaseError('product_catalog_lookup');
  }
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

async function showBusinessReport(requestedDate: string | null, shift: string | null): Promise<string> {
  const today = jakartaTodayBounds();
  const date = requestedDate ?? today.date;
  const start = requestedDate ? new Date(requestedDate + 'T00:00:00+07:00') : today.start;
  const end = new Date(start.getTime() + 86_400_000);
  const shiftFilter = shift ? { user: { is: { shift: { equals: shift, mode: 'insensitive' as const } } } } : {};
  const [sales, services, expenses, productRows, recapReports, inventoryProducts] = await Promise.all([
    prisma.saleTransaction.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { totalRevenue: true, totalProfit: true } }),
    prisma.serviceTransaction.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { profit: true } }),
    prisma.expense.findMany({ where: { createdAt: { gte: start, lt: end }, ...shiftFilter }, select: { amount: true } }),
    prisma.saleItem.groupBy({ by: ['productId'], where: { sale: { createdAt: { gte: start, lt: end }, ...shiftFilter } },
      _sum: { qty: true, revenue: true }, orderBy: { _sum: { revenue: 'desc' } }, take: 8 }),
    prisma.telegramShiftReport.findMany({ where: { confirmedAt: { gte: start, lt: end },
      ...(shift ? { shiftLabel: { equals: shift, mode: 'insensitive' as const } } : {}) }, select: { payload: true } }),
    prisma.product.findMany({ select: { stock: true, costPrice: true, sellPrice: true } }),
  ]);
  const salesRevenue = sales.reduce((sum, sale) => sum + sale.totalRevenue, 0n);
  const goodsProfit = sales.reduce((sum, sale) => sum + sale.totalProfit, 0n);
  const serviceProfit = services.reduce((sum, service) => sum + service.profit, 0n);
  const totalRevenue = salesRevenue + serviceProfit;
  const grossProfit = goodsProfit + serviceProfit;
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0n);
  const totalModalInventory = inventoryProducts.reduce((sum, product) => sum + product.costPrice * BigInt(product.stock), 0n);
  const totalRetailInventory = inventoryProducts.reduce((sum, product) => sum + product.sellPrice * BigInt(product.stock), 0n);
  const recapSales = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'sale'), 0n);
  const recapFees = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'service_fee'), 0n);
  const recapExpenses = recapReports.reduce((sum, report) => sum + reportedRecapTotal(report.payload, 'expense'), 0n);
  const ids = productRows.map(row => row.productId);
  const names = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameById = new Map(names.map(product => [product.id, product.name]));
  const breakdown = productRows.map(row => '• ' + (nameById.get(row.productId) ?? 'Barang dihapus') + ': ' +
    (row._sum.qty ?? 0) + ' unit · ' + formatIdr(row._sum.revenue ?? 0n));
  return 'Ringkasan tercatat — ' + date + ' (WIB)' + (shift ? ' · shift ' + shift : '') + '\nOmzet barang + admin jasa: ' + formatIdr(totalRevenue) +
    '\nLaba kotor tercatat: ' + formatIdr(grossProfit) + '\nPengeluaran: ' + formatIdr(totalExpenses) +
    '\nProfit tercatat setelah pengeluaran: ' + formatIdr(grossProfit - totalExpenses) +
    '\nSnapshot persediaan saat ini (' + inventoryProducts.length + ' produk):' +
    '\nTotal modal stok: ' + formatIdr(totalModalInventory) +
    '\nNilai inventory pada harga jual: ' + formatIdr(totalRetailInventory) +
    '\n\nBarang teratas:\n' + (breakdown.length ? breakdown.join('\n') : 'Belum ada penjualan barang tercatat.') +
    '\n\nRekap shift Telegram terkonfirmasi (dilaporkan terpisah, tidak dijumlahkan):\nOmzet barang: ' + formatIdr(recapSales) +
    '\nAdmin jasa: ' + formatIdr(recapFees) + '\nPengeluaran: ' + formatIdr(recapExpenses) +
    '\nJumlah laporan: ' + recapReports.length +
    '\n\nLaba hanya dihitung dari transaksi yang menyimpan harga jual dan modal. Angka rekap agregat tidak digabung dengan transaksi Web App agar tidak menghitung ganda.';
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
    return sendTelegramMessage(chatId, 'Nilai persediaan saat ini (' + products.length + ' produk):\nTotal modal stok: ' + formatIdr(modal) +
      '\nNilai inventory pada harga jual: ' + formatIdr(retail) + '\nSelisih nilai jual dan modal: ' + formatIdr(retail - modal));
  }
  if (intent.kind === 'business_report_today') return sendTelegramMessage(BigInt(ownerId), await showBusinessReport(intent.date, intent.shift));
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
  const startedAt = Date.now();
  try {
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
  } catch {
    logOwnerDiagnostic('conversation_state_read', 'database_error', startedAt);
    throw new OwnerAssistantDatabaseError('conversation_state_read');
  }
}

async function saveOwnerChatState(rowId: string, chatId: bigint, state: OwnerChatState, status: 'PENDING' | 'PROCESSING' = 'PENDING') {
  const startedAt = Date.now();
  try {
    await prisma.telegramDraft.update({ where: { id: rowId }, data: {
      chatId, kind: 'OWNER_CONVERSATION', payload: state as object, status, expiresAt: new Date(Date.now() + CHAT_TTL),
    } });
  } catch {
    logOwnerDiagnostic('conversation_state_write', 'database_error', startedAt);
    throw new OwnerAssistantDatabaseError('conversation_state_write');
  }
}

function actionQuery(action: OwnerAgentAction): string | null {
  return 'query' in action ? action.query : null;
}
function sameActions(left: OwnerAgentAction[], right: OwnerAgentAction[]) { return JSON.stringify(left) === JSON.stringify(right); }
function rememberOwnerReply(state: OwnerChatState, reply: string) {
  const assistantTurn = [...state.history].reverse().find(message => message.role === 'assistant');
  if (assistantTurn) assistantTurn.content = reply.slice(0, 1200);
}
function selectedProduct(state: OwnerChatState, index: number, query: string): number | null {
  return state.selected.find(item => item.actionIndex === index && item.query === query)?.productId ?? null;
}

function validateBatch(value: unknown): OwnerBatch | null {
  if (!value || typeof value !== 'object') return null;
  const batch = value as Partial<OwnerBatch>;
  if (batch.version !== 2 || !/^\d{1,20}$/.test(batch.ownerId ?? '') || !Array.isArray(batch.operations) ||
      !batch.operations.length || !Array.isArray(batch.labels) || batch.operations.length !== batch.labels.length ||
      !batch.operations.every(operation => parseBatchOperation(operation) !== null) || !batch.labels.every(label => typeof label === 'string')) return null;
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

async function planProductCreate(action: Extract<OwnerAgentAction, { kind: 'propose_product_create' }>, ownerId: number) {
  const name = action.name?.trim();
  if (!name) return { clarification: 'Nama produk yang akan dibuat belum jelas. Sebutkan nama barangnya.' };
  if (!action.category?.trim()) return { clarification: `Kategori untuk “${name}” belum disebutkan. Sebutkan kategori yang sudah ada di katalog.` };
  if (!action.quantity || action.quantity < 1) return { clarification: `Berapa stok awal “${name}” yang ingin dimasukkan?` };
  if (action.quantity > 1_000_000) return { clarification: 'Stok awal melewati batas sistem. Periksa jumlahnya.' };
  const sellPrice = parseOwnerRupiah(action.sellPrice);
  const explicitCost = parseOwnerRupiah(action.unitCost);
  const margin = parseOwnerRupiah(action.margin);
  if (sellPrice === null || sellPrice <= 0n) return { clarification: `Harga jual “${name}” belum jelas. Sebutkan nominalnya.` };
  if (margin !== null && (margin <= 0n || margin >= sellPrice)) return { clarification: `Margin untuk “${name}” tidak cocok dengan harga jual. Pastikan kedua nominalnya.` };
  const derivedCost = margin === null ? null : sellPrice - margin;
  if (explicitCost !== null && derivedCost !== null && explicitCost !== derivedCost) {
    return { clarification: `Modal ${formatIdr(explicitCost)} tidak sama dengan harga jual dikurangi margin (${formatIdr(derivedCost)}). Mana yang benar?` };
  }
  const costPrice = explicitCost ?? derivedCost;
  if (costPrice === null || costPrice <= 0n) return { clarification: `Sebutkan modal per unit “${name}”, atau harga jual dan margin agar modalnya bisa dihitung.` };

  const category = await prisma.category.findFirst({ where: { name: { equals: action.category.trim(), mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!category) {
    const categories = await prisma.category.findMany({ select: { name: true }, orderBy: { sortOrder: 'asc' }, take: 50 });
    return { clarification: `Kategori “${action.category}” belum ada di katalog. Kategori yang tersedia: ${categories.map(item => item.name).join(', ') || 'belum ada'}. Sebutkan salah satunya; saya tidak membuat kategori otomatis.` };
  }
  let subcategory: { id: number; name: string } | null = null;
  if (action.subcategory) {
    subcategory = await prisma.subcategory.findFirst({ where: { categoryId: category.id, name: { equals: action.subcategory, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (!subcategory) {
      const available = await prisma.subcategory.findMany({ where: { categoryId: category.id }, select: { name: true }, orderBy: { name: 'asc' }, take: 50 });
      return { clarification: `Subkategori “${action.subcategory}” tidak ditemukan di ${category.name}. Pilihan yang tersedia: ${available.map(item => item.name).join(', ') || 'tidak ada'}.` };
    }
  }
  let location: { id: number; name: string } | null = null;
  if (action.location) {
    location = await prisma.location.findFirst({ where: { name: { equals: action.location, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (!location) {
      const locations = await prisma.location.findMany({ select: { name: true }, orderBy: { name: 'asc' }, take: 50 });
      return { clarification: `Lokasi “${action.location}” belum ada. Pilihan: ${locations.map(item => item.name).join(', ') || 'belum ada'}.` };
    }
  }
  const duplicate = await prisma.product.findFirst({ where: { OR: [
    { categoryId: category.id, name: { equals: name, mode: 'insensitive' } }, ...(action.sku ? [{ sku: action.sku }] : [])] }, select: { id: true, name: true } });
  if (duplicate) return { clarification: `“${duplicate.name}” sudah ada di katalog. Saya tahan pembuatan agar tidak membuat barang ganda; kalau maksudnya menambah stok, kirim “tambah stok ${duplicate.name} ${action.quantity} pcs”.` };
  const minStock = action.minStock ?? 3;
  if (minStock > 1_000_000) return { clarification: 'Batas stok minimum melewati batas sistem.' };
  const operation: OwnerProductCreate = { version: 1, kind: 'PRODUCT_CREATE', ownerId: String(ownerId), name,
    categoryId: category.id, categoryName: category.name, subcategoryId: subcategory?.id ?? null,
    subcategoryName: subcategory?.name ?? null, sku: action.sku?.trim() || null, provider: action.provider?.trim() || null,
    validity: action.validity?.trim() || null, locationId: location?.id ?? null, locationName: location?.name ?? null,
    costPrice: costPrice.toString(), sellPrice: sellPrice.toString(), stock: action.quantity, minStock };
  const label = `Produk baru · ${category.name}${subcategory ? ` / ${subcategory.name}` : ''}; stok awal ${action.quantity}; minimum ${minStock}; modal ${formatIdr(costPrice)}/unit; harga jual ${formatIdr(sellPrice)}/unit${margin !== null ? `; margin ${formatIdr(margin)}/unit` : ''}${location ? `; lokasi ${location.name}` : ''}${operation.sku ? `; SKU ${operation.sku}` : ''}`;
  return { operation, label };
}

async function planOwnerBusinessAction(kind: OwnerBusinessKind, data: Record<string, unknown>, ownerId: number): Promise<{ draft?: AssistantDraft; clarification?: string }> {
  const text = (key: string, max = 160) => typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim().slice(0, max) : null;
  const number = (key: string, min = 0) => Number.isSafeInteger(data[key]) && (data[key] as number) >= min ? data[key] as number : null;
  const amount = (key: string) => {
    const raw = data[key];
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? BigInt(raw) : typeof raw === 'string' ? parseOwnerRupiah(raw) : null;
  };
  const product = async (name: string) => {
    const catalog = await getCatalog();
    const matches = await findProductCandidates(name, catalog);
    return { catalog, matches };
  };
  const chooseProduct = async (name: string) => {
    const { matches } = await product(name);
    if (matches.length !== 1) return { issue: matches.length ? `Nama “${name}” cocok ke beberapa barang: ${matches.map(item => item.name).join(', ')}. Sebutkan varian yang tepat.` : `Barang “${name}” belum ditemukan di katalog.` };
    return { product: matches[0] };
  };
  const build = (action: AssistantAction, title: string, lines: Array<{ label: string; value: string; emphasis?: boolean }>, payload: Record<string, unknown>) => ({ draft: { action, title, lines, payload } as AssistantDraft });

  if (kind === 'sale_create' || kind === 'sale_edit' || kind === 'sale_return') {
    const saleId = number('saleId', 1);
    const rawItems = data.items;
    if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 50 || !rawItems.every(item => item && typeof item === 'object')) return { clarification: 'Sebutkan barang dan jumlahnya dengan jelas.' };
    if (kind === 'sale_create') {
      const resolvedItems: Array<{ product: CatalogProduct; qty: number }> = [];
      for (const raw of rawItems as Array<Record<string, unknown>>) {
        const name = typeof raw.productName === 'string' ? raw.productName.trim() : '', qty = raw.qty;
        if (!name || !Number.isSafeInteger(qty) || (qty as number) <= 0) return { clarification: 'Penjualan perlu nama barang dan jumlah terjual yang jelas.' };
        const resolved = await chooseProduct(name); if (!resolved.product) return { clarification: resolved.issue };
        const prior = resolvedItems.find(item => item.product.id === resolved.product!.id);
        if (prior) prior.qty += qty as number; else resolvedItems.push({ …8525 tokens truncated…l && operation.subcategoryName !== null) || (operation.locationId === null && operation.locationName !== null)) return null;
  return operation as OwnerProductCreate;
}

function parseBatchOperation(value: unknown): OwnerBatchOperation | null {
  return parseOperation(value) ?? parseOwnerProductCreate(value);
}

function isProductCreate(operation: OwnerBatchOperation): operation is OwnerProductCreate {
  return operation.kind === 'PRODUCT_CREATE';
}

async function confirmBatchOperation(callback: OwnerCallback, ownerId: number, draftId: string, batch: OwnerBatch) {
  const chatId = BigInt(callback.message!.chat.id);
  if (batch.ownerId !== String(ownerId) || batch.operations.some(operation => operation.ownerId !== String(ownerId))) {
    return answerTelegramCallback(callback.id, 'Operasi tidak valid atau bukan milik akun ini.');
  }
  let result: 'APPLIED' | 'STALE' | 'USED' = 'USED';
  try {
    result = await prisma.$transaction(async tx => {
      const conversation = await tx.telegramDraft.findUnique({ where: { id: ownerConversationId(ownerId) } });
      const conversationState = conversation?.kind === 'OWNER_CONVERSATION' && conversation.chatId === chatId
        ? parseOwnerChatState(conversation.payload, ownerId) : null;
      if (conversationState?.proposalDraftId !== draftId) return 'USED';
      const claimed = await tx.telegramDraft.updateMany({
        where: { id: draftId, chatId, kind: 'OWNER_OPERATION', status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count !== 1) return 'USED';
      const existingOperations = batch.operations.filter((operation): operation is OwnerOperation => !isProductCreate(operation));
      const productIds = [...new Set(existingOperations.map(operation => operation.productId))].sort((a, b) => a - b);
      for (const productId of productIds) await tx.$queryRawUnsafe('SELECT "id" FROM "Product" WHERE "id" = $1 FOR UPDATE', productId);
      const products = new Map<number, { id: number; name: string; stock: number; costPrice: bigint; sellPrice: bigint;
        locationId: number | null; updatedAt: Date; location: { name: string } | null }>();
      for (const productId of productIds) {
        const product = await tx.product.findUnique({ where: { id: productId }, include: { location: { select: { name: true } } } });
        if (product) products.set(productId, product);
      }
      for (const operation of batch.operations) {
        if (isProductCreate(operation)) {
          const category = await tx.category.findUnique({ where: { id: operation.categoryId }, select: { name: true } });
          const subcategory = operation.subcategoryId ? await tx.subcategory.findUnique({ where: { id: operation.subcategoryId }, select: { name: true, categoryId: true } }) : null;
          const location = operation.locationId ? await tx.location.findUnique({ where: { id: operation.locationId }, select: { name: true } }) : null;
          const duplicate = await tx.product.findFirst({ where: {
            OR: [{ categoryId: operation.categoryId, name: { equals: operation.name, mode: 'insensitive' } }, ...(operation.sku ? [{ sku: operation.sku }] : [])] }, select: { id: true } });
          if (!category || category.name !== operation.categoryName ||
              (operation.subcategoryId !== null && (!subcategory || subcategory.categoryId !== operation.categoryId || subcategory.name !== operation.subcategoryName)) ||
              (operation.locationId !== null && (!location || location.name !== operation.locationName)) || duplicate) {
            throw new Error('OWNER_DRAFT_INVALID');
          }
          continue;
        }
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
        if (isProductCreate(operation)) {
          const product = await tx.product.create({ data: { name: operation.name, categoryId: operation.categoryId,
            subcategoryId: operation.subcategoryId, sku: operation.sku, provider: operation.provider, validity: operation.validity,
            locationId: operation.locationId, costPrice: BigInt(operation.costPrice), sellPrice: BigInt(operation.sellPrice),
            stock: operation.stock, minStock: operation.minStock } });
          await tx.inventoryMovement.create({ data: { productId: product.id, type: 'IN', qty: operation.stock,
            costAtTime: BigInt(operation.costPrice), note: 'Stok awal produk Telegram owner ' + ownerId, userId: null } });
          continue;
        }
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
      if (conversationState?.proposalDraftId === draftId) {
        conversationState.actions = []; conversationState.selected = []; conversationState.pendingMatches = [];
        conversationState.proposalDraftId = null; conversationState.preview = null;
        conversationState.history = [...conversationState.history, { role: 'assistant' as const, content: 'Perubahan sudah diterapkan setelah konfirmasi owner.' }].slice(-12);
        await tx.telegramDraft.update({ where: { id: ownerConversationId(ownerId) }, data: { payload: conversationState as object } });
      }
      return 'APPLIED';
    }, { isolationLevel: 'Serializable', timeout: 15_000 });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'OWNER_DRAFT_INVALID' || message === 'OWNER_LOCATION_STALE' || ['P2002', 'P2034'].includes((error as { code?: string }).code ?? '')) {
      await prisma.telegramDraft.updateMany({ where: { id: draftId, chatId, status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'FAILED' } });
      return answerTelegramCallback(callback.id, 'Rencana sudah tidak valid. Tidak ada perubahan diterapkan. Kirim ulang pesan untuk meninjau nilai terbaru.');
    }
    throw error;
  }
  if (result === 'APPLIED') {
    await answerTelegramCallback(callback.id, 'Semua perubahan berhasil diterapkan.');
    const createdProducts = batch.operations.filter(isProductCreate);
    await sendTelegramMessage(chatId, createdProducts.length
      ? `✅ Produk ${createdProducts.map(product => `“${product.name}”`).join(', ')} berhasil ditambahkan ke katalog dengan stok awal ${createdProducts.map(product => product.stock).join(', ')} unit. Catatan stok awal sudah dibuat.`
      : `✅ ${batch.operations.length} perubahan diterapkan ke katalog RMCS. Perubahan stok memiliki catatan audit.`);
  } else if (result === 'STALE') {
    await answerTelegramCallback(callback.id, 'Data berubah; tidak ada perubahan diterapkan.');
    await sendTelegramMessage(chatId, 'Data barang berubah sejak pratinjau dibuat. Tidak ada perubahan diterapkan; kirim ulang permintaan agar data terbaru diperiksa.');
  } else await answerTelegramCallback(callback.id, 'Tombol ini sudah dipakai atau kedaluwarsa.');
}

function assistantDraftPreview(draft: AssistantDraft) {
  return `${draft.title}\n${draft.lines.map(line => `${line.label}: ${line.value}`).join('\n')}\n\nBelum ada perubahan. Konfirmasi hanya jika rinciannya benar.`;
}

async function createAssistantActionDraft(chatId: bigint, ownerId: number, draft: AssistantDraft) {
  const payload = { version: 1, kind: 'OWNER_ASSISTANT_ACTION', ownerId: String(ownerId), action: draft.action, payload: JSON.parse(JSON.stringify(draft.payload)), preview: assistantDraftPreview(draft) };
  const row = await prisma.telegramDraft.create({ data: { chatId, kind: 'OWNER_ASSISTANT_ACTION', payload, status: 'PENDING', expiresAt: new Date(Date.now() + DRAFT_TTL) }, select: { id: true } });
  return { draftId: row.id, preview: payload.preview };
}

async function confirmAssistantAction(callback: OwnerCallback, ownerId: number, row: { id: string; chatId: bigint; payload: unknown }) {
  const saved = row.payload as { version?: number; kind?: string; ownerId?: string; action?: unknown; payload?: unknown; preview?: unknown };
  if (saved.version !== 1 || saved.kind !== 'OWNER_ASSISTANT_ACTION' || saved.ownerId !== String(ownerId) || !isAssistantAction(saved.action) || !saved.payload || typeof saved.payload !== 'object') {
    return answerTelegramCallback(callback.id, 'Draf perubahan tidak valid. Tidak ada yang dijalankan.');
  }
  const claimed = await prisma.telegramDraft.updateMany({ where: { id: row.id, chatId: row.chatId, kind: 'OWNER_ASSISTANT_ACTION', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return answerTelegramCallback(callback.id, 'Konfirmasi ini sudah dipakai atau draf kedaluwarsa.');
  try {
    const linkedOwners = await prisma.user.findMany({ where: { role: 'owner', active: true }, select: { id: true, username: true, shift: true, telegramUserId: true }, take: 2 });
    const linked = linkedOwners.filter(user => user.telegramUserId === BigInt(ownerId));
    const owner = linked.length === 1 ? linked[0] : linkedOwners.length === 1 ? linkedOwners[0] : null;
    if (!owner) throw new Error('Akun owner RMCS belum dapat dipastikan. Hubungkan Telegram owner ke akun RMCS.');
    await withTelegramOwnerUser({ id: owner.id, username: owner.username, role: 'owner', shift: owner.shift }, () =>
      withAssistantAuthorization(() => applyAssistantDraft({ action: saved.action, payload: saved.payload })));
    await prisma.telegramDraft.update({ where: { id: row.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });
    await answerTelegramCallback(callback.id, 'Perubahan berhasil diterapkan.');
    return sendTelegramMessage(row.chatId, '✅ ' + (typeof saved.preview === 'string' ? saved.preview.split('\n')[0] : 'Perubahan') + ' berhasil diterapkan di RMCS.');
  } catch (error) {
    await prisma.telegramDraft.updateMany({ where: { id: row.id, status: 'PROCESSING' }, data: { status: 'FAILED' } });
    console.error(JSON.stringify({ event: 'telegram_owner_action_failed', action: saved.action, error: error instanceof Error ? error.message : 'unknown' }));
    await answerTelegramCallback(callback.id, 'Perubahan tidak dikonfirmasi sebagai berhasil. Periksa data RMCS sebelum mencoba ulang.');
    return sendTelegramMessage(row.chatId, `⚠️ ${error instanceof Error ? error.message : 'Perubahan gagal.'}\nDraf tidak dijalankan ulang otomatis.`);
  }
}

async function confirmOperation(callback: OwnerCallback, ownerId: number, draftId: string) {
  const chatId = BigInt(callback.message!.chat.id);
  const row = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  if (!row || row.chatId !== chatId || !['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(row.kind) || row.status !== 'PENDING' || row.expiresAt <= new Date()) {
    return answerTelegramCallback(callback.id, 'Draf tidak aktif. Tidak ada perubahan.');
  }
  if (row.kind === 'OWNER_ASSISTANT_ACTION') return confirmAssistantAction(callback, ownerId, row);
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
      const conversation = await tx.telegramDraft.findUnique({ where: { id: ownerConversationId(ownerId) } });
      const conversationState = conversation?.kind === 'OWNER_CONVERSATION' && conversation.chatId === chatId
        ? parseOwnerChatState(conversation.payload, ownerId) : null;
      if (conversationState?.proposalDraftId === draftId) {
        conversationState.actions = []; conversationState.selected = []; conversationState.pendingMatches = [];
        conversationState.proposalDraftId = null; conversationState.preview = null;
        conversationState.history = [...conversationState.history, { role: 'assistant' as const, content: 'Perubahan sudah diterapkan setelah konfirmasi owner.' }].slice(-12);
        await tx.telegramDraft.update({ where: { id: ownerConversationId(ownerId) }, data: { payload: conversationState as object } });
      }
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
    const changed = await prisma.telegramDraft.updateMany({ where: { id: draftId, chatId, kind: { in: ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'] }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
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
  const startedAt = Date.now();
  try {
    const { rowId, state } = await getOwnerChatState(chatId, ownerId);
    const claimed = await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
    if (claimed.count !== 1) return sendTelegramMessage(chatId, 'Saya sedang menyusun pesan sebelumnya. Tunggu sebentar lalu kirim lagi; belum ada perubahan yang diterapkan.');
    try {
      if (command?.[1].toLowerCase() === 'batal') {
        if (state.proposalDraftId) await prisma.telegramDraft.updateMany({ where: { id: state.proposalDraftId, chatId, kind: { in: ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'] }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        state.actions = []; state.selected = []; state.pendingMatches = []; state.proposalDraftId = null; state.preview = null;
        state.history = [...state.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: 'Rencana dibatalkan.' }].slice(-12);
        await saveOwnerChatState(rowId, chatId, state);
        return sendTelegramMessage(chatId, 'Rencana dibatalkan. Data RMCS tidak berubah.');
      }
      const priorActions = state.actions;
      // Only pass actions back as an active draft while a real, unexpired confirmation draft exists.
      // Clarification context remains available in the saved conversation history.
      const activeDraft = state.proposalDraftId
        ? await prisma.telegramDraft.findUnique({ where: { id: state.proposalDraftId } }) : null;
      const currentProposal = ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(activeDraft?.kind ?? '') && activeDraft?.status === 'PENDING' && activeDraft.expiresAt > new Date()
        ? state.actions : [];
      const memories = await prisma.assistantMemory.findMany({ where: { active: true }, orderBy: { id: 'desc' }, take: 30, select: { kind: true, term: true, content: true } });
      const memoryContext = memories.map(memory => JSON.stringify({ kind: memory.kind, term: memory.term, content: memory.content })).join(' ');
      const turn = await interpretOwnerTurn({ text, history: state.history, currentActions: currentProposal, memoryContext,
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
      return await renderOwnerActions(chatId, ownerId, rowId, state, reply, priorActions);
    } catch (error) {
      if (!(error instanceof OwnerAgentUnavailable) && !(error instanceof OwnerAssistantDatabaseError)) {
        logOwnerDiagnostic('owner_action_processing', 'operation_error', startedAt);
      }
      try {
        await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PROCESSING' },
          data: { status: 'PENDING' } });
      } catch {
        console.error(JSON.stringify({ event: 'owner_assistant_failure', stage: 'conversation_recovery', category: 'state_release_error' }));
      }
      const unavailable = error instanceof OwnerAgentUnavailable;
      return await sendTelegramMessage(chatId, unavailable
        ? 'Maaf, asisten AI sedang mengalami gangguan sementara. Rencana sebelumnya tetap tersimpan dan belum ada perubahan usaha yang diterapkan. Coba lagi sebentar.'
        : 'Maaf, saya belum berhasil memeriksa permintaan itu. Rencana sebelumnya tetap tersimpan dan belum ada perubahan usaha yang diterapkan. Coba kirim ulang sebentar lagi.');
    }
  } catch (error) {
    if (!(error instanceof OwnerAssistantDatabaseError)) logOwnerDiagnostic('conversation_state_read', 'state_access_error', startedAt);
    return sendTelegramMessage(chatId, 'Maaf, saya belum bisa memeriksa data toko sekarang. Tidak ada perubahan yang diterapkan; coba lagi sebentar.');
  }
}


type GroupAssistantState = { version: 1; history: OwnerChatMessage[]; lastReply?: string; processedUpdateIds?: string[] };
type GroupReadAction = Extract<OwnerAgentAction, { kind: 'search_products' | 'get_product_details' | 'get_inventory' | 'get_low_stock' }>;
function isGroupReadAction(action: OwnerAgentAction): action is GroupReadAction {
  return action.kind === 'search_products' || action.kind === 'get_product_details' || action.kind === 'get_inventory' || action.kind === 'get_low_stock';
}
const GROUP_ASSISTANT_TTL = 7 * 24 * 60 * 60_000;
function groupAssistantId(chatId: bigint, identityId: string) { return `group-assistant-${chatId}-${identityId}`; }
function groupProductLine(product: CatalogProduct) {
  return `• ${product.name}${product.sku ? ` · SKU ${product.sku}` : ''} · ${product.category.name}${product.provider ? ` · ${product.provider}` : ''}${product.validity ? ` · ${product.validity}` : ''} · stok ${product.stock} unit · harga jual ${formatIdr(product.sellPrice)}${product.location?.name ? ` · ${product.location.name}` : ''}`;
}

/** Read-only group assistant; catalog changes and financial reports remain owner-only. */
export async function handleGroupAssistantMessage(input: { chatId: bigint; identityId: string; text: string; updateId: string }) {
  const id = groupAssistantId(input.chatId, input.identityId), now = new Date();
  const initial: GroupAssistantState = { version: 1, history: [], processedUpdateIds: [] };
  let existing = await prisma.telegramDraft.findUnique({ where: { id } });
  if (!existing) {
    try {
      existing = await prisma.telegramDraft.create({ data: { id, chatId: input.chatId, telegramIdentityId: input.identityId,
        kind: 'GROUP_ASSISTANT', payload: initial as object, status: 'PENDING', expiresAt: new Date(Date.now() + GROUP_ASSISTANT_TTL) } });
    } catch (error) { if ((error as { code?: string }).code !== 'P2002') throw error; }
  }
  const claimed = await prisma.telegramDraft.updateMany({ where: { id, chatId: input.chatId, kind: 'GROUP_ASSISTANT', status: 'PENDING' },
    data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return sendTelegramMessage(input.chatId, 'Saya sedang memeriksa pertanyaan sebelumnya. Coba kirim lagi sebentar.');
  const claimedRow = await prisma.telegramDraft.findUnique({ where: { id } });
  const payload = claimedRow?.payload;
  const state: GroupAssistantState = claimedRow?.expiresAt && claimedRow.expiresAt > now && payload && typeof payload === 'object' &&
    (payload as GroupAssistantState).version === 1 && Array.isArray((payload as GroupAssistantState).history)
      ? { ...initial, ...(payload as GroupAssistantState), history: (payload as GroupAssistantState).history.slice(-12),
          processedUpdateIds: Array.isArray((payload as GroupAssistantState).processedUpdateIds) ? (payload as GroupAssistantState).processedUpdateIds!.slice(-80) : [] }
      : initial;
  if (state.processedUpdateIds?.includes(input.updateId)) {
    await prisma.telegramDraft.update({ where: { id }, data: { status: 'PENDING' } });
    return sendTelegramMessage(input.chatId, state.lastReply ?? 'Pesan itu sudah diproses.');
  }
  try {
    const turn = await interpretOwnerTurn({ text: input.text, history: state.history, currentActions: [],
      apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
    let reply = '';
    if (turn.actions.some(action => !isGroupReadAction(action))) {
      reply = 'Di grup saya hanya bisa membantu cek informasi barang. Untuk menambah atau mengubah katalog, harga, dan stok, minta owner melakukannya lewat chat pribadi.';
    } else if (turn.clarification) {
      reply = turn.clarification;
    } else if (!turn.actions.length) {
      reply = 'Saya bisa bantu cek harga dan stok barang di grup. Untuk menambah atau mengubah produk, stok, harga, atau lokasi, minta owner lewat chat pribadi.';
    } else {
      const catalog = await getCatalog();
      const evidence: string[] = [];
      for (const action of turn.actions.filter(isGroupReadAction)) {
        if (action.kind === 'get_low_stock') {
          const low = catalog.filter(product => product.stock <= product.minStock).slice(0, 15);
          evidence.push(low.length ? 'Barang yang perlu diperhatikan: ' + low.map(product => `${product.name}: ${product.stock} unit (batas ${product.minStock})`).join('; ')
            : 'Tidak ada barang yang berada pada atau di bawah batas stok minimum.');
          continue;
        }
        const query = action.query;
        if (!query) { evidence.push('Sebutkan nama barang yang ingin dicek stoknya.'); continue; }
        const matches = await findProductCandidates(query, catalog);
        if (!matches.length) { evidence.push(`Saya belum menemukan barang “${query}” di katalog RMCS.`); continue; }
        if (matches.length > 1 && action.kind !== 'search_products') {
          evidence.push(`Ada beberapa barang yang cocok dengan “${query}”: ${matches.slice(0, 5).map(groupProductLine).join(' | ')}. Sebutkan nama atau variannya supaya saya bisa memastikan.`);
          continue;
        }
        evidence.push((action.kind === 'search_products' ? 'Hasil pencarian: ' : 'Data barang: ') + matches.slice(0, 5).map(groupProductLine).join('\n'));
      }
      reply = await composeOwnerReply({ text: input.text, history: state.history, evidence,
        apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL }) ?? evidence.join('\n');
      if (evidence.length) reply += '\n\n' + evidence.join('\n');
    }
    const response = reply.slice(0, 3500);
    const nextHistory: OwnerChatMessage[] = [...state.history, { role: 'user', content: input.text.slice(0, 1000) },
      { role: 'assistant', content: response.slice(0, 1200) }];
    state.history = nextHistory.slice(-12);
    state.lastReply = response;
    state.processedUpdateIds = [...(state.processedUpdateIds ?? []), input.updateId].slice(-80);
    await prisma.telegramDraft.update({ where: { id }, data: { payload: state as object, status: 'PENDING', expiresAt: new Date(Date.now() + GROUP_ASSISTANT_TTL) } });
    return sendTelegramMessage(input.chatId, response);
  } catch (error) {
    await prisma.telegramDraft.updateMany({ where: { id, kind: 'GROUP_ASSISTANT', status: 'PROCESSING' },
      data: { status: 'PENDING', expiresAt: new Date(Date.now() + GROUP_ASSISTANT_TTL) } });
    if (error instanceof OwnerAgentUnavailable) return sendTelegramMessage(input.chatId, 'Maaf, saya belum berhasil memahami pertanyaan itu. Coba sebutkan nama barang dan apakah ingin cek harga atau stok.');
    throw error;
  }
}

