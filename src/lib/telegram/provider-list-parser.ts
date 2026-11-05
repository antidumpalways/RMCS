// Pembaca daftar voucher per provider TANPA AI: format yang teratur (hari + harga) dibaca langsung, cepat, dan pasti.
// Contoh yang dikenali:
//   Telkomsel, ganti semua
//   3 hari 5gb modal 13300 harga jual 15000
//   5hr 7gb modal 18000 jual 20000
// atau dengan nama provider di tiap baris: "XL 3hr 6.5gb modal 13000 harga jual 15000".
// Bila ada baris yang tidak dikenali, mengembalikan null sehingga AI yang menafsirkan.

export type QuickPackage = { validity: string; quota: string | null; sellPrice: string; costPrice: string | null; stock: number | null };
export type QuickProviderList = { provider: string; replaceAll: boolean; packages: QuickPackage[] };

const VALIDITY = /(\d{1,3})\s*(?:hari|hr|h|d)\b/i;
const QUOTA = /(\d+(?:[.,]\d+)?)\s*(?:gb|mb|g)\b/i;
const COST = /modal\s*(?:rp\.?\s*)?(\d[\d.,]*\s*(?:jt|juta|rb|ribu|k)?)/i;
const SELL = /(?:harga\s*jual|jual|hj|harga)\s*(?:rp\.?\s*)?(\d[\d.,]*\s*(?:jt|juta|rb|ribu|k)?)/i;
const STOCK = /stok\s*(\d{1,6})/i;
const REPLACE_ALL = /\b(?:ganti|timpa)\s+semua\b|\breplace\b|\bhapus\s+(?:yang\s+)?(?:lain|lama)\b|\b(?:yang\s+)?lama\s+(?:buang|hapus)\b|\bbuang\s+yang\s+lama\b/i;
const NOISE_WORDS = new Set(['daftar', 'paket', 'voucher', 'data', 'harga', 'hari', 'ini', 'update', 'ubah', 'ganti', 'semua', 'timpa', 'tolong', 'mohon', 'baru', 'saja', 'aja']);

const VERBS = /\b(?:tambah|tambahkan|buat|bikin|ganti|ubah|hapus|naikkan|turunkan|set|masukkan|kasih|tolong|mohon|barang|produk|kategori)\b/i;

// Sisa teks sebuah baris setelah bagian yang dikenali (hari, kuota, modal, harga, stok) dibuang.
// Baris yang rapi hanya menyisakan nama provider; kalimat bebas menyisakan kata lain dan diserahkan ke AI.
function residue(line: string): string {
  return line.replace(VALIDITY, ' ').replace(QUOTA, ' ').replace(COST, ' ').replace(SELL, ' ').replace(STOCK, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\b(?:rp|rupiah|modal|harga|jual)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id-ID');
}

function cleanProvider(text: string): string | null {
  const head = text.split(/[,:;]/)[0] ?? '';
  const words = head.split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(word => word && !NOISE_WORDS.has(word.toLocaleLowerCase('id-ID')));
  const name = words.join(' ').trim();
  return name && name.length <= 40 && /\p{L}/u.test(name) ? name : null;
}

export function parseProviderLists(text: string): QuickProviderList[] | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const lists = new Map<string, QuickProviderList>();
  let current: string | null = null;
  let pendingReplace = false;
  for (const line of lines) {
    const validity = VALIDITY.exec(line);
    const sell = SELL.exec(line);
    if (!validity && !sell) {
      // Baris judul: nama provider (+ penanda "ganti semua").
      if (line.length > 60 || !/^[\p{L}][\p{L}\p{N}.\s,:;-]*$/u.test(line)) return null;
      if (VERBS.test(line.replace(REPLACE_ALL, ' ')) || line.split(/\s+/).length > 6) return null;
      const provider = cleanProvider(line);
      if (!provider) return null;
      current = provider;
      pendingReplace = REPLACE_ALL.test(line);
      const key = provider.toLocaleLowerCase('id-ID');
      const existing = lists.get(key);
      if (existing) existing.replaceAll = existing.replaceAll || pendingReplace;
      else lists.set(key, { provider, replaceAll: pendingReplace, packages: [] });
      continue;
    }
    if (!validity || !sell) return null; // baris paket harus punya hari dan harga jual
    // Nama provider di awal baris ("XL 3hr ...") menimpa judul.
    const leading = /^([\p{L}][\p{L}.\s]*?)\s+(?=\d)/u.exec(line);
    const lineProvider = leading ? cleanProvider(leading[1]) : null;
    const leadingText = leading ? leading[1].trim() : '';
    if (residue(line) !== leadingText.toLocaleLowerCase('id-ID').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()) return null;
    if (leadingText && (leadingText.split(/\s+/).length > 2 || VERBS.test(leadingText))) return null;
    const provider = lineProvider ?? current;
    if (!provider) return null;
    const key = provider.toLocaleLowerCase('id-ID');
    const list = lists.get(key) ?? { provider, replaceAll: pendingReplace && provider === current, packages: [] };
    lists.set(key, list);
    if (REPLACE_ALL.test(line)) list.replaceAll = true;
    const quota = QUOTA.exec(line);
    const cost = COST.exec(line);
    const stock = STOCK.exec(line);
    list.packages.push({ validity: `${Number(validity[1])} hari`, quota: quota ? quota[0].replace(/\s+/g, '') : null,
      sellPrice: sell[1].trim(), costPrice: cost ? cost[1].trim() : null, stock: stock ? Number(stock[1]) : null });
  }
  const result = [...lists.values()].filter(list => list.packages.length);
  return result.length ? result : null;
}

