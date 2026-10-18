import { createHash } from 'node:crypto';

// Draf perubahan katalog dari asisten. Server hanya menyiapkan draf; owner harus
// meninjau dan menekan konfirmasi sebelum apa pun berubah di database.
export type CatalogProposalFields = {
  name: string;
  categoryId: number;
  categoryName: string;
  provider: string | null;
  validity: string | null;
  costPrice: string;
  sellPrice: string;
  stock: number;
  minStock: number;
};

export type CatalogChange = { label: string; from: string; to: string };

export type CatalogProposal = {
  kind: 'create' | 'update';
  productId?: number;
  expectedSignature?: string;
  fields: CatalogProposalFields;
  changes?: CatalogChange[];
};

export type CatalogProductSnapshot = {
  id: number;
  name: string;
  categoryId: number;
  subcategoryId: number | null;
  provider: string | null;
  validity: string | null;
  locationId: number | null;
  costPrice: bigint;
  sellPrice: bigint;
  stock: number;
  minStock: number;
  updatedAt: Date;
};

// Sidik jari produk untuk pencegahan perubahan yang saling menimpa.
export function catalogProductSignature(product: CatalogProductSnapshot) {
  const snapshot = {
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    subcategoryId: product.subcategoryId,
    provider: product.provider,
    validity: product.validity,
    locationId: product.locationId,
    costPrice: product.costPrice.toString(),
    sellPrice: product.sellPrice.toString(),
    stock: product.stock,
    minStock: product.minStock,
    updatedAt: product.updatedAt.toISOString(),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
