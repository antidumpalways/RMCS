import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { shiftOpening } from '@/lib/automation';
import { catalogQueryKey } from '@/lib/catalog-search';
import { semanticCatalogSearch } from '@/lib/semantic-catalog';
import type { RecapDraft, RecapInventoryLine } from '@/lib/telegram/recap';
import { calculateUnrecordedQuantity, evaluateInventoryDeduction, normalizeStockUnit, resolveInventoryProduct, telegramWebAppSaleScope, type InventoryCatalogProduct } from '@/lib/telegram/inventory';

export class TelegramInventoryError extends Error {
  constructor(readonly code: 'INVENTORY_UNMAPPED' | 'INVENTORY_COVERAGE' | 'INVENTORY_STALE' | 'INVENTORY_INSUFFICIENT' | 'INVENTORY_UNIT', message: string) { super(message); }
}

async function catalog() {
  const rows = await prisma.product.findMany({ include: { category: true, subcategory: true }, orderBy: { id: 'asc' } });
  return rows.map(row => ({ id: row.id, name: row.name, sku: row.sku, provider: row.provider, validity: row.validity,
    categoryName: [row.category.name, row.subcategory?.name].filter(Boolean).join(' '), stock: row.stock, locationId: row.locationId } satisfies InventoryCatalogProduct));
}

export async function resolveInventoryMappings(draft: RecapDraft): Promise<RecapDraft> {
  const lines = draft.inventoryLines ?? [];
  if (!lines.length) return { ...draft, inventoryLines: lines };
  const products = await catalog();
  const aliases = await prisma.assistantFeedback.findMany({ where: { status: 'APPROVED', productId: { not: null } }, select: { queryKey: true, productId: true } });
  const resolved = await Promise.all(lines.map(async line => {
    if (line.productId && products.some(product => product.id === line.productId)) return { ...line, mappingStatus: 'MATCHED' as const };
    if (line.mappingStatus === 'OWNER_REVIEW' && line.coverage === 'OWNER_REVIEW') return line;
    if (!normalizeStockUnit(line.unit)) return { ...line, mappingStatus: 'OWNER_REVIEW' as const, coverage: 'OWNER_REVIEW' as const };
    const feedbackIds = aliases.filter(alias => alias.queryKey === catalogQueryKey(line.label) && alias.productId !== null).map(alias => alias.productId!);
    let result = resolveInventoryProduct(line.label, products, feedbackIds);
    if (result.status === 'UNMATCHED' && process.env.DEEPSEEK_API_KEY) {
      try {
        const semantic = await semanticCatalogSearch(line.label, products.map(product => ({ id: product.id, name: product.name, categoryName: product.categoryName, provider: product.provider, validity: product.validity })), process.env.DEEPSEEK_API_KEY);
        const confident = semantic.filter(match => match.confidence === 'high');
        if (confident.length === 1 && semantic.length === 1) result = { status: 'MATCHED', productId: confident[0].id, candidateProductIds: [confident[0].id] };
        else if (semantic.length) result = { status: 'AMBIGUOUS', productId: null, candidateProductIds: semantic.map(match => match.id).slice(0, 5) };
      } catch { /* Keep deterministic no-match and ask for owner review. */ }
    }
    return { ...line, productId: result.productId, candidateProductIds: result.candidateProductIds,
      mappingStatus: result.status, coverage: result.status === 'MATCHED' ? 'UNDECIDED' as const : result.status === 'UNMATCHED' ? 'OWNER_REVIEW' as const : 'UNDECIDED' as const };
  }));
  return { ...draft, inventoryLines: resolved };
}

export async function inventoryPreview(userId: number | null, draft: RecapDraft, now = new Date(), shiftStartOverride?: Date) {
  const { start } = shiftStartOverride ? { start: shiftStartOverride } : await shiftOpening(now);
  const productIds = [...new Set((draft.inventoryLines ?? []).flatMap(line => line.productId ? [line.productId] : []))];
  const rows = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, stock: true, locationId: true } });
  const items = await Promise.all(rows.map(async product => {
    const sales = await prisma.saleItem.aggregate({ where: { productId: product.id, sale: telegramWebAppSaleScope(userId, start, now) }, _sum: { qty: true } });
    return { ...product, recordedWebQty: sales._sum.qty ?? 0 };
  }));
  return { start, items };
}

