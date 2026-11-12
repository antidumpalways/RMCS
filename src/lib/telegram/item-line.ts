// Membaca satu baris catatan barang terjual yang ditulis bebas oleh karyawan.
// Murni (tanpa database/AI) supaya mudah dites dan tetap bekerja saat AI lambat atau gagal.
//
// Aturan toko: voucher dikelola per provider per masa aktif ("Telkomsel 3 Hari"), jadi
// "telkomsel 3 hari" sudah cukup untuk menunjuk satu barang; kuota (GB) tidak wajib ditulis.

export type ParsedItemLine = {
  sourceText: string;
  label: string;
  quantity: number;
  unit: string;
  /** Jumlah ditulis karyawan (bukan anggapan 1). */
  explicitQuantity: boolean;
  /** Satuan ditulis karyawan (pcs, biji, bungkus, ...). */
  explicitUnit: boolean;
  /** Ada ciri barang seperti "3 hari" atau "13gb". */
  hasAttribute: boolean;
  /** Terisi bila angka terakhir bisa berarti jumlah ATAU masa aktif; baris tidak boleh dicatat sebelum jelas. */
  ambiguity: string | null;
};

const UNIT = '(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus|bks|botol)';
const ATTRIBUTE = '(?:hari|hr|gb|mb|bulan|bln|minggu|mgg|ml|liter|ltr|watt|mah|meter|cm|inch|inci)';
const PROVIDERS = /\b(?:telkomsel|tsel|simpati|axis|xl|tri|three|indosat|im3|isat|smartfren|smart|byu|by\.u)\b/i;
// Baris uang/jasa bukan baris barang: ditangani pembaca nominal.
const FINANCE = /\b(?:admin|fee|saldo|kas|cash|tf|transfer|tarik|pulsa|pengeluaran|biaya|beli|bayar|setor|setoran|omzet|penjualan|jualan|total|sisa|uang|dana|gopay|ovo|rekening|token|listrik|topup|top\s*up|modal|untung|laba)\b/i;
// Kalimat koreksi ("axis bukan 7 tapi 5") tidak boleh terbaca sebagai barang baru.
const CORRECTION = /\b(?:salah|bukan|harusnya|seharusnya|mestinya|ralat|koreksi|tapi|ganti|hapus|batal(?:kan)?)\b/i;
const QUESTION = /\?|\b(?:berapa(?:an)?|brp|harga(?:nya)?|apakah|ready|kosong)\b/i;
const MONEY = /\d\s*(?:rb|ribu|k|jt|juta)\b|\d{1,3}(?:[.,]\d{3})+|\b\d{4,}\b/i;
const GENERIC = new Set(['barang', 'produk', 'item', 'voucher', 'vc', 'paket', 'data', 'kartu', 'lainnya', 'lain', 'dll', 'macam', 'aksesoris', 'aksesori']);
const NUMBER_WORDS: Record<string, number> = {
  se: 1, satu: 1, sebiji: 1, sebuah: 1, selembar: 1, sebungkus: 1, sebatang: 1,
  dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10,
};

