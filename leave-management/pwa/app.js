// تطبيقة «عطلتي»: الدخول بالرقم الميكانوغرافي ورقم سري، رصيد العون وعطله، طلب عطلة، موافقات الرؤساء والموارد البشرية.
// الحماية الحقيقية على الخادم (Supabase: Row Level Security + إجراءات) — الواجهة لا تقرّر شيئاً بنفسها.
(() => {
const CFG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(Number(n || 0) * 10) / 10).toString().replace('.', ',');
const dmy = (s) => s.split('-').reverse().join('/');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const YEAR = new Date().getFullYear();
// معرّف الدخول الداخلي (نفس الدالة login_email في قاعدة البيانات)
const loginEmail = (m) => String(m).replace(/[^A-Za-z0-9-]/g, '').toLowerCase() + '@otlati.local';
const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');

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

// ===== الرصيد: 3 سنوات × 30 يوماً، الخصم من الأقدم، وسقوط السنة الخارجة من النافذة =====
// (نفس منطق الدالة annual_buckets في قاعدة البيانات؛ الخادم هو الذي يفرض القاعدة عند تسجيل الطلب)
const ACTIVE = ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED'];
function annualBuckets(leaves, rows, Y) {
  const open = (y) => { const r = rows.find((b) => +b.year === y); return r ? Number(r.opening) : 30; };
  const ann = leaves.filter((l) => l.type === 'ANNUAL' && ACTIVE.includes(l.status) && +l.start_date.slice(0, 4) <= Y)
    .sort((a, b) => (a.start_date + (a.created_at || '')).localeCompare(b.start_date + (b.created_at || '')));
  const used = {}, alloc = {};
  for (const l of ann) {
    const k = +l.start_date.slice(0, 4); let need = Number(l.days); alloc[l.id] = [];
    for (let y = k - 2; y <= k && need > 0; y++) {
      const t = Math.min(need, Math.max(open(y) - (used[y] || 0), 0));
      if (t > 0) { used[y] = (used[y] || 0) + t; need -= t; alloc[l.id].push({ year: y, days: t }); }
    }
    if (need > 0) { used[k] = (used[k] || 0) + need; alloc[l.id].push({ year: k, days: need }); }
  }
  const buckets = [Y - 2, Y - 1, Y].map((y) => ({ year: y, opening: open(y), used: used[y] || 0, remaining: open(y) - (used[y] || 0) }));
  const pending = ann.filter((l) => l.status !== 'APPROVED' && +l.start_date.slice(0, 4) >= Y - 2).reduce((s, l) => s + Number(l.days), 0);
  return { buckets, remaining: buckets.reduce((s, b) => s + b.remaining, 0), pending, alloc };
}
const allocText = (a) => (a || []).map((x) => `${x.year} (${fmt(x.days)})`).join(' + ');

// ===== طبقة المعطيات: Supabase أو وضع تجريبي =====
function supabaseApi() {
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    demo: false,
    async session() { return !!(await sb.auth.getSession()).data.session; },
    async login(m, pin) {
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(m), password: pin });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'الرقم الميكانوغرافي أو الرقم السري غير صحيح.' : error.message);
    },
    async mustChange() { return !!(await sb.auth.getUser()).data.user?.user_metadata?.must_change; },
    async changePin(pin) {
      const { error } = await sb.auth.updateUser({ password: pin, data: { must_change: false } });
      if (error) throw new Error(/different/i.test(error.message) ? 'اختر رقماً مختلفاً عن الرقم الحالي.' : error.message);
    },
    async setPin(m, pin) { ok(await sb.rpc('set_pin', { p_matricule: m, p_pin: pin })); },
    async logout() { await sb.auth.signOut(); },
    async me() { const m = ok(await sb.rpc('my_matricule')); return m ? (ok(await sb.from('employees').select('*').eq('matricule', m)) || [])[0] || null : null; },
    async balanceRows(m) { return ok(await sb.from('balances').select('*').eq('matricule', m)); },
    async leaves(m) { let q = sb.from('leaves').select('*').order('start_date', { ascending: false }); if (m) q = q.eq('matricule', m); return ok(await q); },
    async pending() { return ok(await sb.from('leaves').select('*').in('status', ['PENDING_MANAGER', 'PENDING_HR']).order('start_date')); },
    async holidays() { return ok(await sb.from('holidays').select('*')); },
    async request(f) { ok(await sb.rpc('request_leave', { p_type: f.type, p_start: f.start, p_end: f.end, p_reason: f.reason, p_title_year: f.titleYear, p_address: f.address, p_interim: f.interim, p_note: f.note })); },
    async cancel(id) { ok(await sb.rpc('cancel_my_leave', { p_id: id })); },
    async decide(id, action, comment) { return ok(await sb.rpc('decide_leave', { p_id: id, p_action: action, p_comment: comment || null })); },
    async employees() { return ok(await sb.from('employees').select('*').order('sort')); },
    async allBalances() { return ok(await sb.from('balances').select('*')); },
    async saveBalance(m, y, opening) { ok(await sb.from('balances').upsert({ matricule: m, year: y, opening })); },
    async addEmployee(e) { ok(await sb.from('employees').insert(e)); },
    async updateEmployee(m, patch) { ok(await sb.from('employees').update(patch).eq('matricule', m)); },
  };
}

