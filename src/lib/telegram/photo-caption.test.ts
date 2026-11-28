import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESSORY, parsePhotoCaption } from './photo-caption';
import { isImplicitCatalogQuestion, quickCatalogQuery } from './group-routing';

test('keterangan foto barang baru: per baris maupun satu baris', () => {
  const expected = { kind: 'create', name: 'Charger Vivo 18W', category: 'aksesoris', costPrice: 20_000, sellPrice: 35_000, stock: 5 };
  assert.deepEqual(parsePhotoCaption('Tambah aksesoris\nCharger Vivo 18W\nModal: 20rb\nJual: 35rb\nStok: 5'), expected);
  assert.deepEqual(parsePhotoCaption('Tambah aksesoris Charger Vivo 18W modal 20rb jual 35rb stok 5 pcs'), expected);
  assert.deepEqual(parsePhotoCaption('Charger Vivo 18W\nHarga modal : 20.000\nHarga jual : 35000'),
    { kind: 'create', name: 'Charger Vivo 18W', category: null, costPrice: 20_000, sellPrice: 35_000, stock: null });
  assert.deepEqual(parsePhotoCaption('Tambah barang baru\nNama: Headset JBL\nKategori: Elektronik\nHarga: 50rb'),
    { kind: 'create', name: 'Headset JBL', category: 'Elektronik', costPrice: null, sellPrice: 50_000, stock: null });
});

test('ejaan aksesoris yang umum dikenali', () => {
  for (const word of ['aksesoris', 'Aksesori', 'accessories', 'accesories', 'Accesoris', 'asesoris', 'ACC']) assert.ok(ACCESSORY.test(word), word);
  for (const word of ['access', 'kaos', 'charger', 'accu']) assert.ok(!ACCESSORY.test(word), word);
  const created = parsePhotoCaption('Tambah accesories\nKabel Data C\nJual: 15rb');
  assert.equal(created?.kind === 'create' && created.name, 'Kabel Data C');
});

test('keterangan foto untuk barang yang sudah ada', () => {
  for (const text of ['Foto: Charger Vivo 18W', 'foto charger vivo 18w', 'Ganti foto : Charger Vivo 18W', 'Gambar barang Charger Vivo 18W']) {
    const parsed = parsePhotoCaption(text);
    assert.equal(parsed?.kind, 'attach', text);
    assert.match(parsed?.kind === 'attach' ? parsed.name : '', /^charger vivo 18w$/i);
  }
});

test('keterangan yang kurang lengkap ditolak dengan alasan, bukan ditebak', () => {
  assert.equal(parsePhotoCaption('Tambah aksesoris\nCharger Vivo\nModal: 20rb')?.kind, 'invalid');
  assert.equal(parsePhotoCaption('Tambah aksesoris\nJual: 35rb')?.kind, 'invalid');
  assert.equal(parsePhotoCaption('Charger\nJual: 35')?.kind, 'invalid');
  assert.equal(parsePhotoCaption('Charger\nwarna hitam\nJual: 35rb')?.kind, 'invalid');
  assert.equal(parsePhotoCaption('Charger Vivo 18W'), null);
  assert.equal(parsePhotoCaption(''), null);
});

test('"cari", "foto", dan "harga" di grup dianggap pencarian barang', () => {
  for (const text of ['cari charger vivo', 'foto charger vivo', 'harga charger vivo', 'ada charger vivo?']) {
    assert.ok(isImplicitCatalogQuestion(text), text);
    assert.equal(quickCatalogQuery(text), 'charger vivo', text);
  }
  assert.ok(!isImplicitCatalogQuestion('charger vivo 2 pcs'));
  assert.ok(!isImplicitCatalogQuestion('foto copy 5000'));
});
