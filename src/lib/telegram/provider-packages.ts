// Perencana murni (tanpa database) untuk "daftar paket per provider per hari".
// Paket dikenali dari provider + masa aktif (slot), bukan dari nama: bila kuota berubah (10GB -> 8GB pada slot "3 hari"),
// produk yang sama diganti, bukan dibuat ulang.
import { swapSpec } from './spec-swap';

export type PackageInput = { quota: string; validity: string | null; sellPrice: bigint; costPrice: bigint | null; stock: number | null };
export type CatalogRow = {
  id: number; name: string; provider: string | null; validity: string | null; stock: number;
  costPrice: bigint; sellPrice: bigint; categoryId: number; subcategoryId: number | null;
};
export type PackageUpdate = {
  id: number; kind: 'PRICE' | 'RENAME' | 'SAME';
  from: { name: string; validity: string | null; sellPrice: bigint; costPrice: bigint };
  to: { name: string; validity: string | null; sellPrice: bigint; costPrice: bigint };
};
export type PackageCreate = {
  name: string; validity: string | null; sellPrice: bigint; costPrice: bigint; costEstimated: boolean;
  stock: number; categoryId: number | null; subcategoryId: number | null; provider: string;
};
export type PackagePlan = {
  provider: string; updates: PackageUpdate[]; creates: PackageCreate[];
  missing: Array<{ id: number; name: string; validity: string | null; stock: number }>;
  ambiguous: Array<{ label: string; names: string[] }>; invalid: string[];
};

// "10gb", "10 GB", "1,5GB", "500mb" -> "10GB", "1.5GB", "500MB"
export function normalizeQuota(value: string): string | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(gb|g|mb|m)\b/i.exec(value.trim());
  if (!match) return null;
  const unit = /^m/i.test(match[2]) ? 'MB' : 'GB';
  return match[1].replace(',', '.') + unit;
}

export function quotaOfName(name: string): string | null {
  return normalizeQuota(name);
}

// "3 hari", "3hari", "3hr", "3d", "3" -> "3 hari"; teks lain (mis. "Standard") dibiarkan.
export function normalizeValidity(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const match = /^(\d{1,3})\s*(?:hari|hr|h|d|day|days)?$/i.exec(text);
  return match ? `${Number(match[1])} hari` : text;
}

function validityKey(value: string | null | undefined): string {
  const normalized = normalizeValidity(value);
  return normalized ? normalized.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '') : '';
}

function providerKey(value: string): string {
  return value.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '');
}