function demoApi() {
  const KEY = 'demo-conges-v6';
  const seed = () => ({
    employees: [
      { matricule: 'RH-001', name: 'الموارد البشرية', email: 'rh@demo.tn', role: 'hr', sort: 0 },
      { matricule: '10001', name: 'سلمى بن علي', email: 'chef@demo.tn', role: 'manager', sort: 1, grade: 'متصرّف رئيس' },
      { matricule: '10002', name: 'كريم الهمامي', email: 'agent@demo.tn', role: 'agent', sort: 2, grade: 'متصرّف' },
      { matricule: '10003', name: 'ريم الشابي', email: 'reem@demo.tn', role: 'agent', sort: 3, grade: 'متصرّف رئيس' },
    ],
    balances: [{ matricule: '10002', year: YEAR - 2, opening: 12 }, { matricule: '10001', year: YEAR - 2, opening: 5 }, { matricule: '10003', year: YEAR - 2, opening: 0 }],
    leaves: [
      { id: 'd1', matricule: '10002', type: 'ANNUAL', start_date: `${YEAR}-08-03`, end_date: `${YEAR}-08-12`, days: 10, status: 'APPROVED', log: [] },
      { id: 'd3', matricule: '10002', type: 'SICK', start_date: `${YEAR}-03-02`, end_date: `${YEAR}-03-04`, days: 3, status: 'APPROVED', log: [] },
      { id: 'd4', matricule: '10001', type: 'ANNUAL', start_date: `${YEAR}-07-20`, end_date: `${YEAR}-07-31`, days: 12, status: 'APPROVED', title_year: YEAR, log: [] },
      { id: 'd5', matricule: 'RH-001', type: 'EXCEPTIONAL', reason: 'زواج أحد الأبناء', start_date: `${YEAR}-05-15`, end_date: `${YEAR}-05-15`, days: 1, status: 'APPROVED', log: [] },
      { id: 'd2', matricule: '10003', type: 'EXCEPTIONAL', reason: 'اجتياز امتحان', start_date: `${YEAR}-11-03`, end_date: `${YEAR}-11-04`, days: 2, status: 'PENDING_MANAGER', log: [] },
    ],
    holidays: [{ day: `${YEAR}-12-17`, label: 'عيد الثورة' }],
    pins: { 'RH-001': { pin: '123456' }, 10001: { pin: '123456' }, 10002: { pin: '123456' }, 10003: { pin: '123456' } },
    session: null,
  });
  let db; try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const me = () => db.employees.find((e) => e.matricule === db.session);
  const bal = (m, y) => annualBuckets(db.leaves.filter((l) => l.matricule === m), db.balances.filter((b) => b.matricule === m), y);
  return {
    demo: true,
    async session() { return !!db.session; },
    async login(m, pin) { const p = db.pins[m]; if (!p || p.pin !== pin) throw new Error('الرقم الميكانوغرافي أو الرقم السري غير صحيح.'); db.session = m; save(); },
    async mustChange() { return !!db.pins[db.session]?.must; },
    async changePin(pin) { db.pins[db.session] = { pin, must: false }; save(); },
    async setPin(m, pin) { if (me().role !== 'hr') throw new Error('هذه العملية للموارد البشرية فقط'); db.pins[m] = { pin, must: true }; save(); },
    async logout() { db.session = null; save(); },
    async me() { return me() || null; },
    async balanceRows(m) { return db.balances.filter((b) => b.matricule === m); },
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
    async allBalances() { return db.balances; },
    async saveBalance(m, y, opening) { const b = db.balances.find((x) => x.matricule === m && x.year === y); if (b) b.opening = opening; else db.balances.push({ matricule: m, year: y, opening }); save(); },
    async addEmployee(e) { db.employees.push({ ...e, sort: 99 }); save(); },
    async updateEmployee(m, patch) { Object.assign(db.employees.find((e) => e.matricule === m), patch); save(); },
  };
}

const API = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase ? supabaseApi() : demoApi();
const S = { me: null, holidays: [], myLeaves: [], balance: null, emps: [], pendingList: [] };

// ===== أدوات الواجهة =====
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
async function run(btn, fn) { const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '…'; } try { return await fn(); } catch (e) { toast(e.message || 'حدث خطأ، أعد المحاولة'); throw e; } finally { if (btn) { btn.disabled = false; btn.textContent = old; } } }
const show = (id) => ['vLogin', 'vApp'].forEach((v) => ($(v).hidden = v !== id));
function go(page) {
  ['pMine', 'pHistory', 'pApprovals', 'pStaff'].forEach((p) => ($(p).hidden = p !== page));
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.p === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (page === 'pApprovals') loadApprovals();
  if (page === 'pStaff') loadStaff();
  window.scrollTo(0, 0);
}

