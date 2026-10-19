import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDays, annualEntitlement, carryOver, sickPaySplit, payrollDeduction, splitByMonth, validateRequest, transition } from '../src/rules.js';

test('احتساب الأيام', () => {
  assert.equal(countDays('2026-07-01', '2026-07-30'), 30);
  // 2026-10-19 اثنين → 2026-10-25 أحد: 5 أيام عمل، مع عطلة رسمية يوم 2026-10-15 خارج الفترة
  assert.equal(countDays('2026-10-19', '2026-10-25', 'WORKING'), 5);
  assert.equal(countDays('2026-10-19', '2026-10-25', 'WORKING', { holidays: ['2026-10-20'] }), 4);
});

test('الاستحقاق السنوي والانتداب خلال السنة', () => {
  assert.equal(annualEntitlement(2026, '2015-03-01'), 30);
  assert.equal(annualEntitlement(2026, '2026-07-01'), 15); // 6 أشهر × 2.5
  assert.equal(annualEntitlement(2026, '2026-07-10'), 12.5); // جويلية غير محتسب
  assert.equal(annualEntitlement(2026, '2015-01-01', { suspendedMonths: 2 }), 25);
  assert.equal(annualEntitlement(2026, '2027-01-01'), 0);
});

test('الترحيل', () => {
  assert.deepEqual(carryOver(42), { carried: 30, forfeited: 12 });
  assert.deepEqual(carryOver(10), { carried: 10, forfeited: 0 });
});

test('شرائح أجر المرض', () => {
  assert.deepEqual(sickPaySplit(20, 50), { FULL: 10, HALF: 10, EXCEEDED: 0 });
  assert.deepEqual(sickPaySplit(10, 360), { FULL: 0, HALF: 5, EXCEEDED: 5 });
});

test('خصم الأجر بالقاعدة الثلاثينية', () => {
  assert.equal(payrollDeduction(1500, { noneDays: 3 }), 150);
  assert.equal(payrollDeduction(1500, { halfDays: 10 }), 250);
});

test('تقسيم على الأشهر', () => {
  assert.deepEqual(splitByMonth('2026-10-28', '2026-11-03'), { '2026-10': 4, '2026-11': 3 });
});

test('التحقق من الطلب', () => {
  const ctx = { today: '2026-10-19', employee: { gender: 'M' }, balance: { ANNUAL: 10 }, usedThisYear: { EXCEPTIONAL: 5 } };
  assert.deepEqual(validateRequest({ type: 'ANNUAL', start: '2026-11-10', end: '2026-11-14' }, ctx), []);
  assert.equal(validateRequest({ type: 'ANNUAL', start: '2026-10-25', end: '2026-11-14' }, ctx).length, 2);
  assert.ok(validateRequest({ type: 'MATERNITY', start: '2026-11-01', end: '2026-12-01', documentId: 'x' }, ctx)[0].includes('لا ينطبق'));
  assert.ok(validateRequest({ type: 'EXCEPTIONAL', reason: 'MARRIAGE', start: '2026-10-20', end: '2026-10-21', documentId: 'x' }, ctx)[0].includes('السقف'));
});

test('سير العمل', () => {
  assert.equal(transition('PENDING_MANAGER', 'approve'), 'PENDING_HR');
  assert.equal(transition('PENDING_HR', 'approve'), 'APPROVED');
  assert.throws(() => transition('REJECTED', 'approve'));
});
