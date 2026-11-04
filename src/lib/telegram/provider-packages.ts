// Perencana murni (tanpa database) untuk voucher per provider per HARI.
// Produk = provider + masa aktif, contoh "Axis 3 Hari". Kuota (GB) BUKAN bagian produk: bila kuota berubah tidak ada yang perlu diubah.
// Daftar harian cukup berisi hari + harga; kuota boleh disebut tetapi diabaikan (hanya dipakai bila satu hari punya beberapa produk lama).

// sellPrice null = harga tidak disebut (hanya boleh untuk paket yang sudah ada: mis. hanya memperbarui kuota).
export type PackageInput = { validity: string | null; sellPrice: bigint | null; costPrice: bigint | null; stock: number | null; quota?: string | null };
export type CatalogRow = {
  id: number; name: string; provider: string | null; validity: string | null; stock: number;
  costPrice: bigint; sellPrice: bigint; categoryId: number; subcategoryId: number | null;
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
export type PackagePlan = {
  provider: string; updates: PackageUpdate[]; creates: PackageCreate[];
  missing: Array<{ id: number; name: string; validity: string | null; stock: number }>;
  // Mode "ganti semua": produk lama yang tidak dipakai lagi (dihapus bila aman, kalau tidak dinonaktifkan).
  retire: Array<{ id: number; name: string; validity: string | null; stock: number }>;
  ambiguous: Array<{ label: string; names: string[] }>; invalid: string[];
};

// "10gb", "10 GB", "1,5GB", "500mb" -> "10GB", "1.5GB", "500MB". Dipakai hanya untuk membedakan produk lama di hari yang sama.
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

// Nama produk menurut hari: "Axis 3 Hari" (atau "Axis Standard" bila masa aktif bukan angka hari).
export function slotName(provider: string, validity: string | null): string {
  const normalized = normalizeValidity(validity);
  if (!normalized) return provider;
  const days = /^(\d+) hari$/.exec(normalized);
  return days ? `${provider} ${days[1]} Hari` : `${provider} ${titleCase(normalized)}`;
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

function quotaOfName(name: string): string | null {
  return normalizeQuota(name);
}

// Kuota yang disimpan sebagai keterangan: dinormalkan bila terbaca (10gb -> 10GB), selain itu teks apa adanya (mis. "Unlimited").
export function quotaLabel(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return normalizeQuota(text) ?? text.slice(0, 40);
}

function ownedBy(products: CatalogRow[], provider: string) {
  const owned = products.filter(product => belongsToProvider(product, provider));
  const label = owned.find(product => product.provider)?.provider ?? titleCase(provider);
  return { owned, label };
}

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

  const seenDays = new Set<string>();
  for (const item of packages) {
    const validity = normalizeValidity(item.validity);
    if (!validity) { plan.invalid.push('masa aktif (hari) belum disebut'); continue; }
    const key = validityKey(validity);
    if (seenDays.has(key)) { plan.invalid.push(`masa aktif ${validity} disebut dua kali`); continue; }
    seenDays.add(key);

    const slot = owned.filter(product => !used.has(product.id) && validityKey(product.validity) === key);
    let match: CatalogRow | null = null;
    if (slot.length === 1) match = slot[0];
    else if (slot.length > 1) {
      // Katalog lama: beberapa produk di hari yang sama. Kuota (bila disebut) membedakan; kalau tidak bisa, tanyakan.
      const quota = item.quota ? normalizeQuota(item.quota) : null;
      const byQuota = quota ? slot.filter(product => quotaOfName(product.name) === quota) : [];
      if (byQuota.length === 1) match = byQuota[0];
      else if (options.replaceAll) {
        // "Ganti semua": satu produk (kuota cocok, lalu stok terbanyak, lalu id terkecil) menjadi produk hari itu; sisanya dipensiunkan.
        match = [...slot].sort((a, b) => b.stock - a.stock || a.id - b.id)[0];
        for (const other of slot) if (other.id !== match.id) { used.add(other.id); plan.retire.push({ id: other.id, name: other.name, validity: other.validity, stock: other.stock }); }
      }
      else { plan.ambiguous.push({ label: validity, names: slot.map(product => product.name) }); continue; }
    }

    if (match) {
      used.add(match.id);
      const name = slotName(plan.provider, validity);
      const costPrice = item.costPrice ?? match.costPrice;
      const quota = quotaLabel(item.quota);
      const from = { name: match.name, validity: match.validity, sellPrice: match.sellPrice, costPrice: match.costPrice };
      const to = { name, validity, sellPrice: item.sellPrice ?? match.sellPrice, costPrice };
      const renamed = name !== match.name || normalizeValidity(match.validity) !== validity;
      const priceChanged = to.sellPrice !== from.sellPrice || to.costPrice !== from.costPrice;
      plan.updates.push({ id: match.id, quota, kind: renamed ? 'RENAME' : priceChanged ? 'PRICE' : quota ? 'QUOTA' : 'SAME', from, to });
      continue;
    }

    if (item.sellPrice === null) { plan.invalid.push(`harga ${validity} belum disebut (paket baru perlu harga)`); continue; }
    const given = item.costPrice;
    const estimated = given === null && usualMargin !== null && item.sellPrice > usualMargin;
    plan.creates.push({ name: slotName(plan.provider, validity), validity, sellPrice: item.sellPrice,
      costPrice: given ?? (estimated ? item.sellPrice - usualMargin! : 0n), costEstimated: given === null, stock: item.stock ?? 0,
      categoryId: commonCategory, subcategoryId: commonSub, provider: plan.provider, quota: quotaLabel(item.quota) });
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
    if (group.length > 1) { plan.ambiguous.push({ label: normalizeValidity(group[0].validity) ?? '?', names: group.map(product => product.name) }); continue; }
    const product = group[0];
    const name = slotName(plan.provider, product.validity);
    const validity = normalizeValidity(product.validity);
    const renamed = name !== product.name || validity !== product.validity;
    const point = { name: product.name, validity: product.validity, sellPrice: product.sellPrice, costPrice: product.costPrice };
    plan.updates.push({ id: product.id, quota: null, kind: renamed ? 'RENAME' : 'SAME', from: point, to: { ...point, name, validity } });
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
