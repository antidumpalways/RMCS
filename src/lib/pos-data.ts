import { prisma } from './prisma';

export type PosProduct = {
  id: number;
  name: string;
  stock: number;
  sellPrice: number;
  categoryId: number;
  categoryName: string;
  provider: string | null;
  validity: string | null;
};

// Katalog untuk layar kasir. Dimuat sekali di layout (pos) lalu dipakai ulang antar-halaman.
export async function getPosCatalog(): Promise<{ products: PosProduct[]; popularIds: number[]; storeName: string }> {
  const [products, popular, settings] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, name: true, stock: true, sellPrice: true, categoryId: true, provider: true, validity: true, category: { select: { name: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
    }),
    prisma.saleItem.groupBy({ by: ['productId'], _sum: { qty: true }, orderBy: { _sum: { qty: 'desc' } }, take: 12 }),
    prisma.settings.findUnique({ where: { id: 1 }, select: { storeName: true } }).catch(() => null),
  ]);
  return {
    products: products.map(({ category, sellPrice, ...p }) => ({ ...p, categoryName: category.name, sellPrice: Number(sellPrice) })),
    popularIds: popular.map((p) => p.productId),
    storeName: settings?.storeName || 'R-CELL',
  };
}
