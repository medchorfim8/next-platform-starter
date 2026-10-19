// توليد بطاقة الحضور ليوم معيّن: node scripts/print-sheet.js 2026-02-09 [--demo]
// تُعدّ البطاقة فارغة مع التأشير الآلي على الأعوان في عطلة؛ --demo يضيف توقيتات تجريبية لعرض التحليل.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildAttendanceSheet, applyPunches, closeSheet, renderSheetHtml } from '../src/attendance.js';

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const demo = process.argv.includes('--demo');
const root = new URL('..', import.meta.url);
const { unit, employees } = JSON.parse(readFileSync(new URL('db/seed_dast.json', root)));
// في الإنتاج تأتي العطل من GET /leaves?unit=…&on=date — هنا أمثلة توضيحية
const leaves = demo ? [
  { id: 'L1', employeeId: 3, type: 'ANNUAL', status: 'APPROVED', start: '2026-02-09', end: '2026-02-13', refNo: 'CNG-2026-000031' },
  { id: 'L2', employeeId: 7, type: 'SICK', status: 'PENDING_HR', start: '2026-02-06', end: '2026-02-10' },
] : [];
let sheet = buildAttendanceSheet({ date, unit: unit.code, employees, leaves });
if (demo) {
  const full = [{ in: '08:00', out: '12:00' }, { in: '14:00', out: '17:00' }];
  sheet = closeSheet(applyPunches(sheet, [
    { matricule: '61452', punches: full },
    { matricule: '63541', punches: [{ in: '08:40', out: '12:00' }, { in: '14:00', out: '17:00' }] },
    { matricule: '61533', punches: full },
    { matricule: '61740', punches: [{ in: '07:55', out: '12:00' }, {}] },
    { matricule: '68450', punches: [] },
    { matricule: '65705', punches: [{ in: '08:05', out: '12:00' }, { in: '14:00', out: '16:20' }] },
  ]), { 6: 12 });
}
const logo = 'data:image/png;base64,' + readFileSync(new URL('assets/logo.png', root)).toString('base64');
const html = renderSheetHtml(sheet, { org: [unit.parent.name_ar, unit.name_ar], logoSrc: logo });
mkdirSync(new URL('out/', root), { recursive: true });
const file = new URL(`out/attendance-${date}${demo ? '-demo' : ''}.html`, root);
writeFileSync(file, html);
console.log(file.pathname);
