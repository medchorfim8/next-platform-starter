-- مخطط قاعدة بيانات منظومة متابعة العطل — PostgreSQL 16
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE org_unit (            -- الهيكل التنظيمي (وزارة / إدارة عامة / إدارة / قسم)
  id          serial PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  name_ar     text NOT NULL,
  parent_id   int REFERENCES org_unit(id),
  manager_id  int                   -- رئيس الوحدة (FK أدناه)
);

CREATE TABLE employee (            -- العون
  id             serial PRIMARY KEY,
  matricule      text UNIQUE NOT NULL,          -- الرقم الآلي (المعرّف الوحيد في منظومة الأجور)
  cin_enc        bytea,                         -- رقم بطاقة التعريف مشفّر (pgp_sym_encrypt) — يُستورد من منظومة الأجور
  first_name_ar  text NOT NULL,
  last_name_ar   text NOT NULL,
  gender         char(1) CHECK (gender IN ('M','F')),
  grade          text,                          -- الرتبة
  category       text,                          -- الصنف (أ1، أ2، ب، ج، د) أو عامل
  status         text NOT NULL DEFAULT 'ACTIVE',-- مباشر / عدم مباشرة / إلحاق / متقاعد
  org_unit_id    int NOT NULL REFERENCES org_unit(id),
  ldap_dn        text UNIQUE,
  email          text,
  phone          text
);
ALTER TABLE org_unit ADD FOREIGN KEY (manager_id) REFERENCES employee(id);

CREATE TABLE app_role (            -- EMPLOYEE, MANAGER, HR_AGENT, HR_ADMIN, DIRECTOR, AUDITOR, PAYROLL
  employee_id int REFERENCES employee(id),
  role        text NOT NULL,
  scope_unit  int REFERENCES org_unit(id),     -- نطاق الصلاحية
  PRIMARY KEY (employee_id, role, scope_unit)
);

CREATE TABLE leave_type (          -- إعداد قابل للتعديل لكل نوع عطلة (انظر src/rules.js)
  code          text PRIMARY KEY,                -- ANNUAL, SICK, MATERNITY, ...
  label_ar      text NOT NULL,
  pay_mode      text NOT NULL CHECK (pay_mode IN ('FULL','HALF','NONE')),
  count_mode    text NOT NULL CHECK (count_mode IN ('CALENDAR','WORKING')),
  has_balance   boolean NOT NULL DEFAULT false,
  rules         jsonb NOT NULL,                  -- سقوف، شرائح، آجال، وثائق مطلوبة
  legal_ref     text,                            -- المرجع القانوني
  valid_from    date NOT NULL DEFAULT current_date
);

CREATE TABLE public_holiday (day date PRIMARY KEY, label_ar text NOT NULL);

CREATE TABLE leave_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no         text UNIQUE NOT NULL,           -- عدد الترسيم: CNG-2026-000123
  employee_id    int NOT NULL REFERENCES employee(id),
  type_code      text NOT NULL REFERENCES leave_type(code),
  reason_code    text,
  start_date     date NOT NULL,
  end_date       date NOT NULL CHECK (end_date >= start_date),
  days_counted   numeric(5,1) NOT NULL,
  days_full_pay  numeric(5,1) NOT NULL DEFAULT 0,
  days_half_pay  numeric(5,1) NOT NULL DEFAULT 0,
  days_no_pay    numeric(5,1) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'DRAFT',
  address_during text,                            -- العنوان خلال العطلة
  interim_id     int REFERENCES employee(id),     -- النائب
  comment        text,
  created_by     int NOT NULL REFERENCES employee(id), -- قد يكون عون الموارد البشرية (تسجيل نيابة)
  created_at     timestamptz NOT NULL DEFAULT now(),
  decision_no    text,                            -- عدد قرار المنح
  decision_pdf   uuid,
  version        int NOT NULL DEFAULT 1           -- قفل تفاؤلي
);
-- منع التداخل بين عطلتين نشطتين لنفس العون
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE leave_request ADD CONSTRAINT no_overlap EXCLUDE USING gist (
  employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&
) WHERE (status NOT IN ('REJECTED','CANCELLED','DRAFT'));

