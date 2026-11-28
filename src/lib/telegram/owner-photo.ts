// Owner mengirim foto di chat pribadi: memasang foto ke barang yang ada, atau membuat barang baru berfoto.
import { prisma } from '@/lib/prisma';
import { savePhoto } from '@/lib/services/product-photo';
import { answerTelegramCallback, sendTelegramMessage } from './client';
import { findProductCandidates, getCatalog, type CatalogProduct } from './owner-assistant';
import { telegramOwnerAuthorized } from './owner-intent';
import { ACCESSORY, parsePhotoCaption, type PhotoCaption } from './photo-caption';
import { strictProductMatch } from './product-match';
import { sendProductPhotos } from './product-reply';

type Photo = { file_id: string; width: number; height: number };
export type OwnerPhotoMessage = { chat: { id: number; type: string }; from?: { id: number }; text?: string; caption?: string;
  photo?: Photo[]; document?: { mime_type?: string }; media_group_id?: string; reply_to_message?: { photo?: Photo[] } };
type PickCallback = { id: string; from: { id: number }; data?: string };

const PICK_TTL = 15 * 60_000;
const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const money = (value: bigint) => idr.format(value);
const squash = (value: string) => value.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, '');

export const PHOTO_HELP = [
  'Cara menambahkan foto barang (tulis di keterangan foto):',
  '',
  'Barang baru:',
  'Tambah aksesoris',
  'Charger Vivo 18W',
  'Modal: 20rb',
  'Jual: 35rb',
  'Stok: 5',
  '',
  'Barang yang sudah ada:',
  'Foto: Charger Vivo 18W',
].join('\n');

/** Foto dari owner, atau balasan teks "Foto: …" pada foto yang sudah terkirim. */
export function isOwnerPhotoMessage(m: OwnerPhotoMessage): boolean {
  if (m.photo?.length || m.document?.mime_type?.startsWith('image/')) return true;
  return !!m.text && !!m.reply_to_message?.photo?.length && parsePhotoCaption(m.text) !== null;
}

const ownerCaption = (title: string) => (product: CatalogProduct) =>
  `${title}\n${product.name}\nHarga jual: ${money(product.sellPrice)}\nModal: ${money(product.costPrice)}\nStok: ${product.stock}\nKategori: ${product.category.name}`;

async function attachPhoto(chatId: bigint, product: CatalogProduct, fileId: string, note = '') {
  if (!await savePhoto(product.id, fileId)) {
    return sendTelegramMessage(chatId, `Foto ${product.name} belum tersimpan (database foto belum siap atau sedang bermasalah). Coba kirim lagi beberapa menit lagi.`);
  }
  const rest = await sendProductPhotos(chatId, [product], ownerCaption('✅ Foto tersimpan' + (note ? '. ' + note : '')));
  if (rest.length) await sendTelegramMessage(chatId, `✅ Foto ${product.name} tersimpan.${note ? ' ' + note : ''}`);
}

async function categoryFor(requested: string | null): Promise<{ id: number; name: string } | { clarification: string }> {
  const categories = await prisma.category.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' }, take: 100 });
  const accessory = !requested || ACCESSORY.test(requested);
  const found = (requested ? categories.find(item => squash(item.name) === squash(requested)) : undefined)
    ?? (accessory ? categories.find(item => ACCESSORY.test(item.name)) : undefined);
  if (found) return found;
  if (accessory) return prisma.category.create({ data: { name: 'Aksesoris' }, select: { id: true, name: true } });
  return { clarification: `Kategori “${requested}” belum ada. Pilihan: ${categories.map(item => item.name).join(', ') || 'belum ada'}.` };
}

