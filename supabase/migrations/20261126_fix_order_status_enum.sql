-- إصلاح عدم وجود حالة new في بعض قواعد البيانات القديمة.
-- يحافظ على الحالات القديمة ويضيف الحالات المستخدمة في النظام الحالي.

do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'order_status' and e.enumlabel = 'pending'
  ) and not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'order_status' and e.enumlabel = 'new'
  ) then
    alter type public.order_status rename value 'pending' to 'new';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'order_status' and e.enumlabel = 'delivering'
  ) and not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'order_status' and e.enumlabel = 'shipped'
  ) then
    alter type public.order_status rename value 'delivering' to 'shipped';
  end if;

  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'new') then
    alter type public.order_status add value 'new';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'processing') then
    alter type public.order_status add value 'processing';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'shipped') then
    alter type public.order_status add value 'shipped';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'completed') then
    alter type public.order_status add value 'completed';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'returned') then
    alter type public.order_status add value 'returned';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'cancelled') then
    alter type public.order_status add value 'cancelled';
  end if;
end
$$;
