import { prisma } from '@/lib/prisma';
import { computeCash } from '@/lib/automation';
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
type OwnerChatState = { version: 1; ownerId: string; history: OwnerChatMessage[]; actions: OwnerAgentAction[]; menuFlow?: string | null;
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
const OWNER_MENU_PAGES = {
  home: { title: 'Menu Owner R-CELL', rows: [
    [{ text: '📊 Ringkasan', callback_data: 'rcms:owner:menu:summary' }, { text: '📦 Produk & Stok', callback_data: 'rcms:owner:menu:catalog' }],
    [{ text: '💰 Transaksi', callback_data: 'rcms:owner:menu:sales' }, { text: '🧾 Keuangan & Saldo', callback_data: 'rcms:owner:menu:finance' }],
    [{ text: '🕒 Shift & Opname', callback_data: 'rcms:owner:menu:shift' }, { text: '🧠 Aturan Toko', callback_data: 'rcms:owner:menu:memory' }],
    [{ text: '✅ Persetujuan', callback_data: 'rcms:owner:menu:approval' }],
  ] },
  summary: { title: 'Ringkasan', body: 'Lihat saldo, laporan/profit, nilai stok, piutang, dan stok menipis.' },
  catalog: { title: 'Produk & Stok', body: 'Cek dan kelola produk, harga, stok, lokasi, kategori, serta audit katalog.' },
  sales: { title: 'Transaksi & Piutang', body: 'Buat/koreksi/retur penjualan dan kelola bon.' },
  finance: { title: 'Keuangan & Saldo', body: 'Perbarui saldo gabungan kas + elektronik, catat pengeluaran dan biaya jasa, atau lihat laporan periode tertentu.' },
  shift: { title: 'Shift & Stock Opname', body: 'Tutup shift dan kelola hasil stock opname.' },
  memory: { title: 'Aturan Toko', body: 'Ajari asisten istilah/aturan toko atau minta ia melupakan aturan yang tersimpan.' },
  approval: { title: 'Persetujuan Owner', body: 'Berikut draf perubahan yang menunggu keputusan Owner.' },
};
type OwnerMenuPage = keyof typeof OWNER_MENU_PAGES;
const OWNER_MENU_ACTIONS: Partial<Record<OwnerMenuPage, Array<{ id: string; label: string; prompt: string }>>> = {
  summary: [
    { id: 'balance_read', label: 'Lihat saldo total', prompt: '' },
    { id: 'report_today', label: 'Laporan hari ini', prompt: '' },
    { id: 'inventory_value', label: 'Nilai inventory & modal', prompt: '' },
    { id: 'debt_report', label: 'Daftar piutang/bon', prompt: '' },
    { id: 'low_stock', label: 'Stok menipis', prompt: '' },
  ],
  catalog: [
    { id: 'product_info', label: 'Cek harga/stok barang', prompt: 'Barang mana yang ingin dicek? Sebut nama atau SKU-nya.' },
    { id: 'product_create', label: 'Tambah barang baru', prompt: 'Sebut nama dan kategori barang. Saya akan tanyakan harga, stok, dan informasi yang belum ada.' },
    { id: 'stock_in', label: 'Tambah stok', prompt: 'Sebut barang dan jumlah yang masuk. Tambahkan harga modal jika ada.' },
    { id: 'stock_adjust', label: 'Koreksi stok', prompt: 'Sebut barang, jumlah stok fisik yang benar, dan alasan koreksi.' },
    { id: 'price_update', label: 'Ubah harga satu barang', prompt: 'Sebut nama barang, harga jual atau modal yang diubah, dan harga barunya.' },
    { id: 'price_bulk', label: 'Ubah harga massal', prompt: 'Sebut cakupan (semua barang/kategori/subkategori) dan persentase margin yang diinginkan.' },
    { id: 'location_move', label: 'Pindah lokasi barang', prompt: 'Sebut nama barang dan lokasi tujuan.' },
    { id: 'category_manage', label: 'Kategori & subkategori', prompt: 'Sebut tindakan (buat/ubah/hapus), nama kategori, dan nama baru jika mengubah.' },
    { id: 'catalog_update', label: 'Ubah informasi katalog', prompt: 'Sebut nama barang dan informasi yang ingin diubah, misalnya nama, SKU, provider, kategori, atau stok minimum.' },
    { id: 'catalog_delete', label: 'Hapus barang dari katalog', prompt: 'Sebut nama barang yang ingin dihapus. Saya akan memeriksa riwayatnya sebelum menyiapkan draf.' },
    { id: 'catalog_audit', label: 'Audit & rapikan katalog', prompt: 'Sebut kategori atau masalah katalog yang ingin diperiksa; jika tidak disebut, seluruh katalog akan ditinjau.' },
  ],
  sales: [
    { id: 'sale_create', label: 'Catat penjualan', prompt: 'Sebut barang dan jumlah yang terjual; jika ada beberapa, kirim semua rinciannya.' },
    { id: 'sale_edit', label: 'Koreksi penjualan', prompt: 'Sebut ID penjualan, barang, dan jumlah yang benar.' },
    { id: 'sale_return', label: 'Retur penjualan', prompt: 'Sebut ID penjualan, barang yang diretur, jumlah, dan alasan jika ada.' },
    { id: 'debt_create', label: 'Catat bon', prompt: 'Sebut nama pelanggan, nominal bon, dan keterangan barang jika ada.' },
    { id: 'debt_pay', label: 'Terima pembayaran bon', prompt: 'Sebut nama pelanggan dan jumlah pembayaran.' },
    { id: 'debt_delete', label: 'Hapus bon', prompt: 'Sebut nama pelanggan dan bon yang ingin dihapus.' },
  ],
  finance: [
    { id: 'balance_update', label: 'Perbarui saldo total', prompt: 'Berapa saldo aktual gabungan kas + elektronik sekarang? Contoh: 25 juta 168 ribu.' },
    { id: 'expense_create', label: 'Catat pengeluaran', prompt: 'Sebut nama pengeluaran dan nominalnya.' },
    { id: 'service_create', label: 'Catat biaya admin/jasa', prompt: 'Sebut jumlah layanan dan total biaya admin/jasa yang diterima.' },
    { id: 'report_period', label: 'Laporan periode tertentu', prompt: 'Sebut tanggal laporan, misalnya “laporan tanggal 28 Oktober 2026”.' },
  ],
  shift: [
    { id: 'shift_close', label: 'Tutup shift', prompt: 'Sebut shift yang ditutup dan saldo aktual untuk dicocokkan.' },
    { id: 'opname_record', label: 'Catat hasil opname', prompt: 'Sebut nama barang dan jumlah fisik hasil hitung.' },
    { id: 'opname_review', label: 'Tinjau hasil opname', prompt: 'Sebut barang yang hasil opname-nya ingin ditinjau.' },
    { id: 'opname_apply', label: 'Terapkan hasil opname', prompt: 'Sebut barang yang hasil opname-nya ingin diterapkan.' },
    { id: 'opname_delete', label: 'Hapus hasil opname', prompt: 'Sebut barang yang hasil opname-nya ingin dihapus.' },
  ],
  memory: [
    { id: 'memory_save', label: 'Ingat istilah/aturan', prompt: 'Kirim istilah atau aturan toko yang perlu saya ingat.' },
    { id: 'memory_forget', label: 'Lupakan istilah/aturan', prompt: 'Sebut istilah atau aturan yang ingin dilupakan.' },
  ],
  approval: [{ id: 'approval_help', label: 'Perbarui daftar persetujuan', prompt: '' }],
};
function ownerMenuKeyboard(page: OwnerMenuPage = 'home'): InlineKeyboard {
  if (page === 'home') return keyboard(OWNER_MENU_PAGES.home.rows);
  const actions = OWNER_MENU_ACTIONS[page] ?? [];
  const rows = actions.reduce<Array<Array<{ text: string; callback_data: string }>>>((result, action, index) => {
    if (index % 2 === 0) result.push([]);
    result[result.length - 1].push({ text: action.label, callback_data: 'rcms:owner:menu:do:' + action.id });
    return result;
  }, []);
  rows.push([{ text: '⬅️ Menu Owner', callback_data: 'rcms:owner:menu:home' }]);
  return keyboard(rows);
}
function ownerFlowKeyboard(): InlineKeyboard {
  return keyboard([[{ text: '✖️ Batal', callback_data: 'rcms:owner:menu:flow_cancel' }, { text: '⬅️ Menu Owner', callback_data: 'rcms:owner:menu:home' }]]);
}
async function showOwnerHome(chatId: bigint, ownerId: number) {
  const { rowId, state } = await getOwnerChatState(chatId, ownerId);
  if (state.menuFlow) {
    state.menuFlow = null; state.history = []; state.actions = []; state.selected = []; state.pendingMatches = [];
    await saveOwnerChatState(rowId, chatId, state);
  }
  return showOwnerMenu(chatId);
}
async function showOwnerMenu(chatId: bigint, page: OwnerMenuPage = 'home') {
  if (page === 'home') return sendTelegramMessage(chatId, OWNER_MENU_PAGES.home.title + '\nPilih kelompok fitur:', ownerMenuKeyboard(page));
  const content = OWNER_MENU_PAGES[page];
  return sendTelegramMessage(chatId, '【' + content.title + '】\n\n' + content.body + '\n\nPilih fitur:', ownerMenuKeyboard(page));
}
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

async function showInventoryValue(chatId: bigint) {
  const catalog = await getCatalog();
  if (catalog.length > 3000) return sendTelegramMessage(chatId, 'Katalog terlalu besar untuk menghitung nilai inventory dengan aman.');
  const modal = catalog.reduce((sum, product) => sum + product.costPrice * BigInt(product.stock), 0n);
  const retail = catalog.reduce((sum, product) => sum + product.sellPrice * BigInt(product.stock), 0n);
  return sendTelegramMessage(chatId, `Nilai inventory saat ini (${catalog.length} produk):\nTotal modal: ${formatIdr(modal)}\nNilai pada harga jual: ${formatIdr(retail)}\nSelisih: ${formatIdr(retail - modal)}`);
}
async function showLowStock(chatId: bigint) {
  const catalog = await getCatalog();
  if (catalog.length > 3000) return sendTelegramMessage(chatId, 'Katalog terlalu besar untuk memeriksa stok menipis dengan aman.');
  const items = catalog.filter(product => product.stock <= product.minStock).sort((a, b) => a.stock - b.stock);
  return sendTelegramMessage(chatId, items.length
    ? `Barang menipis/habis (${items.length}):\n${items.slice(0, 25).map(product => `• ${product.name}: ${product.stock} (minimum ${product.minStock})${product.location?.name ? ` · ${product.location.name}` : ''}`).join('\n')}${items.length > 25 ? `\n…dan ${items.length - 25} barang lainnya.` : ''}`
    : 'Tidak ada barang yang mencapai batas stok minimum saat ini.');
}
async function showDebtReport(chatId: bigint) {
  const debts = await prisma.debt.findMany({ where: { status: 'BELUM' }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, customer: true, amount: true, paid: true, description: true, createdAt: true } });
  const open = debts.filter(debt => debt.amount > debt.paid);
  const total = open.reduce((sum, debt) => sum + debt.amount - debt.paid, 0n);
  return sendTelegramMessage(chatId, open.length
    ? `Piutang belum lunas (${open.length}${debts.length === 100 ? '+' : ''}) · total ${formatIdr(total)}:\n${open.slice(0, 25).map(debt => `• ${debt.customer}: ${formatIdr(debt.amount - debt.paid)}${debt.description ? ` · ${debt.description}` : ''}`).join('\n')}${open.length > 25 ? `\n…dan ${open.length - 25} bon lainnya.` : ''}`
    : 'Tidak ada piutang yang belum lunas.');
}