// ===== تسجيل الدخول =====
$('unitName').textContent = CFG.UNIT || '';
$('demoBox').hidden = !API.demo;
const loginStep = (id) => ['stepLogin', 'stepPin'].forEach((v) => ($(v).hidden = v !== id));
$('stepLogin').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const m = $('mat').value.trim(), pin = $('pin').value.replace(/\D/g, '');
  $('loginErr').textContent = '';
  if (!m || pin.length !== 6) { $('loginErr').textContent = 'أدخل رقمك الميكانوغرافي ورقمك السري (6 أرقام).'; return; }
  run($('loginBtn'), async () => { await API.login(m, pin); $('pin').value = ''; await start(); }).catch((e) => ($('loginErr').textContent = e.message));
});
$('stepPin').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const p1 = $('pin1').value, p2 = $('pin2').value;
  $('pinErr').textContent = '';
  if (!/^\d{6}$/.test(p1)) { $('pinErr').textContent = 'الرقم السري يتكوّن من 6 أرقام.'; return; }
  if (/^(\d)\1{5}$/.test(p1) || '0123456789'.includes(p1) || '9876543210'.includes(p1)) { $('pinErr').textContent = 'رقم سهل التخمين، اختر رقماً آخر.'; return; }
  if (p1 !== p2) { $('pinErr').textContent = 'الرقمان غير متطابقين.'; return; }
  run($('pinBtn'), async () => { await API.changePin(p1); $('pin1').value = $('pin2').value = ''; toast('حُفظ رقمك السري الجديد.'); await start(); }).catch((e) => ($('pinErr').textContent = e.message));
});
$('changePin').onclick = () => { show('vLogin'); loginStep('stepPin'); $('pinNote').textContent = 'اختر رقماً سرياً جديداً من 6 أرقام.'; $('pinCancel').hidden = false; };
$('pinCancel').onclick = () => start();
document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = async () => { await API.login(b.dataset.demo, '123456'); await start(); }));
$('logout').onclick = async () => { await API.logout(); location.reload(); };

// ===== الصفحة الرئيسية للعون =====
async function loadMine() {
  const m = S.me.matricule;
  const [rows, leaves] = await Promise.all([API.balanceRows(m), API.leaves(m)]);
  const bal = annualBuckets(leaves, rows, YEAR), nxt = annualBuckets(leaves, rows, YEAR + 1);
  const lastYear = Math.max(YEAR, ...leaves.map((l) => +l.start_date.slice(0, 4)));
  const allocAll = annualBuckets(leaves, rows, lastYear).alloc;
  S.balance = bal; S.balRows = rows; S.myLeaves = leaves;
  $('yearLbl').textContent = `${YEAR - 2}–${YEAR}`;
  $('remaining').textContent = fmt(bal.remaining);
  $('balDetail').innerHTML = bal.buckets.map((b) => `<span class="yr${b.year === YEAR - 2 ? ' old' : ''}"><small>${b.year}</small><b>${fmt(b.remaining)}</b></span>`).join('') +
    `<div class="hint">يُخصم من أقدم سنة أولاً. ما يبقى من ${YEAR - 2} يسقط في 1 جانفي ${YEAR + 1}.</div>` +
    `<div class="hint">ابتداءً من 1 جانفي ${YEAR + 1}: ${nxt.buckets.map((b) => `${b.year} (${fmt(b.remaining)})`).join(' + ')} = <b>${fmt(nxt.remaining)}</b> يوماً، تتمتّع بها كاملة إلى 31 ديسمبر ${YEAR + 1}.</div>`;
  $('stUsed').textContent = fmt(leaves.filter((l) => l.type === 'ANNUAL' && l.status === 'APPROVED' && l.start_date.startsWith(String(YEAR))).reduce((s, l) => s + Number(l.days), 0));
  $('stPending').textContent = fmt(bal.pending);
  $('stSick').textContent = fmt(leaves.filter((l) => l.type === 'SICK' && l.status === 'APPROVED' && l.start_date.startsWith(String(YEAR))).reduce((s, l) => s + Number(l.days), 0));
  const item = (l) => `<div class="item">
      <div class="t"><span>${esc(TYPES[l.type])}</span><span class="pill p-${l.status}">${STATUS[l.status]}</span></div>
      <div class="d">من ${dmy(l.start_date)} إلى ${dmy(l.end_date)} — ${fmt(l.days)} ${Number(l.days) === 1 ? 'يوم' : Number(l.days) <= 10 ? 'أيام' : 'يوماً'}${l.reason ? ` — ${esc(l.reason)}` : ''}</div>
      ${allocAll[l.id]?.length ? `<div class="d">مخصومة من رصيد: ${allocText(allocAll[l.id])}</div>` : ''}
      ${l.comment ? `<div class="d">التعليل: ${esc(l.comment)}</div>` : ''}
      <div class="actions">${FORM906.includes(l.type) && l.status !== 'CANCELLED' ? `<button class="btn sm ghost" data-906="${l.id}">نموذج 906 (PDF)</button>` : ''}${['PENDING_MANAGER', 'PENDING_HR', 'RETURNED'].includes(l.status) ? `<button class="btn sm bad" data-cancel="${l.id}">سحب الطلب</button>` : ''}</div>
    </div>`;
  const empty = '<div class="empty">لا توجد عطل مسجلة بعد. اضغط «+ طلب عطلة» لتقديم أول طلب.</div>';
  $('myList').innerHTML = leaves.length ? leaves.slice(0, 3).map(item).join('') : empty;
  $('histList').innerHTML = leaves.length ? leaves.map(item).join('') : empty;
  $('seeAll').hidden = leaves.length <= 3;
}
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-cancel]'); if (!c) return;
  run(c, async () => { await API.cancel(c.dataset.cancel); toast('سُحب الطلب.'); await loadMine(); });
});

