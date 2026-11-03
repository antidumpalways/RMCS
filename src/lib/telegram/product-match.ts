import { catalogSearchTerms } from '@/lib/catalog-search';

type MatchableProduct = { name: string; provider: string | null; validity: string | null; sku: string | null };

const GENERIC_TERMS = new Set(['paket', 'data', 'voucher', 'kuota', 'vc', 'produk', 'barang', 'pcs', 'unit', 'stok', 'stock', 'harga', 'tolong', 'tambah', 'tambahkan', 'jadi', 'menjadi', 'ke', 'di', 'yang', 'dan', 'untuk']);
// Kecocokan ketat: SEMUA kata khas yang disebut owner (merek, ukuran, varian, angka) ada pada produk. Kecocokan longgar/semantik tidak boleh dijalankan otomatis.
export function strictProductMatch(query: string, product: MatchableProduct): boolean {
  const cleaned = query.trim().replace(/^(?:sku|kode(?:\s+barang)?)\s*[:#-]?\s*/i, '').toLocaleLowerCase('id-ID');
  if (product.sku && product.sku.toLocaleLowerCase('id-ID') === cleaned) return true;
  const tokens = new Set(catalogSearchTerms([product.name, product.provider, product.validity].filter(Boolean).join(' ')));
  const hasDayToken = [...tokens].some(token => /hari$/.test(token));
  const terms = catalogSearchTerms(query).filter(term => !GENERIC_TERMS.has(term));
  return terms.length > 0 && terms.every(term => tokens.has(term) || (/hari$/.test(term) && !hasDayToken));
}
