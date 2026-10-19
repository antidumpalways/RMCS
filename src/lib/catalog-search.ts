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
  const indexed = products.map((product) => {
    const nameTerms = catalogSearchTerms(product.name);
    const values = [...new Set(catalogSearchTerms([
      product.name, product.provider, product.validity, product.categoryName,
    ].filter(Boolean).join(' ')))];
    for (const token of values) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    return { values, nameTerms };
  });
  return products.flatMap((product, index) => {
    if (!indexed[index].values.length) return [];
    let matched = 0;
    let score = 0;
    let nameSimilarity = 0;
    for (const term of terms.slice(0, 16)) {
      const similarity = (token: string) => {
        if (token === term) return 1;
        if (/\d/.test(term + token) || term.length < 5 || token.length < 5) return 0;
        const distance = editDistance(term, token);
        return distance <= (Math.max(term.length, token.length) >= 8 ? 2 : 1)
          ? 1 - distance / Math.max(term.length, token.length) : 0;
      };
      const candidates = indexed[index].values.map((token) => ({ token, similarity: similarity(token) }));
      candidates.sort((a, b) => b.similarity - a.similarity);
      const candidate = candidates[0];
      if (!candidate || candidate.similarity < 0.7) continue;
      matched++;
      score += Math.log(1 + products.length / (documentFrequency.get(candidate.token) ?? products.length)) * candidate.similarity;
      if (candidate.token === term) score += 0.5;
      nameSimilarity = Math.max(nameSimilarity, ...indexed[index].nameTerms.map(similarity));
    }
    if (!matched) return [];
    return [{ product, score, matched, nameSimilarity }];
  }).sort((a, b) => b.score - a.score || b.matched - a.matched || a.product.name.localeCompare(b.product.name));
}

// Provider yang disebut jelas di query (token utuh yang memang dipakai sebagai
// nama provider di katalog). Dipakai agar pencarian seperti “Telkomsel paket
// data” tidak mencampur barang provider lain.
export function matchedProviders<T extends SearchableProduct>(products: T[], terms: string[]) {
  const providerTokens = new Set<string>();
  for (const product of products) {
    if (!product.provider) continue;
    for (const token of catalogSearchTerms(product.provider)) providerTokens.add(token);
  }
  return [...new Set(terms.filter((term) => term.length >= 2 && providerTokens.has(term)))];
}

export function productMatchesProviders(product: SearchableProduct, providers: string[]) {
  if (!providers.length) return true;
  const tokens = new Set(catalogSearchTerms([product.provider ?? '', product.name].join(' ')));
  return providers.some((provider) => tokens.has(provider));
}

export function strongSpellingCandidates<T>(ranked: { product: T; score: number; matched: number; nameSimilarity: number }[], queryTermCount: number) {
  const best = ranked[0];
  if (!best || best.nameSimilarity < 0.7 || best.matched < Math.min(2, queryTermCount)) return [];
  const group = ranked.filter((entry) => entry.score >= best.score * 0.88 &&
    entry.matched >= best.matched && entry.nameSimilarity >= 0.7).slice(0, 8);
  const groupProducts = new Set(group.map((entry) => entry.product));
  const next = ranked.find((entry) => !groupProducts.has(entry.product));
  if (next && best.score < next.score * 1.6) return [];
  return group.map((entry) => entry.product);
}
