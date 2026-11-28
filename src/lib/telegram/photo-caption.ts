// Membaca keterangan foto barang dari owner. Murni (tanpa database).
//   Foto: Charger Vivo 18W                      -> pasang foto ke barang yang sudah ada
//   Tambah aksesoris                            -> barang baru
//   Charger Vivo 18W
//   Modal: 20rb
//   Jual: 35rb
//   Stok: 5
import { parseAmount } from './stock-list';

export type PhotoCaption =
  | { kind: 'attach'; name: string }
  | { kind: 'create'; name: string; category: string | null; costPrice: number | null; sellPrice: number; stock: number | null }
  | { kind: 'invalid'; reason: string };

/** Berbagai ejaan "aksesoris": aksesori, accessories, accesories, asesoris, acc. */
export const ACCESSORY = /\b(?:a[ck]?[sc]e[sc]*or(?:is|ies|es|i|y)?|acc)\b/i;

const ATTACH = /^(?:tolong\s+)?(?:(?:update|ganti|tambah(?:kan)?|pasang)\s+)?(?:foto|gambar)(?:\s+(?:barang|produk|untuk|buat))?\s*[:=\-]?\s+(\S[\s\S]*)$/i;
const HEADER = new RegExp('^(?:tolong\\s+)?(?:(?:tambah(?:kan|in)?|input|masukkan|masukan)\\s+(?:(?:barang|produk)\\s+)?(?:baru\\s+)?(?:' + ACCESSORY.source + '|barang(?:\\s+baru)?|produk(?:\\s+baru)?|baru)|(?:barang|produk)\\s+baru|' + ACCESSORY.source + '(?:\\s+baru)?(?=\\s*(?:[:\\-]|\\n|$)))\\s*[:\\-]?', 'i');
const MONEY = '(?:rp\\.?\\s*)?(?:\\d+(?:[.,]\\d+)?\\s*(?:rb|ribu|k|jt|juta)(?![\\p{L}\\d])|\\d{1,3}(?:[.,]\\d{3})+|\\d+)';

export function parsePhotoCaption(raw: string): PhotoCaption | null {
  const text = raw.replace(/\r/g, '').trim();
  if (!text) return null;
  let rest = text;
  // Ambil satu isian lalu buang dari teks, supaya sisanya adalah nama barang.
  const take = (pattern: RegExp): string | null => {
    const match = pattern.exec(rest);
    if (!match) return null;
    rest = rest.slice(0, match.index) + '\n' + rest.slice(match.index + match[0].length);
    return match[1].trim();
  };
  const category = take(/\bkategori\s*[:=]\s*([^\n,;]+)/iu);
  const cost = take(new RegExp('\\b(?:harga\\s+)?(?:modal|beli)(?:nya)?\\s*[:=]?\\s*(' + MONEY + ')', 'iu'));
  const sell = take(new RegExp('\\b(?:harga\\s+jual|jual|harga)(?:nya)?\\s*[:=]?\\s*(' + MONEY + ')', 'iu'));
  const stock = take(/\b(?:stok|stock|jumlah|qty)(?:nya)?\s*[:=]?\s*(\d+)(?:\s*(?:pcs|unit|biji|buah)\b)?/iu);
  if (sell === null) {
    const attach = cost === null && stock === null ? ATTACH.exec(text) : null;
    if (attach) {
      const name = attach[1].replace(/\s+/g, ' ').trim();
      return name.length <= 100 ? { kind: 'attach', name } : { kind: 'invalid', reason: 'Nama barang terlalu panjang.' };
    }
    if (cost !== null || stock !== null || HEADER.test(text)) return { kind: 'invalid', reason: 'Harga jual belum ditulis. Contoh: “Jual: 35rb”.' };
    return null;
  }
  const header = HEADER.exec(rest.trim());
  const body = header ? rest.trim().slice(header[0].length) : rest;
  const lines = body.split('\n').map(line => line.replace(/^\s*(?:nama(?:\s+barang)?\s*[:=])/i, '').replace(/^[\s,;:|\-]+|[\s,;:|\-]+$/g, '').replace(/\s+/g, ' ')).filter(Boolean);
  if (!lines.length) return { kind: 'invalid', reason: 'Nama barang belum ditulis.' };
  if (lines.length > 1) return { kind: 'invalid', reason: 'Ada baris yang tidak saya pahami: ' + lines.slice(1).join('; ') + '.' };
  const name = lines[0];
  if (name.length > 100 || !/\p{L}/u.test(name)) return { kind: 'invalid', reason: 'Nama barang kurang jelas.' };
  const price = (value: string) => { const amount = parseAmount(value); return amount !== null && amount >= 100 && amount <= 1_000_000_000 ? amount : null; };
  const sellPrice = price(sell), costPrice = cost === null ? null : price(cost);
  if (sellPrice === null || (cost !== null && costPrice === null)) return { kind: 'invalid', reason: 'Angka harga kurang jelas. Tulis lengkap, mis. 35rb atau 35.000.' };
  const quantity = stock === null ? null : Number(stock);
  if (quantity !== null && quantity > 1_000_000) return { kind: 'invalid', reason: 'Jumlah stok terlalu besar.' };
  const accessory = header ? ACCESSORY.exec(header[0]) : null;
  return { kind: 'create', name, category: category ?? (accessory ? accessory[0] : null), costPrice, sellPrice, stock: quantity };
}
