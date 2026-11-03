// Murni (tanpa database): menukar bagian spesifikasi pada nama/masa aktif produk,
// mis. "10GB/3 hari" -> "8GB/3 hari" pada "Paket Data 10GB Axis" menjadi "Paket Data 8GB Axis".

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mengganti satu bagian (tanpa peduli huruf besar/kecil dan spasi antara angka dan satuan, "10GB" = "10 gb").
// Mengembalikan null bila bagian itu tidak ada pada teks.
export function swapSpec(value: string, from: string, to: string): string | null {
  const source = from.trim();
  if (!source) return null;
  const flexible = escapeRegex(source).replace(/(\d)(?=[a-z])/gi, '$1\\s*').replace(/\s+/g, '\\s*');
  const pattern = new RegExp('(?<![a-z0-9])' + flexible + '(?![a-z0-9])', 'i');
  if (!pattern.test(value)) return null;
  return value.replace(pattern, to.trim());
}

// Memecah "10gb/3 hari" -> "8gb/3 hari" menjadi pasangan bagian yang benar-benar berbeda: [["10gb", "8gb"]].
export function specPairs(from: string, to: string): Array<[string, string]> {
  const left = from.split(/[\s/]+/).filter(Boolean);
  const right = to.split(/[\s/]+/).filter(Boolean);
  if (left.length === right.length) {
    const pairs = left.map((token, index) => [token, right[index]] as [string, string]).filter(([a, b]) => a.toLowerCase() !== b.toLowerCase());
    if (pairs.length) return pairs;
  }
  return [[from.trim(), to.trim()]];
}

// Menerapkan penggantian pada nama dan masa aktif produk.
export function applySpecReplacement(product: { name: string; validity: string | null }, from: string, to: string) {
  let name = product.name;
  let validity = product.validity;
  for (const [a, b] of specPairs(from, to)) {
    name = swapSpec(name, a, b) ?? name;
    if (validity) validity = swapSpec(validity, a, b) ?? validity;
  }
  return { name, validity, nameChanged: name !== product.name, validityChanged: validity !== product.validity };
}