function tidyLabel(value: string): string {
  return value
    .replace(/\b(\d+)\s*(?:hr|h|d|day|days)\b/gi, '$1 hari')
    .replace(/\btsel\b/gi, 'telkomsel')
    .replace(/\bisat\b/gi, 'indosat')
    .replace(/^(?:tadi\s+)?(?:laku|terjual|kejual|jual|keluar)\s+/i, '')
    .replace(/\s+(?:terjual|kejual|jual|laku|keluar|habis)$/i, '')
    .replace(/[\s:=\-–,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAttribute(label: string): boolean {
  return new RegExp('\\d+(?:[.,]\\d+)?\\s*' + ATTRIBUTE + '\\b', 'i').test(label);
}

function result(sourceText: string, rawLabel: string, quantity: number, flags: { explicitQuantity: boolean; explicitUnit: boolean; ambiguity?: string | null; unit?: string }): ParsedItemLine | null {
  const label = tidyLabel(rawLabel);
  if (!label || !/\p{L}/u.test(label) || label.length > 120) return null;
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) return null;
  // "barang 25", "voucher 3": nama terlalu umum untuk dicocokkan ke satu produk.
  if (label.split(/\s+/).every(word => GENERIC.has(word.toLowerCase()))) {
    return { sourceText, label, quantity, unit: 'pcs', explicitQuantity: flags.explicitQuantity, explicitUnit: flags.explicitUnit, hasAttribute: false,
      ambiguity: `“${sourceText}” belum menyebut nama barangnya. Contoh: “axis 3 hari 2”.` };
  }
  return { sourceText, label, quantity, unit: (flags.unit ?? 'pcs').toLowerCase(), explicitQuantity: flags.explicitQuantity, explicitUnit: flags.explicitUnit, hasAttribute: hasAttribute(label), ambiguity: flags.ambiguity ?? null };
}

export function parseItemLine(raw: string): ParsedItemLine | null {
  const sourceText = raw.trim();
  let text = sourceText.replace(/^(?:[-•*]|\d{1,2}[.)])\s*/, '').replace(/\s+(?:ya|yaa|dong|nih|kak|bang|bos)[.!]*$/i, '')
    .replace(/^(?:tadi\s+)?(?:laku|terjual|kejual|jual|keluar)\s+/i, '').trim();
  if (!text || text.length > 160 || text.startsWith('/')) return null;
  if (QUESTION.test(text) || FINANCE.test(text) || CORRECTION.test(text)) return null;

  // Harga di ujung baris ("axis 3 hari 2 pcs 30rb") hanya keterangan; uang dihitung dari harga katalog.
  const priceTail = /\s*(?:[=@:]|harga|total|jadi)?\s*(?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)|\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/i.exec(text);
  if (priceTail && priceTail.index > 0) text = text.slice(0, priceTail.index).trim();
  if (MONEY.test(text)) return null;

  // 1) Jumlah + satuan di ujung: "surya 2 bungkus", "axis 13gb: 2pcs".
  const unitEnd = new RegExp('^(.*?)\\s*[:=x×]?\\s*(\\d{1,7})\\s*(' + UNIT + ')\\.?$', 'i').exec(text);
  if (unitEnd && unitEnd[1].trim()) return result(sourceText, unitEnd[1], Number(unitEnd[2]), { explicitQuantity: true, explicitUnit: true, unit: unitEnd[3] });

  // 2) Jumlah (+ satuan) di depan: "2 axis 13gb", "3 pcs surya". "3 hari telkomsel" bukan jumlah.
  const lead = new RegExp('^(\\d{1,4})\\s*(' + UNIT + ')?\\s+(.+)$', 'i').exec(text);
  if (lead && !new RegExp('^' + ATTRIBUTE + '\\b', 'i').test(lead[3]) && /\p{L}/u.test(lead[3])) {
    const inner = parseItemLine(lead[3]);
    // "2 axis 13gb 3" punya dua angka jumlah: jangan menebak.
    if (!inner || !inner.explicitQuantity) return result(sourceText, lead[3], Number(lead[1]), { explicitQuantity: true, explicitUnit: !!lead[2], unit: lead[2] || undefined });
  }

  // 3) "x2" / "2x" di ujung.
  const times = /^(.*?)\s*(?:[x×]\s*(\d{1,4})|(\d{1,4})\s*[x×])$/i.exec(text);
  if (times && times[1].trim() && /\s/.test(text)) return result(sourceText, times[1], Number(times[2] ?? times[3]), { explicitQuantity: true, explicitUnit: false });

  // 4) Kata bilangan di ujung: "axis 13gb dua".
  const word = /^(.*?)\s+([a-z]+)$/i.exec(text);
  if (word && NUMBER_WORDS[word[2].toLowerCase()] && word[2].toLowerCase() !== 'se') return result(sourceText, word[1], NUMBER_WORDS[word[2].toLowerCase()], { explicitQuantity: true, explicitUnit: false });

  // 5) Angka polos di ujung: "axis 13gb 2", "surya 3".
  const bare = /^(.*?\p{L}.*?)\s+(\d{1,3})$/u.exec(text);
  if (bare) {
    const label = bare[1], quantity = Number(bare[2]);
    // "axis 7": 7 pcs atau 7 hari? Untuk voucher tanpa masa aktif, tanyakan daripada salah catat.
    const ambiguous = PROVIDERS.test(label) && !hasAttribute(tidyLabel(label));
    return result(sourceText, label, quantity, { explicitQuantity: true, explicitUnit: false,
      ambiguity: ambiguous ? `“${sourceText}” kurang jelas. Tulis masa aktifnya, contoh: “${tidyLabel(label)} ${quantity} hari” atau “${tidyLabel(label)} 3 hari ${quantity}”.` : null });
  }

  // 6) Tanpa jumlah: hanya barang yang jelas cirinya ("telkomsel 3 hari") dianggap 1.
  if (hasAttribute(tidyLabel(text))) return result(sourceText, text, 1, { explicitQuantity: false, explicitUnit: false });
  return null;
}

// Memecah "axis 3 hari 2 sama xl 7 hari 1" menjadi beberapa barang, hanya bila setiap bagian memang barang.
export function parseItemSegments(raw: string): ParsedItemLine[] | null {
  const line = raw.trim();
  if (!line) return null;
  const parts = line.split(/\s+(?:sama|dan|dgn|dengan|plus)\s+|\s*[;&+]\s*|,\s+/i).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts.length <= 12) {
    const parsed = parts.map(parseItemLine);
    if (parsed.every((item): item is ParsedItemLine => item !== null)) return parsed;
  }
  const single = parseItemLine(line);
  return single ? [single] : null;
}

