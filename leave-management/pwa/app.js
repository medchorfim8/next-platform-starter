// تطبيقة «عطلي»: تسجيل دخول برمز يصل إلى البريد، رصيد العون وعطله، طلب عطلة، موافقات الرؤساء والموارد البشرية.
// الحماية الحقيقية على الخادم (Supabase: Row Level Security + إجراءات) — الواجهة لا تقرّر شيئاً بنفسها.
(() => {
const CFG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(Number(n || 0) * 10) / 10).toString().replace('.', ',');
const dmy = (s) => s.split('-').reverse().join('/');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const YEAR = new Date().getFullYear();

const TYPES = {
  ANNUAL: 'عطلة سنوية للاستراحة', EXCEPTIONAL: 'عطلة استثنائية', SICK: 'عطلة مرض عادي', UNPAID: 'عطلة بدون أجر',
  MATERNITY: 'عطلة الأمومة', PRENATAL: 'عطلة ما قبل الولادة', POSTNATAL: 'عطلة ما بعد الولادة', PATERNITY: 'عطلة الأبوة',
};
const REASONS = { 'زواج العون': 3, 'زواج أحد الأبناء': 1, 'وفاة قريب من الدرجة الأولى': 3, 'وفاة قريب آخر': 1, 'اجتياز امتحان': 2, 'سبب آخر': 1 };
const STATUS = { PENDING_MANAGER: 'عند الرئيس المباشر', PENDING_HR: 'عند الموارد البشرية', APPROVED: 'مقبولة', REJECTED: 'مرفوضة', RETURNED: 'مُرجعة للتعديل', CANCELLED: 'ملغاة' };
const ROLE = { agent: 'عون', manager: 'رئيس مباشر', hr: 'موارد بشرية' };

function countDays(type, a, b, holidays) {
  if (!a || !b || b < a) return 0;
  const A = Date.parse(a + 'T00:00:00Z'), B = Date.parse(b + 'T00:00:00Z');
  if (type !== 'EXCEPTIONAL') return Math.round((B - A) / 864e5) + 1;
  const off = new Set(holidays.map((h) => h.day)); let n = 0;
  for (let t = A; t <= B; t += 864e5) { const d = new Date(t), w = d.getUTCDay(); if (w !== 0 && w !== 6 && !off.has(d.toISOString().slice(0, 10))) n++; }
  return n;
}

// ===== طبقة المعطيات: Supabase أو وضع تجريبي =====
function supabaseApi() {
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    async session() { return (await sb.auth.getSession()).data.session?.user?.email || null; },
    async sendCode(email) { ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
    async verify(email, token) { ok(await sb.auth.verifyOtp({ email, token, type: 'email' })); },
    async logout() { await sb.auth.signOut(); },
    async me(email) { return (ok(await sb.from('employees').select('*').ilike('email', email)) || [])[0] || null; },
    async balance(m, y) { return (ok(await sb.rpc('balance_of', { p_matricule: m, p_year: y })) || [])[0] || null; },
    async leaves(m) { let q = sb.from('leaves').select('*').order('start_date', { ascending: false }); if (m) q = q.eq('matricule', m); return ok(await q); },
    async pending() { return ok(await sb.from('leaves').select('*').in('status', ['PENDING_MANAGER', 'PENDING_HR']).order('start_date')); },
    async holidays() { return ok(await sb.from('holidays').select('*')); },
    async request(f) { ok(await sb.rpc('request_leave', { p_type: f.type, p_start: f.start, p_end: f.end, p_reason: f.reason, p_title_year: f.titleYear, p_address: f.address, p_interim: f.interim, p_note: f.note })); },
    async cancel(id) { ok(await sb.rpc('cancel_my_leave', { p_id: id })); },
    async decide(id, action, comment) { return ok(await sb.rpc('decide_leave', { p_id: id, p_action: action, p_comment: comment || null })); },
    async employees() { return ok(await sb.from('employees').select('*').order('sort')); },
    async balances(y) { return ok(await sb.from('balances').select('*').eq('year', y)); },
    async saveBalance(m, y, entitled, carried) { ok(await sb.from('balances').upsert({ matricule: m, year: y, entitled, carried })); },
    async addEmployee(e) { ok(await sb.from('employees').insert(e)); ok(await sb.from('balances').upsert({ matricule: e.matricule, year: YEAR, entitled: 30, carried: 0 })); },
    async updateEmployee(m, patch) { ok(await sb.from('employees').update(patch).eq('matricule', m)); },
  };
}

function demoApi() {
  const KEY = 'demo-conges-v1';
  const seed = () => ({
    employees: [
      { matricule: 'RH-001', name: 'الموارد البشرية', email: 'rh@demo.tn', role: 'hr', sort: 0 },
      { matricule: '65650', name: 'أميمة التركي', email: 'chef@demo.tn', role: 'manager', sort: 3 },
      { matricule: '61452', name: 'إيناس زقر', email: 'inas@demo.tn', role: 'agent', sort: 1, grade: 'متصرف' },
      { matricule: '63541', name: 'فوزي جاري', email: 'fawzi@demo.tn', role: 'agent', sort: 2 },
    ],
    balances: [{ matricule: '61452', year: YEAR, entitled: 30, carried: 6 }, { matricule: '63541', year: YEAR, entitled: 30, carried: 0 }, { matricule: '65650', year: YEAR, entitled: 30, carried: 2 }],
    leaves: [
      { id: 'd1', matricule: '61452', type: 'ANNUAL', start_date: `${YEAR}-08-03`, end_date: `${YEAR}-08-12`, days: 10, status: 'APPROVED', log: [] },
      { id: 'd2', matricule: '63541', type: 'EXCEPTIONAL', reason: 'اجتياز امتحان', start_date: `${YEAR}-11-03`, end_date: `${YEAR}-11-04`, days: 2, status: 'PENDING_MANAGER', log: [] },
    ],
    holidays: [{ day: `${YEAR}-12-17`, label: 'عيد الثورة' }],
    session: null,
  });
  let db; try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const me = () => db.employees.find((e) => e.email === db.session);
  const bal = (m, y) => {
    const b = db.balances.find((x) => x.matricule === m && x.year === y) || { entitled: 30, carried: 0 };
    const a = db.leaves.filter((l) => l.matricule === m && l.type === 'ANNUAL' && l.start_date.startsWith(String(y)));
    const used = a.filter((l) => l.status === 'APPROVED').reduce((s, l) => s + l.days, 0);
    const pending = a.filter((l) => l.status.startsWith('PENDING')).reduce((s, l) => s + l.days, 0);
    return { entitled: b.entitled, carried: b.carried, used, pending, remaining: b.entitled + b.carried - used - pending };
  };
  return {
    demo: true,
    async session() { return db.session; },
    async sendCode(email) { if (!db.employees.some((e) => e.email === email)) throw new Error('هذا البريد غير مسجّل في الوضع التجريبي'); },
    async verify(email) { db.session = email; save(); },
    async logout() { db.session = null; save(); },
    async me() { return me() || null; },
    async balance(m, y) { return bal(m, y); },
    async leaves(m) { return db.leaves.filter((l) => !m || l.matricule === m).sort((a, b) => b.start_date.localeCompare(a.start_date)); },
    async pending() { return db.leaves.filter((l) => l.status.startsWith('PENDING')); },
    async holidays() { return db.holidays; },
    async request(f) {
      const u = me(), days = countDays(f.type, f.start, f.end, db.holidays);
      if (db.leaves.some((l) => l.matricule === u.matricule && ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED'].includes(l.status) && l.start_date <= f.end && l.end_date >= f.start)) throw new Error('تتداخل هذه الفترة مع عطلة أخرى مسجلة');
      if (f.type === 'ANNUAL' && bal(u.matricule, +f.start.slice(0, 4)).remaining < days) throw new Error('الرصيد غير كافٍ');
      db.leaves.push({ id: 'd' + Date.now(), matricule: u.matricule, type: f.type, start_date: f.start, end_date: f.end, days, reason: f.reason, title_year: f.titleYear, address: f.address, interim: f.interim, note: f.note, status: ['SICK', 'PRENATAL', 'MATERNITY', 'PATERNITY'].includes(f.type) ? 'PENDING_HR' : 'PENDING_MANAGER', log: [] });
      save();
    },
    async cancel(id) { const l = db.leaves.find((x) => x.id === id); l.status = 'CANCELLED'; save(); },
    async decide(id, action, comment) {
      const l = db.leaves.find((x) => x.id === id), r = me().role;
      if (action !== 'approve' && !comment) throw new Error('التعليل إجباري');
      let n = null;
      if (l.status === 'PENDING_MANAGER' && r !== 'agent') n = { approve: 'PENDING_HR', reject: 'REJECTED', return: 'RETURNED' }[action];
      else if (l.status === 'PENDING_HR' && r === 'hr') n = { approve: 'APPROVED', reject: 'REJECTED', return: 'RETURNED' }[action];
      if (!n) throw new Error('ليست لديك صلاحية هذا القرار في هذه المرحلة');
      l.status = n; l.comment = comment; save(); return n;
    },
    async employees() { return [...db.employees].sort((a, b) => a.sort - b.sort); },
    async balances(y) { return db.balances.filter((b) => b.year === y); },
    async saveBalance(m, y, entitled, carried) { const b = db.balances.find((x) => x.matricule === m && x.year === y); if (b) Object.assign(b, { entitled, carried }); else db.balances.push({ matricule: m, year: y, entitled, carried }); save(); },
    async addEmployee(e) { db.employees.push({ ...e, sort: 99 }); db.balances.push({ matricule: e.matricule, year: YEAR, entitled: 30, carried: 0 }); save(); },
    async updateEmployee(m, patch) { Object.assign(db.employees.find((e) => e.matricule === m), patch); save(); },
  };
}

const API = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase ? supabaseApi() : demoApi();
const S = { me: null, holidays: [], myLeaves: [], balance: null };

// ===== أدوات الواجهة =====
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
async function run(btn, fn) { const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '…'; } try { return await fn(); } catch (e) { toast(e.message || 'حدث خطأ، أعد المحاولة'); throw e; } finally { if (btn) { btn.disabled = false; btn.textContent = old; } } }
const show = (id) => ['vLogin', 'vApp'].forEach((v) => ($(v).hidden = v !== id));
function go(page) {
  ['pMine', 'pApprovals', 'pStaff'].forEach((p) => ($(p).hidden = p !== page));
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.p === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (page === 'pApprovals') loadApprovals();
  if (page === 'pStaff') loadStaff();
  window.scrollTo(0, 0);
}

// ===== تسجيل الدخول =====
let pendingEmail = '';
$('unitName').textContent = CFG.UNIT || '';
$('demoBox').hidden = !API.demo;
$('sendCode').onclick = () => {
  const email = $('email').value.trim().toLowerCase();
  $('loginErr').textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('loginErr').textContent = 'أدخل بريداً إلكترونياً صحيحاً.'; return; }
  run($('sendCode'), async () => { await API.sendCode(email); pendingEmail = email; $('sentTo').textContent = email; $('stepEmail').hidden = true; $('stepCode').hidden = false; $('code').focus(); })
    .catch((e) => ($('loginErr').textContent = e.message));
};
$('back').onclick = () => { $('stepCode').hidden = true; $('stepEmail').hidden = false; };
$('verify').onclick = () => {
  const token = $('code').value.replace(/\D/g, '');
  if (token.length !== 6 && !API.demo) { $('codeErr').textContent = 'الرمز مكوّن من 6 أرقام.'; return; }
  run($('verify'), async () => { await API.verify(pendingEmail, token); await start(); }).catch((e) => ($('codeErr').textContent = 'رمز غير صحيح أو منتهي الصلاحية. ' + e.message));
};
$('code').addEventListener('input', () => { if ($('code').value.replace(/\D/g, '').length === 6) $('verify').click(); });
document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = async () => { await API.verify(b.dataset.demo); await start(); }));
$('logout').onclick = async () => { await API.logout(); location.reload(); };

