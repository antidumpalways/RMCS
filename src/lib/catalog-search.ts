export type SearchableProduct = {
  name: string;
  provider: string | null;
  validity: string | null;
  categoryName: string;
};

const fillerWords = new Set([
  'ada', 'aktif', 'aku', 'barang', 'berapa', 'biaya', 'bisa', 'buat', 'butuh',
  'carikan', 'cari', 'cek', 'di', 'dong', 'harganya', 'harga', 'ini', 'itu',
  'jual', 'kah', 'masih', 'masa', 'mau', 'minta', 'nggak', 'nih', 'perlu',
  'produk', 'saya', 'stock', 'stok', 'tarif', 'tolong', 'toko', 'ukuran',
  'untuk', 'yang', 'ya',
]);

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize('NFKC')
    .replace(/\bby[.\s]*u\b/g, 'byu')
    .replace(/\b(?:seminggu|sepekan|1\s*minggu|tujuh\s*hari)\b/g, '7hari')
    .replace(/\btiga\s*hari\b/g, '3hari')
    .replace(/\blima\s*hari\b/g, '5hari')
    .replace(/\b(\d+)\s*(?:gigabytes?|giga|gb)\b/g, '$1gb')
    .replace(/\b(\d+)\s*(?:hari|hr|hri|haro|haru|hrai)\b/g, '$1hari')
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

function editDistance(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const grid = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) grid[i][0] = i;
  for (let j = 0; j <= right.length; j++) grid[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1);
      }
    }
  }
  return grid[left.length][right.length];
}

export function rankCatalogProducts<T extends SearchableProduct>(products: T[], terms: string[]) {
  return products.map((product) => {
    const productTerms = [...new Set(normalizeSearchText([
      product.name, product.provider, product.validity, product.categoryName,
    ].filter(Boolean).join(' ')).split(/\s+/))];
    const distances = terms.map((term) => Math.min(...productTerms.map((candidate) => {
      if (term === candidate) return 0;
      // Angka, ukuran paket, dan masa aktif harus tetap tepat.
      if (/\d/.test(term) || /\d/.test(candidate) || term.length < 4 || candidate.length < 4) return 3;
      return editDistance(term, candidate);
    })));
    const exactCount = distances.filter((distance) => distance === 0).length;
    const valid = distances.every((distance, index) => distance <= (terms[index].length >= 7 || exactCount >= 2 ? 2 : 1));
    return { product, valid, score: exactCount * 10 - distances.reduce((sum, distance) => sum + distance, 0) };
  }).filter(({ valid }) => valid)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
}