export async function postTelegramInventory(tx: Prisma.TransactionClient, reportId: string, userId: number | null, telegramIdentityId: string, draft: RecapDraft, shiftStart: Date, now = new Date()) {
  const lines = draft.inventoryLines ?? [];
  if (!lines.length) return [];
  if (lines.some(line => line.mappingStatus !== 'MATCHED' || !line.productId)) throw new TelegramInventoryError('INVENTORY_UNMAPPED', 'Ada produk yang belum dipastikan.');
  const aggregated = new Map<number, { lines: RecapInventoryLine[]; quantity: number; coverage: RecapInventoryLine['coverage']; recorded: number }>();
  for (const line of lines) {
    if (!normalizeStockUnit(line.unit)) throw new TelegramInventoryError('INVENTORY_UNIT', 'Satuan harus diperjelas sebelum stok diubah.');
    if (line.coverage !== 'UNRECORDED_ONLY' && line.coverage !== 'INCLUDES_APP_SALES') throw new TelegramInventoryError('INVENTORY_COVERAGE', 'Cakupan penjualan Web App belum dikonfirmasi.');
    const id = line.productId!;
    const group = aggregated.get(id);
    if (group && group.coverage !== line.coverage) throw new TelegramInventoryError('INVENTORY_COVERAGE', 'Cakupan penjualan untuk produk yang sama bertentangan.');
    if (group) { group.lines.push(line); group.quantity += line.quantity; group.recorded = Math.max(group.recorded, line.recordedWebQty ?? 0); }
    else aggregated.set(id, { lines: [line], quantity: line.quantity, coverage: line.coverage, recorded: line.recordedWebQty ?? 0 });
  }
  const products = await tx.product.findMany({ where: { id: { in: [...aggregated.keys()] } }, orderBy: { id: 'asc' } });
  if (products.length !== aggregated.size) throw new TelegramInventoryError('INVENTORY_UNMAPPED', 'Produk katalog sudah berubah. Periksa pemetaan ulang.');
  const postings = [];
  for (const product of products) {
    const group = aggregated.get(product.id)!;
    const sales = await tx.saleItem.aggregate({ where: { productId: product.id, sale: telegramWebAppSaleScope(userId, shiftStart, now) }, _sum: { qty: true } });
    const recorded = sales._sum.qty ?? 0;
    if (recorded !== group.recorded) throw new TelegramInventoryError('INVENTORY_STALE', `Penjualan Web App untuk ${product.name} berubah sejak pratinjau. Tinjau laporan lagi.`);
    const plan = evaluateInventoryDeduction(group.quantity, recorded, product.stock, group.coverage === 'INCLUDES_APP_SALES' ? 'INCLUDES_APP_SALES' : 'UNRECORDED_ONLY');
    const appliedQty = plan.appliedQty;
    if (plan.status === 'REVIEW' || appliedQty === null) throw new TelegramInventoryError('INVENTORY_COVERAGE', `Jumlah rekap ${product.name} lebih kecil dari penjualan Web App; minta tinjauan owner.`);
    if (appliedQty > 0) {
      const updated = await tx.product.updateMany({ where: { id: product.id, stock: { gte: appliedQty } }, data: { stock: { decrement: appliedQty } } });
      if (updated.count !== 1) throw new TelegramInventoryError('INVENTORY_INSUFFICIENT', `Stok ${product.name} tidak cukup. Tidak ada perubahan stok dari laporan ini.`);
    }
    const lineId = group.lines.map(line => line.id).sort().join(',');
    let movementId: number | null = null;
    if (appliedQty > 0) {
      const movement = await tx.inventoryMovement.create({ data: { productId: product.id, type: 'TELEGRAM_SHIFT_RECAP', qty: -appliedQty,
        costAtTime: product.costPrice, note: `Rekap Telegram ${reportId}; baris ${lineId}`, userId, telegramIdentityId }, select: { id: true } });
      movementId = movement.id;
    }
    const posting = await tx.telegramInventoryPosting.create({ data: { operationKey: `${reportId}:${lineId}:TELEGRAM_SHIFT_RECAP`, reportId, lineId,
      productId: product.id, sourceText: group.lines.map(line => line.sourceText).join(' | ').slice(0, 2000), productLabel: group.lines.map(line => line.label).join(' / ').slice(0, 500),
      reportedQty: group.quantity, webAppQty: recorded, coverage: group.coverage, appliedQty, movementId }, select: { id: true, productId: true, appliedQty: true, lineId: true } });
    postings.push(posting);
  }
  return postings;
}

export async function prepareInventoryReview(userId: number | null, draft: RecapDraft, now = new Date(), shiftStartOverride?: Date) {
  const mapped = await resolveInventoryMappings(draft);
  const preview = await inventoryPreview(userId, mapped, now, shiftStartOverride);
  const byId = new Map(preview.items.map(item => [item.id, item]));
  let lines = (mapped.inventoryLines ?? []).map(line => {
    const item = line.productId ? byId.get(line.productId) : null;
    if (!item) return line;
    const recordedWebQty = item.recordedWebQty;
    let coverage = line.coverage;
    if (line.recordedWebQty !== recordedWebQty) coverage = recordedWebQty === 0 ? 'UNRECORDED_ONLY' : 'UNDECIDED';
    if (recordedWebQty === 0 && coverage === 'UNDECIDED') coverage = 'UNRECORDED_ONLY';
    return { ...line, recordedWebQty, coverage, appliedQty: undefined };
  });
  const grouped = new Map<number, RecapInventoryLine[]>();
  for (const line of lines) if (line.productId) grouped.set(line.productId, [...(grouped.get(line.productId) ?? []), line]);
  for (const [productId, group] of grouped) {
    const recorded = byId.get(productId)?.recordedWebQty ?? 0;
    const selected = [...new Set(group.map(line => line.coverage).filter(value => value !== 'UNDECIDED'))];
    let coverage: RecapInventoryLine['coverage'] = selected.length > 1 ? 'OWNER_REVIEW' : (selected[0] ?? 'UNDECIDED');
    if (coverage === 'INCLUDES_APP_SALES' && group.reduce((sum, line) => sum + line.quantity, 0) < recorded) coverage = 'OWNER_REVIEW';
    lines = lines.map(line => line.productId === productId ? { ...line, coverage, recordedWebQty: recorded } : line);
  }
  return { draft: { ...mapped, inventoryLines: lines }, preview };
}

