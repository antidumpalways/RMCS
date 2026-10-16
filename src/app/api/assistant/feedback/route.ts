import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { catalogSearchTerms } from '@/lib/catalog-search';
import { prisma } from '@/lib/prisma';
import { respectsNumericAttributes } from '@/lib/semantic-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Silakan masuk kembali.' }, { status: 401 });
  if (user.role !== 'owner') return NextResponse.json({ error: 'Hanya owner yang dapat meninjau umpan balik.' }, { status: 403 });
  const [feedback, products, failedSearches] = await Promise.all([
    prisma.assistantFeedback.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] } }, include: { user: { select: { username: true } }, product: { select: { name: true } } },
      orderBy: [{ status: 'desc' }, { createdAt: 'asc' }], take: 100,
    }),
    prisma.product.findMany({ select: { id: true, name: true, provider: true, validity: true }, orderBy: { name: 'asc' }, take: 2000 }),
    prisma.assistantSearchEvent.groupBy({
      by: ['queryKey'], where: { resultCount: 0, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
      _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: 20,
    }),
  ]);
  return NextResponse.json({ feedback, products, failedSearches: failedSearches.map((item) => ({ query: item.queryKey, count: item._count._all })) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Silakan masuk kembali.' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Data tidak terbaca.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
  const data = body as Record<string, unknown>;
  const query = typeof data.query === 'string' ? data.query.trim().slice(0, 200) : '';
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '';
  const productId = Number.isSafeInteger(data.productId) && (data.productId as number) > 0 ? data.productId as number : null;
  const queryKey = catalogSearchTerms(query).join(' ');
  if (query.length < 3 || query.length > 200 || !queryKey || (!productId && !note)) {
    return NextResponse.json({ error: 'Sebutkan pertanyaan barang dan pilih hasil yang tepat atau tulis koreksinya.' }, { status: 400 });
  }
  if (productId && !await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })) {
    return NextResponse.json({ error: 'Barang tidak ada lagi di katalog.' }, { status: 400 });
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (await prisma.assistantFeedback.count({ where: { userId: user.id, createdAt: { gte: dayAgo } } }) >= 10) {
    return NextResponse.json({ error: 'Batas umpan balik hari ini tercapai.' }, { status: 429 });
  }
  await prisma.assistantFeedback.create({ data: { query, queryKey, note: note || null, productId, userId: user.id } });
  return NextResponse.json({ message: 'Masukan terkirim ke owner untuk diperiksa.' });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Silakan masuk kembali.' }, { status: 401 });
  if (user.role !== 'owner') return NextResponse.json({ error: 'Hanya owner yang dapat meninjau umpan balik.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Data tidak terbaca.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
  const data = body as Record<string, unknown>;
  if (!Number.isSafeInteger(data.id) || (data.id as number) <= 0 ||
      (data.status !== 'APPROVED' && data.status !== 'REJECTED' && data.status !== 'REVOKED')) {
    return NextResponse.json({ error: 'Keputusan tidak valid.' }, { status: 400 });
  }
  const id = data.id as number;
  const productId = Number.isSafeInteger(data.productId) && (data.productId as number) > 0 ? data.productId as number : null;
  try {
    await prisma.$transaction(async (tx) => {
      const feedback = await tx.assistantFeedback.findUnique({ where: { id } });
      if (!feedback || (data.status === 'REVOKED' ? feedback.status !== 'APPROVED' : feedback.status !== 'PENDING')) {
        throw new Error('Status masukan sudah berubah. Muat ulang halaman.');
      }
      const chosenProductId = productId || feedback.productId;
      if (data.status === 'APPROVED') {
        const product = chosenProductId ? await tx.product.findUnique({
          where: { id: chosenProductId }, include: { category: { select: { name: true } } },
        }) : null;
        if (!product) {
          throw new Error('Pilih barang katalog yang benar sebelum menyetujui.');
        }
        if (!respectsNumericAttributes(feedback.query, {
          id: product.id, name: product.name, categoryName: product.category.name,
          provider: product.provider, validity: product.validity,
        })) throw new Error('Angka ukuran atau masa aktif pada pertanyaan berbeda dari barang yang dipilih.');
        const conflicting = await tx.assistantFeedback.findFirst({
          where: { queryKey: feedback.queryKey, status: 'APPROVED', productId: { not: chosenProductId } },
        });
        if (conflicting) throw new Error('Padanan ini sudah disetujui untuk barang lain. Tolak masukan yang bertentangan.');
      }
      await tx.assistantFeedback.update({
        where: { id }, data: { status: data.status as string, productId: chosenProductId,
          reviewedById: user.id, reviewedAt: new Date() },
      });
    });
    return NextResponse.json({ message: data.status === 'APPROVED' ? 'Padanan pencarian disetujui.'
      : data.status === 'REVOKED' ? 'Padanan pencarian dicabut.' : 'Masukan ditolak.' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Gagal menyimpan keputusan.' }, { status: 409 });
  }
}
