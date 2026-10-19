// قواعد العطل لأعوان البريد التونسي.
// كل القيم قابلة للتعديل من واجهة الإدارة (جدول leave_types) — القيم هنا هي الإعدادات الافتراضية.
// المرجع: النظام الأساسي الخاص بأعوان البريد التونسي، والقانون عدد 44 لسنة 2024 (عطل الأمومة والأبوة — ينطبق على القطاع العام).
// القيم المعلّمة VERIFY تُطابَق مع فصول النظام الأساسي للبريد من قبل الإدارة المركزية للموارد البشرية قبل الإنتاج.

export const PAY = { FULL: 'FULL', HALF: 'HALF', NONE: 'NONE' };

export const LEAVE_TYPES = {
  ANNUAL: {
    label: 'عطلة سنوية للاستراحة (خالصة الأجر)',
    pay: PAY.FULL,
    accrual: { perYear: 30, perMonthProrata: 2.5 }, // VERIFY حسب النظام الأساسي للبريد: الاستحقاق السنوي وما يقابله شهرياً
    countMode: 'CALENDAR', // VERIFY: أيام تقويمية أم أيام عمل حسب النظام الأساسي للبريد
    carryOver: { maxDays: 30, expiresMonths: 12 }, // VERIFY: تأجيل رصيد سنة واحدة على الأكثر
    minNoticeDays: 15,
    needsDocument: false,
  },
  SICK: {
    label: 'عطلة مرض عادي',
    pay: PAY.FULL,
    // 12 شهراً على فترة 365 يوماً: شهران بكامل الأجر ثم بنصف الأجر — VERIFY توزيع الأشهر
    tiers: [{ days: 60, pay: PAY.FULL }, { days: 305, pay: PAY.HALF }],
    medicalCommitteeAboveDays: 30, // ما يتجاوز 30 يوماً في السنة يتطلب رأي اللجنة الطبية
    countMode: 'CALENDAR',
    retroactiveDays: 2, // تقديم الشهادة الطبية في أجل 48 ساعة
    needsDocument: true,
  },
  PRENATAL: { label: 'عطلة ما قبل الولادة', pay: PAY.FULL, maxDays: 15, countMode: 'CALENDAR', needsDocument: true, gender: 'F' },
  MATERNITY: {
    label: 'عطلة الأمومة (الولادة)',
    pay: PAY.FULL,
    maxDays: 90, // 3 أشهر؛ 120 يوماً للتوأم أو الخديج بتقرير طبي (القانون 44-2024)
    extendedMaxDays: 120,
    countMode: 'CALENDAR', needsDocument: true, gender: 'F',
  },
  POSTNATAL: { label: 'عطلة ما بعد الولادة (اختيارية)', pay: PAY.HALF, minDays: 30, maxDays: 120, countMode: 'CALENDAR', needsDocument: true, gender: 'F' },
  PATERNITY: { label: 'عطلة الأبوة', pay: PAY.FULL, maxDays: 7, countMode: 'CALENDAR', needsDocument: true, gender: 'M' }, // VERIFY المدة
  EXCEPTIONAL: {
    label: 'عطلة استثنائية (خالصة الأجر)',
    pay: PAY.FULL,
    maxDaysPerYear: 6, // VERIFY السقف السنوي
    reasons: { MARRIAGE: 3, CHILD_MARRIAGE: 1, DEATH_CLOSE: 3, DEATH_OTHER: 1, EXAM: 2, OTHER: 1 }, // VERIFY
    countMode: 'WORKING', needsDocument: true,
  },
  UNPAID: {
    label: 'عطلة بدون أجر',
    pay: PAY.NONE,
    maxDaysPerYear: 90, // VERIFY: يحدّد بقرار من رئيس الإدارة
    countMode: 'CALENDAR', needsDocument: false, payrollDeduction: true,
  },
};

const DAY = 86400000;
const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);

/** عدد الأيام المحتسبة بين تاريخين (شاملين) حسب نمط الاحتساب، مع استثناء العطل الرسمية في نمط WORKING. */
export function countDays(start, end, mode = 'CALENDAR', { holidays = [], weekend = [0, 6] } = {}) {
  const a = toDate(start), b = toDate(end);
  if (b < a) throw new Error('تاريخ النهاية قبل تاريخ البداية');
  if (mode === 'CALENDAR') return Math.round((b - a) / DAY) + 1;
  const off = new Set(holidays);
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY) {
    const d = new Date(t);
    if (!weekend.includes(d.getUTCDay()) && !off.has(iso(d))) n++;
  }
  return n;
}

/**
 * استحقاق العطلة السنوية لسنة مدنية. لا يُعتمد تاريخ الانتداب: الاستحقاق كامل افتراضياً، ويُدخل عون
 * الموارد البشرية عدد أشهر العمل الفعلي عند الاقتضاء (التحاق خلال السنة) ومدد عدم المباشرة.
 */
export function annualEntitlement({ monthsWorked = 12, suspendedMonths = 0 } = {}) {
  const r = LEAVE_TYPES.ANNUAL.accrual;
  const months = Math.max(0, Math.min(12, monthsWorked) - suspendedMonths);
  return months === 12 ? r.perYear : Math.round(months * r.perMonthProrata * 2) / 2;
}

/** ترحيل الرصيد السنوي المتبقي إلى السنة الموالية مع تطبيق السقف. */
export function carryOver(remaining) {
  const max = LEAVE_TYPES.ANNUAL.carryOver.maxDays;
  return { carried: Math.min(Math.max(remaining, 0), max), forfeited: Math.max(remaining - max, 0) };
}

