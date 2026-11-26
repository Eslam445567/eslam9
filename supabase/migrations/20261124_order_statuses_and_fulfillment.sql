-- توحيد حالات الأوردرات لتناسب دورة العمل الجديدة.
-- الحالات الجديدة: new, processing, shipped, completed, returned, cancelled.

do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'order_status' and e.enumlabel = 'pending')
     and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                     where t.typname = 'order_status' and e.enumlabel = 'new') then
    alter type public.order_status rename value 'pending' to 'new';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'order_status' and e.enumlabel = 'delivering')
     and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                     where t.typname = 'order_status' and e.enumlabel = 'shipped') then
    alter type public.order_status rename value 'delivering' to 'shipped';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'order_status' and e.enumlabel = 'returned') then
    alter type public.order_status add value 'returned';
  end if;
end
$$;

alter table public.orders alter column status set default 'new'::public.order_status;