function isCombinedBalanceQuestion(text: string) {
  return /(?:\b(?:berapa|brp)\b.{0,40}\b(?:saldo|kas|cash|uang)\b|\b(?:saldo|cash|kas|uang)\b.{0,40}\b(?:berapa|brp)\b|\b(?:cek|lihat|tampilkan|posisi)\b.{0,20}\bsaldo\b)/i.test(text);
}
async function showCombinedBalance() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { balanceInitial: true } });
  const total = await computeCash() + (settings?.balanceInitial ?? 0n);
  return 'Saldo total kas + elektronik yang tercatat sekarang: ' + formatIdr(total) + '.';
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
    preview: typeof state.preview === 'string' ? state.preview : null,
    menuFlow: typeof state.menuFlow === 'string' ? state.menuFlow : null } as OwnerChatState;
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
      pendingMatches: [], proposalDraftId: null, preview: null, menuFlow: null };
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

async function beginOwnerMenuFlow(chatId: bigint, ownerId: number, action: { id: string; label: string; prompt: string }) {
  const { rowId, state } = await getOwnerChatState(chatId, ownerId);
  const claimed = await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
  if (claimed.count !== 1) return sendTelegramMessage(chatId, 'Saya sedang memproses pesan sebelumnya. Tunggu sebentar lalu pilih lagi.');
  try {
    const pending = state.proposalDraftId ? await prisma.telegramDraft.findUnique({ where: { id: state.proposalDraftId } }) : null;
    if (pending && ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(pending.kind) && pending.status === 'PENDING' && pending.expiresAt > new Date()) {
      await saveOwnerChatState(rowId, chatId, state);
      return sendTelegramMessage(chatId, 'Masih ada draf yang menunggu keputusan. Konfirmasikan/batalkan draf itu dulu, atau buka menu Persetujuan.');
    }
    state.history = [
      { role: 'user', content: `Saya memilih fitur Owner: ${action.label}.` },
      { role: 'assistant', content: action.prompt },
    ];
    state.actions = []; state.selected = []; state.pendingMatches = [];
    state.proposalDraftId = null; state.preview = null; state.menuFlow = action.id;
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, action.prompt, ownerFlowKeyboard());
  } catch (error) {
    await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PROCESSING' }, data: { status: 'PENDING' } });
    throw error;
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
function uniqueMessages(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return parts.map(part => part?.trim() ?? '').filter(part => {
    if (!part) return false;
    const key = part.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n\n');
}
function clarificationReply(content: string, clarification: string) {
  const details = uniqueMessages([content, clarification])
    .replace(/\bBelum ada perubahan\b[.!?]*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [details, 'Belum ada perubahan.'].filter(Boolean).join('\n\n');
}
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

  if (kind === 'balance_update') {
    const actualBalance = amount('actualBalance');
    if (actualBalance === null) return { clarification: 'Sebutkan saldo total kas + elektronik yang benar sekarang, misalnya “saldo total 25 juta 168 ribu”.' };
    const settings = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, storeName: 'R CELL', cashInitial: 0n, balanceInitial: 0n } });
    const currentBalance = await computeCash() + settings.balanceInitial;
    const note = text('note', 240);
    return build('balance.update', 'Draf pembaruan saldo total', [
      { label: 'Saldo tercatat (kas + elektronik)', value: formatIdr(currentBalance) },
      { label: 'Saldo total aktual', value: formatIdr(actualBalance), emphasis: true },
      { label: 'Selisih penyesuaian', value: formatIdr(actualBalance - currentBalance), emphasis: true },
      ...(note ? [{ label: 'Catatan', value: note }] : []),
    ], { actualBalance: actualBalance.toString(), expectedBalance: currentBalance.toString(), ...(note ? { note } : {}) });
  }
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
        if (prior) prior.qty += qty as number; else resolvedItems.push({ product: resolved.product, qty: qty as number });
      }
      const short = resolvedItems.find(item => item.product.stock < item.qty);
      if (short) return { clarification: `Jumlah terjual ${short.qty} melebihi stok ${short.product.stock} untuk ${short.product.name}.` };
      const items = resolvedItems.map(item => ({ productId: item.product.id, qty: item.qty }));
      const expectedPrices = resolvedItems.map(item => ({ productId: item.product.id, sellPrice: item.product.sellPrice.toString() }));
      const lines = resolvedItems.map(item => ({ label: item.product.name, value: `${item.qty} unit × ${formatIdr(item.product.sellPrice)} (stok ${item.product.stock})`, emphasis: true }));
      return build('sale.create', 'Draf penjualan baru', lines, { items, expectedPrices });
    }
    if (!saleId) return { clarification: 'Sebutkan nomor penjualan yang ingin dikoreksi atau diretur.' };
    const sale = await prisma.saleTransaction.findUnique({ where: { id: saleId }, include: { items: { include: { product: true } } } });
    if (!sale || sale.kind !== 'SALE') return { clarification: `Penjualan #${saleId} tidak ditemukan.` };
    if (kind === 'sale_return') {
      const items: Array<{ productId: number; qty: number }> = [], lines: AssistantDraft['lines'] = [];
      for (const raw of rawItems as Array<Record<string, unknown>>) {
        const name = typeof raw.productName === 'string' ? raw.productName.trim().toLowerCase() : '', qty = raw.qty;
        const item = sale.items.find(row => row.product.name.toLowerCase() === name || row.product.name.toLowerCase().includes(name));
        if (!item || !Number.isSafeInteger(qty) || (qty as number) <= 0) return { clarification: `Barang retur “${name}” atau jumlahnya belum cocok dengan penjualan #${saleId}.` };
        items.push({ productId: item.productId, qty: qty as number }); lines.push({ label: item.product.name, value: `${qty} unit`, emphasis: true });
      }
      const reason = text('reason', 200);
      if (reason) lines.push({ label: 'Alasan', value: reason });
      return build('sale.return', `Draf retur penjualan #${saleId}`, lines, { saleId, items, reason });
    }
    const { start, end } = jakartaTodayBounds();
    if (sale.createdAt < start || sale.createdAt >= end) return { clarification: 'Koreksi lewat asisten hanya tersedia untuk penjualan hari ini; penjualan lama perlu ditinjau lewat Web App.' };
    const changed = new Map<number, number>();
    for (const raw of rawItems as Array<Record<string, unknown>>) {
      const name = typeof raw.productName === 'string' ? raw.productName.trim() : '', qty = raw.qty;
      if (!name || !Number.isSafeInteger(qty) || (qty as number) < 0) return { clarification: 'Koreksi perlu nama barang dan jumlah baru yang jelas.' };
      const existing = sale.items.filter(item => item.product.name.toLowerCase() === name.toLowerCase() || item.product.name.toLowerCase().includes(name.toLowerCase()));
      if (existing.length !== 1) return { clarification: `Barang “${name}” belum cocok ke satu baris di penjualan #${saleId}.` };
      changed.set(existing[0].productId, qty as number);
    }
    const merged = sale.items.filter(item => (changed.get(item.productId) ?? item.qty) > 0).map(item => ({ productId: item.productId, qty: changed.get(item.productId) ?? item.qty, expectedPrice: item.priceAtSale.toString() }));
    if (!merged.length) return { clarification: 'Koreksi tidak boleh menghapus seluruh barang dari penjualan.' };
    return build('sale.edit', `Draf koreksi penjualan #${saleId}`, merged.map(item => ({ label: sale.items.find(old => old.productId === item.productId)!.product.name, value: `${item.qty} unit` })), { saleId, expectedSignature: saleSnapshotSignature(sale), items: merged });
  }

  if (kind === 'debt_create') {
    const customer = text('customer', 80), total = amount('amount');
    if (!customer || !total || total <= 0n) return { clarification: 'Catat bon perlu nama pelanggan dan nominal yang jelas.' };
    return build('debt.create', 'Draf catat bon', [{ label: 'Pelanggan', value: customer, emphasis: true }, { label: 'Nominal', value: formatIdr(total), emphasis: true }, ...(text('description', 200) ? [{ label: 'Keterangan', value: text('description', 200)! }] : [])], { customer, amount: total.toString(), description: text('description', 200) });
  }
  if (kind === 'debt_pay' || kind === 'debt_delete') {
    const customer = text('customer', 80); if (!customer) return { clarification: 'Sebutkan nama pelanggan pemilik bon.' };
    const candidates = await prisma.debt.findMany({ where: { customer: { contains: customer, mode: 'insensitive' }, ...(kind === 'debt_pay' ? { status: 'BELUM' } : {}) }, orderBy: { createdAt: 'desc' }, take: 10 });
    if (candidates.length !== 1) return { clarification: candidates.length ? `Ada beberapa bon cocok: ${candidates.map(d => `${d.customer} #${d.id}`).join(', ')}. Sebutkan pelanggan/bon yang tepat.` : `Bon untuk ${customer} tidak ditemukan.` };
    const debt = candidates[0], remaining = debt.amount - debt.paid;
    if (kind === 'debt_delete') return build('debt.delete', 'Draf hapus bon', [{ label: 'Pelanggan', value: debt.customer, emphasis: true }, { label: 'Sisa bon', value: formatIdr(remaining) }], { debtId: debt.id });
    const paid = amount('amount'); if (!paid || paid <= 0n || paid > remaining) return { clarification: `Nominal pembayaran harus lebih dari 0 dan tidak melebihi sisa bon ${formatIdr(remaining)}.` };
    return build('debt.pay', 'Draf pembayaran bon', [{ label: 'Pelanggan', value: debt.customer, emphasis: true }, { label: 'Sisa bon', value: formatIdr(remaining) }, { label: 'Dibayar', value: formatIdr(paid), emphasis: true }], { debtId: debt.id, amount: paid.toString(), note: text('note', 200) });
  }
  if (kind === 'expense_create') {
    const name = text('name', 100), value = amount('amount'); if (!name || !value || value <= 0n) return { clarification: 'Pengeluaran perlu nama dan nominal positif yang jelas.' };
    return build('expense.create', 'Draf pengeluaran', [{ label: 'Pengeluaran', value: name }, { label: 'Nominal', value: formatIdr(value), emphasis: true }], { name, amount: value.toString() });
  }
  if (kind === 'service_create') {
    const count = number('count', 1), value = amount('profit'); if (!count || value === null) return { clarification: 'Biaya admin perlu jumlah transaksi dan total admin yang jelas.' };
    return build('service.create', 'Draf biaya admin/jasa', [{ label: 'Transaksi', value: String(count) }, { label: 'Total admin', value: formatIdr(value), emphasis: true }], { count, profit: value.toString() });
  }
  if (kind === 'shift_close') {
    const actualCash = amount('actualCash'); const note = text('note', 500);
    const lines: AssistantDraft['lines'] = [{ label: 'Kas fisik', value: actualCash === null ? 'Belum disebut' : formatIdr(actualCash), emphasis: actualCash !== null }];
    if (note) lines.push({ label: 'Catatan', value: note });
    return build('shift.close', 'Draf tutup shift', lines, { ...(actualCash === null ? {} : { actualCash: Number(actualCash) }), ...(note ? { note } : {}) });
  }
  if (kind.startsWith('opname_')) {
    const name = text('productName'); if (!name) return { clarification: 'Sebutkan nama barang untuk stock opname.' };
    const resolved = await chooseProduct(name); if (!resolved.product) return { clarification: resolved.issue };
    const p = resolved.product;
    if (kind === 'opname_record') {
      const physicalStock = number('physicalStock'); if (physicalStock === null) return { clarification: 'Sebutkan jumlah fisik hasil hitung.' };
      return build('opname.record', 'Draf catat stock opname', [{ label: 'Barang', value: p.name }, { label: 'Stok sistem', value: String(p.stock) }, { label: 'Stok fisik', value: String(physicalStock), emphasis: true }, { label: 'Selisih', value: String(physicalStock - p.stock) }], { productId: p.id, physicalStock, note: text('note', 200) });
    }
    const opname = await prisma.stockOpname.findFirst({ where: { productId: p.id, reviewStatus: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!opname) return { clarification: `Tidak ada hasil opname yang menunggu untuk ${p.name}.` };
    const action = kind === 'opname_apply' ? 'opname.apply' : kind === 'opname_review' ? 'opname.review' : 'opname.delete';
    return build(action, `Draf ${kind === 'opname_apply' ? 'terapkan' : kind === 'opname_review' ? 'tinjau' : 'hapus'} opname`, [{ label: 'Barang', value: p.name }, { label: 'Sistem → fisik', value: `${opname.systemStock} → ${opname.physicalStock}`, emphasis: true }, { label: 'Selisih', value: String(opname.diff) }], { opnameId: opname.id });
  }
  if (kind.startsWith('category_')) {
    const name = text('categoryName') ?? text('name'); if (!name) return { clarification: 'Sebutkan nama kategori.' };
    const category = await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (kind === 'category_create') {
      if (category) return { clarification: `Kategori ${name} sudah ada.` };
      return build('category.create', 'Draf tambah kategori', [{ label: 'Kategori baru', value: name, emphasis: true }], { name });
    }
    if (!category) return { clarification: `Kategori ${name} tidak ditemukan.` };
    if (kind === 'category_delete') return build('category.delete', 'Draf hapus kategori', [{ label: 'Kategori', value: category.name, emphasis: true }, { label: 'Barang terkait', value: String(await prisma.product.count({ where: { categoryId: category.id } })) }], { categoryId: category.id });
    const newName = text('newName', 60); if (!newName) return { clarification: 'Sebutkan nama kategori yang baru.' };
    return build('category.rename', 'Draf ubah nama kategori', [{ label: 'Kategori', value: category.name }, { label: 'Nama baru', value: newName, emphasis: true }], { categoryId: category.id, name: newName });
  }
  if (kind.startsWith('subcategory_')) {
    const categoryName = text('categoryName', 60), subName = text('subcategoryName', 60); if (!categoryName || !subName) return { clarification: 'Sebutkan nama kategori dan subkategori.' };
    const category = await prisma.category.findFirst({ where: { name: { equals: categoryName, mode: 'insensitive' } } }); if (!category) return { clarification: `Kategori ${categoryName} tidak ditemukan.` };
    const sub = await prisma.subcategory.findFirst({ where: { categoryId: category.id, name: { equals: subName, mode: 'insensitive' } } });
    if (kind === 'subcategory_create') { if (sub) return { clarification: `Subkategori ${subName} sudah ada.` }; return build('subcategory.create', 'Draf tambah subkategori', [{ label: 'Kategori', value: category.name }, { label: 'Subkategori', value: subName, emphasis: true }], { categoryId: category.id, name: subName }); }
    if (!sub) return { clarification: `Subkategori ${subName} tidak ditemukan di ${category.name}.` };
    if (kind === 'subcategory_delete') return build('subcategory.delete', 'Draf hapus subkategori', [{ label: 'Kategori', value: category.name }, { label: 'Subkategori', value: sub.name, emphasis: true }], { subcategoryId: sub.id });
    const newName = text('newName', 60); if (!newName) return { clarification: 'Sebutkan nama subkategori yang baru.' };
    return build('subcategory.rename', 'Draf ubah nama subkategori', [{ label: 'Kategori', value: category.name }, { label: 'Subkategori', value: sub.name }, { label: 'Nama baru', value: newName, emphasis: true }], { subcategoryId: sub.id, name: newName });
  }
  if (kind === 'price_bulk') {
    const scope = data.scope === 'category' || data.scope === 'subcategory' ? data.scope : data.scope === 'all' ? 'all' : null;
    const marginPercent = typeof data.marginPercent === 'number' && Number.isFinite(data.marginPercent) && data.marginPercent >= 0 && data.marginPercent <= 1000 ? data.marginPercent : null;
    if (!scope || marginPercent === null) return { clarification: 'Sebutkan cakupan perubahan (semua barang/kategori/subkategori) dan persentase margin.' };
    const payload: Record<string, unknown> = { scope, marginPercent };
    let where: Record<string, unknown> = {};
    if (scope === 'category') { const name = text('categoryName', 60); const c = name && await prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }); if (!c) return { clarification: 'Kategori untuk ubah harga massal tidak ditemukan.' }; payload.categoryId = c.id; where = { categoryId: c.id }; }
    if (scope === 'subcategory') { const name = text('subcategoryName', 60); const sub = name && await prisma.subcategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }); if (!sub) return { clarification: 'Subkategori untuk ubah harga massal tidak ditemukan.' }; payload.subcategoryId = sub.id; where = { subcategoryId: sub.id }; }
    const products = await prisma.product.findMany({ where, select: { name: true, costPrice: true, sellPrice: true }, take: 501 });
    if (!products.length || products.length > 500) return { clarification: products.length ? 'Cakupan lebih dari 500 produk; pecah perubahan agar aman.' : 'Tidak ada barang pada cakupan itu.' };
    return build('price.bulk', 'Draf ubah harga massal', [{ label: 'Cakupan', value: scope === 'all' ? 'Semua barang' : text(scope === 'category' ? 'categoryName' : 'subcategoryName')! }, { label: 'Produk terdampak', value: String(products.length), emphasis: true }, { label: 'Margin', value: `${marginPercent}%` }, { label: 'Contoh barang', value: products.slice(0, 5).map(p => `${p.name} (${formatIdr(p.sellPrice)})`).join(', ') }], payload);
  }
  if (kind === 'catalog_update') {
    const productName = text('productName'); if (!productName) return { clarification: 'Sebutkan nama produk yang ingin diubah.' };
    const resolved = await chooseProduct(productName); if (!resolved.product) return { clarification: resolved.issue };
    const p = resolved.product, payload: Record<string, unknown> = { productId: p.id }, changes: AssistantDraft['lines'] = [];
    const newName = text('name', 180); if (newName) { payload.name = newName; changes.push({ label: 'Nama', value: `${p.name} → ${newName}` }); }
    if (typeof data.categoryName === 'string') {
      const category = await prisma.category.findFirst({ where: { name: { equals: data.categoryName.trim(), mode: 'insensitive' } } });
      if (!category) return { clarification: `Kategori ${data.categoryName} tidak ditemukan.` };
      payload.categoryId = category.id; payload.subcategoryId = null; changes.push({ label: 'Kategori', value: `${p.category.name} → ${category.name}` });
    }
    if (typeof data.subcategoryName === 'string') {
      const sub = await prisma.subcategory.findFirst({ where: { name: { equals: data.subcategoryName.trim(), mode: 'insensitive' }, ...(typeof payload.categoryId === 'number' ? { categoryId: payload.categoryId } : { categoryId: (await prisma.product.findUnique({ where: { id: p.id }, select: { categoryId: true } }))!.categoryId }) } });
      if (!sub) return { clarification: `Subkategori ${data.subcategoryName} tidak ditemukan pada kategori tujuan.` };
      payload.subcategoryId = sub.id; changes.push({ label: 'Subkategori', value: sub.name });
    }
    for (const field of ['sku', 'provider', 'validity'] as const) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const value = text(field, field === 'sku' ? 80 : 100); payload[field] = value;
        changes.push({ label: field === 'sku' ? 'SKU' : field === 'provider' ? 'Provider' : 'Masa aktif', value: `${(p[field] ?? '—')} → ${value ?? 'dihapus'}` });
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, 'minStock')) {
      const minStock = number('minStock'); if (minStock === null) return { clarification: 'Batas stok minimum harus angka bulat 0 atau lebih.' };
      payload.minStock = minStock; changes.push({ label: 'Stok minimum', value: `${p.minStock} → ${minStock}` });
    }
    if (!changes.length) return { clarification: 'Sebutkan bagian produk yang ingin diubah.' };
    return build('catalog.update', 'Draf ubah informasi produk', [{ label: 'Produk', value: p.name, emphasis: true }, ...changes], payload);
  }  if (kind === 'catalog_delete') {
    const name = text('productName'); if (!name) return { clarification: 'Sebutkan nama barang yang ingin dihapus.' };
    const resolved = await chooseProduct(name); if (!resolved.product) return { clarification: resolved.issue };
    return build('catalog.delete', 'Draf hapus barang', [{ label: 'Barang', value: resolved.product.name, emphasis: true }, { label: 'Catatan', value: 'Penghapusan ditolak jika barang punya riwayat transaksi/stok.' }], { productId: resolved.product.id });
  }
  if (kind === 'catalog_audit') {
    const rawFocus = Array.isArray(data.focus) ? data.focus : [];
    const focus = rawFocus.filter((item): item is AuditKind => typeof item === 'string' && (AUDIT_KINDS as readonly string[]).includes(item));
    const categories = Array.isArray(data.categories) ? data.categories.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 50) : [];
    const report = await analyzeCatalog({ categoryNames: categories }); const selected = focus.length ? focus : [...AUDIT_KINDS];
    const ops = cleanupsForKinds(report, selected).slice(0, 200);
    if (!ops.length) return { clarification: `Audit selesai: tidak ada perapian aman yang perlu diterapkan. Temuan total ${report.findings.length}; tidak ada perubahan dibuat.` };
    return build('catalog.cleanup', 'Draf perapian katalog', [{ label: 'Barang yang akan dirapikan', value: String(ops.length), emphasis: true }, { label: 'Cakupan', value: categories.length ? categories.join(', ') : 'Semua kategori' }, { label: 'Contoh ID barang', value: ops.slice(0, 8).map(op => String(op.productId)).join(', ') }], { operations: ops });
  }
  if (kind === 'memory_save') {
    const memoryKind = data.kind === 'SYNONYM' || data.kind === 'STYLE' || data.kind === 'PREFERENCE' ? data.kind : null;
    const content = text('content', 300), term = text('term', 80);
    if (!memoryKind || !content || (memoryKind === 'SYNONYM' && !term)) return { clarification: 'Sebutkan jenis memori, isi yang harus diingat, dan istilah bila itu sinonim.' };
    return build('memory.save', 'Draf simpan memori', [{ label: 'Jenis', value: memoryKind }, ...(term ? [{ label: 'Istilah', value: term }] : []), { label: 'Diingat', value: content, emphasis: true }], { kind: memoryKind, term, content });
  }
  if (kind === 'memory_forget') {
    const query = text('memory', 160); if (!query) return { clarification: 'Sebutkan istilah atau isi memori yang ingin dilupakan.' };
    const rows = await prisma.assistantMemory.findMany({ where: { active: true, OR: [{ term: { contains: query, mode: 'insensitive' } }, { content: { contains: query, mode: 'insensitive' } }] }, take: 6, orderBy: { id: 'desc' } });
    if (rows.length !== 1) return { clarification: rows.length ? `Ada beberapa memori yang cocok: ${rows.map(m => `#${m.id} ${m.term ?? m.content.slice(0, 40)}`).join('; ')}. Sebutkan yang tepat.` : 'Memori itu tidak ditemukan.' };
    const memory = rows[0]; return build('memory.forget', 'Draf lupakan memori', [{ label: 'Istilah', value: memory.term ?? '—' }, { label: 'Isi', value: memory.content, emphasis: true }], { memoryId: memory.id });
  }
  return { clarification: 'Jenis perubahan belum didukung atau rincian belum cukup. Belum ada perubahan.' };
}