async function createWithPhoto(chatId: bigint, ownerId: number, spec: Extract<PhotoCaption, { kind: 'create' }>, fileId: string) {
  const catalog = await getCatalog();
  const existing = catalog.find(product => squash(product.name) === squash(spec.name));
  // Nama sudah ada: hanya fotonya yang dipasang, supaya harga dan stok tidak tertimpa tanpa sengaja.
  if (existing) return attachPhoto(chatId, existing, fileId, 'Barang ini sudah ada, jadi harga dan stok tidak diubah (pakai “Update harga/modal/stok”).');
  const category = await categoryFor(spec.category);
  if ('clarification' in category) return sendTelegramMessage(chatId, category.clarification + ' Belum ada yang disimpan.');
  const cost = BigInt(spec.costPrice ?? 0), stock = spec.stock ?? 0;
  const created = await prisma.$transaction(async tx => {
    const row = await tx.product.create({ data: { name: spec.name, categoryId: category.id, costPrice: cost, sellPrice: BigInt(spec.sellPrice), stock, minStock: 1 }, select: { id: true } });
    if (stock > 0) await tx.inventoryMovement.create({ data: { productId: row.id, type: 'IN', qty: stock, costAtTime: cost, note: 'Stok awal produk berfoto Telegram owner ' + ownerId, userId: null } });
    return row;
  });
  const notes = [
    spec.costPrice === null ? `Modal belum diisi (Rp 0). Isi dengan:\nUpdate modal:\n${spec.name} : 20rb` : '',
    spec.stock === null ? `Stok masih 0. Isi dengan:\nUpdate stok\n${spec.name} : 5` : '',
    spec.costPrice !== null && BigInt(spec.sellPrice) < cost ? '⚠️ Harga jual di bawah modal.' : '',
  ].filter(Boolean).join('\n\n');
  const product: CatalogProduct = { id: created.id, name: spec.name, sku: null, provider: null, validity: null, stock, minStock: 1, costPrice: cost,
    sellPrice: BigInt(spec.sellPrice), locationId: null, updatedAt: new Date(), category: { name: category.name }, location: null };
  if (!await savePhoto(created.id, fileId)) {
    return sendTelegramMessage(chatId, `Barang ${spec.name} tersimpan, tetapi fotonya belum. Kirim ulang fotonya dengan keterangan “Foto: ${spec.name}”.`);
  }
  const rest = await sendProductPhotos(chatId, [product], ownerCaption('🆕 Barang baru disimpan'));
  if (rest.length) await sendTelegramMessage(chatId, ownerCaption('🆕 Barang baru disimpan')(product));
  if (notes) await sendTelegramMessage(chatId, notes);
}

async function askWhich(chatId: bigint, name: string, candidates: CatalogProduct[], fileId: string) {
  const draft = await prisma.telegramDraft.create({ data: { chatId, kind: 'OWNER_PHOTO_PICK', status: 'PENDING', expiresAt: new Date(Date.now() + PICK_TTL),
    payload: { fileId, candidateIds: candidates.map(product => product.id) } }, select: { id: true } });
  return sendTelegramMessage(chatId, `Foto ini untuk barang yang mana? (“${name}” belum cocok persis)`, { inline_keyboard: [
    ...candidates.map(product => [{ text: product.name.slice(0, 55), callback_data: `rcms:owner:photo:${draft.id}:${product.id}` }]),
    [{ text: 'Batal', callback_data: `rcms:owner:photo:${draft.id}:0` }],
  ] });
}

async function attachByName(chatId: bigint, name: string, fileId: string) {
  const catalog = await getCatalog();
  const exact = catalog.filter(product => squash(product.name) === squash(name));
  if (exact.length === 1) return attachPhoto(chatId, exact[0], fileId);
  const candidates = exact.length ? exact.slice(0, 5) : await findProductCandidates(name, catalog);
  if (candidates.length === 1 && strictProductMatch(name, candidates[0])) return attachPhoto(chatId, candidates[0], fileId);
  if (candidates.length) return askWhich(chatId, name, candidates, fileId);
  return sendTelegramMessage(chatId, `Barang “${name}” belum ada di katalog. Untuk membuatnya, kirim ulang fotonya dengan keterangan:\n\nTambah aksesoris\n${name}\nModal: …\nJual: …\nStok: …`);
}

