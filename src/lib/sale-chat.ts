import { createHash } from 'node:crypto';

export type SaleSnapshot = {
  id: number;
  userId: number | null;
  createdAt: Date;
  totalRevenue: bigint;
  totalProfit: bigint;
  items: {
    id: number;
    productId: number;
    qty: number;
    priceAtSale: bigint;
    costAtSale: bigint;
  }[];
};

export function jakartaTodayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const start = new Date(`${date}T00:00:00+07:00`);
  return { date, start, end: new Date(start.getTime() + 86_400_000) };
}

export function saleSnapshotSignature(sale: SaleSnapshot) {
  const snapshot = {
    id: sale.id,
    userId: sale.userId,
    createdAt: sale.createdAt.toISOString(),
    totalRevenue: sale.totalRevenue.toString(),
    totalProfit: sale.totalProfit.toString(),
    items: [...sale.items].sort((a, b) => a.id - b.id).map((item) => ({
      id: item.id,
      productId: item.productId,
      qty: item.qty,
      priceAtSale: item.priceAtSale.toString(),
      costAtSale: item.costAtSale.toString(),
    })),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