// ===== طلب عطلة =====
$('fType').innerHTML = Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('fReason').innerHTML = Object.entries(REASONS).map(([k, d]) => `<option value="${esc(k)}" data-max="${d}">${esc(k)} (${d} ${d === 1 ? 'يوم' : 'أيام'})</option>`).join('');
const readForm = () => ({ type: $('fType').value, start: $('fStart').value, end: $('fEnd').value, reason: $('fType').value === 'EXCEPTIONAL' ? $('fReason').value : null, titleYear: null, address: $('fAddress').value.trim() || null, interim: $('fInterim').value.trim() || null, note: $('fNote').value.trim() || null });
function preview() {
  const f = readForm();
  $('fReasonW').hidden = f.type !== 'EXCEPTIONAL';
  $('fErr').textContent = '';
  if (!f.start || !f.end) { $('fPreview').textContent = 'اختر التاريخين لعرض عدد الأيام.'; return f; }
  if (f.end < f.start) { $('fPreview').textContent = 'تاريخ النهاية قبل تاريخ البداية.'; return f; }
  const days = countDays(f.type, f.start, f.end, S.holidays);
  let txt = `${fmt(days)} ${days <= 10 ? 'أيام' : 'يوماً'} ${f.type === 'EXCEPTIONAL' ? '(أيام عمل)' : ''}`;
  if (f.type === 'ANNUAL' && S.balRows) {
    const y = +f.start.slice(0, 4), sim = annualBuckets([...S.myLeaves, { id: '_new', type: 'ANNUAL', status: 'PENDING_MANAGER', start_date: f.start, days, created_at: '9' }], S.balRows, y);
    const after = sim.remaining;
    txt += ` — تُخصم من: ${allocText(sim.alloc._new)} — يبقى لك ${fmt(after)} يوماً`;
    if (after < 0) $('fErr').textContent = `الرصيد غير كافٍ: المتاح ${fmt(after + days)} يوماً (${y - 2}–${y}).`;
  }
  if (f.type === 'EXCEPTIONAL') { const max = +$('fReason').selectedOptions[0].dataset.max; if (days > max) $('fErr').textContent = `المدة المسموح بها لهذا السبب ${max} ${max === 1 ? 'يوم' : 'أيام'}.`; }
  $('fPreview').textContent = txt;
  return f;
}
['fType', 'fStart', 'fEnd', 'fReason'].forEach((id) => $(id).addEventListener('input', preview));
$('fStart').addEventListener('change', () => { if (!$('fEnd').value || $('fEnd').value < $('fStart').value) $('fEnd').value = $('fStart').value; preview(); });
$('newLeave').onclick = () => { $('leaveForm').reset(); $('fStart').min = today(); preview(); $('sheet').hidden = false; };
$('fCancel').onclick = () => ($('sheet').hidden = true);
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) $('sheet').hidden = true; });
$('leaveForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = preview();
  if ($('fErr').textContent || !f.start || !f.end || f.end < f.start) return;
  run($('fSubmit'), async () => { await API.request(f); $('sheet').hidden = true; toast(FORM906.includes(f.type) ? 'أُرسل طلبك. نموذج 906 جاهز للتنزيل في سجل عطلك.' : 'أُرسل طلبك إلى الرئيس المباشر.'); await loadMine(); })
    .catch((e) => ($('fErr').textContent = e.message));
});

