-- بذر الوحدة وأعوان بطاقة الحضور (مولَّد من seed_dast.json)
INSERT INTO org_unit (code, name_ar) VALUES ('DCRH', 'الإدارة المركزية للموارد البشرية');
INSERT INTO org_unit (code, name_ar, parent_id) SELECT 'DCRH-DASC', 'إدارة العمل الاجتماعي والثقافي', id FROM org_unit WHERE code = 'DCRH';
INSERT INTO employee (matricule, first_name_ar, last_name_ar, org_unit_id) VALUES
  ('61452', 'إيناس', 'زقر', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('63541', 'فوزي', 'جاري', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('65650', 'أميمة', 'التركي', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('61533', 'عفاف', 'الصيد', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('61740', 'سميرة', 'حمدي', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('67475', 'محمد', 'شرفي', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('68450', 'آمنة', 'عاشوري', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC')),
  ('65705', 'ليليا', 'توايتي', (SELECT id FROM org_unit WHERE code = 'DCRH-DASC'));