// ===== الصفحة الرئيسية للعون =====
async function loadMine() {
  const m = S.me.matricule;
  const [bal, leaves] = await Promise.all([API.balance(m, YEAR), API.leaves(m)]);
  S.balance = bal; S.myLeaves = leaves;
  $('yearLbl').textContent = YEAR;
  $('remaining').textContent = bal ? fmt(bal.remaining) : '—';
  $('balDetail').textContent = bal ? `${fmt(bal.entitled)} مستحق + ${fmt(bal.carried)} مرحّل من السنة الماضية` : '';
  $('stUsed').textContent = bal ? fmt(bal.used) : '—';
  $('stPending').textContent = bal ? fmt(bal.pending) : '—';
  $('stSick').textContent = fmt(leaves.filter((l) => l.type === 'SICK' && l.status === 'APPROVED' && l.start_date.startsWith(String(YEAR))).reduce((s, l) => s + Number(l.days), 0));
  $('myList').innerHTML = leaves.length ? leaves.map((l) => `<div class="item">
      <div class="t"><span>${esc(TYPES[l.type])}</span><span class="pill p-${l.status}">${STATUS[l.status]}</span></div>
      <div class="d">من ${dmy(l.start_date)} إلى ${dmy(l.end_date)} — ${fmt(l.days)} ${Number(l.days) <= 10 ? 'أيام' : 'يوماً'}${l.reason ? ` — ${esc(l.reason)}` : ''}</div>
      ${l.comment ? `<div class="d">التعليل: ${esc(l.comment)}</div>` : ''}
      ${['PENDING_MANAGER', 'PENDING_HR', 'RETURNED'].includes(l.status) ? `<div class="actions"><button class="btn sm bad" data-cancel="${l.id}">سحب الطلب</button></div>` : ''}
    </div>`).join('') : '<div class="empty">لا توجد عطل مسجلة بعد.</div>';
}
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-cancel]'); if (!c) return;
  run(c, async () => { await API.cancel(c.dataset.cancel); toast('سُحب الطلب.'); await loadMine(); });
});