// ===== نموذج طلب عطلة عدد 906 (PDF) =====
const FORM906 = ['ANNUAL', 'EXCEPTIONAL'];
const PDF_LIBS = ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'];
let pdfLibs = null;
const loadScript = (src) => new Promise((ok, ko) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => ko(new Error('تعذّر تحميل أداة PDF، تحقّق من الاتصال')); document.head.appendChild(el); });
// الشعار يُضمَّن في الوثيقة كبيانات (data URL) حتى يظهر في ملف PDF
let logoData = null;
const getLogo = () => (logoData ||= fetch('icons/logo.png').then((r) => r.blob()).then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); })).catch(() => ''));
function html906(l, e, logo, titreYears) {
  const isAnn = l.type === 'ANNUAL';
  const nature = isAnn ? 'عطلة استراحة' : `عطلة استثنائية${l.reason ? ` (${l.reason})` : ''}`;
  const titre = isAnn ? (titreYears || String(l.start_date.slice(0, 4))) : (l.reason || '');
  const days = Number(l.days);
  const mgr = (l.log || []).find((x) => x.from === 'PENDING_MANAGER');
  const avis = mgr ? (mgr.to === 'REJECTED' ? 'غير موافق' : mgr.to === 'RETURNED' ? 'مُرجع للتعديل' : 'موافق') + (mgr.comment ? ` — ${mgr.comment}` : '') : '';
  const signDate = dmy((l.created_at || new Date().toISOString()).slice(0, 10));
  const box = (on) => `<span class="box">${on ? 'X' : ''}</span>`;
  const row = (ar, fr, val) => `<div class="r"><span class="fr">${fr}</span><span class="v">${esc(val)}</span><span class="ar">${ar}</span></div>`;
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap"><style>
body{margin:0;padding:34px;width:794px;box-sizing:border-box;background:#fff;font-family:'Noto Naskh Arabic','Traditional Arabic',Tahoma,Arial,sans-serif;font-size:16px;color:#000}
.page{border:1.5px solid #7a4a86;border-radius:14px;padding:20px 28px}.c{text-align:center}.no{font-size:18px;margin:6px 0 14px}
.org{display:flex;justify-content:space-between;font-size:18px;margin-bottom:10px;white-space:nowrap}h1{text-align:center;font-size:24px;margin:10px 0}
.types{display:grid;justify-content:center;gap:8px;font-size:19px;font-weight:bold;margin-bottom:22px}.types div{display:grid;grid-template-columns:200px 34px 200px;align-items:center;gap:14px}
.types .fr{text-align:left}.types .ar{text-align:right;direction:rtl}.box{display:inline-block;width:20px;height:20px;border:1.5px solid #000;text-align:center;line-height:20px;font-weight:bold}
.r{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:end;margin:13px 0}.r .fr{text-align:left;white-space:nowrap}.r .ar{direction:rtl;white-space:nowrap}
.r .v{border-bottom:1px dotted #000;text-align:center;min-height:22px;font-weight:bold;direction:rtl}.sig{text-align:center;margin:16px 0 40px}
.notes{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;font-size:13px;margin-top:30px}.notes .ar{direction:rtl;text-align:right}
</style></head><body><div class="page">
${logo ? `<div class="c"><img src="${logo}" style="width:120px" alt=""></div>` : ''}<div class="no c">N° 906 &nbsp; رقم</div>
<div class="org"><span>Office National des postes</span><span dir="rtl">الديوان الوطني للبريد</span></div>
<h1>Demande de Congé <small>(1)</small> &nbsp; طلب عطلة</h1>
<div class="types"><div><span class="fr">Congé de Repos</span>${box(isAnn)}<span class="ar">عطلة إستراحة</span></div><div><span class="fr">Congé exceptionnel</span>${box(!isAnn)}<span class="ar">عطلة إستثنائية</span></div></div>
${row('إني الممضي أسفله', 'Je soussigné', e.name)}${row('الرتبة', 'Grade', e.grade || '')}${row('الرقم الميكانوغرافي', 'Matricule', l.matricule)}${row('تاريخ الإنتداب', 'Date de recrutement', '')}
${row('أطلب الحصول على (2)', "Demande de bénéficier d'un (2)", nature)}${row('لمدة', "D'une durée de", `${fmt(days)} ${days === 1 ? 'يوم' : days <= 10 ? 'أيام' : 'يوماً'}`)}${row('بعنوان (3)', 'au titre de (3)', titre)}
${row('إبتداء من', 'A compter du', dmy(l.start_date))}${row('إلى (بدخول الغاية)', 'au (inclus)', dmy(l.end_date))}${row('لقضائها بالعنوان التالي', 'Adresse pendant le congé', l.address || '')}
${row('بتونس في', 'A Tunis le', signDate)}<div class="sig">الإمضاء</div>
${row('رأي الرئيس المباشر', 'Avis du chef Immédiat', avis)}${row('إسم النائب (عند الإقتضاء)', 'Nom du remplaçant (éventuellement)', l.interim || '')}
<div class="sig">التاريخ و الإمضاء${mgr ? ` — ${dmy(String(mgr.at).slice(0, 10))}` : ''}</div>
<div class="notes"><span>(1) Mettre une croix dans la case correspondante</span><span class="ar">(1) وضع علامة X في المربع المناسب</span>
<span>(2) Ecrire la nature du congé (repos ou exceptionnel)</span><span class="ar">(2) ذكر نوعية العطلة (إستراحة أو إستثنائية)</span>
<span>(3) Indiquer l'année à laquelle se rapporte le congé</span><span class="ar">(3) ذكر سنة إستحقاق عطلة الإستراحة</span></div></div></body></html>`;
}
// تحويل وثيقة HTML (عرض 794px) إلى PDF بصفحات A4، ثم مشاركتها أو تنزيلها
async function htmlToPdf(html, name, title) {
  pdfLibs ||= Promise.all(PDF_LIBS.map(loadScript)).catch((err) => { pdfLibs = null; throw err; });
  await pdfLibs;
  const fr = document.createElement('iframe');
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;left:-20000px;top:0;width:794px;height:1123px;border:0;';
  const loaded = new Promise((r) => (fr.onload = r));
  fr.srcdoc = html;
  document.body.appendChild(fr);
  try {
    await loaded;
    const doc = fr.contentDocument;
    try { await doc.fonts.ready; } catch {}
    await Promise.all([...doc.images].map((im) => im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r))));
    const opts = { scale: 2, backgroundColor: '#ffffff', width: 794, windowWidth: 794, height: doc.body.scrollHeight, logging: false, useCORS: true };
    let canvas;
    try { canvas = await window.html2canvas(doc.body, { ...opts, foreignObjectRendering: true }); canvas.toDataURL('image/jpeg', 0.5); }
    catch { canvas = await window.html2canvas(doc.body, opts); }
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const pagePx = Math.floor(canvas.width * ph / pw);
    if (canvas.height <= pagePx * 1.02) {
      let w = pw, h = canvas.height * pw / canvas.width; if (h > ph) { h = ph; w = canvas.width * ph / canvas.height; }
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, 0, w, h);
    } else {
      for (let y = 0, first = true; y < canvas.height; y += pagePx, first = false) {
        const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.min(pagePx, canvas.height - y);
        const ctx = part.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height); ctx.drawImage(canvas, 0, -y);
        if (!first) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, part.height * pw / part.width);
      }
    }
    const file = new File([pdf.output('blob')], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally { fr.remove(); }
}
async function pdf906(l, btn) {
  const e = l.matricule === S.me.matricule ? S.me : (S.emps.find((x) => x.matricule === l.matricule) || { name: l.matricule });
  await run(btn, async () => {
    let titreYears = '';
    if (l.type === 'ANNUAL') {
      const [ls, rows] = await Promise.all([API.leaves(l.matricule), API.balanceRows(l.matricule)]);
      const a = annualBuckets(ls, rows, +l.start_date.slice(0, 4)).alloc[l.id] || [];
      titreYears = a.map((x) => a.length > 1 ? `${x.year} (${fmt(x.days)} ي)` : String(x.year)).join(' و ');
    }
    await htmlToPdf(html906(l, e, await getLogo(), titreYears), `conge-906-${l.matricule}-${l.start_date}.pdf`, 'نموذج طلب عطلة 906');
  });
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-906]'); if (!b) return;
  const l = [...S.myLeaves, ...S.pendingList].find((x) => String(x.id) === b.dataset['906']);
  if (l) pdf906(l, b).catch(() => {});
});

