export type SearchableProduct = {
  name: string;
  provider: string | null;
  validity: string | null;
  categoryName: string;
};

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase('id-ID').normalize('NFKC')
    .replace(/(\d)\s+([\p{L}])/gu, '$1$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function catalogSearchTerms(query: string) {
  return [...new Set(normalizeSearchText(query).split(/\s+/).filter(Boolean))];
}

export function catalogQueryKey(query: string) {
  return catalogSearchTerms(query).join(' ').slice(0, 200);
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
  const documentFrequency = new Map<string, number>();
  const productTerms = products.map((product) => {
    const values = [...new Set(catalogSearchTerms([
      product.name, product.provider, product.validity, product.categoryName,
    ].filter(Boolean).join(' ')))];
    for (const token of values) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    return values;
  });
  return products.flatMap((product, index) => {
    if (!productTerms[index].length) return [];
    let matched = 0;
    let score = 0;
    for (const term of terms.slice(0, 16)) {
      const candidate = productTerms[index].find((token) => token === term) ||
        productTerms[index].find((token) => !/\d/.test(term + token) && term.length >= 5 && token.length >= 5 && editDistance(term, token) <= 1);
      if (!candidate) continue;
      matched++;
      score += Math.log(1 + products.length / (documentFrequency.get(candidate) ?? products.length));
      if (candidate === term) score += 0.5;
    }
    if (!matched) return [];
    return [{ product, score, matched }];
  }).sort((a, b) => b.score - a.score || b.matched - a.matched || a.product.name.localeCompare(b.product.name));
}