// ===== طلب عطلة =====
$('fType').innerHTML = Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('fReason').innerHTML = Object.entries(REASONS).map(([k, d]) => `<option value="${esc(k)}" data-max="${d}">${esc(k)} (${d} ${d === 1 ? 'يوم' : 'أيام'})</option>`).join('');
$('fYear').innerHTML = [YEAR, YEAR - 1].map((y) => `<option>${y}</option>`).join('');
const readForm = () => ({ type: $('fType').value, start: $('fStart').value, end: $('fEnd').value, reason: $('fType').value === 'EXCEPTIONAL' ? $('fReason').value : null, titleYear: $('fType').value === 'ANNUAL' ? +$('fYear').value : null, address: $('fAddress').value.trim() || null, interim: $('fInterim').value.trim() || null, note: $('fNote').value.trim() || null });
function preview() {
  const f = readForm();
  $('fReasonW').hidden = f.type !== 'EXCEPTIONAL'; $('fYearW').hidden = f.type !== 'ANNUAL';
  $('fErr').textContent = '';
  if (!f.start || !f.end) { $('fPreview').textContent = 'اختر التاريخين لعرض عدد الأيام.'; return f; }
  if (f.end < f.start) { $('fPreview').textContent = 'تاريخ النهاية قبل تاريخ البداية.'; return f; }
  const days = countDays(f.type, f.start, f.end, S.holidays);
  let txt = `${fmt(days)} ${days <= 10 ? 'أيام' : 'يوماً'} ${f.type === 'EXCEPTIONAL' ? '(أيام عمل)' : ''}`;
  if (f.type === 'ANNUAL' && S.balance) { const after = S.balance.remaining - days; txt += ` — يبقى لك بعد الطلب ${fmt(after)} يوماً`; if (after < 0) $('fErr').textContent = 'الرصيد غير كافٍ لهذا الطلب.'; }
  if (f.type === 'EXCEPTIONAL') { const max = +$('fReason').selectedOptions[0].dataset.max; if (days > max) $('fErr').textContent = `المدة المسموح بها لهذا السبب ${max} ${max === 1 ? 'يوم' : 'أيام'}.`; }
  $('fPreview').textContent = txt;
  return f;
}
['fType', 'fStart', 'fEnd', 'fReason', 'fYear'].forEach((id) => $(id).addEventListener('input', preview));
$('fStart').addEventListener('change', () => { if (!$('fEnd').value || $('fEnd').value < $('fStart').value) $('fEnd').value = $('fStart').value; preview(); });
$('newLeave').onclick = () => { $('leaveForm').reset(); $('fStart').min = today(); preview(); $('sheet').hidden = false; };
$('fCancel').onclick = () => ($('sheet').hidden = true);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; });
$('leaveForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = preview();
  if ($('fErr').textContent || !f.start || !f.end || f.end < f.start) return;
  run($('fSubmit'), async () => { await API.request(f); $('sheet').hidden = true; toast('أُرسل طلبك إلى الرئيس المباشر.'); await loadMine(); })
    .catch((e) => ($('fErr').textContent = e.message));
});

