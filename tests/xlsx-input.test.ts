import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excelDate } from '../lib/workbench/xlsx-input.ts';
import { validateDocument } from '../lib/workbench/documents.ts';

void test('Excel documents are accepted and unsupported legacy binary workbooks are explicit', () => {
  assert.equal(validateDocument('Orders.XLSX', 100), 'xlsx');
  assert.throws(() => validateDocument('Orders.xls',100), /XLSX/);
});
void test('Excel date systems retain calendar dates and fractional time', () => {
  assert.equal(excelDate(1), '1900-01-01');
  assert.equal(excelDate(61), '1900-03-01');
  assert.equal(excelDate(60), '1900-02-29 (Excel leap-year placeholder)');
  assert.equal(excelDate(0,true), '1904-01-01');
  assert.equal(excelDate(1.5,true), '1904-01-02 12:00:00');
  assert.throws(() => excelDate(NaN), /Invalid/);
});
