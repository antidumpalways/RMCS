// Perencana murni (tanpa database) untuk "tempel daftar barang apa saja": barang yang sudah ada diubah, yang belum ada dibuat.
// Berlaku untuk semua jenis barang (rokok, minyak, aksesori, voucher, dst.); voucher per provider punya perencana sendiri (provider-packages.ts).
import { catalogSearchTerms } from '@/lib/catalog-search';
import { strictProductMatch } from './product-match';

export type ListItem = {
  name: string; sellPrice: bigint | null; costPrice: bigint | null; stock: number | null; newName: string | null;
  provider: string | null; validity: string | null; category: string | null;
};
export type ListRow = {
  id: number; name: string; provider: string | null; validity: string | null; sku: string | null; quota?: string | null;
  stock: number; costPrice: bigint; sellPrice: bigint; categoryId: number; categoryName: string; subcategoryId: number | null;
};
type Point = { name: string; sellPrice: bigint; costPrice: bigint; stock: number };
export type ListUpdate = { id: number; from: Point; to: Point; changed: boolean };
export type ListCreate = {
  name: string; provider: string | null; validity: string | null; sellPrice: bigint; costPrice: bigint; costEstimated: boolean;
  stock: number; category: string | null; categoryId: number | null; subcategoryId: number | null; priceMissing: boolean;
};
type Leftover = { id: number; name: string; stock: number };
export type ListPlan = {
  updates: ListUpdate[]; creates: ListCreate[]; retire: Leftover[]; missing: Leftover[];
  ambiguous: Array<{ label: string; names: string[] }>; invalid: string[];
};

function nameKey(value: string): string {
  return catalogSearchTerms(value).join(' ');
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

function categoryKey(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '');
}