// ===== تقرير عون (للرئيس المباشر والموارد البشرية) =====
const daysTxt = (n) => `${fmt(n)} ${Number(n) === 1 ? 'يوم' : Number(n) <= 10 ? 'أيام' : 'يوماً'}`;
async function agentReport(m) {
  const emps = S.emps.length ? S.emps : (S.emps = await API.employees());
  const e = emps.find((x) => x.matricule === m) || { matricule: m, name: m };
  const [leaves, rows] = await Promise.all([API.leaves(m), API.balanceRows(m)]);
  const bal = annualBuckets(leaves, rows, YEAR), nxt = annualBuckets(leaves, rows, YEAR + 1);
  const lastYear = Math.max(YEAR, ...leaves.map((l) => +l.start_date.slice(0, 4)));
  const alloc = annualBuckets(leaves, rows, lastYear).alloc;
  const ok = leaves.filter((l) => l.status === 'APPROVED' && l.start_date.startsWith(String(YEAR)));
  const byType = Object.keys(TYPES).map((t) => [t, ok.filter((l) => l.type === t).reduce((s, l) => s + Number(l.days), 0)]).filter(([, n]) => n > 0);
  return { e, leaves, bal, nxt, alloc, byType };
}
function reportHtml(r, logo) {
  const { e, leaves, bal, nxt, alloc, byType } = r;
  const tr = (l) => `<tr><td>${esc(TYPES[l.type])}${l.reason ? ` (${esc(l.reason)})` : ''}</td><td>${dmy(l.start_date)}</td><td>${dmy(l.end_date)}</td><td>${fmt(l.days)}</td><td>${l.type === 'ANNUAL' && alloc[l.id] ? allocText(alloc[l.id]) : ''}</td><td>${STATUS[l.status]}</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap"><style>
body{margin:0;padding:34px;width:794px;box-sizing:border-box;background:#fff;font-family:'Noto Naskh Arabic',Tahoma,Arial,sans-serif;font-size:15px;color:#111}
.hd{display:flex;align-items:center;gap:16px;border-bottom:3px solid #f6c400;padding-bottom:10px;margin-bottom:16px}.hd img{width:90px}.hd h1{font-size:22px;margin:0;color:#181d54}
.hd .s{color:#555;font-size:14px}table{width:100%;border-collapse:collapse;margin:8px 0 18px}th,td{border:1px solid #bbb;padding:6px 8px;text-align:right}th{background:#181d54;color:#fff}
h2{font-size:17px;color:#181d54;margin:14px 0 6px}.ft{color:#666;font-size:12px;margin-top:20px}
</style></head><body>
<div class="hd">${logo ? `<img src="${logo}" alt="">` : ''}<div><h1>تقرير العطل — ${esc(e.name)}</h1><div class="s">${esc(CFG.UNIT || '')} · تاريخ التقرير ${dmy(today())}</div></div></div>
<table><tr><th>الرقم الميكانوغرافي</th><th>الإسم واللقب</th><th>الرتبة</th><th>الصفة</th></tr><tr><td>${esc(e.matricule)}</td><td>${esc(e.name)}</td><td>${esc(e.grade || '')}</td><td>${ROLE[e.role] || ''}</td></tr></table>
<h2>رصيد العطلة السنوية</h2>
<table><tr>${bal.buckets.map((b) => `<th>المتبقي من ${b.year}</th>`).join('')}<th>المجموع</th><th>قيد الانتظار</th></tr>
<tr>${bal.buckets.map((b) => `<td>${fmt(b.remaining)}</td>`).join('')}<td><b>${fmt(bal.remaining)}</b></td><td>${fmt(bal.pending)}</td></tr></table>
<div>ابتداءً من 1 جانفي ${YEAR + 1}: ${nxt.buckets.map((b) => `${b.year} (${fmt(b.remaining)})`).join(' + ')} = <b>${fmt(nxt.remaining)}</b> يوماً.</div>
<h2>العطل المقبولة خلال ${YEAR}</h2>
${byType.length ? `<table><tr><th>النوع</th><th>عدد الأيام</th></tr>${byType.map(([t, n]) => `<tr><td>${esc(TYPES[t])}</td><td>${fmt(n)}</td></tr>`).join('')}</table>` : '<div>لا شيء.</div>'}
<h2>سجل كل الطلبات</h2>
${leaves.length ? `<table><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>بعنوان</th><th>الحالة</th></tr>${leaves.map(tr).join('')}</table>` : '<div>لا توجد طلبات.</div>'}
<div class="ft">وثيقة صادرة عن تطبيقة «عطلتي» — للاستعمال الإداري الداخلي.</div></body></html>`;
}
async function openReport(m) {
  const box = $('repBody');
  box.innerHTML = '<div class="empty">جارٍ التحميل…</div>'; $('repSheet').hidden = false;
  try {
    const r = await agentReport(m), { e, leaves, bal, nxt, alloc, byType } = r;
    box.innerHTML = `<h2>${esc(e.name)}</h2>
      <div class="d">${esc(e.matricule)}${e.grade ? ` · ${esc(e.grade)}` : ''} · ${ROLE[e.role] || ''}</div>
      <div class="hero" style="margin:12px 0"><div class="d">الرصيد السنوي المتبقي (${YEAR - 2}–${YEAR})</div><div style="font-size:1.8rem;font-weight:700">${fmt(bal.remaining)} <small>يوماً</small></div>
        <div>${bal.buckets.map((b) => `<span class="yr${b.year === YEAR - 2 ? ' old' : ''}"><small>${b.year}</small><b>${fmt(b.remaining)}</b></span>`).join('')}</div>
        <div class="hint">قيد الانتظار: ${fmt(bal.pending)} · ابتداءً من 1 جانفي ${YEAR + 1}: <b>${fmt(nxt.remaining)}</b> يوماً</div></div>
      <h3>العطل المقبولة خلال ${YEAR}</h3>
      ${byType.length ? `<div class="rep-kv">${byType.map(([t, n]) => `<span>${esc(TYPES[t])}</span><b>${daysTxt(n)}</b>`).join('')}</div>` : '<div class="empty">لا شيء.</div>'}
      <h3>سجل الطلبات (${leaves.length})</h3>
      ${leaves.length ? leaves.map((l) => `<div class="item"><div class="t"><span>${esc(TYPES[l.type])}</span><span class="pill p-${l.status}">${STATUS[l.status]}</span></div>
        <div class="d">من ${dmy(l.start_date)} إلى ${dmy(l.end_date)} — ${daysTxt(l.days)}${l.type === 'ANNUAL' && alloc[l.id] ? ` — بعنوان ${allocText(alloc[l.id])}` : ''}${l.reason ? ` — ${esc(l.reason)}` : ''}</div>
        ${l.comment ? `<div class="d">التعليل: ${esc(l.comment)}</div>` : ''}</div>`).join('') : '<div class="empty">لا توجد طلبات.</div>'}
      <div class="actions" style="margin-top:14px"><button class="btn navy" id="repPdf">تقرير PDF</button><button class="btn ghost" id="repClose">إغلاق</button></div>`;
    $('repClose').onclick = () => ($('repSheet').hidden = true);
    $('repPdf').onclick = () => run($('repPdf'), async () => htmlToPdf(reportHtml(r, await getLogo()), `rapport-conges-${e.matricule}-${today()}.pdf`, 'تقرير العطل')).catch(() => {});
  } catch (err) { box.innerHTML = `<div class="err">${esc(err.message)}</div><button class="btn ghost" onclick="this.closest('.sheet-bg').hidden=true">إغلاق</button>`; }
}
document.addEventListener('click', (ev) => { const b = ev.target.closest('[data-rep]'); if (b) { ev.preventDefault(); openReport(b.dataset.rep); } });
$('repSheet').addEventListener('click', (e) => { if (e.target === $('repSheet')) $('repSheet').hidden = true; });

