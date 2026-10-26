import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExtraction, deterministicExtraction, emptyRecap } from './recap';
import { calculateUnrecordedQuantity, correctedStockDeduction, correctionDelta, evaluateInventoryDeduction, inventoryCallback, mergePhotoInventory, normalizeStockUnit, parseInventoryCallback, resolveInventoryProduct, type InventoryCatalogProduct } from './inventory';

const catalog: InventoryCatalogProduct[] = [
  { id: 1, name: 'Kartu Axis 3GB', categoryName: 'Voucher', provider: 'Axis', validity: '3 hari', stock: 20, locationId: 1 },
  { id: 2, name: 'Kartu Axis 5GB', categoryName: 'Voucher', provider: 'Axis', validity: '5 hari', stock: 15, locationId: 1 },
  { id: 3, name: 'Charger Type C', categoryName: 'Accessories', provider: null, validity: null, stock: 10, locationId: 1 },
  { id: 4, name: 'Anti Gores Vivo Y12', sku: 'AG-VY12', categoryName: 'Accessories', provider: null, validity: null, stock: 9, locationId: 1 },
];

test('explicit unit quantities are separate from aggregate monetary sales', () => {
  const extraction = deterministicExtraction('axis: 7 pcs\ncharger: 3 biji\nvc telkomsel: 230000\nrokok: 175000');
  assert.deepEqual(extraction.inventoryLines?.map(line => [line.label, line.quantity, line.unit]), [['axis', '7', 'pcs'], ['charger', '3', 'biji']]);
  assert.equal(extraction.entries.find(entry => entry.label === 'rokok')?.amount, '175000');
  assert.equal(extraction.inventoryLines?.some(line => line.label.includes('telkomsel')), false);
});

test('quantity corrections replace the earlier quantity and duplicate updates do not add twice', () => {
  const first = applyExtraction(emptyRecap(), { entries: [], inventoryLines: [{ sourceText: 'axis 7 pcs', label: 'axis', quantity: '7', unit: 'pcs', operation: 'add' }], unresolved: [] }, 'axis 7 pcs', 'u1');
  const duplicate = applyExtraction(first, { entries: [], inventoryLines: [{ sourceText: 'axis 7 pcs', label: 'axis', quantity: '7', unit: 'pcs', operation: 'add' }], unresolved: [] }, 'axis 7 pcs', 'u1');
  const parsedCorrection=deterministicExtraction('axis salah bukan 7 pcs tapi 5 pcs');
  const corrected = applyExtraction(duplicate, parsedCorrection, 'axis salah bukan 7 pcs tapi 5 pcs', 'u2');
  assert.equal(corrected.inventoryLines?.[0].quantity, 5);
  assert.equal(corrected.inventoryLines?.length, 1);
});

test('generic product labels remain ambiguous, while unique exact products can resolve', () => {
  assert.deepEqual(resolveInventoryProduct('axis', catalog), { status: 'AMBIGUOUS', productId: null, candidateProductIds: [1, 2] });
  assert.equal(resolveInventoryProduct('Charger Type C', catalog).productId, 3);
  assert.equal(resolveInventoryProduct('charger chargre c', catalog).status, 'MATCHED');
  assert.equal(resolveInventoryProduct('AG-VY12', catalog).productId, 4);
});

test('only confirmed same-shift Web App quantities are offset; never infer from money', () => {
  assert.equal(calculateUnrecordedQuantity(7, 2, 'INCLUDES_APP_SALES'), 5);
  assert.equal(calculateUnrecordedQuantity(7, 2, 'UNRECORDED_ONLY'), 7);
  assert.equal(calculateUnrecordedQuantity(1, 2, 'INCLUDES_APP_SALES'), null);
  assert.equal(normalizeStockUnit('biji'), 'pcs');
  assert.equal(normalizeStockUnit('box'), null);
});

test('unknown products remain unresolved and approved aliases map only to catalog IDs', () => {
  assert.deepEqual(resolveInventoryProduct('barang misterius', catalog), { status: 'UNMATCHED', productId: null, candidateProductIds: [] });
  assert.equal(resolveInventoryProduct('axis', catalog, [2]).productId, 2);
});

test('duplicate photo lines require an explicit choice and replacement preserves one source line', () => {
  const current = [{ id: 'line-1', sourceText: 'axis 7 pcs', label: 'axis', quantity: 7, unit: 'pcs', productId: 1,
    candidateProductIds: [1], mappingStatus: 'MATCHED' as const, coverage: 'UNRECORDED_ONLY' as const }];
  const photo = [{ sourceText: 'Axis 5 pcs', label: 'axis', quantity: '5', unit: 'pcs', operation: 'add' as const }];
  assert.equal(mergePhotoInventory(current, photo, 'accept', 'photo1').conflicts.length, 1);
  const replaced = mergePhotoInventory(current, photo, 'replace', 'photo1');
  assert.equal(replaced.lines.length, 1);
  assert.equal(replaced.lines[0].quantity, 5);
  assert.equal(replaced.lines[0].productId, null);
});

test('inline catalog and coverage buttons are compact and validate their identifiers', () => {
  const actions = ['select', 'included', 'unrecorded', 'owner'] as const;
  for (const action of actions) {
    const data = inventoryCallback(action, 'cmr1234567890123456789012', '123', action === 'select' ? '2147483647' : '-', 2147483647);
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64);
    assert.equal(parseInventoryCallback(data)?.action, action);
  }
  assert.equal(parseInventoryCallback('rcms:i:x:draft:line:1:1'), null);
});

test('stock plan rejects insufficient stock and reconciles only the same-shift employee quantity', () => {
  assert.deepEqual(evaluateInventoryDeduction(7, 2, 18, 'INCLUDES_APP_SALES'), { status: 'READY', appliedQty: 5, stockAfter: 13 });
  assert.equal(evaluateInventoryDeduction(7, 0, 3, 'UNRECORDED_ONLY').status, 'INSUFFICIENT');
  assert.equal(evaluateInventoryDeduction(1, 2, 10, 'INCLUDES_APP_SALES').status, 'REVIEW');
});
test('post-confirmation correction is compensating and preserves the requested target', () => {
  const delta = correctionDelta(7, 5);
  assert.equal(delta, -2);
  assert.equal(delta === null ? null : -delta, 2);
  assert.equal(correctionDelta(5, 7), 2);
  assert.equal(correctionDelta(-1, 3), null);
  assert.equal(correctedStockDeduction(5, 2, 'INCLUDES_APP_SALES'), 3);
  assert.equal(correctedStockDeduction(1, 2, 'INCLUDES_APP_SALES'), null);
  assert.equal(correctedStockDeduction(5, 2, 'UNRECORDED_ONLY'), 5);
});