// Pembantu murni untuk menentukan apakah pesan grup adalah catatan rekap atau pertanyaan katalog.
// Dipisah dari bot.ts agar mudah dites.

const QUESTION_START = /^(?:tolong\s+)?(?:cek|cari|harga|berapa|apakah|tanya)\b/i;
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
  if (asksPrice) return !hasMoney && !hasQuantityUnit;
  return asksAvailability && !hasMoney && !hasQuantityUnit;
}