export function planCatalogList(rows: ListRow[], items: ListItem[], options: { defaultCategory?: string | null; replaceAll?: boolean; resolveAmbiguous?: boolean } = {}): ListPlan {
  const plan: ListPlan = { updates: [], creates: [], retire: [], missing: [], ambiguous: [], invalid: [] };
  const used = new Set<number>();
  const scopeKey = categoryKey(options.defaultCategory);
  const scoped = scopeKey ? rows.filter(row => categoryKey(row.categoryName) === scopeKey) : rows;

  const marginOf = (pool: ListRow[]) => {
    const margins = pool.filter(row => row.costPrice > 0n && row.sellPrice > row.costPrice).map(row => row.sellPrice - row.costPrice);
    return margins.length ? median(margins) : null;
  };
  const defaultMargin = marginOf(scoped);

  for (const item of items) {
    const name = item.name.trim();
    if (!name) { plan.invalid.push('ada baris tanpa nama barang'); continue; }
    const itemCategoryKey = categoryKey(item.category) || scopeKey;
    const pool = itemCategoryKey ? rows.filter(row => categoryKey(row.categoryName) === itemCategoryKey) : rows;
    const free = pool.filter(row => !used.has(row.id));

    // 1) nama persis sama (abaikan huruf besar/kecil dan tanda baca)
    const exact = free.filter(row => nameKey(row.name) === nameKey(name));
    let match: ListRow | null = null;
    if (exact.length === 1) match = exact[0];
    else if (exact.length > 1) {
      if (options.resolveAmbiguous) match = [...exact].sort((a, b) => b.stock - a.stock || a.id - b.id)[0];
      else { plan.ambiguous.push({ label: name, names: exact.map(row => row.name) }); continue; }
    }
    else {
      // 2) semua kata khas cocok pada satu barang; bila beberapa, pilih yang namanya paling pendek (paling mirip) bila jelas
      const loose = free.filter(row => strictProductMatch(name, row));
      if (loose.length === 1) match = loose[0];
      else if (loose.length > 1) {
        const lengths = loose.map(row => catalogSearchTerms(row.name).length);
        const shortest = Math.min(...lengths);
        const closest = loose.filter((_, index) => lengths[index] === shortest);
        if (closest.length === 1) match = closest[0];
        else if (options.resolveAmbiguous) match = [...closest].sort((a, b) => b.stock - a.stock || a.id - b.id)[0];
        else { plan.ambiguous.push({ label: name, names: loose.map(row => row.name) }); continue; }
      }
    }

    if (match) {
      used.add(match.id);
      const from: Point = { name: match.name, sellPrice: match.sellPrice, costPrice: match.costPrice, stock: match.stock };
      const to: Point = { name: item.newName?.trim() || match.name, sellPrice: item.sellPrice ?? match.sellPrice, costPrice: item.costPrice ?? match.costPrice, stock: item.stock ?? match.stock };
      plan.updates.push({ id: match.id, from, to, changed: to.name !== from.name || to.sellPrice !== from.sellPrice || to.costPrice !== from.costPrice || to.stock !== from.stock });
      continue;
    }

    // 3) tidak ada: barang baru
    const priceMissing = item.sellPrice === null;
    const sellPrice = item.sellPrice ?? 0n;
    const category = item.category ?? options.defaultCategory ?? null;
    const sample = category ? rows.find(row => categoryKey(row.categoryName) === categoryKey(category)) : undefined;
    const given = item.costPrice;
    const margin = defaultMargin ?? (sample ? marginOf(rows.filter(row => row.categoryId === sample.categoryId)) : null);
    const estimated = given === null && margin !== null && sellPrice > margin;
    plan.creates.push({ name: item.newName?.trim() || name, provider: item.provider, validity: item.validity, sellPrice,
      costPrice: given ?? (estimated ? sellPrice - margin! : 0n), costEstimated: given === null, stock: item.stock ?? 0,
      category: sample?.categoryName ?? category, categoryId: sample?.categoryId ?? null, subcategoryId: null, priceMissing });
  }

  const leftovers = scoped.filter(row => !used.has(row.id) && !plan.ambiguous.some(entry => entry.names.includes(row.name)));
  const mapped = leftovers.map(row => ({ id: row.id, name: row.name, stock: row.stock }));
  if (options.replaceAll) {
    if (!scopeKey) plan.invalid.push('“ganti semua” perlu kategori yang jelas (mis. Rokok) supaya tidak menghapus seluruh katalog');
    else if (!plan.ambiguous.length && !plan.invalid.length) plan.retire = mapped;
  } else plan.missing = mapped;
  return plan;
}

export function formatListPlan(plan: ListPlan, formatMoney: (value: bigint) => string): string[] {
  const lines: string[] = [];
  for (const update of plan.updates) {
    if (!update.changed) { lines.push(`• ${update.to.name}: tidak berubah`); continue; }
    const parts: string[] = [update.to.name !== update.from.name ? `${update.from.name} → ${update.to.name}` : update.to.name];
    if (update.to.sellPrice !== update.from.sellPrice) parts.push(`harga ${formatMoney(update.from.sellPrice)} → ${formatMoney(update.to.sellPrice)}`);
    if (update.to.costPrice !== update.from.costPrice) parts.push(`modal ${formatMoney(update.from.costPrice)} → ${formatMoney(update.to.costPrice)}`);
    if (update.to.stock !== update.from.stock) parts.push(`stok ${update.from.stock} → ${update.to.stock}`);
    lines.push('• ' + parts.join('; '));
  }
  for (const made of plan.creates) {
    lines.push(`• BARU ${made.name}${made.category ? ' [' + made.category + ']' : ''}: harga ${made.priceMissing ? 'belum diisi' : formatMoney(made.sellPrice)}; modal ${formatMoney(made.costPrice)}${made.costEstimated ? (made.costPrice > 0n ? ' (perkiraan dari margin biasa)' : ' (belum diisi)') : ''}; stok ${made.stock}`);
  }
  return lines;
}
