// Menampilkan barang yang punya foto sebagai foto + keterangan. Dipakai jawaban pencarian di grup dan chat owner.
import { loadPhotos } from '@/lib/services/product-photo';
import { sendTelegramPhoto } from './client';

/**
 * Mengirim satu foto untuk tiap barang yang punya foto (maksimal 5). Mengembalikan barang yang TIDAK terkirim sebagai foto
 * (belum punya foto atau pengiriman gagal) supaya pemanggil bisa menjawabnya dengan teks.
 */
export async function sendProductPhotos<T extends { id: number }>(chatId: bigint, products: T[], caption: (product: T) => string): Promise<T[]> {
  const photos = await loadPhotos(products.map(product => product.id));
  const rest: T[] = [];
  let sent = 0;
  for (const product of products) {
    const fileId = photos.get(product.id);
    if (!fileId || sent >= 5) { rest.push(product); continue; }
    try { await sendTelegramPhoto(chatId, fileId, caption(product)); sent++; }
    catch { rest.push(product); }
  }
  return rest;
}