function belongsToProvider(product: CatalogRow, provider: string): boolean {
  const key = providerKey(provider);
  if (!key) return false;
  if (product.provider) return providerKey(product.provider) === key;
  return providerKey(product.name).includes(key);
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

// Membuat nama paket dengan meniru gaya penulisan produk lain milik provider yang sama.
function nameFromTemplate(template: CatalogRow | undefined, provider: string, quota: string, validity: string | null): string {
  if (template) {
    const oldQuota = quotaOfName(template.name);
    let name = oldQuota ? swapSpec(template.name, oldQuota, quota) : null;
    if (name && template.validity && validity) name = swapSpec(name, template.validity, validity) ?? name;
    if (name) return name;
  }
  return `Paket Data ${quota} ${provider}`;
}

export function planProviderPackages(provider: string, products: CatalogRow[], packages: PackageInput[]): PackagePlan {
  const owned = products.filter(product => belongsToProvider(product, provider));
  const providerLabel = owned.find(product => product.provider)?.provider ?? provider;
  const plan: PackagePlan = { provider: providerLabel, updates: [], creates: [], missing: [], ambiguous: [], invalid: [] };
  const used = new Set<number>();
  const normalized = packages.map(item => ({ item, quota: normalizeQuota(item.quota), validity: normalizeValidity(item.validity) }));
  const claimed = new Map<number, CatalogRow>();

  for (const entry of normalized) if (!entry.quota) plan.invalid.push(`kuota “${entry.item.quota}” tidak terbaca`);
  const valid = normalized.filter((entry): entry is typeof entry & { quota: string } => !!entry.quota);
  const target = new Map<typeof valid[number], CatalogRow | null>();

  // 1) kuota dan masa aktif sama persis
  for (const entry of valid) {
    const match = owned.find(product => !used.has(product.id) && quotaOfName(product.name) === entry.quota && validityKey(product.validity) === validityKey(entry.validity));
    if (match) { used.add(match.id); target.set(entry, match); claimed.set(match.id, match); }
  }
  // 2) masa aktif sama (slot), kuota berbeda -> produk yang sama diganti kuotanya
  for (const entry of valid) {
    if (target.has(entry) || !validityKey(entry.validity)) continue;
    const slot = owned.filter(product => !used.has(product.id) && validityKey(product.validity) === validityKey(entry.validity));
    if (slot.length === 1) { used.add(slot[0].id); target.set(entry, slot[0]); claimed.set(slot[0].id, slot[0]); }
    else if (slot.length > 1) { plan.ambiguous.push({ label: `${entry.quota}/${entry.validity}`, names: slot.map(product => product.name) }); target.set(entry, null); }
  }
  // 3) kuota sama, masa aktif produk belum tercatat -> isi masa aktifnya
  for (const entry of valid) {
    if (target.has(entry)) continue;
    const match = owned.find(product => !used.has(product.id) && !product.validity && quotaOfName(product.name) === entry.quota);
    if (match) { used.add(match.id); target.set(entry, match); claimed.set(match.id, match); }
  }

  const usualMargin = (() => {
    const margins = owned.filter(product => product.costPrice > 0n && product.sellPrice > product.costPrice).map(product => product.sellPrice - product.costPrice);
    return margins.length ? median(margins) : null;
  })();
  const template = owned[0];
  const commonCategory = (() => {
    const counts = new Map<number, number>();
    for (const product of owned) counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  const commonSub = commonCategory === null ? null : owned.find(product => product.categoryId === commonCategory)?.subcategoryId ?? null;

  for (const entry of valid) {
    const match = target.get(entry);
    if (match === null) continue; // ambigu: ditanyakan
    if (match) {
      const oldQuota = quotaOfName(match.name);
      let name = match.name;
      if (oldQuota && oldQuota !== entry.quota) name = swapSpec(match.name, oldQuota, entry.quota) ?? `Paket Data ${entry.quota} ${plan.provider}`;
      const validity = entry.validity ?? match.validity;
      const costPrice = entry.item.costPrice ?? match.costPrice;
      const from = { name: match.name, validity: match.validity, sellPrice: match.sellPrice, costPrice: match.costPrice };
      const to = { name, validity, sellPrice: entry.item.sellPrice, costPrice };
      const renamed = name !== match.name || normalizeValidity(match.validity) !== normalizeValidity(validity);
      const changed = renamed || to.sellPrice !== from.sellPrice || to.costPrice !== from.costPrice;
      plan.updates.push({ id: match.id, kind: renamed ? 'RENAME' : changed ? 'PRICE' : 'SAME', from, to });
      continue;
    }
    const given = entry.item.costPrice;
    const estimated = given === null && usualMargin !== null && entry.item.sellPrice > usualMargin;
    const costPrice = given ?? (estimated ? entry.item.sellPrice - usualMargin! : 0n);
    plan.creates.push({ name: nameFromTemplate(template, plan.provider, entry.quota, entry.validity), validity: entry.validity,
      sellPrice: entry.item.sellPrice, costPrice, costEstimated: given === null, stock: entry.item.stock ?? 0, categoryId: commonCategory, subcategoryId: commonSub, provider: plan.provider });
  }

  plan.missing = owned.filter(product => !used.has(product.id) && !plan.ambiguous.some(item => item.names.includes(product.name)))
    .map(product => ({ id: product.id, name: product.name, validity: product.validity, stock: product.stock }));
  return plan;
}

export function formatPackagePlan(plan: PackagePlan, formatMoney: (value: bigint) => string): string[] {
  const lines: string[] = [];
  for (const update of plan.updates) {
    if (update.kind === 'SAME') { lines.push(`• ${update.to.name}: tidak berubah`); continue; }
    const parts: string[] = [];
    if (update.to.name !== update.from.name) parts.push(`nama ${update.from.name} → ${update.to.name}`);
    else parts.push(update.to.name);
    if (update.to.sellPrice !== update.from.sellPrice) parts.push(`harga ${formatMoney(update.from.sellPrice)} → ${formatMoney(update.to.sellPrice)}`);
    if (update.to.costPrice !== update.from.costPrice) parts.push(`modal ${formatMoney(update.from.costPrice)} → ${formatMoney(update.to.costPrice)}`);
    lines.push('• ' + parts.join('; '));
  }
  for (const made of plan.creates) {
    lines.push(`• BARU ${made.name}${made.validity ? ' (' + made.validity + ')' : ''}: harga ${formatMoney(made.sellPrice)}; modal ${formatMoney(made.costPrice)}${made.costEstimated ? (made.costPrice > 0n ? ' (perkiraan dari margin biasa)' : ' (belum diisi)') : ''}; stok ${made.stock}`);
  }
  return lines;
}
