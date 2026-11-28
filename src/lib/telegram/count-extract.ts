// Mengubah pesan grup "Update stok ... Admin ... Total ..." menjadi ekstraksi rekap:
// barang laku = stok sistem - stok hitungan, admin, dan total saldo/kas. Selebihnya memakai alur rekap yang sudah ada.
import { prisma } from '@/lib/prisma';
import { catalogQueryKey } from '@/lib/catalog-search';
import { formatTelegramRupiah } from './core';
import { getCatalog } from './owner-assistant';
import { resolveInventoryProduct } from './inventory';
import { dedupeCounts, soldFromCounts, type CountMessage, type CountProduct } from './group-count';
import { looseUnitConflict } from './variant-guard';
import type { StockListItem } from './stock-list';
import type { RecapEntry, RecapExtraction, RecapInventoryExtraction } from './recap';

const squash = (value: string) => value.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '');

// Mencocokkan baris hitungan dengan barang katalog (alias disetujui owner, kata kunci, kategori judul kelompok).
export async function resolveCountItems(count: CountMessage): Promise<{ counts: Array<{ item: StockListItem; product: CountProduct | null }>; catalogProducts: CountProduct[]; duplicateNotes: string[] }> {
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
    let product = productId === null ? null : byId.get(productId) ?? null;
    if (product && looseUnitConflict(item.label, product.name)) product = null;
    return { item, product: product ? toCountProduct(product) : null };
  });
  const deduped = dedupeCounts(counts);
  return { counts: deduped.counts, catalogProducts: catalog.map(toCountProduct), duplicateNotes: deduped.notes };
}

export async function extractCountMessage(count: CountMessage, labels: { closing: string | null; next: string | null } = { closing: null, next: null }): Promise<RecapExtraction> {
  const { counts, catalogProducts } = await resolveCountItems(count);
  const result = soldFromCounts(counts, catalogProducts);
  const inventoryLines: RecapInventoryExtraction[] = result.sold.map(line => ({
    productId: line.productId, sourceText: `${line.label}: stok sistem ${line.systemStock}, hitungan ${line.counted}`, label: line.label, quantity: line.sold, unit: 'pcs', operation: 'add', ambiguity: null }));

  const entries: RecapEntry[] = [], unresolved: string[] = [], notes: string[] = [], readAs: string[] = [];
  const money = (key: 'admin' | 'total' | 'expense', title: string, category: RecapEntry['category'], label: string) => {
    const value = count[key];
    if (!value) return;
    if (value.amount === null) { unresolved.push(`Angka ${title} “${value.raw}” kurang jelas. Tulis misalnya 82rb atau 34.463.000.`); return; }
    entries.push({ category, label, amount: String(value.amount), operation: 'set' });
    if (value.assumedThousands && key !== 'expense') readAs.push(`${title} ${formatTelegramRupiah(value.amount)}`);
  };
  money('admin', 'Admin', 'service_fee', 'admin transfer');
  money('expense', 'Pengeluaran', 'expense', 'pengeluaran');
  money('total', 'Total', 'total_balance', 'saldo total');

  // Kejadian uang di luar stok: uang masuk dan bon masuk hitungan perkiraan; uang keluar sudah menjadi pengeluaran di atas.
  const cashEvents: NonNullable<RecapExtraction['cashEvents']> = [], eventLines: string[] = [];
  const title = { in: 'Uang masuk', out: 'Uang keluar', bon: 'Bon' } as const;
  for (const event of count.events) {
    if (event.money.amount === null) { unresolved.push(`Angka ${title[event.kind]} “${event.money.raw}” kurang jelas. Tulis misalnya 500rb atau 500.000.`); continue; }
    if (event.kind !== 'out') cashEvents.push({ kind: event.kind, amount: String(event.money.amount), note: event.note });
    eventLines.push(`${title[event.kind]} ${formatTelegramRupiah(event.money.amount)}${event.note ? ' (' + event.note + ')' : ''}`);
  }
  if (readAs.length) notes.push(`Dibaca ribuan: ${readAs.join(', ')}.`);
  if (eventLines.length) notes.push(`Uang di luar stok (sudah dihitung): ${eventLines.join('; ')}.`);
  const soldTotal = result.sold.reduce((sum, line) => sum + line.price * BigInt(line.sold), 0n);
  if (result.sold.length) notes.push(`Laku ${result.sold.reduce((sum, line) => sum + line.sold, 0)} pcs = ${formatTelegramRupiah(soldTotal)}.`);
  else if (count.items.length) notes.push('Tidak ada barang yang berkurang.');
  if (result.raised.length) notes.push(`📈 Lebih besar dari catatan (tidak dihitung terjual, stok disamakan saat Selesai): ${result.raised.map(line => `${line.label} ${line.from}→${line.to}`).join(', ')}.`);
  if (result.unmatched.length) notes.push(`⚠️ Belum ada di katalog / nama kembar, tidak dihitung (owner perlu menambahkan): ${result.unmatched.join(', ')}.`);
  if (count.skipped.length) notes.push(`Dilewati (angka kosong): ${count.skipped.join(', ')}.`);
  if (count.invalid.length) notes.push(`Baris tidak terbaca: ${count.invalid.slice(0, 6).join('; ')}.`);
  notes.unshift(`Menutup shift${labels.closing ? ' ' + labels.closing : ''}; shift${labels.next ? ' ' + labels.next : ' berikutnya'} dimulai setelah Selesai. Hanya mau menyamakan stok? Batal, lalu kirim “Update stok buka”.`);

  return { nextShiftLabel: labels.next, ...(labels.closing ? { shiftLabel: labels.closing } : {}), stockRaises: result.raised, replaceInventory: true, entries, inventoryLines, unresolved, notes, cashEvents };
}
