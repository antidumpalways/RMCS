// Mengubah pesan grup "Update stok ... Admin ... Total ..." menjadi ekstraksi rekap:
// barang laku = stok sistem - stok hitungan, admin, dan total saldo/kas. Selebihnya memakai alur rekap yang sudah ada.
import { prisma } from '@/lib/prisma';
import { catalogQueryKey } from '@/lib/catalog-search';
import { formatTelegramRupiah } from './core';
import { getCatalog } from './owner-assistant';
import { resolveInventoryProduct } from './inventory';
import { soldFromCounts, type CountMessage, type CountProduct } from './group-count';
import type { RecapEntry, RecapExtraction, RecapInventoryExtraction } from './recap';

const squash = (value: string) => value.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '');

export async function extractCountMessage(count: CountMessage): Promise<RecapExtraction> {
  const catalog = await getCatalog();
  const searchable = catalog.map(product => ({ id: product.id, name: product.name, sku: product.sku, provider: product.provider,
    validity: [product.validity, product.quota].filter(Boolean).join(' ') || null, categoryName: product.category.name, stock: product.stock, locationId: product.locationId }));
  const aliasRows = await prisma.assistantFeedback.findMany({ where: { status: 'APPROVED', productId: { not: null } }, select: { queryKey: true, productId: true } })
    .catch(() => [] as Array<{ queryKey: string; productId: number | null }>);
  const byId = new Map(catalog.map(product => [product.id, product]));
  const toCountProduct = (product: (typeof catalog)[number]): CountProduct => ({ id: product.id, name: product.name, stock: product.stock, sellPrice: product.sellPrice, validity: product.validity, quota: product.quota });

  const counts = count.items.map(item => {
    // Penulisan yang pernah dipilih owner (alias disetujui) langsung dikenali.
    const aliasIds = [...new Set(aliasRows.filter(row => row.queryKey === catalogQueryKey(item.label) && row.productId !== null && byId.has(row.productId)).map(row => row.productId!))];
    let productId: number | null = aliasIds.length === 1 ? aliasIds[0] : null;
    if (productId === null) {
      // Voucher dikelola per provider per hari: kuota dan angka lepas tidak ikut mencocokkan.
      const hasDay = /\d\s*hari\b/i.test(item.label);
      const label = hasDay ? item.label.replace(/\b\d+(?:[.,]\d+)?\s*(?:gb|mb)\b/gi, ' ').replace(/(^|\s)\d+(?:[.,]\d+)?(?=\s|$)(?!\s*hari)/gi, ' ').replace(/\s+/g, ' ').trim() : item.label;
      const inGroup = item.group ? searchable.filter(product => squash(product.categoryName).includes(squash(item.group!))) : [];
      let found = inGroup.length ? resolveInventoryProduct(label, inGroup) : resolveInventoryProduct(label, searchable);
      if (found.status !== 'MATCHED' && inGroup.length) found = resolveInventoryProduct(label, searchable);
      if (found.status === 'MATCHED' && found.productId) productId = found.productId;
      else {
        const squashed = searchable.filter(product => squash(product.name) === squash(label));
        if (squashed.length === 1) productId = squashed[0].id;
      }
    }
    const product = productId === null ? null : byId.get(productId) ?? null;
    return { item, product: product ? toCountProduct(product) : null };
  });

  const result = soldFromCounts(counts, catalog.map(toCountProduct));
  const inventoryLines: RecapInventoryExtraction[] = result.sold.map(line => ({
    productId: line.productId, sourceText: `${line.label}: stok sistem ${line.systemStock}, hitungan ${line.counted}`, label: line.label, quantity: line.sold, unit: 'pcs', operation: 'add', ambiguity: null }));

  const entries: RecapEntry[] = [], unresolved: string[] = [], notes: string[] = [];
  const money = (key: 'admin' | 'total' | 'expense', title: string, category: RecapEntry['category'], label: string) => {
    const value = count[key];
    if (!value) return;
    if (value.amount === null) { unresolved.push(`Angka ${title} “${value.raw}” kurang jelas. Tulis misalnya 82rb atau 34.463.000.`); return; }
    entries.push({ category, label, amount: String(value.amount), operation: 'set' });
    if (value.assumedThousands) notes.push(`${title} “${value.raw}” dibaca ${formatTelegramRupiah(value.amount)} (angka tanpa satuan dianggap ribuan). Salah? Kirim ulang dengan rb/jt, mis. ${title}: ${key === 'total' ? '34,4jt' : '82rb'}.`);
  };
  money('admin', 'Admin', 'service_fee', 'admin transfer');
  money('expense', 'Pengeluaran', 'expense', 'pengeluaran');
  money('total', 'Total', 'total_balance', 'saldo total');

  const soldTotal = result.sold.reduce((sum, line) => sum + line.price * BigInt(line.sold), 0n);
  if (result.sold.length) notes.push(`Barang laku dari selisih stok: ${result.sold.reduce((sum, line) => sum + line.sold, 0)} pcs, nilai katalog ${formatTelegramRupiah(soldTotal)}.`);
  else if (count.items.length) notes.push('Tidak ada selisih stok: semua hitungan sama dengan stok sistem.');
  if (result.unmatched.length) notes.push(`Belum dikenali (tidak dihitung, tulis ulang dengan nama lengkap atau kabari owner): ${result.unmatched.join(', ')}.`);
  if (count.skipped.length) notes.push(`Dilewati (angka kosong): ${count.skipped.join(', ')}.`);
  notes.push(...result.notes);

  return { replaceInventory: true, entries, inventoryLines, unresolved, notes };
}
