// Perencana murni (tanpa database) untuk voucher per provider per HARI.
// Produk = provider + masa aktif, contoh "Axis 3 Hari". Kuota (GB) BUKAN bagian produk: bila kuota berubah tidak ada yang perlu diubah.
// Pengecualian: bila satu provider punya beberapa paket di hari yang sama (mis. Telkomsel 5 hari: 5GB dan 7GB), tiap varian
// diberi nama dengan kuotanya, "Telkomsel 5 Hari (7GB)", dan dipasangkan dengan produk lama lewat kuota, lalu urutan harga.

export type PackageInput = { validity: string | null; sellPrice: bigint | null; costPrice: bigint | null; stock: number | null; quota?: string | null };
export type CatalogRow = {
  id: number; name: string; provider: string | null; validity: string | null; stock: number;
  costPrice: bigint; sellPrice: bigint; categoryId: number; subcategoryId: number | null;
  quota?: string | null; // kuota hari ini (keterangan), bila tercatat
};
export type PackageUpdate = {
  id: number; kind: 'PRICE' | 'RENAME' | 'SAME' | 'QUOTA'; quota: string | null;
  from: { name: string; validity: string | null; sellPrice: bigint; costPrice: bigint };
  to: { name: string; validity: string | null; sellPrice: bigint; costPrice: bigint };
};
export type PackageCreate = {
  name: string; validity: string | null; sellPrice: bigint; costPrice: bigint; costEstimated: boolean;
  stock: number; categoryId: number | null; subcategoryId: number | null; provider: string; quota: string | null;
};
type Leftover = { id: number; name: string; validity: string | null; stock: number };
export type PackagePlan = {
  provider: string; updates: PackageUpdate[]; creates: PackageCreate[];
  missing: Leftover[];
  // Mode "ganti semua": produk lama yang tidak dipakai lagi (dihapus bila aman, kalau tidak dinonaktifkan).
  retire: Leftover[];
  ambiguous: Array<{ label: string; names: string[] }>; invalid: string[];
};

// "10gb", "10 GB", "1,5GB", "500mb" -> "10GB", "1.5GB", "500MB".
export function normalizeQuota(value: string): string | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(gb|g|mb|m)\b/i.exec(value.trim());
  if (!match) return null;
  const unit = /^m/i.test(match[2]) ? 'MB' : 'GB';
  return match[1].replace(',', '.') + unit;
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

function titleCase(value: string): string {
  return value.trim().split(/\s+/).map(word => word.charAt(0).toLocaleUpperCase('id-ID') + word.slice(1)).join(' ');
}

// Nama produk menurut hari: "Axis 3 Hari"; varian di hari yang sama: "Telkomsel 5 Hari (7GB)".
export function slotName(provider: string, validity: string | null, variant?: string | null): string {
  const normalized = normalizeValidity(validity);
  const base = !normalized ? provider : (() => {
    const days = /^(\d+) hari$/.exec(normalized);
    return days ? `${provider} ${days[1]} Hari` : `${provider} ${titleCase(normalized)}`;
  })();
  return variant ? `${base} (${variant})` : base;
}

