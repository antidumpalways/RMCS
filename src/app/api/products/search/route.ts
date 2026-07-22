import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ items: [] });

  const products = await prisma.product.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 20,
  });
  return NextResponse.json({
    items: products.map((p) => ({
      id: p.id,
      name: p.name,
      categoryName: p.category.name,
      sellPrice: Number(p.sellPrice),
      stock: p.stock,
    })),
  });
}