// ===== الموافقات =====
async function loadApprovals() {
  const [list, emps] = await Promise.all([API.pending(), API.employees()]);
  const name = (m) => emps.find((e) => e.matricule === m)?.name || m;
  const mine = list.filter((l) => S.me.role === 'hr' || l.status === 'PENDING_MANAGER');
  $('apCount').textContent = mine.length ? `(${mine.length})` : '';
  const bals = {};
  for (const l of mine.filter((x) => x.type === 'ANNUAL')) bals[l.matricule] ||= await API.balance(l.matricule, +l.start_date.slice(0, 4));
  $('apList').innerHTML = mine.length ? mine.map((l) => `<div class="item">
      <div class="t"><span>${esc(name(l.matricule))}</span><span class="pill p-${l.status}">${STATUS[l.status]}</span></div>
      <div class="d">${esc(TYPES[l.type])}${l.reason ? ` (${esc(l.reason)})` : ''} — من ${dmy(l.start_date)} إلى ${dmy(l.end_date)} — ${fmt(l.days)} أيام</div>
      ${bals[l.matricule] ? `<div class="d">رصيده الحالي: ${fmt(bals[l.matricule].remaining)} يوماً (محسوب معه هذا الطلب)</div>` : ''}
      ${l.note ? `<div class="d">ملاحظة: ${esc(l.note)}</div>` : ''}
      <input id="c_${l.id}" placeholder="التعليل (إجباري عند الرفض أو الإرجاع)">
      <div class="actions"><button class="btn sm ok" data-dec="approve" data-id="${l.id}">${l.status === 'PENDING_MANAGER' ? 'موافقة' : 'مصادقة نهائية'}</button>
        <button class="btn sm ghost" data-dec="return" data-id="${l.id}">إرجاع</button><button class="btn sm bad" data-dec="reject" data-id="${l.id}">رفض</button></div>
    </div>`).join('') : '<div class="empty">لا توجد طلبات في انتظار قرارك.</div>';
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-dec]'); if (!b) return;
  const comment = $(`c_${b.dataset.id}`)?.value.trim();
  if (b.dataset.dec !== 'approve' && !comment) { toast('اكتب التعليل أولاً.'); $(`c_${b.dataset.id}`)?.focus(); return; }
  run(b, async () => { const n = await API.decide(b.dataset.id, b.dataset.dec, comment); toast(n === 'APPROVED' ? 'صودق على العطلة.' : 'سُجّل القرار.'); await loadApprovals(); });
});