// Kuota yang disimpan sebagai keterangan: dinormalkan bila terbaca (10gb -> 10GB), selain itu teks apa adanya (mis. "Unlimited").
export function quotaLabel(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return normalizeQuota(text) ?? text.slice(0, 40);
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

function quotaOfProduct(product: CatalogRow): string | null {
  return quotaLabel(product.quota) ?? normalizeQuota(product.name);
}

function ownedBy(products: CatalogRow[], provider: string) {
  const owned = products.filter(product => belongsToProvider(product, provider));
  const label = owned.find(product => product.provider)?.provider ?? titleCase(provider);
  return { owned, label };
}

function priceOrder(a: bigint | null, b: bigint | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

type Entry = { item: PackageInput; validity: string; quota: string | null; index: number };

export function planProviderPackages(provider: string, products: CatalogRow[], packages: PackageInput[], options: { replaceAll?: boolean } = {}): PackagePlan {
  const { owned, label } = ownedBy(products, provider);
  const plan: PackagePlan = { provider: label, updates: [], creates: [], missing: [], retire: [], ambiguous: [], invalid: [] };
  const used = new Set<number>();

  const usualMargin = (() => {
    const margins = owned.filter(product => product.costPrice > 0n && product.sellPrice > product.costPrice).map(product => product.sellPrice - product.costPrice);
    return margins.length ? median(margins) : null;
  })();
  const commonCategory = (() => {
    const counts = new Map<number, number>();
    for (const product of owned) counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  const commonSub = commonCategory === null ? null : owned.find(product => product.categoryId === commonCategory)?.subcategoryId ?? null;

  // Kelompokkan masukan per hari. Beberapa paket di hari yang sama harus dibedakan kuotanya.
  const byDay = new Map<string, Entry[]>();
  packages.forEach((item, index) => {
    const validity = normalizeValidity(item.validity);
    if (!validity) { plan.invalid.push('masa aktif (hari) belum disebut'); return; }
    const key = validityKey(validity);
    const entry: Entry = { item, validity, quota: quotaLabel(item.quota), index };
    const group = byDay.get(key) ?? [];
    if (group.length && (!entry.quota || group.some(other => !other.quota))) { plan.invalid.push(`masa aktif ${validity} disebut lebih dari sekali tanpa kuota pembeda`); return; }
    if (entry.quota && group.some(other => other.quota === entry.quota)) { plan.invalid.push(`${validity} ${entry.quota} disebut dua kali`); return; }
    byDay.set(key, [...group, entry]);
  });

  for (const [key, group] of byDay) {
    const slot = owned.filter(product => !used.has(product.id) && validityKey(product.validity) === key);
    const inputs = [...group].sort((a, b) => priceOrder(a.item.sellPrice, b.item.sellPrice) || a.index - b.index);
    const multi = inputs.length > 1;
    const olds = [...slot];
    const pairs: Array<{ entry: Entry; match: CatalogRow | null }> = [];
    const unpaired: Entry[] = [];

    // 1) kuota yang sama
    for (const entry of inputs) {
      const at = entry.quota ? olds.findIndex(product => quotaOfProduct(product) === entry.quota) : -1;
      if (at >= 0) pairs.push({ entry, match: olds.splice(at, 1)[0] });
      else unpaired.push(entry);
    }
    // 2) sisanya: bila produk lama LEBIH banyak dari masukan dan bukan "ganti semua", tanyakan; selain itu pasangkan per urutan
    if (unpaired.length && olds.length > unpaired.length && !options.replaceAll) {
      plan.ambiguous.push({ label: group[0].validity, names: olds.map(product => product.name) });
      continue;
    }
    const pool = options.replaceAll && olds.length > unpaired.length
      ? [...olds].sort((a, b) => b.stock - a.stock || a.id - b.id)
      : [...olds].sort((a, b) => (a.sellPrice < b.sellPrice ? -1 : a.sellPrice > b.sellPrice ? 1 : a.id - b.id));
    for (const entry of unpaired) pairs.push({ entry, match: pool.shift() ?? null });
    if (options.replaceAll) {
      for (const leftover of pool) {
        used.add(leftover.id);
        plan.retire.push({ id: leftover.id, name: leftover.name, validity: leftover.validity, stock: leftover.stock });
      }
    }

    pairs.sort((a, b) => a.entry.index - b.entry.index);
    for (const { entry, match } of pairs) {
      const item = entry.item;
      // Varian di hari yang sama dibedakan lewat kuota.
      const name = slotName(plan.provider, entry.validity, multi ? entry.quota : null);
      if (match) {
        used.add(match.id);
        const costPrice = item.costPrice ?? match.costPrice;
        const from = { name: match.name, validity: match.validity, sellPrice: match.sellPrice, costPrice: match.costPrice };
        const to = { name, validity: entry.validity, sellPrice: item.sellPrice ?? match.sellPrice, costPrice };
        const renamed = name !== match.name || normalizeValidity(match.validity) !== entry.validity;
        const priceChanged = to.sellPrice !== from.sellPrice || to.costPrice !== from.costPrice;
        plan.updates.push({ id: match.id, quota: entry.quota, kind: renamed ? 'RENAME' : priceChanged ? 'PRICE' : entry.quota ? 'QUOTA' : 'SAME', from, to });
        continue;
      }
      if (item.sellPrice === null) { plan.invalid.push(`harga ${entry.validity}${entry.quota ? ' ' + entry.quota : ''} belum disebut (paket baru perlu harga)`); continue; }
      const given = item.costPrice;
      const estimated = given === null && usualMargin !== null && item.sellPrice > usualMargin;
      plan.creates.push({ name, validity: entry.validity, sellPrice: item.sellPrice, costPrice: given ?? (estimated ? item.sellPrice - usualMargin! : 0n),
        costEstimated: given === null, stock: item.stock ?? 0, categoryId: commonCategory, subcategoryId: commonSub, provider: plan.provider, quota: entry.quota });
    }
  }

  plan.missing = owned.filter(product => !used.has(product.id) && !plan.ambiguous.some(entry => entry.names.includes(product.name)))
    .map(product => ({ id: product.id, name: product.name, validity: product.validity, stock: product.stock }));
  if (options.replaceAll && !plan.ambiguous.length && !plan.invalid.length) {
    // Daftar yang diberikan menggantikan seluruh katalog provider: yang tidak disebut ikut dipensiunkan.
    plan.retire.push(...plan.missing);
    plan.missing = [];
  }
  return plan;
}

// Merapikan katalog lama: ganti nama produk voucher yang punya masa aktif menjadi "Provider N Hari" (harga dan stok tidak disentuh).
export function planProviderNormalize(provider: string, products: CatalogRow[]): PackagePlan {
  const { owned, label } = ownedBy(products, provider);
  const plan: PackagePlan = { provider: label, updates: [], creates: [], missing: [], retire: [], ambiguous: [], invalid: [] };
  const groups = new Map<string, CatalogRow[]>();
  for (const product of owned) {
    const key = validityKey(product.validity);
    if (!key) { plan.missing.push({ id: product.id, name: product.name, validity: product.validity, stock: product.stock }); continue; }
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  for (const [, group] of groups) {
    const quotas = group.map(product => quotaOfProduct(product));
    const distinct = new Set(quotas.filter(Boolean));
    // Beberapa produk di hari yang sama: boleh dirapikan bila kuota masing-masing diketahui dan berbeda.
    const variantsKnown = group.length > 1 && quotas.every(Boolean) && distinct.size === group.length;
    if (group.length > 1 && !variantsKnown) { plan.ambiguous.push({ label: normalizeValidity(group[0].validity) ?? '?', names: group.map(product => product.name) }); continue; }
    for (const product of group) {
      const name = slotName(plan.provider, product.validity, group.length > 1 ? quotaOfProduct(product) : null);
      const validity = normalizeValidity(product.validity);
      const renamed = name !== product.name || validity !== product.validity;
      const point = { name: product.name, validity: product.validity, sellPrice: product.sellPrice, costPrice: product.costPrice };
      plan.updates.push({ id: product.id, quota: null, kind: renamed ? 'RENAME' : 'SAME', from: point, to: { ...point, name, validity } });
    }
  }
  return plan;
}

export function formatPackagePlan(plan: PackagePlan, formatMoney: (value: bigint) => string): string[] {
  const lines: string[] = [];
  for (const update of plan.updates) {
    if (update.kind === 'SAME') { lines.push(`• ${update.to.name}: tidak berubah`); continue; }
    const parts: string[] = [];
    if (update.to.name !== update.from.name) parts.push(`${update.from.name} → ${update.to.name}`);
    else parts.push(update.to.name);
    if (update.quota) parts.push(`kuota ${update.quota}`);
    if (update.to.sellPrice !== update.from.sellPrice) parts.push(`harga ${formatMoney(update.from.sellPrice)} → ${formatMoney(update.to.sellPrice)}`);
    if (update.to.costPrice !== update.from.costPrice) parts.push(`modal ${formatMoney(update.from.costPrice)} → ${formatMoney(update.to.costPrice)}`);
    lines.push('• ' + parts.join('; '));
  }
  for (const made of plan.creates) {
    lines.push(`• BARU ${made.name}${made.quota ? ' (' + made.quota + ')' : ''}: harga ${formatMoney(made.sellPrice)}; modal ${formatMoney(made.costPrice)}${made.costEstimated ? (made.costPrice > 0n ? ' (perkiraan dari margin biasa)' : ' (belum diisi)') : ''}; stok ${made.stock}`);
  }
  return lines;
}