export async function handleOwnerPhoto(m: OwnerPhotoMessage, ownerId: number) {
  const chatId = BigInt(m.chat.id);
  if (!m.from || !telegramOwnerAuthorized(m.from.id) || m.from.id !== ownerId || m.chat.type !== 'private' || m.chat.id !== ownerId) {
    return sendTelegramMessage(chatId, 'Asisten administrasi hanya tersedia untuk owner yang telah diotorisasi.');
  }
  const photos = m.photo?.length ? m.photo : m.reply_to_message?.photo;
  if (!photos?.length) return sendTelegramMessage(chatId, 'Kirim gambarnya sebagai foto (bukan sebagai file) supaya bisa ditampilkan saat barang dicari.');
  const fileId = [...photos].sort((a, b) => b.width * b.height - a.width * a.height)[0].file_id;
  const text = (m.photo?.length ? m.caption : m.text)?.trim() ?? '';
  // Album: hanya foto yang diberi keterangan yang diproses.
  if (!text && m.media_group_id) return;
  if (!text) return sendTelegramMessage(chatId, 'Foto diterima, tetapi belum ada keterangannya.\n\n' + PHOTO_HELP);
  try {
    const parsed = parsePhotoCaption(text);
    if (parsed?.kind === 'invalid') return await sendTelegramMessage(chatId, parsed.reason + ' Belum ada yang disimpan.\n\n' + PHOTO_HELP);
    if (parsed?.kind === 'create') return await createWithPhoto(chatId, ownerId, parsed, fileId);
    if (parsed?.kind === 'attach') return await attachByName(chatId, parsed.name, fileId);
    // Keterangan berisi nama barang saja.
    if (!text.includes('\n') && text.length <= 100) return await attachByName(chatId, text, fileId);
    return await sendTelegramMessage(chatId, 'Keterangan fotonya belum saya pahami.\n\n' + PHOTO_HELP);
  } catch (error) {
    console.error(JSON.stringify({ event: 'owner_photo_failure', message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return sendTelegramMessage(chatId, 'Maaf, foto itu belum bisa saya proses. Cek dulu barangnya (“cek nama barang”), lalu kirim ulang bila belum tersimpan.');
  }
}

export async function handleOwnerPhotoPick(callback: PickCallback, ownerId: number) {
  const match = /^rcms:owner:photo:([A-Za-z0-9_-]{10,40}):(\d{1,9})$/.exec(callback.data ?? '');
  if (!match || !telegramOwnerAuthorized(callback.from.id) || callback.from.id !== ownerId) return answerTelegramCallback(callback.id, 'Tombol tidak valid.');
  const chatId = BigInt(ownerId), productId = Number(match[2]);
  const draft = await prisma.telegramDraft.findUnique({ where: { id: match[1] } });
  const payload = draft?.payload as { fileId?: string; candidateIds?: number[] } | undefined;
  if (!draft || draft.kind !== 'OWNER_PHOTO_PICK' || draft.chatId !== chatId || draft.status !== 'PENDING' || draft.expiresAt <= new Date() || !payload?.fileId) {
    return answerTelegramCallback(callback.id, 'Pilihan ini sudah tidak aktif. Kirim ulang fotonya.');
  }
  if (productId !== 0 && !payload.candidateIds?.includes(productId)) return answerTelegramCallback(callback.id, 'Barang tidak ada di pilihan.');
  const claimed = await prisma.telegramDraft.updateMany({ where: { id: draft.id, status: 'PENDING' }, data: { status: productId ? 'CONFIRMED' : 'CANCELLED' } });
  if (claimed.count !== 1) return answerTelegramCallback(callback.id, 'Pilihan sudah diproses.');
  if (!productId) { await answerTelegramCallback(callback.id, 'Dibatalkan.'); return; }
  const product = (await getCatalog()).find(item => item.id === productId);
  if (!product) return answerTelegramCallback(callback.id, 'Barang sudah tidak ada.');
  await answerTelegramCallback(callback.id, 'Menyimpan foto.');
  return attachPhoto(chatId, product, payload.fileId);
}