// ===== الموافقات =====
async function loadApprovals() {
  const [list, emps] = await Promise.all([API.pending(), API.employees()]);
  S.emps = emps; S.pendingList = list;
  const name = (m) => emps.find((e) => e.matricule === m)?.name || m;
  const mine = list.filter((l) => S.me.role === 'hr' || l.status === 'PENDING_MANAGER');
  $('apCount').textContent = mine.length ? `(${mine.length})` : '';
  const bals = {};
  for (const l of mine.filter((x) => x.type === 'ANNUAL')) {
    const [ls, rows] = await Promise.all([API.leaves(l.matricule), API.balanceRows(l.matricule)]);
    const r = annualBuckets(ls, rows, +l.start_date.slice(0, 4));
    bals[l.id] = { remaining: r.remaining, alloc: r.alloc[l.id] };
  }
  $('apList').innerHTML = mine.length ? mine.map((l) => `<div class="item">
      <div class="t"><button class="who-link" data-rep="${esc(l.matricule)}">${esc(name(l.matricule))}</button><span class="pill p-${l.status}">${STATUS[l.status]}</span></div>
      <div class="d">${esc(TYPES[l.type])}${l.reason ? ` (${esc(l.reason)})` : ''} — من ${dmy(l.start_date)} إلى ${dmy(l.end_date)} — ${fmt(l.days)} أيام</div>
      ${bals[l.id] ? `<div class="d">تُخصم من: ${allocText(bals[l.id].alloc)} — يبقى له ${fmt(bals[l.id].remaining)} يوماً</div>` : ''}
      ${l.note ? `<div class="d">ملاحظة: ${esc(l.note)}</div>` : ''}
      <input id="c_${l.id}" placeholder="التعليل (إجباري عند الرفض أو الإرجاع)">
      <div class="actions">${FORM906.includes(l.type) ? `<button class="btn sm ghost" data-906="${l.id}">906</button>` : ''}<button class="btn sm ok" data-dec="approve" data-id="${l.id}">${l.status === 'PENDING_MANAGER' ? 'موافقة' : 'مصادقة نهائية'}</button>
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
  const [emps, bals, leaves] = await Promise.all([API.employees(), API.allBalances(), API.leaves()]);
  S.emps = emps;
  const years = [YEAR - 2, YEAR - 1, YEAR];
  $('empList').innerHTML = emps.map((e) => {
    const rows = bals.filter((x) => x.matricule === e.matricule);
    const r = annualBuckets(leaves.filter((l) => l.matricule === e.matricule), rows, YEAR);
    const op = (y) => { const x = rows.find((b) => +b.year === y); return x ? Number(x.opening) : 30; };
    return `<div class="item">
      <div class="t"><span><button class="who-link" data-rep="${esc(e.matricule)}">${esc(e.name)}</button> <span class="d">· ${esc(e.matricule)}</span></span><span class="pill p-RETURNED">${ROLE[e.role]}</span></div>
      <div class="d">الدخول: الرقم الميكانوغرافي <b>${esc(e.matricule)}</b> + رقم سري</div>
      <div class="d">الرصيد المتبقي: <b>${fmt(r.remaining)}</b> يوماً (${r.buckets.map((b) => `${fmt(b.remaining)} من ${b.year}`).join('، ')})</div>
      <div class="three">${years.map((y) => `<label>متاح ${y}<input type="number" step="0.5" min="0" max="30" value="${op(y)}" id="bo_${esc(e.matricule)}_${y}"></label>`).join('')}</div>
      <div class="d hint">«متاح» = ما بقي من استحقاق تلك السنة قبل بدء العمل بالتطبيقة (30 إن لم يستهلك منها شيئاً).</div>
      <div class="actions"><button class="btn sm navy" data-bal="${esc(e.matricule)}">حفظ الرصيد</button><button class="btn sm ghost" data-pin="${esc(e.matricule)}">رقم سري جديد</button></div>
    </div>`;
  }).join('');
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-bal]');
  if (b) { const m = b.dataset.bal; run(b, async () => { for (const y of [YEAR - 2, YEAR - 1, YEAR]) await API.saveBalance(m, y, Math.min(30, Math.max(0, +$(`bo_${m}_${y}`).value))); toast('حُفظ الرصيد.'); await loadStaff(); }); }
  const p = ev.target.closest('[data-pin]');
  if (p) {
    const m = p.dataset.pin;
    if (!window.confirm(`إعطاء رقم سري جديد للعون ${m}؟ سيُلغى رقمه الحالي ويُخرج من كل أجهزته.`)) return;
    const pin = randomPin();
    run(p, async () => { await API.setPin(m, pin); window.alert(`الرقم السري الجديد للعون ${m}:\n\n${pin}\n\nأعطه إياه شخصياً؛ سيُطلب منه تغييره عند أول دخول.`); });
  }
});
$('empForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const e = { matricule: $('eMat').value.trim(), name: $('eName').value.trim(), grade: $('eGrade').value.trim() || null, role: $('eRole').value };
  run(ev.submitter, async () => {
    await API.addEmployee(e); const pin = randomPin(); await API.setPin(e.matricule, pin);
    window.alert(`أُضيف العون ${e.name}.\n\nالدخول: ${e.matricule}\nالرقم السري الأولي: ${pin}\n\nأعطه إياه شخصياً؛ سيُطلب منه تغييره عند أول دخول.`);
    ev.target.reset(); await loadStaff();
  });
});

$('seeAll').onclick = () => go('pHistory');
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
  if (!(await API.session())) { show('vLogin'); loginStep('stepLogin'); return; }
  try {
    if (await API.mustChange()) { show('vLogin'); loginStep('stepPin'); $('pinCancel').hidden = true; return; }
    S.me = await API.me();
    if (!S.me) { await API.logout(); show('vLogin'); loginStep('stepLogin'); $('loginErr').textContent = 'هذا الحساب غير مفعّل. اتصل بالموارد البشرية.'; return; }
    S.holidays = await API.holidays();
    show('vApp');
    $('hello').textContent = `مرحباً ${S.me.name.split(' ')[0]}`;
    $('who').textContent = `${S.me.matricule} · ${ROLE[S.me.role]}${API.demo ? ' · وضع تجريبي' : ''}`;
    const staff = S.me.role !== 'agent';
    document.querySelector('[data-p="pApprovals"]').hidden = !staff;
    document.querySelector('[data-p="pStaff"]').hidden = S.me.role !== 'hr';
    $('nav').hidden = false;
    go('pMine');
    await loadMine();
    if (staff) loadApprovals();
  } catch (e) { toast(e.message); }
}
start();
})();