CREATE TABLE approval_step (       -- كل خطوة في سير العمل
  id           bigserial PRIMARY KEY,
  request_id   uuid NOT NULL REFERENCES leave_request(id),
  level        text NOT NULL,                    -- MANAGER / HR / DIRECTOR
  actor_id     int REFERENCES employee(id),
  delegate_of  int REFERENCES employee(id),      -- تفويض
  action       text NOT NULL,                    -- submit/approve/reject/return/escalate/cancel
  from_status  text NOT NULL,
  to_status    text NOT NULL,
  comment      text,
  due_at       timestamptz,
  acted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document (            -- الشهادات الطبية، مضامين الولادة، ...
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid REFERENCES leave_request(id),
  kind         text NOT NULL,
  storage_key  text NOT NULL,                    -- مخزن كائنات مشفّر
  sha256       text NOT NULL,
  mime         text NOT NULL,
  uploaded_by  int NOT NULL REFERENCES employee(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- دفتر الأرصدة: لا يُعدّل أي رصيد مباشرة، كل حركة سطر جديد (append-only)
CREATE TABLE balance_ledger (
  id           bigserial PRIMARY KEY,
  employee_id  int NOT NULL REFERENCES employee(id),
  type_code    text NOT NULL REFERENCES leave_type(code),
  period_year  int NOT NULL,
  movement     text NOT NULL CHECK (movement IN
               ('ACCRUAL','CARRY_IN','CARRY_FORFEIT','CONSUME','RESTORE','ADJUST','OPENING')),
  days         numeric(5,1) NOT NULL,            -- موجب للإضافة، سالب للخصم
  request_id   uuid REFERENCES leave_request(id),
  reason       text,
  actor_id     int REFERENCES employee(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON balance_ledger (employee_id, type_code, period_year);

CREATE VIEW balance AS
SELECT employee_id, type_code, period_year,
       sum(days) FILTER (WHERE movement IN ('ACCRUAL','CARRY_IN','OPENING')) AS entitled,
       -sum(days) FILTER (WHERE movement IN ('CONSUME','RESTORE'))           AS used,
       sum(days)                                                            AS remaining
FROM balance_ledger GROUP BY 1,2,3;

CREATE TABLE payroll_export (      -- ما يُرسل لمنظومة الأجور شهرياً
  id           bigserial PRIMARY KEY,
  employee_id  int NOT NULL REFERENCES employee(id),
  pay_month    char(7) NOT NULL,                 -- 2026-10
  request_id   uuid NOT NULL REFERENCES leave_request(id),
  days_half    numeric(5,1) NOT NULL DEFAULT 0,
  days_none    numeric(5,1) NOT NULL DEFAULT 0,
  amount_dt    numeric(12,3),                    -- مبلغ الخصم التقديري بالدينار
  batch_id     text,
  sent_at      timestamptz,
  ack_status   text,
  UNIQUE (request_id, pay_month)
);

-- سجل التدقيق: سلسلة مُجزّأة (hash chain) لاكتشاف أي تلاعب
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    int,
  actor_ip    inet,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  prev_hash   text,
  hash        text NOT NULL
);
-- بطاقة الحضور اليومية (نفس أعمدة البطاقة الورقية)
CREATE TABLE attendance_sheet (
  id           bigserial PRIMARY KEY,
  org_unit_id  int NOT NULL REFERENCES org_unit(id),
  day          date NOT NULL,
  schedule     text NOT NULL CHECK (schedule IN ('DOUBLE','SINGLE')),   -- حصتان / حصة واحدة
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','VALIDATED')),
  scan_doc_id  uuid REFERENCES document(id),     -- نسخة ممسوحة من البطاقة الورقية الممضاة
  validated_by int REFERENCES employee(id),       -- رئيس القسم
  validated_at timestamptz,
  UNIQUE (org_unit_id, day)
);

CREATE TABLE attendance_entry (
  sheet_id     bigint NOT NULL REFERENCES attendance_sheet(id),
  line_no      int NOT NULL,                      -- ع/ر
  employee_id  int NOT NULL REFERENCES employee(id),
  status       text NOT NULL CHECK (status IN ('EXPECTED','ON_LEAVE','HOLIDAY','WEEKEND')),
  leave_id     uuid REFERENCES leave_request(id), -- العطلة التي بُنيت عليها الملاحظة
  in1 time, out1 time,                            -- الحصة الصباحية: دخول / خروج
  in2 time, out2 time,                            -- الحصة المسائية: دخول / خروج
  anomalies    jsonb NOT NULL DEFAULT '[]',       -- ABSENT, HALF_ABSENT, LATE, EARLY_LEAVE, MISSING_PUNCH
  remark       text,                              -- ملاحظات
  resolution   text CHECK (resolution IN ('JUSTIFIED','SICK','DEDUCT_ANNUAL','UNPAID')),
  resolved_request uuid REFERENCES leave_request(id),
  PRIMARY KEY (sheet_id, employee_id)
);

REVOKE UPDATE, DELETE ON audit_log, balance_ledger FROM PUBLIC;
