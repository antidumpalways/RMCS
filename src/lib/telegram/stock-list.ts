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

// ---------------------------------------------------------------------------------------------
// Daftar harga / modal / margin: format sama dengan daftar stok, hanya kopnya yang berbeda.
//   Update harga:            Update modal:             Update margin:
//   TELKOMSEL 3 HARI : 15rb  TELKOMSEL 3 HARI : 13rb   TELKOMSEL 3 HARI : 2rb
// ---------------------------------------------------------------------------------------------

export type UpdateKind = 'stock' | 'sellPrice' | 'costPrice' | 'margin';
export type UpdateItem = { kind: UpdateKind; label: string; value: number; group: string | null; sourceText: string };
export type UpdateList = { items: UpdateItem[]; skipped: string[]; invalid: string[] };

const SECTION = /^(?:tolong\s+)?(?:update|updet|apdet)\s+(stok|stock|harga\s+jual|harga\s+modal|harga\s+beli|harga|modal|margin|untung|laba)(?:\s+(?:fisik|sekarang|terbaru|baru|hari\s+ini))*\s*[:.,-]*\s*/i;
const AMOUNT = '(?:rp\\.?\\s*)?(\\d+(?:[.,]\\d+)?\\s*(?:rb|ribu|k|jt|juta)|\\d{1,3}(?:[.,]\\d{3})+|\\d+)';

function sectionKind(word: string): UpdateKind {
  const value = word.toLowerCase().replace(/\s+/g, ' ');
  if (value === 'stok' || value === 'stock') return 'stock';
  if (value === 'modal' || value === 'harga modal' || value === 'harga beli') return 'costPrice';
  if (value === 'margin' || value === 'untung' || value === 'laba') return 'margin';
  return 'sellPrice';
}

function parseAmount(raw: string): number | null {
  const value = raw.toLowerCase().replace(/^rp\.?\s*/, '').replace(/\s+/g, '');
  const suffixed = /^(\d+(?:[.,]\d+)?)(rb|ribu|k|jt|juta)$/.exec(value);
  if (suffixed) {
    const amount = Math.round(Number(suffixed[1].replace(',', '.')) * (suffixed[2] === 'jt' || suffixed[2] === 'juta' ? 1_000_000 : 1000));
    return Number.isSafeInteger(amount) ? amount : null;
  }
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return Number(value.replace(/[.,]/g, ''));
  return /^\d+$/.test(value) ? Number(value) : null;
}

function parsePriceSection(lines: string[], kind: Exclude<UpdateKind, 'stock'>): UpdateList | null {
  const items: UpdateItem[] = [], skipped: string[] = [], invalid: string[] = [];
  let group: string | null = null;
  for (const raw of lines) {
    if (/\?/.test(raw) || /\b(?:berapa|brp|hapus|pindah|lokasi)\b/i.test(raw)) return null;
    const line = raw.replace(/^(?:[-•*]|\d{1,2}[.)])\s+/, '').replace(/\b(?:harga(?:\s+jual|\s+modal|\s+beli)?|modal|margin|untung|jadi)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const withColon = new RegExp('^(.+?)\\s*[:=]\\s*' + AMOUNT + '\\.?$', 'i').exec(line);
    // Tanpa titik dua, angka harus jelas berupa uang agar "3 hari" tidak terbaca sebagai harga.
    const plain = withColon ? null : new RegExp('^(.+?\\p{L}.*?)\\s+(?:rp\\.?\\s*)?(\\d+(?:[.,]\\d+)?\\s*(?:rb|ribu|k|jt|juta)|\\d{1,3}(?:[.,]\\d{3})+|\\d{4,})\\.?$', 'iu').exec(line);
    const match = withColon ?? plain;
    if (match) {
      let label = clean(match[1]);
      if (ATTRIBUTE_ONLY.test(label.replace(/\s+/g, ''))) {
        if (!group) return null;
        label = clean(group + ' ' + label.replace(/\//g, ' '));
      }
      if (!/\p{L}/u.test(label) || label.length > 100) return null;
      const amount = parseAmount(match[2]);
      // "15" tanpa rb: bisa 15 rupiah atau 15 ribu. Jangan menebak.
      if (amount === null || amount < 100 || amount > 1_000_000_000) { invalid.push(`${label} (${match[2].trim()})`); continue; }
      items.push({ kind, label, value: amount, group, sourceText: raw });
      continue;
    }
    if (/[:=]\s*$/.test(line) && /\d/.test(line)) { skipped.push(clean(line)); continue; }
    const header = /^([\p{L}][\p{L}\s.&]{0,30}?)\s*:?\s*$/u.exec(line);
    if (header) { group = header[1].trim(); continue; }
    return null;
  }
  return items.length || invalid.length ? { items, skipped, invalid } : null;
}

/**
 * Membaca pesan owner yang berisi satu atau beberapa bagian "Update stok / harga / modal / margin".
 * Mengembalikan null bila pesan bukan daftar seperti itu (ditangani asisten biasa).
 */
export function parseUpdateList(text: string, options: { lenient?: boolean } = {}): UpdateList | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 120) return null;
  const sections: Array<{ kind: UpdateKind; lines: string[] }> = [];
  for (const line of lines) {
    const intro = SECTION.exec(line);
    if (intro) {
      sections.push({ kind: sectionKind(intro[1]), lines: [] });
      const rest = line.slice(intro[0].length).trim();
      if (rest) sections[sections.length - 1].lines.push(rest);
    } else if (sections.length) sections[sections.length - 1].lines.push(line);
    else if (!options.lenient) return null;
    else { sections.push({ kind: 'stock', lines: [line] }); }
  }
  const result: UpdateList = { items: [], skipped: [], invalid: [] };
  for (const section of sections) {
    if (!section.lines.length) return null;
    if (section.kind === 'stock') {
      const stock = parseStockList(section.lines.join('\n'), { lenient: true });
      if (!stock) return null;
      result.items.push(...stock.items.map(item => ({ kind: 'stock' as const, label: item.label, value: item.stock, group: item.group, sourceText: item.sourceText })));
      result.skipped.push(...stock.skipped);
    } else {
      const prices = parsePriceSection(section.lines, section.kind);
      if (!prices) return null;
      result.items.push(...prices.items); result.skipped.push(...prices.skipped); result.invalid.push(...prices.invalid);
    }
  }
  return result.items.length || result.invalid.length ? result : null;
}
