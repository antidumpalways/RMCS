// "BATANGAN FELOZ" (rokok eceran per batang) adalah barang lain dari "FELOZ" (bungkus). Baris yang menyebut eceran/batangan
// tidak boleh dicocokkan ke barang yang namanya tidak memuat kata itu, apa pun yang mencocokkannya (aturan, alias, AI).
const LOOSE = /\b(batangan|ketengan|eceran|ecer|satuan)\b/i;

export function looseUnitConflict(label: string, productName: string): boolean {
  const word = LOOSE.exec(label)?.[1];
  if (!word) return false;
  return !new RegExp(`\\b${word}\\b`, 'i').test(productName);
}
