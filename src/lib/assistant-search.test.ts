import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { semanticCatalogSearch, validatedSemanticMatches } from './semantic-catalog';
import { catalogSearchTerms, matchedProviders, productMatchesProviders, rankCatalogProducts, strongSpellingCandidates } from './catalog-search';
import { validateProductImage } from './product-image';

const products = [
  { id: 1, name: 'Paket Data 13GB Axis', categoryName: 'Voucher', provider: 'Axis', validity: '7 hari' },
  { id: 2, name: 'Paket Data 30GB Axis', categoryName: 'Voucher', provider: 'Axis', validity: '7 hari' },
  { id: 3, name: 'Car charger USB-C', categoryName: 'Aksesori', provider: null, validity: null },
];

test('semantic matcher accepts only IDs from the catalog', () => {
  assert.deepEqual(validatedSemanticMatches({ matches: [
    { id: 999, confidence: 'high' }, { id: 3, confidence: 'high' }, { id: 3, confidence: 'medium' },
  ] }, products, 'charger untuk mobil'), [{ id: 3, confidence: 'high' }]);
});

test('semantic matcher cannot substitute package size or validity', () => {
  assert.deepEqual(validatedSemanticMatches({ matches: [
    { id: 2, confidence: 'high' }, { id: 1, confidence: 'high' },
  ] }, products, 'Axis 13 GB 7 hari'), [{ id: 1, confidence: 'high' }]);
});

test('invalid image content is rejected even with an image MIME type', () => {
  assert.equal(validateProductImage(`data:image/jpeg;base64,${Buffer.alloc(120).toString('base64')}`), null);
  assert.equal(validateProductImage('data:text/html;base64,PGgxPk5vPC9oMT4='), null);
});

test('a provider named in the query keeps results to that provider', () => {
  const catalog = [
    { name: 'SP TELKOMSEL', provider: 'Telkomsel', validity: null, categoryName: 'Kartu Perdana' },
    { name: 'Paket Data 10GB Axis', provider: 'Axis', validity: '3 hari', categoryName: 'Voucher' },
    { name: 'Paket Data 10GB Three', provider: 'Three', validity: '5 hari', categoryName: 'Voucher' },
  ];
  const terms = catalogSearchTerms('Telkomsel belum ada yang paket data kita');
  const providers = matchedProviders(catalog, terms);
  assert.deepEqual(providers, ['telkomsel']);
  assert.deepEqual(catalog.filter((product) => productMatchesProviders(product, providers)).map((p) => p.name),
    ['SP TELKOMSEL']);
  assert.deepEqual(matchedProviders(catalog, catalogSearchTerms('paket data 10gb')), []);
});

test('normalization does not depend on a list of filler words or product synonyms', () => {
  assert.deepEqual(catalogSearchTerms('Axis 13 GB / 7 hari'), ['axis', '13gb', '7hari']);
  assert.deepEqual(catalogSearchTerms('Do you sell a vehicle charging adapter?'),
    ['do', 'you', 'sell', 'a', 'vehicle', 'charging', 'adapter']);
});

test('semantic selection can inspect a product in a later catalog batch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { messages: { content: string }[] };
    const payload = JSON.parse(body.messages[1].content) as { catalog: { id: number }[] };
    const matches = payload.catalog.some((product) => product.id === 501) ? [{ id: 501, confidence: 'high' }] : [];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ matches }) } }] }), { status: 200 });
  };
  try {
    const catalog = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1, name: index === 500 ? 'Car charger USB-C' : `Produk ${index + 1}`,
      categoryName: 'Aksesori', provider: null, validity: null,
    }));
    assert.deepEqual(await semanticCatalogSearch('vehicle charging adapter', catalog, 'test-key'),
      [{ id: 501, confidence: 'high' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('a distinctive two-edit typo outranks products sharing only the category', () => {
  const catalog = [
    { name: 'SAMPOERNA', categoryName: 'Rokok', provider: null, validity: null },
    { name: 'Gudang Garam', categoryName: 'Rokok', provider: null, validity: null },
    { name: 'Djarum Super', categoryName: 'Rokok', provider: null, validity: null },
    { name: 'Marlboro', categoryName: 'Rokok', provider: null, validity: null },
  ];
  const terms = catalogSearchTerms('rokok sampurna');
  const ranked = rankCatalogProducts(catalog, terms);
  assert.equal(ranked[0].product.name, 'SAMPOERNA');
  assert.deepEqual(strongSpellingCandidates(ranked, terms.length).map((item) => item.name), ['SAMPOERNA']);
  const generic = catalogSearchTerms('rokok');
  assert.deepEqual(strongSpellingCandidates(rankCatalogProducts(catalog, generic), generic.length), []);
});
