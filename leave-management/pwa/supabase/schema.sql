-- قاعدة بيانات تطبيقة العطل (Supabase / PostgreSQL)
-- تُنفَّذ مرة واحدة من: Supabase ← SQL Editor ← New query ← لصق ← Run
-- الحماية: كل عون لا يقرأ إلا سطوره (Row Level Security)، والرئيس المباشر والموارد البشرية يقرؤون الكل.

create extension if not exists pgcrypto;

-- ===== الجداول =====
create table if not exists employees (
  matricule text primary key,                       -- الرقم الآلي
  name      text not null,                          -- الإسم واللقب
  grade     text,                                   -- الرتبة
  email     text unique,                            -- البريد الذي يسجّل به الدخول
  role      text not null default 'agent' check (role in ('agent', 'manager', 'hr')),
  active    boolean not null default true,
  sort      int not null default 99
);

create table if not exists balances (
  matricule text not null references employees on update cascade,
  year      int  not null,
  entitled  numeric(5,1) not null default 30,       -- المستحق
  carried   numeric(5,1) not null default 0 check (carried between 0 and 30), -- المرحّل
  primary key (matricule, year)
);

create table if not exists holidays (
  day   date primary key,
  label text not null
);

create table if not exists leaves (
  id         uuid primary key default gen_random_uuid(),
  matricule  text not null references employees on update cascade,
  type       text not null check (type in ('ANNUAL','SICK','PRENATAL','MATERNITY','POSTNATAL','PATERNITY','EXCEPTIONAL','UNPAID')),
  start_date date not null,
  end_date   date not null check (end_date >= start_date),
  days       numeric(5,1) not null default 0,       -- يُحسب آلياً (انظر الزناد)
  reason     text,                                  -- سبب العطلة الاستثنائية
  title_year int,                                   -- بعنوان سنة (العطلة السنوية)
  address    text,                                  -- العنوان خلال العطلة
  interim    text,                                  -- النائب
  note       text,
  status     text not null default 'PENDING_MANAGER'
             check (status in ('PENDING_MANAGER','PENDING_HR','APPROVED','REJECTED','RETURNED','CANCELLED')),
  comment    text,                                  -- تعليل القرار
  log        jsonb not null default '[]',           -- سجل القرارات
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists leaves_matricule on leaves (matricule, start_date);

-- ===== هوية المستخدم المتصل =====
create or replace function my_matricule() returns text
language sql stable security definer set search_path = public as $$
  select matricule from employees where lower(email) = lower(auth.email()) and active limit 1
$$;

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from employees where lower(email) = lower(auth.email()) and active limit 1), 'none')
$$;

create or replace function is_staff() returns boolean
language sql stable as $$ select my_role() in ('manager', 'hr') $$;

-- ===== احتساب الأيام والتحقق من الرصيد (على الخادم، لا يمكن التحايل عليه من الهاتف) =====
create or replace function count_days(p_type text, p_start date, p_end date) returns numeric
language sql stable as $$
  select case when p_type = 'EXCEPTIONAL' then
    (select count(*) from generate_series(p_start, p_end, interval '1 day') d
      where extract(isodow from d) < 6 and d::date not in (select day from holidays))
  else (p_end - p_start + 1) end
$$;

