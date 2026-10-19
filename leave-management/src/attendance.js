// بطاقة الحضور اليومية وربطها بمنظومة العطل.
// الشكل مطابق لبطاقة الحضور الورقية المعتمدة: ع/ر، الرقم الآلي، الإسم واللقب، دخول/خروج (الحصة الصباحية)،
// دخول/خروج (الحصة المسائية)، ملاحظات.
import { LEAVE_TYPES, countDays } from './rules.js';

// التوقيت الإداري — VERIFY حسب المنشور الداخلي للمؤسسة
export const SCHEDULES = {
  DOUBLE: { label: 'نظام الحصتين', sessions: [{ in: '08:00', out: '12:00' }, { in: '14:00', out: '17:00' }] },
  SINGLE: { label: 'نظام الحصة الواحدة', sessions: [{ in: '07:30', out: '13:30' }] },
};
export const TOLERANCE_MIN = 10; // دقائق التسامح قبل اعتبار التأخير

const ACTIVE = ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'PENDING_HR']; // PENDING_HR: مرض/ولادة مسجلة في انتظار مراقبة الوثيقة
const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const formatDateAr = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[+m - 1]} ${y}`;
};
const dmy = (iso) => iso.split('-').reverse().join('/');
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** نظام التوقيت المنطبق في تاريخ معيّن: حصة واحدة في الصيف ورمضان (الفترات تُضبط سنوياً). */
export function scheduleFor(date, singleSessionPeriods = []) {
  const single = singleSessionPeriods.some((p) => date >= p.from && date <= p.to);
  return single ? SCHEDULES.SINGLE : SCHEDULES.DOUBLE;
}

/** إعداد بطاقة اليوم: قائمة الأعوان مع التأشير آلياً على من هو في عطلة. */
export function buildAttendanceSheet({ date, unit, employees, leaves = [], holidays = [], singleSessionPeriods = [] }) {
  const schedule = scheduleFor(date, singleSessionPeriods);
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const holiday = holidays.find((h) => h.day === date);
  const rows = employees.map((e, i) => {
    const leave = leaves.find((l) => l.employeeId === e.id && ACTIVE.includes(l.status) && l.start <= date && l.end >= date);
    let status = 'EXPECTED', remark = '';
    if (holiday) { status = 'HOLIDAY'; remark = holiday.label; }
    else if (dow === 0 || dow === 6) { status = 'WEEKEND'; remark = 'راحة أسبوعية'; }
    else if (leave) {
      status = 'ON_LEAVE';
      remark = `${LEAVE_TYPES[leave.type].label.replace(/ \(.*\)$/, '')} من ${dmy(leave.start)} إلى ${dmy(leave.end)}` + (leave.refNo ? ` (${leave.refNo})` : '');
    }
    return { n: i + 1, employeeId: e.id, matricule: e.matricule, name: e.name, status, leaveId: leave?.id ?? null, punches: [], remark };
  });
  return { date, dateAr: formatDateAr(date), unit, schedule, rows };
}

/** تحليل حضور عون في يوم: يُرجع قائمة المخالفات. punches = [{in:'08:05', out:'12:00'}, {in, out}] بنفس ترتيب الحصص. */
export function analyzeRow(row, schedule, tolerance = TOLERANCE_MIN) {
  if (row.status !== 'EXPECTED') return [];
  const out = [];
  const missed = [];
  schedule.sessions.forEach((s, i) => {
    const p = row.punches[i] || {};
    if (!p.in && !p.out) { missed.push(i); return; }
    if (!p.in || !p.out) out.push({ code: 'MISSING_PUNCH', session: i, label: `تسجيل ناقص في الحصة ${i + 1}` });
    if (p.in && toMin(p.in) > toMin(s.in) + tolerance) out.push({ code: 'LATE', session: i, minutes: toMin(p.in) - toMin(s.in), label: `تأخير ${toMin(p.in) - toMin(s.in)} دق` });
    if (p.out && toMin(p.out) < toMin(s.out)) out.push({ code: 'EARLY_LEAVE', session: i, minutes: toMin(s.out) - toMin(p.out), label: `خروج مبكر ${toMin(s.out) - toMin(p.out)} دق` });
  });
  if (missed.length === schedule.sessions.length) out.push({ code: 'ABSENT', days: 1, label: 'غياب غير مبرر' });
  else if (missed.length) out.push({ code: 'HALF_ABSENT', days: 0.5, session: missed[0], label: `غياب عن الحصة ${missed[0] + 1}` });
  return out;
}

/**
 * مقترحات التسوية لغياب غير مبرر: يُشعَر العون بالتبرير في أجل 48 ساعة، وإلا تُقترح
 * تسوية من الرصيد السنوي (إن وُجد رصيد) أو عطلة بدون أجر مع خصم 1/30.
 */
export function reconcile(anomalies, { annualBalance = 0, justifyHours = 48 } = {}) {
  const days = anomalies.filter((a) => a.days).reduce((s, a) => s + a.days, 0);
  if (!days) return [];
  const opts = [{ action: 'REQUEST_JUSTIFICATION', deadlineHours: justifyHours, label: `مطالبة العون بالتبرير في أجل ${justifyHours} ساعة (شهادة طبية ← عطلة مرض)` }];
  if (annualBalance >= days) opts.push({ action: 'DEDUCT_ANNUAL', type: 'ANNUAL', days, label: `خصم ${days} يوم من الرصيد السنوي بموافقة العون` });
  opts.push({ action: 'UNPAID', type: 'UNPAID', days, label: `اعتبارها غياباً بدون أجر (${days} يوم) وإرسالها لمنظومة الأجور` });
  return opts;
}

/** تحليل البطاقة كاملة بعد إدخال التوقيتات وتوليد الملاحظات. */
export function closeSheet(sheet, balances = {}) {
  const rows = sheet.rows.map((r) => {
    const anomalies = analyzeRow(r, sheet.schedule);
    const remark = r.remark || anomalies.map((a) => a.label).join('، ');
    return { ...r, anomalies, remark, proposals: reconcile(anomalies, { annualBalance: balances[r.employeeId] ?? 0 }) };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  const summary = {
    total: rows.length,
    present: rows.filter((r) => r.status === 'EXPECTED' && !r.anomalies.some((a) => a.code === 'ABSENT')).length,
    onLeave: count('ON_LEAVE'),
    absentUnjustified: rows.filter((r) => r.anomalies.some((a) => a.code === 'ABSENT')).length,
    late: rows.filter((r) => r.anomalies.some((a) => a.code === 'LATE')).length,
  };
  return { ...sheet, rows, summary };
}

/** استيراد بطاقة ورقية مرقونة (CSV بنفس أعمدة البطاقة). */
export function parseSheetCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const [n, matricule, name, in1, out1, in2, out2, remark = ''] = l.split(',').map((c) => c.trim());
    const punches = [{ in: in1 || null, out: out1 || null }];
    if (in2 !== undefined) punches.push({ in: in2 || null, out: out2 || null });
    return { n: +n, matricule, name, punches, remark };
  });
}

/** دمج التوقيتات المستوردة في البطاقة حسب الرقم الآلي. */
export function applyPunches(sheet, imported) {
  const byMat = new Map(imported.map((r) => [r.matricule, r]));
  return { ...sheet, rows: sheet.rows.map((r) => {
    const imp = byMat.get(r.matricule);
    return imp ? { ...r, punches: imp.punches, remark: r.remark || imp.remark } : r;
  }) };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** طباعة البطاقة بصيغة HTML (A4 أفقي) مطابقة للنموذج الورقي — تُحوَّل إلى PDF عبر Chromium/Gotenberg. */
export function renderSheetHtml(sheet, { org = [], logoSrc = '' } = {}) {
  const pairs = sheet.schedule.sessions.length === 2 ? 2 : 1;
  const head = Array.from({ length: pairs }, () => '<th>دخول</th><th>خروج</th>').join('');
  const cell = (r, i, k) => {
    if (r.status !== 'EXPECTED') return '<td class="na">—</td>';
    return `<td>${esc(r.punches[i]?.[k] ?? '')}</td>`;
  };
  const body = sheet.rows.map((r) => `<tr class="${r.status.toLowerCase()}">
      <td class="b">${r.n}</td><td>${esc(r.matricule)}</td><td class="name">${esc(r.name)}</td>
      ${Array.from({ length: pairs }, (_, i) => cell(r, i, 'in') + cell(r, i, 'out')).join('')}
      <td class="rem">${esc(r.remark)}</td></tr>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>بطاقة حضور ${esc(sheet.dateAr)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: 'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', 'DejaVu Sans', sans-serif; color: #000; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; }
  .org { font-size: 13px; line-height: 1.5; } .org b { display: block; }
  .title { text-align: center; font-weight: bold; font-size: 20px; line-height: 1.6; }
  .logo { width: 130px; height: 80px; object-fit: contain; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; table-layout: fixed; }
  th, td { border: 1.5px solid #000; text-align: center; font-size: 15px; height: 46px; }
  th { font-size: 16px; height: 34px; }
  col.n { width: 3%; } col.m { width: 7%; } col.nm { width: 12%; } col.rem { width: 22%; }
  td.b { font-weight: bold; } td.name { text-align: center; }
  td.na { color: #777; } td.rem { font-size: 12px; padding: 0 4px; }
  tr.on_leave td.rem { font-weight: bold; }
  footer { display: flex; justify-content: space-between; margin-top: 18px; font-size: 13px; }
</style></head><body>
<header>
  <div class="org">${org.map((l, i) => (i === org.length - 1 ? `<b>${esc(l)}</b>` : `<div>${esc(l)}</div>`)).join('')}</div>
  <div class="title">بطاقة حضور<br>التاريخ: ${esc(sheet.dateAr)}</div>
  <div>${logoSrc ? `<img class="logo" src="${esc(logoSrc)}" alt="">` : ''}</div>
</header>
<table>
  <colgroup><col class="n"><col class="m"><col class="nm">${'<col>'.repeat(pairs * 2)}<col class="rem"></colgroup>
  <thead><tr><th>ع/ر</th><th>الرقم الآلي</th><th>الإسم و اللقب</th>${head}<th>ملاحظات</th></tr></thead>
  <tbody>${body}</tbody>
</table>
<footer><span>${esc(sheet.schedule.label)}${sheet.summary ? ` — الحاضرون: ${sheet.summary.present} / ${sheet.summary.total}، في عطلة: ${sheet.summary.onLeave}، غياب غير مبرر: ${sheet.summary.absentUnjustified}` : ''}</span>
<span>إمضاء رئيس القسم: ....................</span></footer>
</body></html>`;
}
