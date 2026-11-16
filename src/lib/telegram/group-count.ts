// Pesan grup karyawan setelah shift: "Update stok" berisi sisa stok fisik + Admin + Total saldo/kas.
// Bot menghitung barang yang laku dari selisih stok sistem dan stok hitungan, lalu mencocokkannya dengan uang terkumpul.
import { parseStockList, parseAmount, type StockListItem } from './stock-list';

export type CountMoney = { raw: string; amount: number | null; assumedThousands: boolean };
export type CountMessage = {
  items: StockListItem[];
  skipped: string[];
  admin: CountMoney | null;
  total: CountMoney | null;
  expense: CountMoney | null;
};

const HEADER = /^(?:tolong\s+)?(?:update|updet|apdet)\s+(?:stok|stock)(?:\s+(?:akhir|fisik|sekarang|terbaru|shift|tutup|pagi|sore|buka|awal))*\s*[:.,-]*\s*/i;
// "Modal" yang ditulis karyawan berarti uang gabungan saldo + cash, sama seperti "Total".
const FINANCE_LINE = /^(admin|total(?:\s+(?:saldo|kas|uang|akhir))*|modal(?:\s+(?:awal|akhir|saldo|kas|uang))*|saldo(?:\s+(?:total|akhir))*|kas|pengeluaran|biaya)\s*[:=]\s*(.+)$/i;

// Kop bisa menyebut pagi/buka (membuka shift) atau sore/tutup/akhir (menutup shift); tanpa penanda ditentukan dari keadaan shift.
export function countMode(text: string): 'open' | 'close' | null {
  const first = text.trim().split(/\r?\n/)[0] ?? '';
  const header = HEADER.exec(first)?.[0] ?? '';
  if (/\b(?:pagi|buka|awal)\b/i.test(header)) return 'open';
  if (/\b(?:sore|tutup|akhir)\b/i.test(header)) return 'close';
  return null;
}

export function isCountMessage(text: string): boolean {
  const first = text.trim().split(/\r?\n/)[0] ?? '';
  return HEADER.test(first) && text.trim().split(/\r?\n/).length > 1 || (HEADER.test(first) && first.replace(HEADER, '').trim().length > 0);
}

// Angka kecil tanpa satuan pada isian uang ("Admin: 82", "Total: 34463") ditulis dalam ribuan oleh karyawan.
// Satuan eksplisit (rb, jt) dan angka bertitik ribuan dipakai apa adanya. Hasilnya selalu ditampilkan di draf untuk diperiksa.
export function interpretMoney(raw: string, kind: 'admin' | 'total' | 'expense', reference: number | null = null): CountMoney {
  const text = raw.trim();
  const explicit = parseAmount(text);
  const hasUnit = /(?:rb|ribu|k|jt|juta)\b/i.test(text) || /^\D*\d{1,3}(?:[.,]\d{3})+\D*$/.test(text);
  if (explicit === null) return { raw: text, amount: null, assumedThousands: false };
  if (hasUnit) return { raw: text, amount: explicit, assumedThousands: false };
  const thousands = explicit * 1000;
  if (kind === 'total') {
    if (explicit >= 1_000_000) return { raw: text, amount: explicit, assumedThousands: false };
    // Bila saldo awal diketahui, pilih tafsiran yang masuk akal terhadapnya (0,2x-5x).
    if (reference && reference > 0) {
      const plausible = (value: number) => value >= reference * 0.2 && value <= reference * 5;
      if (plausible(explicit)) return { raw: text, amount: explicit, assumedThousands: false };
      if (plausible(thousands)) return { raw: text, amount: thousands, assumedThousands: true };
      return { raw: text, amount: null, assumedThousands: false };
    }
    return explicit >= 1000 ? { raw: text, amount: thousands, assumedThousands: true } : { raw: text, amount: null, assumedThousands: false };
  }
  // Admin/pengeluaran per shift: di bawah Rp 1.000 pasti ribuan.
  return explicit < 1000 ? { raw: text, amount: thousands, assumedThousands: true } : { raw: text, amount: explicit, assumedThousands: false };
}

