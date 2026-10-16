import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validatedSemanticMatches } from './semantic-catalog';
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
