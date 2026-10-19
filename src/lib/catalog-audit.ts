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
  productId?: number;
  productIds?: number[];
};

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

export async function analyzeCatalog(): Promise<CatalogAuditResult> {
  const [products, subcategories] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, provider: true, validity: true, subcategoryId: true, stock: true, updatedAt: true },
    }),
    prisma.subcategory.findMany({ select: { id: true, name: true } }),
  ]);

  // Kosakata provider diambil dari katalog sendiri agar tidak mengarang nilai.
  const providerCanon = new Map<string, string>();
  for (const product of products) {
    const value = product.provider?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!providerCanon.has(key)) providerCanon.set(key, value);
  }

  const subByName = new Map<string, { id: number; name: string }[]>();
  for (const sub of subcategories) {
    const key = sub.name.trim().toLowerCase();
    const list = subByName.get(key) ?? [];
    list.push({ id: sub.id, name: sub.name });
    subByName.set(key, list);
  }

  const findings: CatalogAuditFinding[] = [];
  const cleanups: CatalogCleanupOp[] = [];
  const counts: Record<AuditKind, number> = { name: 0, provider: 0, validity: 0, subcategory: 0, duplicate: 0, zeroStock: 0 };

  for (const product of products) {
    const tidy = tidyName(product.name);
    const lower = tidy.toLowerCase();
    const expectedUpdatedAt = product.updatedAt.toISOString();

    if (tidy !== product.name) {
      counts.name += 1;
      findings.push({ kind: 'name', label: product.name, detail: `“${product.name}” → “${tidy}”`, productId: product.id });
      cleanups.push({ kind: 'name', productId: product.id, expectedUpdatedAt, name: tidy });
    }

    const providerValue = product.provider?.trim();
    if (!providerValue) {
      const match = [...providerCanon.values()].find((value) => wordBoundary(value).test(lower));
      if (match) {
        counts.provider += 1;
        findings.push({ kind: 'provider', label: product.name, detail: `Provider → ${match}`, productId: product.id });
        cleanups.push({ kind: 'provider', productId: product.id, expectedUpdatedAt, provider: match });
      }
    } else {
      const canon = providerCanon.get(providerValue.toLowerCase());
      if (canon && canon !== product.provider) {
        counts.provider += 1;
        findings.push({ kind: 'provider', label: product.name, detail: `Provider “${providerValue}” → “${canon}”`, productId: product.id });
        cleanups.push({ kind: 'provider', productId: product.id, expectedUpdatedAt, provider: canon });
      }
    }

    if (!product.validity?.trim()) {
      const match = lower.match(/\b(\d{1,3})\s*(?:hari|hr|day)\b/);
      if (match) {
        const validity = `${match[1]} hari`;
        counts.validity += 1;
        findings.push({ kind: 'validity', label: product.name, detail: `Masa aktif → ${validity}`, productId: product.id });
        cleanups.push({ kind: 'validity', productId: product.id, expectedUpdatedAt, validity });
      }
    }

    if (!product.subcategoryId) {
      let move: { id: number; name: string } | null = null;
      for (const [key, list] of subByName) {
        if (key.length >= 4 && list.length === 1 && lower.includes(key)) { move = list[0]; break; }
      }
      if (move) {
        counts.subcategory += 1;
        findings.push({ kind: 'subcategory', label: product.name, detail: `Subkategori → ${move.name}`, productId: product.id });
        cleanups.push({ kind: 'subcategory', productId: product.id, expectedUpdatedAt, subcategoryId: move.id });
      }
    }
  }

  const duplicateGroups = new Map<string, { id: number; name: string }[]>();
  for (const product of products) {
    const key = tidyName(product.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key.length < 3) continue;
    const list = duplicateGroups.get(key) ?? [];
    list.push({ id: product.id, name: product.name });
    duplicateGroups.set(key, list);
  }
  for (const list of duplicateGroups.values()) {
    if (list.length < 2) continue;
    counts.duplicate += 1;
    findings.push({ kind: 'duplicate', label: list[0].name, detail: `${list.length} barang mirip: ${list.map((entry) => entry.name).join(' / ')}`, productIds: list.map((entry) => entry.id) });
  }

  const zeroStock = products.filter((product) => product.stock === 0);
  counts.zeroStock = zeroStock.length;
  for (const product of zeroStock) {
    findings.push({ kind: 'zeroStock', label: product.name, detail: 'Stok 0', productId: product.id });
  }

  return { total: products.length, counts, findings, cleanups };
}

export function findingsForKinds(result: CatalogAuditResult, kinds: AuditKind[]) {
  const selected = new Set(kinds);
  return result.findings.filter((finding) => selected.has(finding.kind));
}

export function cleanupsForKinds(result: CatalogAuditResult, kinds: AuditKind[]) {
  const selected = new Set(kinds);
  return result.cleanups.filter((cleanup) => selected.has(cleanup.kind));
}
