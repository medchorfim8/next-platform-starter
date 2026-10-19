# يولّد نسخة التطبيقة بهوية البريد التونسي (الألوان والشعار) انطلاقاً من index.html:
#   python3 build-branded.py  ->  index-poste.html
import base64, pathlib
here = pathlib.Path(__file__).parent
s = (here / 'index.html').read_text()
logo = 'data:image/png;base64,' + base64.b64encode((here / 'assets/logo-poste.png').read_bytes()).decode()

css = """
/* ===== هوية البريد التونسي: أزرق ليلي + أصفر، ونقشة المعيّن المستوحاة من الشعار ===== */
:root {
  --navy: #181d54; --yellow: #fcbf16; --yellow-ink: #8a6200;
  --bg: #f2f3f8; --surface: #ffffff; --ink: #161a3d; --muted: #5a5f80; --line: #dcdfec;
  --accent: #181d54; --accent-soft: #e7e9f5; --gold: #fcbf16;
  --head-ink: #ffffff; --head-muted: #c9cdf0; --pattern: rgba(24, 29, 84, .045);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c0f2b; --surface: #151a44; --ink: #eef0fb; --muted: #a3a8cc; --line: #2b3170;
  --accent: #fcbf16; --accent-soft: #232a66; --yellow-ink: #fcbf16; --pattern: rgba(252, 191, 22, .04); color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0c0f2b; --surface: #151a44; --ink: #eef0fb; --muted: #a3a8cc; --line: #2b3170;
  --accent: #fcbf16; --accent-soft: #232a66; --yellow-ink: #fcbf16; --pattern: rgba(252, 191, 22, .04); color-scheme: dark }
body {
  background-color: var(--bg);
  background-image:
    repeating-linear-gradient(45deg, var(--pattern) 0 1px, transparent 1px 34px),
    repeating-linear-gradient(-45deg, var(--pattern) 0 1px, transparent 1px 34px);
  background-attachment: fixed;
}
body::before { background: var(--navy); }
header.top { background: var(--navy); border-bottom: 4px solid var(--yellow); box-shadow: 0 4px 18px rgba(12, 15, 43, .18); }
header.top .wrap { padding-block: 12px; gap: 10px 20px; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand .logo { width: 64px; height: 56px; flex: none; background: #fff; border-radius: 10px; display: grid; place-items: center; padding: 4px; }
.brand .logo img { width: 100%; height: 100%; object-fit: contain; }
.brand h1 { color: var(--head-ink); font-size: 1.4rem; line-height: 1.2; }
.brand .sub { color: var(--yellow); font-size: .8rem; letter-spacing: .01em; }
.brand .date { color: var(--head-muted); font-size: .78rem; font-variant-numeric: tabular-nums; }
nav.tabs { width: 100%; order: 3; gap: 6px; padding-top: 4px; }
nav.tabs button { color: var(--head-muted); border-radius: 999px; padding: 6px 14px; }
nav.tabs button:hover { color: var(--head-ink); background: rgba(255, 255, 255, .08); }
nav.tabs button[aria-selected="true"] { background: var(--yellow); color: var(--navy); font-weight: 700; }
.who { color: var(--head-muted); }
main.wrap { padding-block: 24px 48px; }
.panel { border-radius: 14px; border-color: var(--line); box-shadow: 0 1px 2px rgba(22, 26, 61, .04), 0 8px 24px rgba(22, 26, 61, .05); }
h2 { color: var(--accent); display: flex; align-items: center; gap: 10px; }
h2::before { content: ""; width: 9px; height: 9px; background: var(--yellow); transform: rotate(45deg); flex: none; }
.cards .card { border-radius: 12px; background: var(--surface); }
.cards .card:first-child { background: var(--navy); border-color: var(--navy); }
.cards .card:first-child .k, .cards .card:first-child .s { color: #c9cdf0; }
.cards .card:first-child .v { color: var(--yellow); }
.card .v { color: var(--accent); }
button.btn { background: var(--navy); border-color: var(--navy); color: #fff; border-radius: 8px; }
button.btn.ghost { background: transparent; color: var(--accent); border-color: var(--accent); }
button.btn.ok { background: var(--ok); border-color: var(--ok); }
button.btn.bad { background: transparent; color: var(--bad); border-color: var(--bad); }
:root[data-theme="dark"] button.btn:not(.ghost):not(.ok):not(.bad) { background: var(--yellow); border-color: var(--yellow); color: #181d54; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) button.btn:not(.ghost):not(.ok):not(.bad) { background: var(--yellow); border-color: var(--yellow); color: #181d54; } }
th { color: var(--accent); background: var(--accent-soft); }
table.sheet th { background: var(--navy); color: #fff; border-color: var(--navy); }
.sim { border-inline-start: 4px solid var(--yellow); }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
footer.site { text-align: center; color: var(--muted); font-size: .78rem; padding-block: 0 24px; }
"""
s = s.replace('</style>', css + '</style>', 1)
s = s.replace('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Reem+Kufi:wght@500;700&display=swap">',
              '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@500;700&display=swap">')
old_h1 = '  <h1>متابعة العطل والحضور</h1>'
assert old_h1 in s
s = s.replace(old_h1, f'''  <div class="brand">
    <div class="logo"><img src="{logo}" alt="شعار البريد التونسي"></div>
    <div><h1>متابعة العطل والحضور</h1>
      <div class="sub">البريد التونسي · الإدارة المركزية للموارد البشرية · إدارة العمل الاجتماعي والثقافي</div>
      <div class="date" id="todayAr"></div></div>
  </div>''')
s = s.replace('<div class="toast" id="toast" hidden></div>', '<footer class="site wrap">البريد التونسي — منظومة داخلية لمتابعة العطل والحضور</footer>\n<div class="toast" id="toast" hidden></div>')
s = s.replace("$('pmDate').value = today();", "$('pmDate').value = today();\nif ($('todayAr')) $('todayAr').textContent = 'اليوم: ' + ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][D(today()).getUTCDay()] + ' ' + dateAr(today());", 1)
# الشعار في الوثائق المنزّلة (بطاقة الحضور، رخصة الخروج، طلب العطلة 906)
s = s.replace('<div style="width:130px"></div></header>', f'<div style="width:130px"><img src="{logo}" style="width:130px" alt=""></div></header>')
s = s.replace('<div class="org">الإدارة المركزية للموارد البشرية<b>', f'<div style="text-align:center"><img src="{logo}" style="width:150px" alt=""></div><div class="org">الإدارة المركزية للموارد البشرية<b>')
s = s.replace('<div class="no c">N° 906', f'<div class="c"><img src="{logo}" style="width:120px" alt=""></div><div class="no c">N° 906')
s = s.replace('<div>تاريخ الإصدار:', f'<img src="{logo}" style="width:110px" alt=""><div>تاريخ الإصدار:', 1)
(here / 'index-poste.html').write_text(s)
print('index-poste.html', len(s))
