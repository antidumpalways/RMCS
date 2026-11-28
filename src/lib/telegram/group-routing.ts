// Pembantu murni untuk menentukan apakah pesan grup adalah catatan rekap atau pertanyaan katalog.
// Dipisah dari bot.ts agar mudah dites.

const QUESTION_START = /^(?:tolong\s+)?(?:cek|cari(?:kan|in)?|foto|gambar(?:nya)?|harga|berapa|apakah|tanya)\b/i;
const QUESTION_WORD = /\b(?:harga|berapa)\b/i;

const ASK_WORD = '(?:ada|punya|jual|ready|tersedia)';
const NO_WORD = '(?:gak|ga|gk|nggak|ngga|enggak|engga|kah)';
// "ada gak casan type c", "adakah headset"
const ASK_INLINE = new RegExp('\\b' + ASK_WORD + '\\s*' + NO_WORD + '\\b', 'i');
// "ada casan vivo gak bang", "charger iphone ready ga", "ada kabel c?"
const ASK_TAIL = new RegExp('(?:\\b' + NO_WORD + '|\\btidak|\\?)\\s*(?:(?:bang|kak|bos|min|ya)\\s*)?[?!.]*$', 'i');
const NOT_ITEM = /\b(?:rekap|laporan|shift|admin|saldo|modal|total|setor(?:an)?|bon|kasbon|uang|duit|transfer|tf|selisih|gaji|u?tang|hutang)\b/i;

