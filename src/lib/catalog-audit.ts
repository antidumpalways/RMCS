// Audit katalog deterministik (bukan dikarang AI). Hanya membaca, lalu
// mengusulkan perbaikan aman untuk disetujui owner.

import { prisma } from '@/lib/prisma';

export const AUDIT_KINDS = ['name', 'provider', 'validity', 'subcategory', 'duplicate', 'zeroStock'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  name: 'Nama barang',
  provider: 'Provider',
  validity: 'Masa aktif',
  subcategory: 'Kategori/subkategori',
  duplicate: 'Barang mirip/duplikat',
  zeroStock: 'Stok 0',
};

export type CatalogAuditFinding = {
  kind: AuditKind;
  label: string;
  detail: string;
  category?: string;
  productId?: number;
  productIds?: number[];
};

export type CatalogAuditOptions = { categoryNames?: string[] };

export type CatalogCleanupOp = {
  kind: 'name' | 'provider' | 'validity' | 'subcategory';
  productId: number;
  expectedUpdatedAt: string;
  name?: string;
  provider?: string;
  validity?: string;
  subcategoryId?: number;
};

export type CatalogAuditResult = {
  total: number;
  counts: Record<AuditKind, number>;
  findings: CatalogAuditFinding[];
  cleanups: CatalogCleanupOp[];
};

const SPACES = /\s+/g;

function tidyName(name: string) {
  return name.replace(SPACES, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

function wordBoundary(token: string) {
  return new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
}

export async function analyzeCatalog(options: CatalogAuditOptions = {}): Promise<CatalogAuditResult> {
  const [products, subcategories, categories] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, provider: true, validity: true, subcategoryId: true, categoryId: true, stock: true, updatedAt: true },
    }),
    prisma.subcategory.findMany({ select: { id: true, name: true, categoryId: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
  ]);

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const wantedCategories = (options.categoryNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean);
  const scoped = wantedCategories.length
    ? products.filter((product) => wantedCategories.includes((categoryNameById.get(product.categoryId) ?? '').toLowerCase()))
    : products;

  // Kosakata provider diambil dari katalog sendiri agar tidak mengarang nilai.
  const providerCanon = new Map<string, string>();
  for (const product of products) {
    const value = product.provider?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!providerCanon.has(key)) providerCanon.set(key, value);
  }

  const subByName = new Map<string, { id: number; name: string; categoryId: number }[]>();
  for (const sub of subcategories) {
    const key = sub.name.trim().toLowerCase();
    const list = subByName.get(key) ?? [];
    list.push({ id: sub.id, name: sub.name, categoryId: sub.categoryId });
    subByName.set(key, list);
  }

  const findings: CatalogAuditFinding[] = [];
  const cleanups: CatalogCleanupOp[] = [];
  const counts: Record<AuditKind, number> = { name: 0, provider: 0, validity: 0, subcategory: 0, duplicate: 0, zeroStock: 0 };

  for (const product of scoped) {
    const tidy = tidyName(product.name);
    const lower = tidy.toLowerCase();
    const expectedUpdatedAt = product.updatedAt.toISOString();
    const category = categoryNameById.get(product.categoryId);

    if (tidy !== product.name) {
      counts.name += 1;
      findings.push({ kind: 'name', label: product.name, detail: `“${product.name}” → “${tidy}”`, category, productId: product.id });
      cleanups.push({ kind: 'name', productId: product.id, expectedUpdatedAt, name: tidy });
    }

    const providerValue = product.provider?.trim();
    if (!providerValue) {
      const match = [...providerCanon.values()].find((value) => wordBoundary(value).test(lower));
      if (match) {
        counts.provider += 1;
        findings.push({ kind: 'provider', label: product.name, detail: `Provider → ${match}`, category, productId: product.id });
        cleanups.push({ kind: 'provider', productId: product.id, expectedUpdatedAt, provider: match });
      }
    } else {
      const canon = providerCanon.get(providerValue.toLowerCase());
      if (canon && canon !== product.provider) {
        counts.provider += 1;
        findings.push({ kind: 'provider', label: product.name, detail: `Provider “${providerValue}” → “${canon}”`, category, productId: product.id });
        cleanups.push({ kind: 'provider', productId: product.id, expectedUpdatedAt, provider: canon });
      }
    }

    if (!product.validity?.trim()) {
      const match = lower.match(/\b(\d{1,3})\s*(?:hari|hr|day)\b/);
      if (match) {
        const validity = `${match[1]} hari`;
        counts.validity += 1;
        findings.push({ kind: 'validity', label: product.name, detail: `Masa aktif → ${validity}`, category, productId: product.id });
        cleanups.push({ kind: 'validity', productId: product.id, expectedUpdatedAt, validity });
      }
    }

    if (!product.subcategoryId) {
      let move: { id: number; name: string; categoryId: number } | null = null;
      for (const [key, list] of subByName) {
        if (key.length < 4 || !lower.includes(key)) continue;
        const same = list.find((entry) => entry.categoryId === product.categoryId);
        move = same ?? (list.length === 1 ? list[0] : null);
        if (move) break;
      }
      if (move) {
        counts.subcategory += 1;
        findings.push({ kind: 'subcategory', label: product.name, detail: `Subkategori → ${move.name}`, category, productId: product.id });
        cleanups.push({ kind: 'subcategory', productId: product.id, expectedUpdatedAt, subcategoryId: move.id });
      }
    }
  }

  const duplicateGroups = new Map<string, { id: number; name: string; category?: string }[]>();
  for (const product of scoped) {
    const key = tidyName(product.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key.length < 3) continue;
    const list = duplicateGroups.get(key) ?? [];
    list.push({ id: product.id, name: product.name, category: categoryNameById.get(product.categoryId) });
    duplicateGroups.set(key, list);
  }
  for (const list of duplicateGroups.values()) {
    if (list.length < 2) continue;
    counts.duplicate += 1;
    findings.push({ kind: 'duplicate', label: list[0].name, detail: `${list.length} barang mirip: ${list.map((entry) => entry.name).join(' / ')}`, category: list[0].category, productIds: list.map((entry) => entry.id) });
  }

  const zeroStock = scoped.filter((product) => product.stock === 0);
  counts.zeroStock = zeroStock.length;
  for (const product of zeroStock) {
    findings.push({ kind: 'zeroStock', label: product.name, detail: 'Stok 0', category: categoryNameById.get(product.categoryId), productId: product.id });
  }

  return { total: scoped.length, counts, findings, cleanups };
}

export function findingsForKinds(result: CatalogAuditResult, kinds: AuditKind[]) {
  const selected = new Set(kinds);
  return result.findings.filter((finding) => selected.has(finding.kind));
}

export function cleanupsForKinds(result: CatalogAuditResult, kinds: AuditKind[]) {
  const selected = new Set(kinds);
  return result.cleanups.filter((cleanup) => selected.has(cleanup.kind));
}
