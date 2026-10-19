import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAttendanceSheet, analyzeRow, reconcile, closeSheet, parseSheetCsv, applyPunches, renderSheetHtml, scheduleFor, SCHEDULES, formatDateAr } from '../src/attendance.js';

const { employees } = JSON.parse(readFileSync(new URL('../db/seed_dast.json', import.meta.url)));
const leaves = [
  { id: 'L1', employeeId: 3, type: 'ANNUAL', status: 'APPROVED', start: '2026-02-09', end: '2026-02-13', refNo: 'CNG-2026-000031' },
  { id: 'L2', employeeId: 7, type: 'SICK', status: 'PENDING_HR', start: '2026-02-06', end: '2026-02-10' },
  { id: 'L3', employeeId: 5, type: 'ANNUAL', status: 'REJECTED', start: '2026-02-09', end: '2026-02-09' },
];

test('التاريخ بالعربية كما في البطاقة', () => assert.equal(formatDateAr('2026-02-09'), '09 فيفري 2026'));

test('البطاقة تُعدّ آلياً مع التأشير على العطل', () => {
  const s = buildAttendanceSheet({ date: '2026-02-09', employees, leaves });
  assert.equal(s.rows.length, 8);
  assert.equal(s.rows[2].status, 'ON_LEAVE');
  assert.match(s.rows[2].remark, /عطلة سنوية للاستراحة من 09\/02\/2026 إلى 13\/02\/2026 \(CNG-2026-000031\)/);
  assert.equal(s.rows[6].status, 'ON_LEAVE'); // مرض مسجل في انتظار مراقبة الوثيقة
  assert.equal(s.rows[4].status, 'EXPECTED'); // عطلة مرفوضة لا تُحتسب
});

test('العطلة الرسمية والراحة الأسبوعية', () => {
  assert.equal(buildAttendanceSheet({ date: '2026-03-20', employees, holidays: [{ day: '2026-03-20', label: 'عيد الاستقلال' }] }).rows[0].remark, 'عيد الاستقلال');
  assert.equal(buildAttendanceSheet({ date: '2026-02-08', employees }).rows[0].status, 'WEEKEND');
});

test('نظام الحصة الواحدة', () => {
  const periods = [{ from: '2026-07-01', to: '2026-08-31' }];
  assert.equal(scheduleFor('2026-07-15', periods), SCHEDULES.SINGLE);
  assert.equal(scheduleFor('2026-02-09', periods), SCHEDULES.DOUBLE);
});

test('تحليل الحضور', () => {
  const S = SCHEDULES.DOUBLE;
  const row = (punches) => ({ status: 'EXPECTED', punches });
  assert.deepEqual(analyzeRow(row([{ in: '08:05', out: '12:00' }, { in: '14:00', out: '17:00' }]), S), []);
  assert.deepEqual(analyzeRow(row([]), S).map((a) => a.code), ['ABSENT']);
  assert.deepEqual(analyzeRow(row([{ in: '08:30', out: '12:00' }, {}]), S).map((a) => a.code), ['LATE', 'HALF_ABSENT']);
  assert.deepEqual(analyzeRow(row([{ in: '08:00' }, { in: '14:00', out: '16:30' }]), S).map((a) => a.code), ['MISSING_PUNCH', 'EARLY_LEAVE']);
});

test('مقترحات التسوية', () => {
  assert.deepEqual(reconcile([{ code: 'ABSENT', days: 1 }], { annualBalance: 5 }).map((o) => o.action), ['REQUEST_JUSTIFICATION', 'DEDUCT_ANNUAL', 'UNPAID']);
  assert.deepEqual(reconcile([{ code: 'HALF_ABSENT', days: 0.5 }]).map((o) => o.action), ['REQUEST_JUSTIFICATION', 'UNPAID']);
  assert.deepEqual(reconcile([{ code: 'LATE' }]), []);
});

test('استيراد بطاقة مرقونة وإقفالها', () => {
  const csv = '﻿ع/ر,الرقم الآلي,الإسم و اللقب,دخول,خروج,دخول,خروج,ملاحظات\n1,61452,إيناس زقر,08:00,12:00,14:00,17:00,\n2,63541,فوزي جاري,08:40,12:00,14:00,17:00,\n';
  const sheet = applyPunches(buildAttendanceSheet({ date: '2026-02-09', employees, leaves }), parseSheetCsv(csv));
  const closed = closeSheet(sheet, { 6: 10 });
  assert.equal(closed.rows[1].remark, 'تأخير 40 دق');
  assert.equal(closed.rows[5].remark, 'غياب غير مبرر'); // محمد شرفي: لا توقيت ولا عطلة
  assert.ok(closed.rows[5].proposals.some((p) => p.action === 'DEDUCT_ANNUAL'));
  assert.deepEqual(closed.summary, { total: 8, present: 2, onLeave: 2, absentUnjustified: 4, late: 1 });
  const html = renderSheetHtml(closed, { org: ['الإدارة المركزية للموارد البشرية', 'إدارة العمل الاجتماعي والثقافي'] });
  assert.match(html, /بطاقة حضور<br>التاريخ: 09 فيفري 2026/);
  assert.equal((html.match(/<th>دخول<\/th>/g) || []).length, 2);
});