// "Minyak yang kita jual itu cuma Pertalite" / "rokok yg dijual hanya surya dan sampoerna" /
// "hapus semua minyak, yang kita jual hanya pertalite modal 11000 harga jual 12000":
// kategori itu kini hanya berisi barang yang disebut (harga/modal boleh ikut). Dibaca tanpa AI.
export type OnlyItem = { name: string; sellPrice: string | null; costPrice: string | null };
export type OnlyStatement = { category: string; items: OnlyItem[] };
const ONLY_FILLER = new Set(['oke', 'ok', 'catat', 'ya', 'nih', 'eh', 'btw', 'info', 'jadi', 'itu', 'tolong', 'sekarang', 'mulai', 'dari', 'sini', 'yang', 'yg', 'kita', 'kami']);
const ONLY_PATTERN = /^(.{2,60}?)\s+(?:yang|yg)\s+(?:kita\s+|kami\s+|saya\s+|aku\s+|toko\s+)?(?:jual|dijual|jualan)\s*(?:itu|nya|ini)?\s*(?:cuma|cuman|hanya)\s+(.+?)[.!\s]*$/iu;
// "hapus/buang semua <kategori> ... (cuma|hanya) <isi>"
const WIPE_PATTERN = /^(?:.{0,30}?\s)?(?:hapus|buang|bersihkan|kosongkan)\s+semua\s+(\p{L}[\p{L}\p{N}.-]*(?:\s+\p{L}[\p{L}\p{N}.-]*)?)\b.*?\b(?:cuma|cuman|hanya)\s+(.+?)[.!\s]*$/iu;
const WIPE_STOP = new Set(['ganti', 'gantikan', 'kan', 'yang', 'yg', 'kita', 'kami', 'jual', 'dijual', 'itu', 'dan', 'lalu', 'terus']);

function parseOnlyItems(segment: string, category: string): OnlyItem[] | null {
  const items: OnlyItem[] = [];
  for (const piece of segment.split(/\s*(?:,|&|\bdan\b|\bsama\b)\s*/i)) {
    const cost = COST.exec(piece);
    const sell = SELL.exec(piece);
    let name = piece.replace(COST, ' ').replace(SELL, ' ').replace(/\b(?:aja|saja)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    // "minyak pertalite" di kategori Minyak -> "Pertalite"
    const categoryWord = category.toLocaleLowerCase('id-ID');
    if (name.toLocaleLowerCase('id-ID').startsWith(categoryWord + ' ') && name.length > categoryWord.length + 2) name = name.slice(categoryWord.length + 1).trim();
    if (!name || name.length < 2 || name.length > 40 || !/^[\p{L}][\p{L}\p{N}\s.-]*$/u.test(name)) return null;
    items.push({ name: name.split(' ').map(word => word.charAt(0).toLocaleUpperCase('id-ID') + word.slice(1)).join(' '), sellPrice: sell ? sell[1].trim() : null, costPrice: cost ? cost[1].trim() : null });
  }
  return items.length && items.length <= 10 ? items : null;
}

export function parseOnlyStatement(text: string): OnlyStatement | null {
  const line = text.trim().replace(/\s+/g, ' ');
  if (!line || line.includes(String.fromCharCode(10)) || line.length > 240) return null;
  let category: string | null = null;
  let segment: string | null = null;
  const wipe = WIPE_PATTERN.exec(line);
  if (wipe) {
    const words = wipe[1].split(' ').filter(word => !WIPE_STOP.has(word.toLocaleLowerCase('id-ID')));
    category = words.slice(0, 2).join(' ') || null;
    segment = wipe[2];
  } else {
    const match = ONLY_PATTERN.exec(line);
    if (!match) return null;
    // Kalimat perintah ("hapus semua yang kita jual cuma ...") bukan pernyataan isi kategori.
    if (VERBS.test(match[1]) || /^(?:yang|semua)\b/i.test(match[2]) || /\bsemua\b/i.test(match[1])) return null;
    const tokens = match[1].split(' ').map(token => token.replace(/[^\p{L}\p{N}.-]/gu, '')).filter(token => token && !ONLY_FILLER.has(token.toLocaleLowerCase('id-ID')));
    if (!tokens.length || tokens.length > 2 || !tokens.every(token => /^[\p{L}][\p{L}\p{N}.-]*$/u.test(token))) return null;
    category = tokens.join(' ');
    segment = match[2];
  }
  if (!category || !segment || /^(?:yang|semua)\b/i.test(segment)) return null;
  const items = parseOnlyItems(segment, category);
  if (!items) return null;
  const seen = new Set<string>();
  return { category, items: items.filter(item => !seen.has(item.name.toLocaleLowerCase('id-ID')) && seen.add(item.name.toLocaleLowerCase('id-ID'))) };
}
