// Pembantu murni untuk menentukan apakah pesan grup adalah catatan rekap atau pertanyaan katalog.
// Dipisah dari bot.ts agar mudah dites.

const QUESTION_START = /^(?:tolong\s+)?(?:cek|cari|harga|berapa|ada|apakah|info|tanya|stok|stock)\b/i;
const QUESTION_WORD = /\b(?:harga|berapa)\b/i;

// Pertanyaan tentang katalog (harga/stok) — bukan catatan penjualan seperti "Axis 13GB 2 pcs".
export function looksLikeCatalogQuestion(text: string): boolean {
  const value = text.trim();
  if (!value) return true;
  if (/\?\s*$/.test(value)) return true;
  const hasQuantityUnit = /\d+\s*(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\b/i.test(value);
  if (hasQuantityUnit && !/\?/.test(value)) return false;
  return QUESTION_START.test(value) || QUESTION_WORD.test(value);
}

const RECAP_HEADER = /^(?:rekap|laporan|lapor|barang\s+terjual|terjual|penjualan|jualan)(?:\s+(?:shift|hari\s+ini))?(?:\s+(?:pagi|siang|malam))?\s*[:.\-]*\s*$/i;

// Membuang baris judul seperti "Rekap" atau "Barang terjual" bila masih ada isi di bawahnya.
export function stripRecapHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && RECAP_HEADER.test(lines[0].trim())) {
    const rest = lines.slice(1).join('\n').trim();
    if (rest) return rest;
  }
  return text.trim();
}

const START_PATTERN = /^(?:(?:halo|hai)\s+)?(?:(?:aku|saya|kami)\s+)?(?:(?:mau|ingin|boleh|tolong)\s+)?(?:(?:mulai|buka|buat|lanjut)\s+)?(?:rekap|laporan|lapor)(?:\s+(?:shift|hari\s+ini|penjualan|jualan))?(?:\s+(pagi|siang|malam))?[.!?:]*$/i;

// Pesan yang diawali "rekap"/"lapor" pada baris pertama, dengan isi rekap (jika ada) di baris berikutnya.
export function splitRecapStart(text: string): { shiftLabel: string | null; rest: string } | null {
  const lines = text.trim().replace(/^@\w+\s*/, '').split(/\r?\n/);
  const match = START_PATTERN.exec(lines[0].trim());
  if (!match) return null;
  return { shiftLabel: match[1]?.toLocaleLowerCase('id-ID') ?? null, rest: lines.slice(1).join('\n').trim() };
}

// Membuang @mention bot tanpa meratakan baris baru: rekap multi-baris harus tetap satu barang per baris.
export function removeBotMention(text: string, username: string): string {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = username ? text.replace(new RegExp('@' + escaped + '\\b', 'ig'), ' ') : text;
  return cleaned.split(/\r?\n/).map(line => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
}
