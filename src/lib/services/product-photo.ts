import { prisma } from '@/lib/prisma';

// Foto barang hanya pelengkap: bila tabelnya belum ada (skema belum tersinkron) atau gagal, fitur lain tetap berjalan.

export async function loadPhotos(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  try {
    const rows = await prisma.productPhoto.findMany({ where: { productId: { in: ids } }, select: { productId: true, fileId: true } });
    return new Map(rows.map(row => [row.productId, row.fileId]));
  } catch {
    return new Map();
  }
}

/** Mengembalikan false bila foto tidak tersimpan, supaya owner bisa diberi tahu. */
export async function savePhoto(productId: number, fileId: string): Promise<boolean> {
  try {
    await prisma.productPhoto.upsert({ where: { productId }, create: { productId, fileId }, update: { fileId } });
    return true;
  } catch {
    return false;
  }
}