create or replace function balance_of(p_matricule text, p_year int)
returns table (entitled numeric, carried numeric, used numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = public as $$
  with b as (select coalesce(max(entitled), 30) e, coalesce(max(carried), 0) c from balances where matricule = p_matricule and year = p_year),
       l as (select coalesce(sum(days) filter (where status = 'APPROVED'), 0) u,
                    coalesce(sum(days) filter (where status in ('PENDING_MANAGER','PENDING_HR')), 0) p
             from leaves where matricule = p_matricule and type = 'ANNUAL' and extract(year from start_date) = p_year)
  select b.e, b.c, l.u, l.p, b.e + b.c - l.u - l.p from b, l
  where p_matricule = my_matricule() or is_staff()
$$;

create or replace function leaves_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare rem numeric; used numeric;
begin
  new.days := count_days(new.type, new.start_date, new.end_date);
  if new.days <= 0 then raise exception 'لا توجد أيام محتسبة في هذه الفترة'; end if;
  if tg_op = 'INSERT' or new.status in ('PENDING_MANAGER','PENDING_HR','APPROVED') then
    if exists (select 1 from leaves x where x.matricule = new.matricule and x.id <> new.id
               and x.status in ('PENDING_MANAGER','PENDING_HR','APPROVED')
               and daterange(x.start_date, x.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
      raise exception 'تتداخل هذه الفترة مع عطلة أخرى مسجلة';
    end if;
  end if;
  if tg_op = 'INSERT' and new.type = 'ANNUAL' then
    select remaining into rem from balance_of(new.matricule, extract(year from new.start_date)::int);
    if coalesce(rem, 0) < new.days then raise exception 'الرصيد غير كافٍ: % يوماً متاحاً', coalesce(rem, 0); end if;
  end if;
  if tg_op = 'INSERT' and new.type = 'EXCEPTIONAL' then
    select coalesce(sum(days), 0) into used from leaves where matricule = new.matricule and type = 'EXCEPTIONAL'
      and status in ('PENDING_MANAGER','PENDING_HR','APPROVED') and extract(year from start_date) = extract(year from new.start_date);
    if used + new.days > 6 then raise exception 'تجاوز السقف السنوي للعطل الاستثنائية (6 أيام)'; end if;
  end if;
  return new;
end $$;
drop trigger if exists leaves_before on leaves;
create trigger leaves_before before insert or update of start_date, end_date, type, status on leaves
  for each row execute function leaves_before();

-- ===== الإجراءات (تُستدعى من التطبيقة) =====
-- طلب عطلة من العون: يُسجَّل باسمه هو فقط، مهما كان ما يرسله الهاتف
create or replace function request_leave(p_type text, p_start date, p_end date, p_reason text default null,
  p_title_year int default null, p_address text default null, p_interim text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m text := my_matricule(); new_id uuid;
begin
  if m is null then raise exception 'حسابك غير مسجّل لدى الموارد البشرية'; end if;
  insert into leaves (matricule, type, start_date, end_date, reason, title_year, address, interim, note, status, created_by)
  values (m, p_type, p_start, p_end, p_reason, p_title_year, p_address, p_interim, p_note,
          case when p_type in ('SICK','PRENATAL','MATERNITY','PATERNITY') then 'PENDING_HR' else 'PENDING_MANAGER' end,
          auth.email())
  returning id into new_id;
  return new_id;
end $$;

-- سحب العون لطلبه ما دام في الانتظار
create or replace function cancel_my_leave(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update leaves set status = 'CANCELLED',
    log = log || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.email(), 'from', status, 'to', 'CANCELLED'))
  where id = p_id and matricule = my_matricule() and status in ('PENDING_MANAGER','PENDING_HR','RETURNED');
  if not found then raise exception 'لا يمكن سحب هذا الطلب'; end if;
end $$;

-- قرار الرئيس المباشر أو الموارد البشرية
create or replace function decide_leave(p_id uuid, p_action text, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare cur text; nxt text; r text := my_role();
begin
  select status into cur from leaves where id = p_id for update;
  if cur is null then raise exception 'الطلب غير موجود'; end if;
  if p_action in ('reject','return') and coalesce(trim(p_comment), '') = '' then raise exception 'التعليل إجباري'; end if;
  if cur = 'PENDING_MANAGER' and r in ('manager','hr') then
    nxt := case p_action when 'approve' then 'PENDING_HR' when 'reject' then 'REJECTED' when 'return' then 'RETURNED' end;
  elsif cur = 'PENDING_HR' and r = 'hr' then
    nxt := case p_action when 'approve' then 'APPROVED' when 'reject' then 'REJECTED' when 'return' then 'RETURNED' end;
  elsif cur = 'APPROVED' and r = 'hr' and p_action = 'cancel' then
    nxt := 'CANCELLED';
  end if;
  if nxt is null then raise exception 'ليست لديك صلاحية هذا القرار في هذه المرحلة'; end if;
  update leaves set status = nxt, comment = p_comment,
    log = log || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.email(), 'from', cur, 'to', nxt, 'comment', p_comment))
  where id = p_id;
  return nxt;
end $$;

-- ===== قواعد الاطلاع (Row Level Security) =====
alter table employees enable row level security;
alter table balances  enable row level security;
alter table leaves    enable row level security;
alter table holidays  enable row level security;

drop policy if exists emp_read on employees;
create policy emp_read on employees for select to authenticated using (matricule = my_matricule() or is_staff());
drop policy if exists emp_write on employees;
create policy emp_write on employees for all to authenticated using (my_role() = 'hr') with check (my_role() = 'hr');

drop policy if exists bal_read on balances;
create policy bal_read on balances for select to authenticated using (matricule = my_matricule() or is_staff());
drop policy if exists bal_write on balances;
create policy bal_write on balances for all to authenticated using (my_role() = 'hr') with check (my_role() = 'hr');

drop policy if exists lv_read on leaves;
create policy lv_read on leaves for select to authenticated using (matricule = my_matricule() or is_staff());
drop policy if exists lv_hr on leaves;
create policy lv_hr on leaves for all to authenticated using (my_role() = 'hr') with check (my_role() = 'hr');
-- لا يوجد إدراج مباشر للعون: يمرّ عبر request_leave فقط

drop policy if exists hol_read on holidays;
create policy hol_read on holidays for select to authenticated using (true);
drop policy if exists hol_write on holidays;
create policy hol_write on holidays for all to authenticated using (my_role() = 'hr') with check (my_role() = 'hr');

revoke execute on function request_leave, cancel_my_leave, decide_leave, balance_of from public, anon;
grant execute on function request_leave, cancel_my_leave, decide_leave, balance_of to authenticated;
