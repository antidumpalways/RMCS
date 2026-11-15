// Membaca daftar stok fisik yang ditulis owner, tanpa AI:
//   TELKOMSEL 3 HARI : 52
//   ROKOK :
//   SAMPOERNA : 7
// Angkanya adalah stok fisik sekarang (ditimpa), bukan tambahan.

export type StockListItem = {
  /** Nama barang seperti ditulis owner. */
  label: string;
  stock: number;
  /** Judul di atasnya ("ROKOK", "AXIS"), bila ada: dipakai untuk mempersempit pencarian. */
  group: string | null;
  sourceText: string;
};

export type StockList = { items: StockListItem[]; skipped: string[] };

const UNIT = '(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus|bks|botol|slop)';
const ATTRIBUTE_ONLY = /^(?:[\d.,/\s]|gb|mb|hari|hr|bulan|bln)+$/i;
// Kalimat ini bukan "stok fisik sekarang": biarkan asisten biasa yang menangani.
const NOT_STOCK = /\b(?:tambah(?:kan|in)?|masuk|kurang(?:i|in)?|jual|terjual|laku|harga|modal|margin|hapus|ganti|pindah|lokasi|berapa|brp)\b|\?/i;
const MONEY = /\d\s*(?:rb|ribu|k|jt|juta)\b|\d{1,3}(?:[.,]\d{3})+|\b\d{4,}\b/i;
// Kata pembuka wajib: owner harus menulis "update stok" agar daftar diproses langsung.
const INTRO = /^(?:tolong\s+)?(?:update|updet|apdet)\s+(?:stok|stock)(?:\s+(?:fisik|sekarang|terbaru|hari\s+ini))*\s*[:.,-]*\s*/i;

function clean(value: string): string {
  return value.replace(/\b(\d+)\s*(?:hr|h)\b/gi, '$1 hari').replace(/(\d)\s*hari\b/gi, '$1 hari').replace(/[\s:=\-–,.]+$/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Mengembalikan null bila pesan bukan daftar stok. `lenient` (mis. owner baru menekan menu Koreksi stok)
 * menerima satu baris tanpa kata "stok" atau titik dua, seperti "axis 6gb 5 hari 4".
 */
export function parseStockList(text: string, options: { lenient?: boolean } = {}): StockList | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 80) return null;
  const items: StockListItem[] = [], skipped: string[] = [];
  let group: string | null = null, explicit = false;
  for (let raw of lines) {
    if (!explicit && INTRO.test(raw)) {
      explicit = true;
      // "update stok telkomsel 3 hari 5": isi boleh langsung di baris yang sama.
      raw = raw.replace(INTRO, '').trim();
      if (!raw) continue;
    }
    if (NOT_STOCK.test(raw)) return null;
    let line = raw.replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '');
    line = line.replace(/\b(?:stok(?:nya)?(?:\s+fisik)?|sisa|jadi|tinggal|ada)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (MONEY.test(line)) return null;
    const withColon = new RegExp('^(.+?)\\s*[:=]\\s*(\\d{1,3})\\s*' + UNIT + '?\\.?$', 'i').exec(line);
    const plain = withColon ? null : new RegExp('^(.+?\\p{L}.*?)\\s+(\\d{1,3})\\s*' + UNIT + '?\\.?$', 'iu').exec(line);
    const match = withColon ?? plain;
    if (match) {
      let label = clean(match[1]);
      // "10gb/ 3 hari : 5" di bawah judul "AXIS": nama barangnya memakai judul.
      if (ATTRIBUTE_ONLY.test(label.replace(/\s+/g, ''))) {
        if (!group) return null;
        label = clean(group + ' ' + label.replace(/\//g, ' '));
      }
      if (!/\p{L}/u.test(label) || label.length > 100) return null;
      items.push({ label, stock: Number(match[2]), group, sourceText: raw });
      continue;
    }
    // "XL 3 HARI :" tanpa angka: owner belum mengisi, lewati.
    if (/[:=]\s*$/.test(line) && /\d/.test(line)) { skipped.push(clean(line)); continue; }
    // Judul kelompok: "ROKOK :", "AXIS".
    const header = /^([\p{L}][\p{L}\s.&]{0,30}?)\s*:?\s*$/u.exec(line);
    if (header) { group = header[1].trim(); continue; }
    return null;
  }
  if (!items.length) return null;
  // Tanpa kata "update stok" (atau menu Koreksi stok), daftar tidak diproses langsung: asisten biasa yang menangani.
  if (!explicit && !options.lenient) return null;
  return { items, skipped };
}