// ===== الأعوان والأرصدة (الموارد البشرية) =====
async function loadStaff() {
  $('yearLbl2').textContent = YEAR;
  const [emps, bals] = await Promise.all([API.employees(), API.balances(YEAR)]);
  $('empList').innerHTML = emps.map((e) => {
    const b = bals.find((x) => x.matricule === e.matricule) || { entitled: 30, carried: 0 };
    return `<div class="item">
      <div class="t"><span>${esc(e.name)} <span class="d">· ${esc(e.matricule)}</span></span><span class="pill p-RETURNED">${ROLE[e.role]}</span></div>
      <div class="d">${e.email ? esc(e.email) : '<span class="err">لا يوجد بريد: لا يستطيع الدخول</span>'}</div>
      <div class="two"><label>المستحق<input type="number" step="0.5" min="0" value="${b.entitled}" id="be_${esc(e.matricule)}"></label><label>المرحّل<input type="number" step="0.5" min="0" max="30" value="${b.carried}" id="bc_${esc(e.matricule)}"></label></div>
      <div class="actions"><button class="btn sm navy" data-bal="${esc(e.matricule)}">حفظ الرصيد</button><button class="btn sm ghost" data-mail="${esc(e.matricule)}">تعديل البريد</button></div>
    </div>`;
  }).join('');
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-bal]');
  if (b) { const m = b.dataset.bal; run(b, async () => { await API.saveBalance(m, YEAR, +$(`be_${m}`).value, Math.min(30, +$(`bc_${m}`).value)); toast('حُفظ الرصيد.'); }); }
  const e = ev.target.closest('[data-mail]');
  if (e) { const m = e.dataset.mail, email = window.prompt('البريد الإلكتروني للعون'); if (email) run(e, async () => { await API.updateEmployee(m, { email: email.trim().toLowerCase() }); toast('حُفظ البريد.'); await loadStaff(); }); }
});
$('empForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const e = { matricule: $('eMat').value.trim(), name: $('eName').value.trim(), grade: $('eGrade').value.trim() || null, email: $('eEmail').value.trim().toLowerCase(), role: $('eRole').value };
  run(ev.submitter, async () => { await API.addEmployee(e); toast('أُضيف العون. يمكنه الآن الدخول ببريده.'); ev.target.reset(); await loadStaff(); });
});