export function parseCountMessage(text: string, openingBalance: number | null = null): CountMessage | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || !HEADER.test(lines[0])) return null;
  const rest = lines[0].replace(HEADER, '').trim();
  const body = rest ? [rest, ...lines.slice(1)] : lines.slice(1);
  const money: Partial<Record<'admin' | 'total' | 'expense', CountMoney>> = {};
  const stockLines: string[] = [];
  for (const line of body) {
    const finance = FINANCE_LINE.exec(line);
    if (!finance) { stockLines.push(line); continue; }
    const key = /^admin/i.test(finance[1]) ? 'admin' : /^(?:pengeluaran|biaya)/i.test(finance[1]) ? 'expense' : 'total';
    money[key] = interpretMoney(finance[2], key, key === 'total' ? openingBalance : null);
  }
  const stock = stockLines.length ? parseStockList(stockLines.join('\n'), { lenient: true }) : null;
  if (!stock && !money.admin && !money.total) return null;
  return { items: stock?.items ?? [], skipped: stock?.skipped ?? [], admin: money.admin ?? null, total: money.total ?? null, expense: money.expense ?? null };
}

// ---------------------------------------------------------------------------------------------
// Dari hitungan stok ke barang laku
// ---------------------------------------------------------------------------------------------

export type CountProduct = { id: number; name: string; stock: number; sellPrice: bigint; validity: string | null; quota?: string | null };
export type CountSold = { productId: number; label: string; sold: number; counted: number; systemStock: number; price: bigint };

export function productLabel(product: Pick<CountProduct, 'name' | 'validity'>, duplicates: boolean): string {
  // Nama yang sama dipakai beberapa barang (mis. "Paket Data 10GB Three"): masa aktif membedakannya.
  return duplicates && product.validity && !product.name.toLowerCase().includes(product.validity.toLowerCase()) ? `${product.name} (${product.validity})` : product.name;
}

export function soldFromCounts(
  counts: Array<{ item: StockListItem; product: CountProduct | null }>,
  catalog: CountProduct[],
): { sold: CountSold[]; unmatched: string[]; notes: string[]; same: number } {
  const nameCount = new Map<string, number>();
  for (const product of catalog) nameCount.set(product.name.toLowerCase(), (nameCount.get(product.name.toLowerCase()) ?? 0) + 1);
  const sold = new Map<number, CountSold>(), unmatched: string[] = [], notes: string[] = [];
  let same = 0;
  for (const { item, product } of counts) {
    if (!product) { unmatched.push(`${item.label} (${item.stock})`); continue; }
    const label = productLabel(product, (nameCount.get(product.name.toLowerCase()) ?? 0) > 1);
    if (item.stock === product.stock) { same++; continue; }
    if (item.stock > product.stock) { notes.push(`${label}: hitungan ${item.stock} lebih banyak dari stok sistem ${product.stock} (barang masuk?). Tidak dihitung terjual; owner perlu memeriksa.`); continue; }
    sold.set(product.id, { productId: product.id, label, sold: product.stock - item.stock, counted: item.stock, systemStock: product.stock, price: product.sellPrice });
  }
  return { sold: [...sold.values()], unmatched, notes, same };
}

// Selisih uang yang setara dengan 1-3 pcs barang berharga jual tertentu: petunjuk salah hitung/barang keluar yang belum tercatat.
export function differenceHints(difference: bigint, products: Array<{ name: string; sellPrice: bigint }>): string[] {
  const abs = difference < 0n ? -difference : difference;
  if (abs <= 0n) return [];
  const hints: Array<{ text: string; qty: number }> = [];
  for (const product of products) {
    if (product.sellPrice <= 0n) continue;
    for (let qty = 1; qty <= 3; qty++) if (product.sellPrice * BigInt(qty) === abs) { hints.push({ text: `${qty} pcs ${product.name}`, qty }); break; }
  }
  return hints.sort((a, b) => a.qty - b.qty).slice(0, 3).map(hint => hint.text);
}

export function balanceExplanation(status: 'MATCH' | 'SHORT' | 'EXCESS', amount: string, hints: string[] = []): string {
  if (status === 'MATCH') return '';
  const hint = hints.length ? ` Selisih ini setara ${hints.join(' / ')}: mungkin salah hitung atau ada yang keluar belum tercatat.` : '';
  return status === 'EXCESS'
    ? `Uang lebih ${amount} dari perkiraan. Kemungkinan dari penjualan pertalite/aksesori yang tidak ikut dihitung, atau pembayaran bon.${hint}`
    : `Uang kurang ${amount} dari perkiraan. Kemungkinan bon (belum dibayar), pengeluaran yang belum ditulis, atau barang keluar yang belum tercatat.${hint}`;
}
