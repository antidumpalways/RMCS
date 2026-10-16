type SearchableProduct = {
  name: string;
  provider: string | null;
  validity: string | null;
  categoryName: string;
};

const fillerWords = new Set([
  'ada', 'aktif', 'berapa', 'biaya', 'bisa', 'carikan', 'cari', 'cek', 'di',
  'dong', 'harganya', 'harga', 'ini', 'itu', 'jual', 'kah', 'masih', 'masa',
  'mau', 'nggak', 'nih', 'saya', 'stock', 'stok', 'tarif', 'tolong', 'toko',
  'untuk', 'yang', 'ya',
]);

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize('NFKC')
    .replace(/\bby[.\s]*u\b/g, 'byu')
    .replace(/\b(\d+)\s*(?:gigabytes?|giga|gb)\b/g, '$1gb')
    .replace(/\b(\d+)\s*(?:hari|hr|hri)\b/g, '$1hari')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function catalogSearchTerms(query: string) {
  return [...new Set(normalizeSearchText(query).split(/\s+/).filter((term) => term && !fillerWords.has(term)))].slice(0, 8);
}

export function catalogDatabaseNeedle(term: string) {
  return term.match(/^(\d+)(?:gb|hari)$/)?.[1] ?? term;
}

export function matchesCatalogProduct(product: SearchableProduct, terms: string[]) {
  const productTerms = new Set(normalizeSearchText([
    product.name, product.provider, product.validity, product.categoryName,
  ].filter(Boolean).join(' ')).split(/\s+/));
  return terms.every((term) => productTerms.has(term));
}
