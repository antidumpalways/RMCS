// Membuat barang baru dari baris "Update stok" yang barangnya memang belum ada di katalog,
// dan membaca balasan owner untuk modal + harga jual barang baru itu. Semua murni (tanpa database).
import { parseAmount } from './stock-list';

export type NewProductSpec = {
  name: string;
  provider: string | null;
  validity: string | null;
  quota: string | null;
  /** Kategori yang disebut owner lewat judul kelompok ("ROKOK :"), bila ada. */
  group: string | null;
  voucher: boolean;
};

const UNIT_WORD = /^(?:gb|mb|hari|hr|bulan|bln|pcs?|batang|bungkus)$/i;

function titleProvider(raw: string): string {
  const word = raw.trim();
  if (!word) return word;
  // Singkatan pendek atau yang memuat angka ditulis kapital: XL, IM3. Lainnya: Axis, Telkomsel.
  return word.length <= 3 || /\d/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase();
}

export function parseNewProductSpec(label: string, group: string | null): NewProductSpec | null {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 100 || !/\p{L}/u.test(text)) return null;
  const day = /(\d{1,3})\s*hari\b/i.exec(text);
  const quota = /(\d+(?:[.,]\d+)?)\s*gb\b/i.exec(text);
  if (day) {
    const words = text.split(' ');
    const providerWords: string[] = [];
    for (const word of words) {
      if (/^\d+(?:[.,]\d+)?(?:gb|mb|hari)?$/i.test(word) || UNIT_WORD.test(word)) break;
      providerWords.push(word);
    }
    const provider = providerWords.map(titleProvider).join(' ').trim();
    if (!provider) return null;
    return { name: `${provider} ${Number(day[1])} Hari`, provider, validity: `${Number(day[1])} hari`, quota: quota ? `${quota[1].replace(',', '.')}GB` : null, group, voucher: true };
  }
  return { name: text, provider: null, validity: null, quota: null, group, voucher: false };
}

const BRAND_SYNONYMS = [
  ['tri', 'three', 'tree'], ['indosat', 'im3', 'isat', 'ooredoo'], ['telkomsel', 'tsel', 'simpati'], ['smartfren', 'smart'], ['axis', 'axiata'],
];

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const grid = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) grid[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return grid[a.length][b.length];
}

export function catalogTokens(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) for (const word of text.toLocaleLowerCase('id-ID').split(/[^\p{L}\p{N}]+/u)) if (word) tokens.add(word);
  return tokens;
}

/**
 * Apakah kata merek/nama pertama pada baris sudah dikenal katalog (sebagai kata utuh, sinonim, atau salah ketik 1 huruf)?
 * Bila dikenal, barisnya kemungkinan barang yang sudah ada dengan penulisan berbeda: jangan dibuat baru, tanyakan.
 */
export function brandKnown(label: string, known: Set<string>): boolean {
  const first = label.toLocaleLowerCase('id-ID').split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0];
  if (!first) return true;
  const candidates = new Set([first]);
  for (const group of BRAND_SYNONYMS) if (group.includes(first)) group.forEach(word => candidates.add(word));
  for (const word of candidates) {
    if (known.has(word)) return true;
    if (word.length >= 5) for (const item of known) if (item.length >= 5 && editDistance(word, item) <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Balasan modal + harga jual:  "modal 13rb jual 15rb" | "13rb 15rb" | "IM3 3 hari : 13rb 15rb"
// ---------------------------------------------------------------------------------------------

export type PriceReply = { id: number; costPrice: number; sellPrice: number; warning: string | null };
export type PendingPrice = { id: number; name: string };

const MONEY = '(?:rp\\.?\\s*)?\\d+(?:[.,]\\d+)?\\s*(?:rb|ribu|k|jt|juta)?|(?:rp\\.?\\s*)?\\d{1,3}(?:[.,]\\d{3})+';

function pairFromText(text: string): { cost: number; sell: number } | null {
  const labelled = new RegExp(`modal\\s*[:=]?\\s*(${MONEY})[\\s,;/]+(?:harga\\s+)?(?:jual|harga)\\s*[:=]?\\s*(${MONEY})`, 'i').exec(text)
    ?? (() => { const reversed = new RegExp(`(?:harga\\s+)?(?:jual|harga)\\s*[:=]?\\s*(${MONEY})[\\s,;/]+modal\\s*[:=]?\\s*(${MONEY})`, 'i').exec(text); return reversed ? [reversed[0], reversed[2], reversed[1]] as unknown as RegExpExecArray : null; })();
  const found = labelled ?? new RegExp(`(?:^|[\\s:=])(${MONEY})[\\s,;/]+(${MONEY})\\s*$`, 'i').exec(text);
  if (!found) return null;
  const cost = parseAmount(found[1]), sell = parseAmount(found[2]);
  return cost !== null && sell !== null && cost >= 100 && sell >= 100 ? { cost, sell } : null;
}

export function parsePriceReply(text: string, pending: PendingPrice[]): PriceReply[] | null {
  if (!pending.length) return null;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 60 || /\?/.test(text)) return null;
  const out: PriceReply[] = [];
  const make = (item: PendingPrice, pair: { cost: number; sell: number }): PriceReply => ({ id: item.id, costPrice: pair.cost, sellPrice: pair.sell,
    warning: pair.sell < pair.cost ? `${item.name}: harga jual di bawah modal.` : null });
  // Satu pesan satu pasangan: berlaku untuk semua barang baru yang menunggu harga.
  if (lines.length === 1) {
    const pair = pairFromText(lines[0]);
    return pair ? pending.map(item => make(item, pair)) : null;
  }
  const tokens = (value: string) => value.toLocaleLowerCase('id-ID').split(/[^\p{L}\p{N}]+/u).filter(word => word && !/^\d+(?:rb|k|jt)?$/.test(word) || /^\d{1,2}$/.test(word));
  for (const line of lines) {
    const colon = /^(.+?)\s*[:=]\s*(.+)$/.exec(line);
    const pair = pairFromText(colon ? colon[2] : line);
    if (!pair || !colon) return null;
    const words = tokens(colon[1]);
    const hits = pending.filter(item => { const nameWords = tokens(item.name); return words.length > 0 && words.every(word => nameWords.includes(word) || nameWords.some(name => name.replace(/hari$/, '') === word)); });
    if (hits.length !== 1) return null;
    out.push(make(hits[0], pair));
  }
  return out.length ? out : null;
}

// Kartu perdana ("SP AXIS", "SP BY U 11GB") bukan voucher: keberadaannya tidak membuktikan voucher merek itu sudah ada.
export function isStarterPack(product: { name: string; category: string }): boolean {
  return /^\s*sp\b/i.test(product.name) || /perdana|starter/i.test(product.name) || /perdana|starter/i.test(product.category);
}
