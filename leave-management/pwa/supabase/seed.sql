-- المعطيات الأولى: تُنفَّذ بعد schema.sql (SQL Editor ← Run)
-- المصدر: البطاقات المهنية 2023 (الرقم الآلي، الإسم واللقب، الخطة، الوظيفة) وبطاقة الحضور.
-- قبل التنفيذ:
--   1) ضع البريد الإلكتروني لكل عون مكان null.
--   2) ضع بريدك أنت مكان 'rh@exemple.tn' (الموارد البشرية).
--   3) أكمل يدوياً الرتبة الناقصة (آمنة عاشوري، ليليا توايتي).
insert into employees (matricule, name, grade, email, role, sort) values
  ('RH-001', 'الموارد البشرية',      null,               'rh@exemple.tn', 'hr',      0),
  ('61452',  'إيناس زڤر بوصبيع',     'متصرّف رئيس',      null,            'manager', 1), -- رئيس دائرة: الرئيس المباشر
  ('63541',  'فوزي جاري',            'متصرّف',           null,            'agent',   2),
  ('65650',  'أميمة التركي',         'متصرّف رئيس',      null,            'agent',   3),
  ('61533',  'عفاف الصيد',           'متصرّف رئيس',      null,            'agent',   4),
  ('61740',  'سميرة الحمدي',         'متصرّف عام',       null,            'agent',   5),
  ('67475',  'محمّد شرفي',           'عون إداري',        null,            'agent',   6),
  ('68450',  'آمنة عاشوري',          null,               null,            'agent',   7), -- الرتبة: تُكمَّل يدوياً
  ('65705',  'ليليا توايتي',         null,               null,            'agent',   8)  -- الرتبة: تُكمَّل يدوياً
on conflict (matricule) do update set name = excluded.name, grade = coalesce(excluded.grade, employees.grade), role = excluded.role, sort = excluded.sort;

insert into balances (matricule, year, entitled, carried)
select matricule, 2026, 30, 0 from employees where role <> 'hr'
on conflict do nothing;

insert into holidays (day, label) values
  ('2026-01-01', 'رأس السنة الإدارية'), ('2026-03-20', 'عيد الاستقلال'), ('2026-04-09', 'عيد الشهداء'),
  ('2026-05-01', 'عيد الشغل'), ('2026-07-25', 'عيد الجمهورية'), ('2026-08-13', 'عيد المرأة'),
  ('2026-10-15', 'عيد الجلاء'), ('2026-12-17', 'عيد الثورة')
on conflict do nothing;