// Pesan grup di luar sesi rekap yang jelas-jelas catatan penjualan ("axis 3 hari 2 pcs").
// Sengaja lebih ketat daripada pembaca di dalam sesi agar obrolan biasa tidak membuka rekap.
export function isLikelySaleNote(text: string): boolean {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 25) return false;
  return lines.every(line => {
    const items = parseItemSegments(line);
    return !!items && items.every(item => !item.ambiguity && (item.explicitUnit || (item.hasAttribute && PROVIDERS.test(item.label))));
  });
}

// Koreksi jumlah tanpa satuan: "axis 3 hari bukan 7 tapi 5", "axis 3 hari harusnya 5".
export function parseItemCorrection(raw: string): { sourceText: string; label: string; quantity: number } | null {
  const sourceText = raw.trim();
  const text = sourceText.replace(/^(?:eh|maaf|sori|sorry)[\s,]+/i, '');
  if (FINANCE.test(text) || MONEY.test(text)) return null;
  const unit = String.raw`(?:\s*${UNIT})?`;
  const swap = new RegExp(String.raw`^(.+?)\s+(?:tadi\s+)?(?:salah\s+)?bukan\s+\d{1,7}${unit}\s*,?\s+(?:tapi|tp|melainkan|harusnya|seharusnya)\s+(\d{1,7})${unit}\s*$`, 'i').exec(text);
  const should = swap ? null : new RegExp(String.raw`^(.+?)\s+(?:tadi\s+)?(?:salah\s*,?\s+)?(?:harusnya|seharusnya|mestinya)\s+(\d{1,7})${unit}\s*$`, 'i').exec(text);
  // "hapus axis 3 hari", "axis 3 hari batal": keluarkan barang dari rekap (jumlah 0).
  const remove = swap || should ? null : /^(?:hapus|batal(?:kan)?|buang|coret)\s+(.+)$/i.exec(text) ?? /^(.+?)\s+(?:dihapus|hapus|batal|dibatalkan|gak\s+jadi|ga\s+jadi|nggak\s+jadi|tidak\s+jadi)$/i.exec(text);
  if (remove) {
    const label = tidyLabel(remove[1].replace(/\s+\d{1,4}\s*(?:pcs?|biji|buah)?$/i, ''));
    return label && /\p{L}/u.test(label) && !/^(?:rekap|semua|shift|yang\s+tadi|tadi)$/i.test(label) ? { sourceText, label, quantity: 0 } : null;
  }
  const match = swap ?? should;
  if (!match) return null;
  const label = tidyLabel(match[1].replace(/\b(?:tadi|salah)\s*$/i, ''));
  const quantity = Number(match[2]);
  if (!label || !/\p{L}/u.test(label) || !Number.isSafeInteger(quantity) || quantity < 0) return null;
  return { sourceText, label, quantity };
}