// Karyawan menanyakan ketersediaan barang dengan bahasa bebas. Obrolan yang ikut lolos disaring lagi oleh AI.
export function looksLikeItemQuestion(text: string): boolean {
  const value = text.trim();
  if (value.length < 6 || value.length > 140 || value.startsWith('/') || /\n/.test(value)) return false;
  if (/\d+\s*(?:rb|ribu|k|jt|juta)\b|\d{5,}|\d+\s*(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\b/i.test(value) || NOT_ITEM.test(value)) return false;
  return ASK_INLINE.test(value) || (new RegExp('\\b' + ASK_WORD + '\\b', 'i').test(value) && ASK_TAIL.test(value));
}

// Pertanyaan tentang katalog (harga/stok) — bukan catatan penjualan seperti "Axis 13GB 2 pcs".
export function looksLikeCatalogQuestion(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (/\?\s*$/.test(value)) return true;
  const hasQuantityUnit = /\d+\s*(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\b/i.test(value);
  if (hasQuantityUnit && !/\?/.test(value)) return false;
  return QUESTION_START.test(value) || QUESTION_WORD.test(value) || looksLikeItemQuestion(value);
}

const RECAP_HEADER = /^(?:rekap|laporan|lapor|barang\s+terjual|terjual|penjualan|jualan)(?:\s+(?:shift|hari\s+ini))?(?:\s+(?:pagi|siang|malam))?\s*[:.\-]*\s*$/i;

// Membuang baris judul seperti "Rekap" atau "Barang terjual" bila masih ada isi di bawahnya.
export function stripRecapHeader(text: string): string {
  const inline = INLINE_START.exec(text.trim());
  if (inline && !/\n/.test(text.trim()) && ITEM_LIKE.test(inline[2])) return inline[2].trim();
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && RECAP_HEADER.test(lines[0].trim())) {
    const rest = lines.slice(1).join('\n').trim();
    if (rest) return rest;
  }
  return text.trim();
}

const START_PATTERN = /^(?:(?:halo|hai)\s+)?(?:(?:aku|saya|kami)\s+)?(?:(?:mau|ingin|boleh|tolong)\s+)?(?:(?:mulai|buka|buat|lanjut)\s+)?(?:rekap|laporan|lapor)(?:\s+(?:shift|hari\s+ini|penjualan|jualan))?(?:\s+(pagi|siang|malam))?[.!?:]*$/i;

// Pesan yang diawali "rekap"/"lapor" pada baris pertama, dengan isi rekap (jika ada) di baris berikutnya.
const ITEM_LIKE = /\d+\s*(?:pcs?|unit|units?|biji|buah|lembar|bungkus|pack|pak)\b|\d+\s*(?:rb|ribu|k|jt|juta)\b|\b(?:saldo|admin|pengeluaran)\b/i;
const INLINE_START = /^(?:rekap|laporan|lapor)\s+(?:shift\s+)?(?:(pagi|siang|malam)\s+)?(.+)$/is;

export function splitRecapStart(text: string): { shiftLabel: string | null; rest: string } | null {
  const lines = text.trim().replace(/^@\w+\s*/, '').split(/\r?\n/);
  const match = START_PATTERN.exec(lines[0].trim());
  if (match) return { shiftLabel: match[1]?.toLocaleLowerCase('id-ID') ?? null, rest: lines.slice(1).join('\n').trim() };
  // "rekap voucher telkomsel 7gb 5 hari laku 5 pcs": judul dan isi dalam satu baris.
  const inline = INLINE_START.exec(lines[0].trim());
  if (inline && ITEM_LIKE.test(inline[2])) {
    return { shiftLabel: inline[1]?.toLocaleLowerCase('id-ID') ?? null, rest: [inline[2], ...lines.slice(1)].join('\n').trim() };
  }
  return null;
}

// Membuang @mention bot tanpa meratakan baris baru: rekap multi-baris harus tetap satu barang per baris.
export function removeBotMention(text: string, username: string): string {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = username ? text.replace(new RegExp('@' + escaped + '\\b', 'ig'), ' ') : text;
  return cleaned.split(/\r?\n/).map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
}

const LATE_ENTRY = /^(?:susulan|lupa\s+(?:catat|rekap))\b[\s:,.-]*(.*)$/is;

// "susulan Axis 13gb 1 pcs": penjualan atau uang yang terlewat. Mengembalikan isinya (boleh kosong), atau null bila bukan susulan.
export function lateEntryText(text: string): string | null {
  const match = LATE_ENTRY.exec(text.trim().replace(/^@\w+\s*/, ''));
  if (!match) return null;
  const content = match[1].trim();
  // Frasa tanpa angka ("lupa rekap tadi, maaf ya") hanya obrolan, bukan susulan.
  return content && !/\d/.test(content) ? null : content;
}

// Pertanyaan harga/ketersediaan yang ditulis langsung di grup tanpa menyebut bot ("harga axis 13gb berapa?", "ada charger type c?").
// Sengaja ketat agar catatan rekap dan obrolan biasa tidak ikut tertangkap.
export function isImplicitCatalogQuestion(text: string): boolean {
  const value = text.trim();
  if (value.length < 6 || value.length > 140 || value.startsWith('/') || /\n/.test(value)) return false;
  const hasMoney = /\d+\s*(?:rb|ribu|k|jt|juta)\b|\d{4,}/i.test(value);
  const hasQuantityUnit = /\d+\s*(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\b/i.test(value);
  const asksPrice = /\b(?:harga(?:nya)?|berapa(?:an)?|brp)\b/i.test(value);
  const asksAvailability = /\?\s*$/.test(value) && /\b(?:ada|ready|stok|stock|kosong|sisa|punya)\b/i.test(value);
  // "cari charger vivo" / "foto charger vivo": minta barang ditampilkan.
  const asksToShow = /^(?:tolong\s+)?(?:cari(?:kan|in)?|foto|gambar(?:nya)?)\s+\S/i.test(value);
  if (asksPrice || asksToShow) return !hasMoney && !hasQuantityUnit;
  return (asksAvailability && !hasMoney && !hasQuantityUnit) || looksLikeItemQuestion(value);
}

const QUESTION_FILLER = new Set(['harga', 'harganya', 'berapa', 'berapaan', 'brp', 'ada', 'adakah', 'ready', 'stok', 'stoknya', 'stock', 'sisa', 'kosong', 'punya', 'masih', 'cek', 'cari', 'tolong', 'tanya', 'dong', 'ya', 'kak', 'bang', 'bos', 'min', 'gak', 'ga', 'nggak', 'tidak', 'yang', 'yg', 'untuk', 'buat', 'nya', 'sih', 'nih', 'kah', 'apakah', 'info', 'mau', 'kalau', 'kalo', 'itu', 'ini', 'si', 'jual', 'dijual', 'foto', 'fotonya', 'gambar', 'gambarnya', 'carikan', 'cariin', 'lihat', 'barang', 'ngga', 'enggak', 'engga', 'gk', 'tersedia', 'apa', 'bg', 'kk']);

// Mengambil nama barang dari pertanyaan harga/stok sederhana ("harga axis 3 hari berapa?" => "axis 3 hari").
// Mengembalikan null bila bukan pertanyaan satu barang yang jelas, supaya ditangani asisten biasa.
export function quickCatalogQuery(text: string): string | null {
  const value = text.trim();
  if (value.length < 4 || value.length > 120 || /\n/.test(value) || !looksLikeCatalogQuestion(value)) return null;
  const words = value.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}.\s]/gu, ' ').split(/\s+/).filter(word => word && !QUESTION_FILLER.has(word));
  if (!words.some(word => /\p{L}{2,}/u.test(word) && !/^\d/.test(word) && !['hari', 'hr', 'gb', 'mb', 'bulan', 'pcs', 'biji'].includes(word))) return null;
  // Pertanyaan lanjutan seperti "yang 7 hari?" butuh konteks percakapan.
  if (words.length > 8) return null;
  return words.join(' ');
}
