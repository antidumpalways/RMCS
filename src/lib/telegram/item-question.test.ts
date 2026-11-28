import test from 'node:test';
import assert from 'node:assert/strict';
import { isImplicitCatalogQuestion, looksLikeItemQuestion } from './group-routing';
import { validatedItemQuestion } from './item-question';

test('pertanyaan barang bahasa sehari-hari dikenali tanpa tanda tanya', () => {
  for (const text of ['ada barang ini gak', 'bang ada casan buat hp vivo gak', 'ada gak headset bluetooth', 'charger iphone ready ga', 'punya antigores samsung a15 nggak kak', 'adakah kabel type c', 'masih ada powerbank?', 'kak jual memori 32gb gak']) {
    assert.ok(looksLikeItemQuestion(text), text);
    assert.ok(isImplicitCatalogQuestion(text), text);
  }
});

test('obrolan, uang, dan catatan rekap tidak dianggap pertanyaan barang', () => {
  for (const text of ['oke siap bang', 'ada tf 500rb gak', 'ada selisih admin gak', 'axis 3 hari 2 pcs', 'ada 2 pcs axis gak', 'bon budi ada gak', 'gak ada bang', 'rekap sudah ada belum', 'besok saya masuk pagi']) {
    assert.equal(looksLikeItemQuestion(text), false, text);
  }
});

test('jawaban AI hanya dipakai untuk barang yang ada; angka tipe yang tidak tercantum tidak diklaim cocok', () => {
  const products = [
    { id: 1, name: 'Tempered Glass Samsung A15', categoryName: 'Aksesoris', provider: null, validity: null },
    { id: 2, name: 'Tempered Glass Samsung A05', categoryName: 'Aksesoris', provider: null, validity: null },
    { id: 3, name: 'Charger Vivo', categoryName: 'Aksesoris', provider: null, validity: null },
  ];
  const raw = { asking: true, wanted: 'antigores samsung a15', matches: [{ id: 2, confidence: 'high' }, { id: 1, confidence: 'high' }, { id: 99, confidence: 'high' }, { id: 1, confidence: 'high' }] };
  assert.deepEqual(validatedItemQuestion(raw, products, 'ada antigores samsung a15 gak'), { asking: true, wanted: 'antigores samsung a15', sure: [1], maybe: [], similar: [2] });
  assert.deepEqual(validatedItemQuestion({ asking: true, wanted: 'casan', matches: [{ id: 3, confidence: 'medium' }] }, products, 'ada casan gak')?.maybe, [3]);
  assert.equal(validatedItemQuestion({ asking: false, matches: [{ id: 3, confidence: 'high' }] }, products, 'ada orang gak')?.sure.length, 0);
  assert.equal(validatedItemQuestion({ matches: [] }, products, 'x'), null);
  const sized = [{ id: 4, name: 'Kabel Data 2M', categoryName: 'Aksesoris', provider: null, validity: null },
    { id: 5, name: 'Case iPhone11 Bening', categoryName: 'Aksesoris', provider: null, validity: null }];
  assert.deepEqual(validatedItemQuestion({ asking: true, matches: [{ id: 4, confidence: 'high' }] }, sized, 'ada kabel 2 meter gak')?.sure, [4]);
  assert.deepEqual(validatedItemQuestion({ asking: true, matches: [{ id: 5, confidence: 'high' }] }, sized, 'case iphone 11 ada ga')?.sure, [5]);
  assert.deepEqual(validatedItemQuestion({ asking: true, matches: [{ id: 5, confidence: 'high' }] }, sized, 'case iphone 12 ada ga')?.similar, [5]);
});
