-- المعطيات الأولى: تُنفَّذ بعد schema.sql (SQL Editor ← Run)
-- 1) غيّر البريد الإلكتروني لكل عون إلى بريده الحقيقي قبل التنفيذ.
-- 2) غيّر 'rh@exemple.tn' إلى بريدك أنت (الموارد البشرية).
insert into employees (matricule, name, email, role, sort) values
  ('RH-001', 'الموارد البشرية', 'rh@exemple.tn', 'hr', 0),
  ('61452', 'إيناس زقر',     null, 'agent', 1),
  ('63541', 'فوزي جاري',     null, 'agent', 2),
  ('65650', 'أميمة التركي',  null, 'agent', 3),
  ('61533', 'عفاف الصيد',    null, 'agent', 4),
  ('61740', 'سميرة حمدي',    null, 'agent', 5),
  ('67475', 'محمد شرفي',     null, 'agent', 6),
  ('68450', 'آمنة عاشوري',   null, 'agent', 7),
  ('65705', 'ليليا توايتي',  null, 'agent', 8)
on conflict (matricule) do nothing;

insert into balances (matricule, year, entitled, carried)
select matricule, 2026, 30, 0 from employees where role = 'agent'
on conflict do nothing;

insert into holidays (day, label) values
  ('2026-01-01', 'رأس السنة الإدارية'), ('2026-03-20', 'عيد الاستقلال'), ('2026-04-09', 'عيد الشهداء'),
  ('2026-05-01', 'عيد الشغل'), ('2026-07-25', 'عيد الجمهورية'), ('2026-08-13', 'عيد المرأة'),
  ('2026-10-15', 'عيد الجلاء'), ('2026-12-17', 'عيد الثورة')
on conflict do nothing;