async function createBatchDraft(chatId: bigint, ownerId: number, operations: OwnerBatchOperation[], labels: string[]) {
  const batch: OwnerBatch = { version: 2, ownerId: String(ownerId), operations, labels };
  const row = await prisma.telegramDraft.create({ data: { chatId, kind: 'OWNER_OPERATION', payload: batch as object,
    status: 'PENDING', expiresAt: new Date(Date.now() + DRAFT_TTL) }, select: { id: true } });
  const preview = `Rencana perubahan (${operations.length} langkah):\n${operations.map((operation, index) =>
    `${index + 1}. ${isProductCreate(operation) ? operation.name : operation.productName} — ${labels[index]}`).join('\n')}\n\nBelum ada yang diubah. Tinjau semua rincian lalu tekan tombol konfirmasi untuk menerapkan semuanya sekaligus.`;
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
  if (sameActions(priorActions, state.actions) && ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(existing?.kind ?? '') && existing?.status === 'PENDING' && existing.expiresAt > new Date() && state.preview) {
    await saveOwnerChatState(rowId, chatId, state);
    return sendTelegramMessage(chatId, `${reply}\n\n${state.preview}`, ownerActionKeyboard(previousDraftId!));
  }
  state.proposalDraftId = null; state.preview = null; state.pendingMatches = [];
  const catalog = state.actions.some(action => 'query' in action || action.kind === 'get_low_stock') ? await getCatalog() : [];
  if (catalog.length > 3000) {
    state.proposalDraftId = null;
    await saveOwnerChatState(rowId, chatId, state);
    if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
    return sendTelegramMessage(chatId, 'Katalog terlalu besar untuk ditinjau dengan aman sekarang. Belum ada perubahan data; coba pecah permintaan menjadi satu barang per pesan.');
  }
  const operations: OwnerBatchOperation[] = [], labels: string[] = [], responses: string[] = [];
  let clarification: string | null = null;
  let businessDraft: AssistantDraft | null = null;
  for (let index = 0; index < state.actions.length; index++) {
    const action = state.actions[index];
    if (action.kind === 'propose_business_action') {
      if (operations.length || businessDraft) { clarification ??= 'Tinjau satu tindakan penting per pesan agar perubahan tetap jelas dan aman.'; continue; }
      const planned = await planOwnerBusinessAction(action.action, action.data, ownerId);
      businessDraft = planned.draft ?? null; clarification ??= planned.clarification ?? null; continue;
    }
    if (action.kind === 'request_clarification') { clarification ??= action.question; continue; }
    if (action.kind === 'get_business_report') { responses.push(await showBusinessReport(action.date, action.shift)); continue; }
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
    if (action.kind === 'propose_product_create') {
      const planned = await planProductCreate(action, ownerId);
      if (planned.clarification) clarification ??= planned.clarification;
      else if (planned.operation && planned.label) { operations.push(planned.operation); labels.push(planned.label); }
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
  if (!clarification && businessDraft && operations.length) clarification = 'Pisahkan perubahan ini menjadi pesan terpisah agar satu konfirmasi hanya mengubah satu jenis data.';
  if (!clarification && operations.length > 1 && operations.some(isProductCreate)) {
    clarification = 'Pembuatan produk baru sebaiknya ditinjau terpisah dari perubahan barang lain. Kirim permintaan produk baru saja terlebih dahulu.';
  }
  if (!clarification && operations.length > 1) {
    const seen = new Set<string>();
    for (const operation of operations.filter((item): item is OwnerOperation => !isProductCreate(item))) {
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
  // Read-only tools run first; a second, bounded model turn can now answer from their actual RMCS evidence.
  // Mutations keep the application-authored preview and never rely on model-generated execution claims.
  let userFacingReply = reply;
  if (responses.length && !clarification && !state.actions.some(action => action.kind.startsWith('propose_'))) {
    const latestRequest = [...state.history].reverse().find(message => message.role === 'user')?.content ?? '';
    userFacingReply = await composeOwnerReply({ text: latestRequest, history: state.history.slice(0, -2), evidence: responses,
      apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL }) ?? reply;
  }
  const content = [userFacingReply, ...responses].filter(Boolean).join('\n\n');
  if (state.pendingMatches.length) {
    rememberOwnerReply(state, content);
    await saveOwnerChatState(rowId, chatId, state);
    if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
    for (const pending of state.pendingMatches) {
      const matches = catalog.filter(product => pending.candidateIds.includes(product.id));
      await sendTelegramMessage(chatId, `Saya menemukan beberapa barang untuk “${pending.query}”. Pilih yang tepat; rincian permintaan tetap tersimpan.`,
        agentCandidateKeyboard(ownerId, pending.actionIndex, matches));
    }
    if (content) await sendTelegramMessage(chatId, content);
    return;
  }
  if (clarification) {
    const clarificationResponse = clarificationReply(content, clarification);
    rememberOwnerReply(state, clarificationResponse);
    await saveOwnerChatState(rowId, chatId, state);
    if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
    return sendTelegramMessage(chatId, clarificationResponse);
  }
  if (businessDraft) {
    const saved = await createAssistantActionDraft(chatId, ownerId, businessDraft);
    state.proposalDraftId = saved.draftId; state.preview = saved.preview; state.menuFlow = null;
    rememberOwnerReply(state, [content, saved.preview].filter(Boolean).join('\n\n'));
    await saveOwnerChatState(rowId, chatId, state);
    if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
    return sendTelegramMessage(chatId, [content, saved.preview].filter(Boolean).join('\n\n'), ownerActionKeyboard(saved.draftId));
  }
  if (operations.length) {
    const batch = await createBatchDraft(chatId, ownerId, operations, labels);
    state.proposalDraftId = batch.draftId; state.preview = batch.preview; state.menuFlow = null;
    rememberOwnerReply(state, [content, batch.preview].filter(Boolean).join('\n\n'));
    try { await saveOwnerChatState(rowId, chatId, state); }
    catch (error) {
      await cancelSupersededDraft(batch.draftId, chatId);
      throw error;
    }
    if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
    return sendTelegramMessage(chatId, [content, batch.preview].filter(Boolean).join('\n\n'), ownerActionKeyboard(batch.draftId));
  }
  // A completed read-only request should not be replayed as the next turn's proposal.
  rememberOwnerReply(state, content || 'Saya belum menangkap maksudnya. Coba ceritakan dengan kata-kata sendiri; kalau ada angka yang belum jelas, saya akan tanyakan.');
  state.actions = []; state.selected = []; state.pendingMatches = []; state.menuFlow = null;
  await saveOwnerChatState(rowId, chatId, state);
  if (previousDraftId) await cancelSupersededDraft(previousDraftId, chatId);
  return sendTelegramMessage(chatId, content || 'Saya belum menangkap maksudnya. Coba ceritakan dengan kata-kata sendiri; kalau ada angka yang belum jelas, saya akan tanyakan.');
}

async function cancelSupersededDraft(draftId: string, chatId: bigint) {
  await prisma.telegramDraft.updateMany({ where: { id: draftId, chatId, kind: { in: ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'] }, status: 'PENDING' },
    data: { status: 'CANCELLED' } });
}

function parseOperation(value: unknown): OwnerOperation | null {
  if (!value || typeof value !== 'object') return null;
  const operation = value as Partial<OwnerOperation>;
  if (operation.version !== 1 || !['STOCK_IN', 'STOCK_ADJUST', 'PRICE_UPDATE', 'LOCATION_MOVE'].includes(operation.kind ?? '') ||
      !Number.isSafeInteger(operation.productId) || !operation.expected || !operation.proposed || !/^\d{1,20}$/.test(operation.ownerId ?? '')) return null;
  return operation as OwnerOperation;
}

function parseOwnerProductCreate(value: unknown): OwnerProductCreate | null {
  if (!value || typeof value !== 'object') return null;
  const operation = value as Partial<OwnerProductCreate>;
  if (operation.version !== 1 || operation.kind !== 'PRODUCT_CREATE' || typeof operation.ownerId !== 'string' || !/^\d{1,20}$/.test(operation.ownerId) ||
      !Number.isSafeInteger(operation.categoryId) || (operation.categoryId ?? 0) <= 0 || typeof operation.categoryName !== 'string' || !operation.categoryName.trim() ||
      typeof operation.name !== 'string' || !operation.name.trim() || operation.name.length > 180 ||
      !(operation.subcategoryId === null || (typeof operation.subcategoryId === 'number' && Number.isSafeInteger(operation.subcategoryId) && operation.subcategoryId > 0)) ||
      !(operation.locationId === null || (typeof operation.locationId === 'number' && Number.isSafeInteger(operation.locationId) && operation.locationId > 0)) ||
      typeof operation.costPrice !== 'string' || !/^\d{1,13}$/.test(operation.costPrice) || BigInt(operation.costPrice) <= 0n || BigInt(operation.costPrice) > 1_000_000_000_000n ||
      typeof operation.sellPrice !== 'string' || !/^\d{1,13}$/.test(operation.sellPrice) || BigInt(operation.sellPrice) <= 0n || BigInt(operation.sellPrice) > 1_000_000_000_000n ||
      !Number.isSafeInteger(operation.stock) || (operation.stock ?? 0) <= 0 || (operation.stock ?? 1_000_001) > 1_000_000 ||
      !Number.isSafeInteger(operation.minStock) || (operation.minStock ?? -1) < 0 || (operation.minStock ?? 1_000_001) > 1_000_000 ||
      !(operation.sku === null || (typeof operation.sku === 'string' && operation.sku.length <= 80)) ||
      !(operation.provider === null || (typeof operation.provider === 'string' && operation.provider.length <= 80)) ||
      !(operation.validity === null || (typeof operation.validity === 'string' && operation.validity.length <= 80)) ||
      !(operation.subcategoryName === null || (typeof operation.subcategoryName === 'string' && operation.subcategoryName.length <= 100)) ||
      !(operation.locationName === null || (typeof operation.locationName === 'string' && operation.locationName.length <= 100)) ||
      (operation.subcategoryId === null && operation.subcategoryName !== null) || (operation.locationId === null && operation.locationName !== null)) return null;
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
      withAssistantAuthorization(() => applyAssistantDraft({ action: saved.action, payload: saved.payload, sourceDraftId: row.id })));
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

function ownerDraftOwnerId(row: { kind: string; payload: unknown }): string | null {
  if (!row.payload || typeof row.payload !== 'object') return null;
  const payload = row.payload as Record<string, unknown>;
  return typeof payload.ownerId === 'string' ? payload.ownerId : null;
}
function ownerDraftDescription(row: { kind: string; payload: unknown }): string | null {
  if (!row.payload || typeof row.payload !== 'object') return null;
  const payload = row.payload as Record<string, unknown>;
  if (row.kind === 'OWNER_ASSISTANT_ACTION' && typeof payload.preview === 'string') return payload.preview;
  const batch = row.kind === 'OWNER_OPERATION' ? validateBatch(payload) : null;
  if (batch) return `Rencana perubahan (${batch.operations.length} langkah):\n${batch.operations.map((operation, index) => `${index + 1}. ${isProductCreate(operation) ? operation.name : operation.productName} — ${batch.labels[index]}`).join('\n')}`;
  const operation = row.kind === 'OWNER_OPERATION' ? parseOperation(payload) : null;
  if (operation) {
    const proposed = operation.proposed;
    const money = (value: unknown) => typeof value === 'string' && /^\d{1,20}$/.test(value) ? formatIdr(BigInt(value)) : '—';
    const details = operation.kind === 'STOCK_IN' ? `Stok: ${operation.expected.stock} → ${operation.expected.stock + (proposed.quantity ?? 0)}; modal/unit: ${money(proposed.unitCost)}`
      : operation.kind === 'STOCK_ADJUST' ? `Stok: ${operation.expected.stock} → ${proposed.newStock ?? operation.expected.stock}; alasan: ${proposed.reason ?? '—'}`
        : operation.kind === 'PRICE_UPDATE' ? `Harga: ${money(proposed.field === 'sellPrice' ? operation.expected.sellPrice : operation.expected.costPrice)} → ${money(proposed.amount)}`
          : `Lokasi: ${operation.expected.locationName ?? '—'} → ${proposed.targetLocationName ?? '—'}`;
    return `Draf perubahan — ${operation.productName}\n${details}`;
  }
  const product = row.kind === 'OWNER_OPERATION' ? parseOwnerProductCreate(payload) : null;
  if (product) return `Draf barang baru — ${product.name}\nKategori: ${product.categoryName}${product.subcategoryName ? ' / ' + product.subcategoryName : ''}\nStok awal: ${product.stock}\nModal/unit: ${formatIdr(BigInt(product.costPrice))}\nHarga jual: ${formatIdr(BigInt(product.sellPrice))}`;
  return null;
}
async function showPendingOwnerApprovals(chatId: bigint, ownerId: number) {
  const rows = await prisma.telegramDraft.findMany({ where: { chatId, kind: { in: ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'] }, status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 50 });
  const { state } = await getOwnerChatState(chatId, ownerId);
  const pending = rows.filter(row => ownerDraftOwnerId(row) === String(ownerId) && ownerDraftDescription(row) &&
    (!validateBatch(row.payload) || state.proposalDraftId === row.id));
  if (!pending.length) return sendTelegramMessage(chatId, 'Tidak ada draf Owner yang menunggu persetujuan.', ownerMenuKeyboard('home'));
  const visible = pending.slice(0, 20);
  const rowsKeyboard = visible.map(row => [{ text: `Tinjau draf ${row.id.slice(-6)}`, callback_data: 'rcms:owner:review:' + row.id }]);
  rowsKeyboard.push([{ text: '⬅️ Menu Owner', callback_data: 'rcms:owner:menu:home' }]);
  return sendTelegramMessage(chatId, `Draf menunggu persetujuan (${pending.length}):\n${visible.map(row => `• ${row.id.slice(-6)} · ${row.createdAt.toLocaleString('id-ID')}`).join('\n')}${pending.length > 20 ? '\nDaftar dibatasi ke 20 draf terbaru.' : ''}`, keyboard(rowsKeyboard));
}
async function reviewOwnerDraft(callback: OwnerCallback, ownerId: number, draftId: string) {
  const chatId = BigInt(ownerId);
  const row = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  if (!row || row.chatId !== chatId || !['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(row.kind) || row.status !== 'PENDING' || row.expiresAt <= new Date() || ownerDraftOwnerId(row) !== String(ownerId)) {
    return answerTelegramCallback(callback.id, 'Draf tidak ditemukan, kedaluwarsa, atau bukan milik Owner ini.');
  }
  const description = ownerDraftDescription(row);
  if (!description) return answerTelegramCallback(callback.id, 'Pratinjau draf tidak dapat dibaca.');
  await answerTelegramCallback(callback.id, 'Draf siap ditinjau.');
  return sendTelegramMessage(chatId, description + '\n\nBelum ada perubahan. Konfirmasi hanya jika rinciannya benar.', ownerActionKeyboard(row.id));
}

export async function handleOwnerCallback(callback: OwnerCallback, ownerId: number) {
  const chat = callback.message?.chat;
  if (!telegramOwnerAuthorized(callback.from.id) || callback.from.id !== ownerId || !chat || chat.type !== 'private' || chat.id !== ownerId) {
    return answerTelegramCallback(callback.id, 'Akses ditolak.');
  }
  const data = callback.data ?? '';
  if (data === 'rcms:owner:menu:flow_cancel') {
    const { rowId, state } = await getOwnerChatState(BigInt(chat.id), ownerId);
    state.menuFlow = null; state.actions = []; state.selected = []; state.pendingMatches = [];
    state.history = [{ role: 'user', content: 'Owner membatalkan alur menu.' }, { role: 'assistant', content: 'Alur dibatalkan; data RMCS tidak berubah.' }];
    await saveOwnerChatState(rowId, BigInt(chat.id), state);
    await answerTelegramCallback(callback.id, 'Alur dibatalkan.');
    return showOwnerMenu(BigInt(chat.id));
  }
  const review = /^rcms:owner:review:([A-Za-z0-9_-]{10,40})$/.exec(data);
  if (review) return reviewOwnerDraft(callback, ownerId, review[1]);
  const menuAction = /^rcms:owner:menu:do:([a-z_]+)$/.exec(data);
  if (menuAction) {
    const item = Object.values(OWNER_MENU_ACTIONS).flatMap(actions => actions ?? []).find(action => action.id === menuAction[1]);
    if (!item) return answerTelegramCallback(callback.id, 'Tombol tidak dikenal.');
    await answerTelegramCallback(callback.id, 'Siap.');
    if (menuAction[1] === 'balance_read') return sendTelegramMessage(BigInt(chat.id), await showCombinedBalance());
    if (menuAction[1] === 'report_today') return sendTelegramMessage(BigInt(chat.id), await showBusinessReport(null, null));
    if (menuAction[1] === 'inventory_value') return showInventoryValue(BigInt(chat.id));
    if (menuAction[1] === 'debt_report') return showDebtReport(BigInt(chat.id));
    if (menuAction[1] === 'low_stock') return showLowStock(BigInt(chat.id));
    return beginOwnerMenuFlow(BigInt(chat.id), ownerId, item);
  }
  const menu = /^rcms:owner:menu:(home|summary|catalog|sales|finance|shift|memory|approval)$/.exec(data);
  if (menu) {
    const page = menu[1] as OwnerMenuPage;
    await answerTelegramCallback(callback.id, page === 'home' ? 'Menu Owner' : 'Membuka ' + OWNER_MENU_PAGES[page].title);
    if (page === 'home') return showOwnerHome(BigInt(chat.id), ownerId);
    if (page === 'approval') return showPendingOwnerApprovals(BigInt(chat.id), ownerId);
    return showOwnerMenu(BigInt(chat.id), page);
  }
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
        state.actions = []; state.selected = []; state.pendingMatches = []; state.proposalDraftId = null; state.preview = null; state.menuFlow = null;
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
  if (command?.[1].toLowerCase() === 'menu' || command?.[1].toLowerCase() === 'fitur') return showOwnerHome(chatId, ownerId);
  if (command?.[1].toLowerCase() === 'start' || command?.[1].toLowerCase() === 'help') {
    return sendTelegramMessage(chatId, 'Hai, saya asisten owner R-CELL. Buka /menu untuk memilih fitur. Anda juga bisa bertanya dengan kata-kata sendiri. Setiap perubahan menunggu konfirmasi sebelum diterapkan. /whoami menampilkan ID Telegram Anda.', ownerMenuKeyboard());
  }
  const startedAt = Date.now();
  try {
    if (isCombinedBalanceQuestion(text)) return sendTelegramMessage(chatId, await showCombinedBalance());
    const { rowId, state } = await getOwnerChatState(chatId, ownerId);
    const claimed = await prisma.telegramDraft.updateMany({ where: { id: rowId, kind: 'OWNER_CONVERSATION', status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'PROCESSING' } });
    if (claimed.count !== 1) return sendTelegramMessage(chatId, 'Saya sedang menyusun pesan sebelumnya. Tunggu sebentar lalu kirim lagi; belum ada perubahan yang diterapkan.');
    try {
      if (command?.[1].toLowerCase() === 'batal') {
        if (state.proposalDraftId) await prisma.telegramDraft.updateMany({ where: { id: state.proposalDraftId, chatId, kind: { in: ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'] }, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        state.actions = []; state.selected = []; state.pendingMatches = []; state.proposalDraftId = null; state.preview = null; state.menuFlow = null;
        state.history = [...state.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: 'Rencana dibatalkan.' }].slice(-12);
        await saveOwnerChatState(rowId, chatId, state);
        return sendTelegramMessage(chatId, 'Rencana dibatalkan. Data RMCS tidak berubah.');
      }
      const priorActions = state.actions;
      // Only pass actions back as an active draft while a real, unexpired confirmation draft exists.
      // Clarification context remains available in the saved conversation history.
      const activeDraft = state.proposalDraftId
        ? await prisma.telegramDraft.findUnique({ where: { id: state.proposalDraftId } }) : null;
      const hasActiveProposal = ['OWNER_OPERATION', 'OWNER_ASSISTANT_ACTION'].includes(activeDraft?.kind ?? '') && activeDraft?.status === 'PENDING' && activeDraft.expiresAt > new Date();
      const lastAssistantMessage = state.history.at(-1)?.role === 'assistant' ? state.history.at(-1)?.content ?? '' : '';
      const awaitingBalanceClarification = !state.proposalDraftId &&
        state.actions.some(action => action.kind === 'propose_business_action' && action.action === 'balance_update') &&
        /saldo|cash|kas|elektronik|akun|pecah|pisah|nominal/i.test(lastAssistantMessage);
      const currentProposal = hasActiveProposal || awaitingBalanceClarification ? state.actions : [];
      const pendingTotalBalance = currentProposal.find((action): action is Extract<OwnerAgentAction, { kind: 'propose_business_action' }> => action.kind === 'propose_business_action' && action.action === 'balance_update');
      const aggregateBalanceFollowUp = /dianggap\s+satu|satu\s+(?:aja|saja)|jangan\s+(?:dibeda|dipisah|dipecah)|gabung(?:an)?|pecah.+terserah|terserah/i.test(text)
        && !/\d/.test(text);
      if (pendingTotalBalance && aggregateBalanceFollowUp) {
        state.actions = [pendingTotalBalance];
        state.selected = [];
        state.pendingMatches = [];
        const followUpReply = 'Siap, saya pertahankan sebagai satu saldo gabungan kas + elektronik. Tidak perlu memilih akun atau membagi nominal.';
        state.history = [...state.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: followUpReply }].slice(-12);
        return await renderOwnerActions(chatId, ownerId, rowId, state, followUpReply, priorActions);
      }
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
      const reply = uniqueMessages([turn.reply, turn.clarification]);
      const hasBalanceAction = state.actions.some(action => action.kind === 'propose_business_action' && action.action === 'balance_update');
      const historyReply = state.actions.length && !hasBalanceAction ? 'Saya sudah meninjau permintaan. Rencana perubahan hanya akan diterapkan setelah tombol konfirmasi ditekan.' : reply;
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