/** تقسيم أيام عطلة مرض حسب شرائح الأجر بالنظر إلى الأيام المستهلكة سابقاً في الفترة المرجعية (365 يوماً). */
export function sickPaySplit(requestedDays, alreadyUsedDays) {
  const out = { FULL: 0, HALF: 0, EXCEEDED: 0 };
  let used = alreadyUsedDays, left = requestedDays;
  let floor = 0;
  for (const tier of LEAVE_TYPES.SICK.tiers) {
    const cap = floor + tier.days;
    const take = Math.max(0, Math.min(left, cap - used));
    out[tier.pay] += take; used += take; left -= take; floor = cap;
  }
  out.EXCEEDED = left;
  return out;
}

/** خصم الأجر (القاعدة الثلاثينية: الأجر اليومي = الأجر الشهري / 30). */
export function payrollDeduction(monthlyGross, { noneDays = 0, halfDays = 0 }) {
  const daily = monthlyGross / 30;
  return Math.round((noneDays * daily + halfDays * daily / 2) * 1000) / 1000; // بالدينار مع 3 أرقام (مليم)
}

/** يقسم فترة عطلة على الأشهر لإرسالها إلى منظومة الأجور شهرياً. */
export function splitByMonth(start, end) {
  const res = {};
  for (let t = toDate(start).getTime(); t <= toDate(end).getTime(); t += DAY) {
    const k = iso(new Date(t)).slice(0, 7);
    res[k] = (res[k] || 0) + 1;
  }
  return res;
}

/** التحقق من طلب عطلة قبل إرساله. يعيد قائمة أخطاء (فارغة = صالح). */
export function validateRequest(req, ctx) {
  const t = LEAVE_TYPES[req.type];
  const errors = [];
  if (!t) return ['نوع عطلة غير معروف'];
  const days = countDays(req.start, req.end, t.countMode, ctx);
  if (t.gender && ctx.employee.gender !== t.gender) errors.push('نوع العطلة لا ينطبق على العون');
  if (t.needsDocument && !req.documentId) errors.push('يجب إرفاق وثيقة مثبتة');
  if (ctx.overlaps) errors.push('تتداخل الفترة مع عطلة أخرى مسجلة');
  if (req.type === 'ANNUAL') {
    if (days > ctx.balance.ANNUAL) errors.push(`الرصيد غير كافٍ (${ctx.balance.ANNUAL} يوم متاح)`);
    const notice = Math.round((toDate(req.start) - toDate(ctx.today)) / DAY);
    if (notice < t.minNoticeDays) errors.push(`يجب تقديم الطلب قبل ${t.minNoticeDays} يوماً على الأقل`);
  }
  if (req.type === 'SICK') {
    const back = Math.round((toDate(ctx.today) - toDate(req.start)) / DAY);
    if (back > t.retroactiveDays) errors.push('تجاوز أجل 48 ساعة لإيداع الشهادة الطبية');
  }
  if (req.type === 'MATERNITY') {
    const max = req.extended ? t.extendedMaxDays : t.maxDays;
    if (days > max) errors.push(`المدة القصوى ${max} يوماً`);
  }
  if (['PRENATAL', 'PATERNITY', 'POSTNATAL'].includes(req.type) && days > t.maxDays) errors.push(`المدة القصوى ${t.maxDays} يوماً`);
  if (req.type === 'POSTNATAL' && days < t.minDays) errors.push(`المدة الدنيا ${t.minDays} يوماً`);
  if (['EXCEPTIONAL', 'UNPAID'].includes(req.type) && (ctx.usedThisYear[req.type] || 0) + days > t.maxDaysPerYear)
    errors.push(`تجاوز السقف السنوي (${t.maxDaysPerYear} يوماً)`);
  if (req.type === 'EXCEPTIONAL' && req.reason && days > (t.reasons[req.reason] ?? 0))
    errors.push(`المدة المسموح بها لهذا السبب ${t.reasons[req.reason]} يوم`);
  return errors;
}

/** آلة الحالات لسير العمل: عون → رئيس قسم → الموارد البشرية. */
export const WORKFLOW = {
  DRAFT: { submit: 'PENDING_MANAGER', cancel: 'CANCELLED' },
  PENDING_MANAGER: { approve: 'PENDING_HR', reject: 'REJECTED', return: 'NEEDS_CHANGES', escalate: 'PENDING_HR', cancel: 'CANCELLED' },
  NEEDS_CHANGES: { submit: 'PENDING_MANAGER', cancel: 'CANCELLED' },
  PENDING_HR: { approve: 'APPROVED', reject: 'REJECTED', return: 'NEEDS_CHANGES' },
  APPROVED: { start: 'IN_PROGRESS', cancel: 'CANCELLED', interrupt: 'INTERRUPTED' },
  IN_PROGRESS: { finish: 'COMPLETED', interrupt: 'INTERRUPTED' },
  REJECTED: {}, CANCELLED: {}, COMPLETED: {}, INTERRUPTED: {},
};

export function transition(state, action) {
  const next = WORKFLOW[state]?.[action];
  if (!next) throw new Error(`إجراء غير مسموح: ${action} من الحالة ${state}`);
  return next;
}

/** المهلات: 3 أيام عمل لرئيس القسم ثم تصعيد آلي، 5 أيام للموارد البشرية ثم تنبيه للمدير العام. */
export const SLA = { PENDING_MANAGER: { days: 3, onTimeout: 'escalate' }, PENDING_HR: { days: 5, onTimeout: 'notify_director' } };
