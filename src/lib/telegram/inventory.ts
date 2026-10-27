import { catalogQueryKey, catalogSearchTerms, rankCatalogProducts, type SearchableProduct } from '@/lib/catalog-search';
import type { RecapInventoryExtraction, RecapInventoryLine } from './recap';

export function telegramWebAppSaleScope(userId: number | null, from: Date, to: Date) {
  return { ...(userId === null ? {} : { userId }), kind: 'SALE' as const, createdAt: { gte: from, lte: to } };
}

export type InventoryCatalogProduct = SearchableProduct & { id: number; sku?: string | null; stock: number; locationId: number | null };
export type ProductResolution = { status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'; productId: number | null; candidateProductIds: number[] };

const aliases: Record<string, string[]> = {
  tg: ['tempered glass', 'anti gores'],
  cas: ['charger', 'pengisi daya'],
  kartu: ['voucher', 'kartu perdana'],
  axis: ['axis'],
};

function normalize(value: string) {
  return catalogSearchTerms(value).join(' ');
}

export function normalizeStockUnit(value: string): 'pcs' | null {
  const unit = value.trim().toLocaleLowerCase('id-ID').replace(/\./g, '');
  if (['pc', 'pcs', 'unit', 'units', 'biji', 'buah', 'lembar'].includes(unit)) return 'pcs';
  return null;
}

export function resolveInventoryProduct(
  label: string,
  products: InventoryCatalogProduct[],
  approvedAliasProductIds: number[] = [],
): ProductResolution {
  const query = normalize(label);
  if (!query) return { status: 'UNMATCHED', productId: null, candidateProductIds: [] };
  const skuMatches = products.filter(product => product.sku && normalize(product.sku) === query);
  if (skuMatches.length === 1) return { status: 'MATCHED', productId: skuMatches[0].id, candidateProductIds: [skuMatches[0].id] };
  if (skuMatches.length > 1) return { status: 'AMBIGUOUS', productId: null, candidateProductIds: skuMatches.slice(0, 8).map(product => product.id) };
  const aliasIds = [...new Set(approvedAliasProductIds.filter(id => products.some(product => product.id === id)))];
  if (aliasIds.length === 1) return { status: 'MATCHED', productId: aliasIds[0], candidateProductIds: aliasIds };
  if (aliasIds.length > 1) return { status: 'AMBIGUOUS', productId: null, candidateProductIds: aliasIds.slice(0, 8) };

  const expanded = [...new Set([label, ...catalogSearchTerms(label).flatMap(term => aliases[term] ?? [])])];
  const exact = products.filter(product => expanded.some(value => normalize(value) === normalize(product.name)));
  if (exact.length === 1) return { status: 'MATCHED', productId: exact[0].id, candidateProductIds: [exact[0].id] };
  if (exact.length > 1) return { status: 'AMBIGUOUS', productId: null, candidateProductIds: exact.slice(0, 8).map(x => x.id) };

  const terms = catalogSearchTerms(label);
  const ranked = rankCatalogProducts(products, terms).slice(0, 8);
  if (!ranked.length) return { status: 'UNMATCHED', productId: null, candidateProductIds: [] };
  const best = ranked[0];
  const second = ranked[1];
  const clearlySpecific = terms.length >= 2 && best.matched >= 2 && best.nameSimilarity >= 0.8 &&
    (!second || best.score >= second.score * 1.6);
  if (ranked.length === 1 || clearlySpecific) {
    return { status: 'MATCHED', productId: best.product.id, candidateProductIds: [best.product.id] };
  }
  return { status: 'AMBIGUOUS', productId: null, candidateProductIds: ranked.slice(0, 5).map(x => x.product.id) };
}

export function calculateUnrecordedQuantity(reportedQty: number, recordedWebQty: number, coverage: 'INCLUDES_APP_SALES' | 'UNRECORDED_ONLY') {
  if (!Number.isSafeInteger(reportedQty) || reportedQty < 0 || !Number.isSafeInteger(recordedWebQty) || recordedWebQty < 0) return null;
  if (coverage === 'UNRECORDED_ONLY') return reportedQty;
  return reportedQty >= recordedWebQty ? reportedQty - recordedWebQty : null;
}

export type InventoryCallbackAction = 'select' | 'included' | 'unrecorded' | 'owner';
const actionCode: Record<InventoryCallbackAction, string> = { select: 's', included: 'i', unrecorded: 'u', owner: 'o' };
const codeAction = Object.fromEntries(Object.entries(actionCode).map(([action, code]) => [code, action as InventoryCallbackAction]));
export function inventoryCallback(action: InventoryCallbackAction, draftId: string, lineId: string, value: string, revision: number) {
  return `rcms:i:${actionCode[action]}:${draftId}:${lineId}:${value}:${revision}`;
}
export function parseInventoryCallback(data: string | undefined) {
  const match = /^rcms:i:([siuo]):([A-Za-z0-9_-]{10,40}):([0-9]{1,4}):([A-Za-z0-9_-]{1,12}):([0-9]{1,10})$/.exec(data ?? '');
  return match ? { action: codeAction[match[1]] as InventoryCallbackAction, draftId: match[2], lineIndex: Number(match[3]), value: match[4], revision: Number(match[5]) } : null;
}
export function findInventoryConflicts(current: RecapInventoryLine[], candidates: RecapInventoryExtraction[]) {
  const labels = new Set(current.map(line => normalize(line.label)));
  return candidates.filter(line => labels.has(normalize(line.label)));
}

export function mergePhotoInventory(current: RecapInventoryLine[], candidates: RecapInventoryExtraction[], mode: 'accept' | 'replace' | 'supplement', sourceId: string) {
  const conflicts = findInventoryConflicts(current, candidates);
  if (mode === 'accept' && conflicts.length) return { lines: current, conflicts, unresolved: ['Jumlah produk dari foto berbenturan dengan draf; pilih ganti atau tambahkan.'] };
  const lines = current.map(line => ({ ...line, candidateProductIds: [...line.candidateProductIds] }));
  const unresolved: string[] = [];
  candidates.forEach((candidate, index) => {
    const label = candidate.label.trim().toLocaleLowerCase('id-ID');
    const quantity = typeof candidate.quantity === 'number' ? candidate.quantity : Number(candidate.quantity);
    const unit = candidate.unit?.trim().toLocaleLowerCase('id-ID') ?? '';
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000 || !label || !unit || candidate.ambiguity) {
      unresolved.push(candidate.ambiguity ?? `Jumlah atau satuan barang foto perlu diperjelas: ${candidate.sourceText}`);
      return;
    }
    const found = lines.findIndex(line => normalize(line.label) === normalize(label));
    if (found >= 0 && mode === 'replace') lines[found] = { ...lines[found], sourceText: candidate.sourceText, label, quantity, unit,
      productId: null, candidateProductIds: [], mappingStatus: 'UNMATCHED', coverage: 'UNDECIDED', recordedWebQty: undefined, appliedQty: undefined };
    else if (found >= 0 && mode === 'supplement') lines[found] = { ...lines[found], sourceText: `${lines[found].sourceText}; ${candidate.sourceText}`, quantity: lines[found].quantity + quantity };
    else if (found < 0) lines.push({ id: `photo-${sourceId}-${index}`, sourceText: candidate.sourceText, label, quantity, unit,
      productId: null, candidateProductIds: [], mappingStatus: 'UNMATCHED', coverage: 'UNDECIDED' });
  });
  return { lines, conflicts, unresolved };
}
export function evaluateInventoryDeduction(reportedQty: number, recordedWebQty: number, stock: number, coverage: 'INCLUDES_APP_SALES' | 'UNRECORDED_ONLY') {
  const appliedQty = calculateUnrecordedQuantity(reportedQty, recordedWebQty, coverage);
  if (appliedQty === null) return { status: 'REVIEW' as const, appliedQty: null, stockAfter: null };
  if (!Number.isSafeInteger(stock) || stock < 0 || appliedQty > stock) return { status: 'INSUFFICIENT' as const, appliedQty, stockAfter: null };
  return { status: 'READY' as const, appliedQty, stockAfter: stock - appliedQty };
}
export function correctedStockDeduction(reportedQty: number, webAppQty: number, coverage: 'INCLUDES_APP_SALES' | 'UNRECORDED_ONLY') {
  if (!Number.isSafeInteger(reportedQty) || reportedQty < 0 || !Number.isSafeInteger(webAppQty) || webAppQty < 0) return null;
  if (coverage === 'INCLUDES_APP_SALES') return reportedQty < webAppQty ? null : reportedQty - webAppQty;
  return reportedQty;
}
export function correctionDelta(currentAppliedQty: number, requestedAppliedQty: number) {
  if (!Number.isSafeInteger(currentAppliedQty) || currentAppliedQty < 0 || !Number.isSafeInteger(requestedAppliedQty) || requestedAppliedQty < 0) return null;
  return requestedAppliedQty - currentAppliedQty;
}