$('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-p]'); if (b) go(b.dataset.p); });

// ===== التثبيت على الهاتف =====
let installEvt = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!standalone) $('installBox').hidden = false; });
$('installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBox').hidden = true; }
  else toast('على آيفون: اضغط زرّ المشاركة ثم «إضافة إلى الشاشة الرئيسية».');
};
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) { $('installBox').hidden = false; $('installText').textContent = 'لتثبيتها: زرّ المشاركة ← «إضافة إلى الشاشة الرئيسية».'; }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ===== البدء =====
async function start() {
  const email = await API.session();
  if (!email) { show('vLogin'); return; }
  try {
    S.me = await API.me(email);
    if (!S.me) { show('vLogin'); $('stepEmail').hidden = false; $('stepCode').hidden = true; $('loginErr').textContent = 'هذا البريد غير مسجّل لدى الموارد البشرية. اتصل بهم لإضافته.'; await API.logout(); return; }
    S.holidays = await API.holidays();
    show('vApp');
    $('hello').textContent = `مرحباً ${S.me.name.split(' ')[0]}`;
    $('who').textContent = `${S.me.matricule} · ${ROLE[S.me.role]}${API.demo ? ' · وضع تجريبي' : ''}`;
    const staff = S.me.role !== 'agent';
    document.querySelector('[data-p="pApprovals"]').hidden = !staff;
    document.querySelector('[data-p="pStaff"]').hidden = S.me.role !== 'hr';
    $('nav').hidden = !staff;
    go('pMine');
    await loadMine();
    if (staff) loadApprovals();
  } catch (e) { toast(e.message); }
}
start();
})();
