import { catalogSearchTerms } from './catalog-search';

export type SemanticProduct = {
  id: number;
  name: string;
  categoryName: string;
  provider: string | null;
  validity: string | null;
};

export type SemanticMatch = { id: number; confidence: 'high' | 'medium' | 'low' };

// Numerik produk (mis. 13GB/7 hari) tidak boleh diganti oleh penilaian model.
export function respectsNumericAttributes(query: string, product: SemanticProduct) {
  const required = catalogSearchTerms(query).filter((term) => /\d/.test(term));
  if (!required.length) return true;
  const attributes = catalogSearchTerms([product.name, product.categoryName, product.provider, product.validity].filter(Boolean).join(' '));
  return required.every((term) => attributes.includes(term));
}

export function validatedSemanticMatches(raw: unknown, products: SemanticProduct[], query: string): SemanticMatch[] {
  if (!raw || typeof raw !== 'object' || !('matches' in raw) || !Array.isArray(raw.matches)) return [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const seen = new Set<number>();
  return raw.matches.slice(0, 6).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('id' in entry) || !('confidence' in entry)) return [];
    const id = entry.id;
    const confidence = entry.confidence;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || seen.has(id) ||
        (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low')) return [];
    const product = byId.get(id);
    if (!product || !respectsNumericAttributes(query, product)) return [];
    seen.add(id);
    return [{ id, confidence }];
  });
}

async function searchBatch(query: string, products: SemanticProduct[], apiKey: string) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
      messages: [
        { role: 'system', content: 'Cocokkan maksud pencarian barang ke daftar katalog. Pahami parafrasa, kegunaan, bahasa informal dan typo. Pilih hanya ID dari daftar. Jangan mengarang kompatibilitas, varian, atau atribut yang tidak tercantum. Jika tidak yakin, berikan beberapa kandidat dengan confidence medium/low atau daftar kosong. Jawab JSON saja: {"matches":[{"id":123,"confidence":"high"}]}. Maksimal 5 hasil.' },
        { role: 'user', content: JSON.stringify({ query, catalog: products.map(({ id, name, categoryName, provider, validity }) => ({ id, name, categoryName, provider, validity })) }) },
      ],
      max_tokens: 300,
      temperature: 0,
      stream: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Semantic catalog search unavailable.');
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];
  try { return validatedSemanticMatches(JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content), products, query); }
  catch { return []; }
}

export async function semanticCatalogSearch(query: string, products: SemanticProduct[], apiKey: string) {
  if (!products.length) return [];
  if (products.length > 3000) throw new Error('Catalog exceeds semantic search limit.');
  const batches = Array.from({ length: Math.ceil(products.length / 500) }, (_, index) => products.slice(index * 500, (index + 1) * 500));
  const results = await Promise.allSettled(batches.map((batch) => searchBatch(query, batch, apiKey)));
  const partial = results.some((result) => result.status === 'rejected');
  if (results.every((result) => result.status === 'rejected')) throw new Error('Semantic catalog search unavailable.');
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  const matches = new Map<number, SemanticMatch>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const match of result.value) {
      const confidence = partial && match.confidence === 'high' ? 'medium' : match.confidence;
      const previous = matches.get(match.id);
      if (!previous || confidenceOrder[confidence] < confidenceOrder[previous.confidence]) {
        matches.set(match.id, { id: match.id, confidence });
      }
    }
  }
  if (partial && !matches.size) throw new Error('Semantic catalog search incomplete.');
  return [...matches.values()].sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]).slice(0, 8);
}
