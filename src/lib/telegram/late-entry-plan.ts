import type { RecapInventoryLine } from './recap';

export type PlanProduct = { id: number; name: string; stock: number; sellPrice: bigint };
export type LateEntryPlan =
  | { status: 'OK'; groups: Array<{ product: PlanProduct; qty: number; labels: string[]; sources: string[] }>; itemMoney: bigint; balanceDelta: bigint }
  | { status: 'REFUSED'; reason: string };

// Murni (tanpa database): menyatukan baris per barang, memeriksa stok, dan menghitung uang dari harga katalog.
// Batas perubahan saldo yang boleh diterapkan otomatis; di atas ini harus lewat owner.
export const LATE_ENTRY_AUTO_LIMIT = 1_000_000n;

export function planLateEntry(lines: RecapInventoryLine[], moneyDelta: bigint, products: PlanProduct[], limit: bigint = LATE_ENTRY_AUTO_LIMIT): LateEntryPlan {
  const byId = new Map(products.map(product => [product.id, product]));
  const grouped = new Map<number, { qty: number; labels: string[]; sources: string[] }>();
  for (const line of lines) {
    if (line.mappingStatus !== 'MATCHED' || !line.productId) return { status: 'REFUSED', reason: 'barang belum dipastikan, tulis nama lengkap' };
    const group = grouped.get(line.productId) ?? { qty: 0, labels: [], sources: [] };
    group.qty += line.quantity;
    group.labels.push(line.label);
    group.sources.push(line.sourceText);
    grouped.set(line.productId, group);
  }
  let itemMoney = 0n;
  const groups: Array<{ product: PlanProduct; qty: number; labels: string[]; sources: string[] }> = [];
  for (const [productId, group] of [...grouped].sort((a, b) => a[0] - b[0])) {
    const product = byId.get(productId);
    if (!product) return { status: 'REFUSED', reason: 'barang tidak ditemukan di katalog' };
    if (!Number.isSafeInteger(group.qty) || group.qty <= 0) return { status: 'REFUSED', reason: 'jumlah barang tidak valid' };
    if (group.qty > product.stock) return { status: 'REFUSED', reason: 'stok ' + product.name + ' tidak cukup (' + product.stock + ')' };
    itemMoney += product.sellPrice * BigInt(group.qty);
    groups.push({ product, qty: group.qty, labels: group.labels, sources: group.sources });
  }
  const balanceDelta = moneyDelta + itemMoney;
  if ((balanceDelta < 0n ? -balanceDelta : balanceDelta) > limit) return { status: 'REFUSED', reason: 'nilainya besar (di atas Rp 1.000.000), perlu persetujuan owner' };
  return { status: 'OK', groups, itemMoney, balanceDelta };
}
