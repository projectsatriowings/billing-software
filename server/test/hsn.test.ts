import test from 'node:test';
import assert from 'node:assert/strict';
import { searchHsnSac, suggestHsnForProduct } from '../src/services/hsnService.ts';

test('HSN Service: search by code prefix', () => {
  const results = searchHsnSac('1006', 5);
  assert.ok(results.length > 0, 'Should find results for HSN 1006 (Rice)');
  assert.equal(results[0].code, '1006');
});

test('HSN Service: search by keyword', () => {
  const results = searchHsnSac('milk', 5);
  assert.ok(results.length > 0, 'Should find results for milk');
  assert.ok(results.some((r) => r.desc.toLowerCase().includes('milk')));
});

test('HSN Service: suggest HSN for product name', () => {
  const suggestions = suggestHsnForProduct('Basmati Rice 1kg', 'Groceries');
  assert.ok(suggestions.length > 0, 'Should return suggestions for Basmati Rice');
  assert.ok(suggestions.some((s) => s.code.startsWith('1006')), 'Should suggest 1006 for rice');
});

test('HSN Service: suggest HSN for medicines', () => {
  const suggestions = suggestHsnForProduct('Paracetamol 650mg tablet', 'Medicines');
  assert.ok(suggestions.length > 0, 'Should return suggestions for Paracetamol');
  assert.ok(suggestions.some((s) => s.code.startsWith('3004')), 'Should suggest 3004 for medicaments');
});

test('HSN Service: suggest correct HSN for potato chips', () => {
  const suggestions = suggestHsnForProduct('potato chips', 'Snacks');
  assert.ok(suggestions.length > 0, 'Should return suggestions for potato chips');
  assert.equal(suggestions[0].code, '20052000', 'Top suggestion for potato chips must be 20052000');
  assert.ok(suggestions[0].desc.includes('POTATO CHIPS'), 'Description should clarify potato chips');
});

