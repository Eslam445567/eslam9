-- خصائص تأكيد العميل وتجميع المنتجات حسب نوع الفوطة.
-- ترحيل إضافي وآمن: لا يحذف أي منتج أو أوردر قديم، وتظل المنتجات القديمة قابلة للاستخدام.

alter table public.orders
  add column if not exists confirmation_status text not null default 'unconfirmed',
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.profiles(id);

alter table public.orders
  drop constraint if exists orders_confirmation_status_check;

alter table public.orders
  add constraint orders_confirmation_status_check
  check (confirmation_status in ('confirmed', 'unconfirmed'));

create index if not exists orders_confirmation_status_idx
  on public.orders(confirmation_status);

create table if not exists public.product_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists product_family_id uuid references public.product_families(id);

create index if not exists products_product_family_id_idx
  on public.products(product_family_id);

-- الأنواع المطلوبة مسبقًا. لا ننشئ مقاسات أو أسعارًا افتراضية بلا بيانات من المدير.
insert into public.product_families(name)
values
  ('فوطة ميكروفايبر'),
  ('فوطة وسط'),
  ('فوطة فرو شعبي'),
  ('فوطة ماركات مصري'),
  ('فوطة رصاصي')
on conflict (name) do nothing;

-- ربط المنتجات القديمة بنوع مطابق إن وجد، ثم إنشاء نوع محافظ للمنتجات غير المطابقة.
update public.products p
set product_family_id = f.id
from public.product_families f
where p.product_family_id is null
  and btrim(p.name) = f.name;

update public.products p
set product_family_id = f.id
from public.product_families f
where p.product_family_id is null
  and (
    (f.name = 'فوطة ميكروفايبر' and lower(p.name) like '%ميكروفايبر%') or
    (f.name = 'فوطة وسط' and lower(p.name) like '%وسط%') or
    (f.name = 'فوطة فرو شعبي' and lower(p.name) like '%فرو%') or
    (f.name = 'فوطة ماركات مصري' and (lower(p.name) like '%ماركات%' or lower(p.name) like '%مصري%')) or
    (f.name = 'فوطة رصاصي' and lower(p.name) like '%رصاص%')
  );

insert into public.product_families(name)
select distinct btrim(p.name)
from public.products p
where p.product_family_id is null
  and nullif(btrim(p.name), '') is not null
on conflict (name) do nothing;

update public.products p
set product_family_id = f.id
from public.product_families f
where p.product_family_id is null
  and btrim(p.name) = f.name;

-- إرجاع المنتجات للمستخدمين على هيئة أنواع، مع إبقاء كل صف قديم كمقاس/نسخة مستقلة.
create or replace function public.get_catalog_products_admin()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  caller_role text;
  caller_active boolean;
begin
  select role, is_active into caller_role, caller_active
  from public.profiles where id = auth.uid();
  if caller_role <> 'admin' or caller_active is not true then
    raise exception 'Admin access required';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(row_data) order by row_data.family_name, row_data.size, row_data.name)
    from (
      select p.id, p.legacy_id, p.name, p.size, p.design, p.image_url,
             p.sale_price, p.cost_price, p.created_at, p.is_active,
             p.product_family_id, f.name as family_name, f.is_active as family_is_active
      from public.products p
      left join public.product_families f on f.id = p.product_family_id
      where true
    ) row_data
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_catalog_products_admin() from public;
grant execute on function public.get_catalog_products_admin() to authenticated;

create or replace function public.get_product_families_admin()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  caller_role text;
  caller_active boolean;
begin
  select role, is_active into caller_role, caller_active
  from public.profiles where id = auth.uid();
  if caller_role <> 'admin' or caller_active is not true then
    raise exception 'Admin access required';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at, f.name) from public.product_families f), '[]'::jsonb);
end;
$$;

revoke all on function public.get_product_families_admin() from public;
grant execute on function public.get_product_families_admin() to authenticated;

drop view if exists public.products_catalog_marketers;
create view public.products_catalog_marketers as
select p.id, p.legacy_id, p.name, p.size, p.design, p.image_url, p.sale_price,
       p.created_at, p.is_active, p.product_family_id,
       coalesce(f.name, p.name) as family_name,
       coalesce(f.is_active, true) as family_is_active
from public.products p
left join public.product_families f on f.id = p.product_family_id
where p.is_active is true and coalesce(f.is_active, true) is true;

grant select on public.products_catalog_marketers to authenticated;

create or replace function public.admin_manage_product_family(
  p_action text,
  p_family_id uuid default null,
  p_name text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_active boolean;
  result jsonb;
begin
  select role, is_active into caller_role, caller_active
  from public.profiles where id = auth.uid();
  if caller_role <> 'admin' or caller_active is not true then
    raise exception 'Admin access required';
  end if;

  if p_action = 'create' then
    insert into public.product_families(name, is_active)
    values (btrim(coalesce(p_name, '')), true)
    returning to_jsonb(product_families.*) into result;
  elsif p_action = 'update' then
    update public.product_families
    set name = btrim(coalesce(nullif(p_name, ''), name)),
        is_active = coalesce(p_is_active, is_active),
        updated_at = now()
    where id = p_family_id
    returning to_jsonb(product_families.*) into result;
  elsif p_action = 'deactivate' then
    update public.product_families set is_active = false, updated_at = now()
    where id = p_family_id
    returning to_jsonb(product_families.*) into result;
  else
    raise exception 'Unknown product family action';
  end if;
  if result is null then raise exception 'Product family not found'; end if;
  return result;
end;
$$;

revoke all on function public.admin_manage_product_family(text, uuid, text, boolean) from public;
grant execute on function public.admin_manage_product_family(text, uuid, text, boolean) to authenticated;

-- نسخة جديدة من إدارة المنتج تضيف ربط المقاس بنوع رئيسي، مع إبقاء التوقيعات القديمة.
create or replace function public.admin_manage_product(
  p_action text,
  p_product_id uuid default null,
  p_name text default null,
  p_sale_price numeric default 0,
  p_cost_price numeric default 0,
  p_is_active boolean default true,
  p_size text default '',
  p_design text default '',
  p_image_url text default '',
  p_family_id uuid default null,
  p_family_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_active boolean;
  caller_permissions jsonb;
  allowed boolean := false;
  result jsonb;
  target_family_id uuid := p_family_id;
  target_family_name text := nullif(btrim(coalesce(p_family_name, p_name)), '');
begin
  select role, is_active, permissions into caller_role, caller_active, caller_permissions
  from public.profiles where id = auth.uid();
  if caller_active is not true or caller_role is null then raise exception 'Active profile required'; end if;
  if caller_role = 'admin' then
    allowed := true;
  elsif caller_role = 'marketer' then
    allowed := case p_action
      when 'create' then coalesce((caller_permissions->>'add_product')::boolean, false)
      when 'update' then coalesce((caller_permissions->>'edit_product')::boolean, false)
      when 'deactivate' then coalesce((caller_permissions->>'delete_product')::boolean, false)
      else false
    end;
  end if;
  if not allowed then raise exception 'Product permission required'; end if;

  if target_family_id is null and target_family_name is not null then
    insert into public.product_families(name) values (target_family_name)
    on conflict (name) do update set updated_at = now()
    returning id into target_family_id;
  end if;

  if p_action = 'create' then
    insert into public.products(name, size, design, image_url, sale_price, cost_price, is_active, product_family_id)
    values (
      coalesce(nullif(btrim(p_name), ''), target_family_name, 'منتج'),
      btrim(coalesce(p_size, '')), btrim(coalesce(p_design, '')), btrim(coalesce(p_image_url, '')),
      coalesce(p_sale_price, 0), case when caller_role = 'admin' then coalesce(p_cost_price, 0) else 0 end,
      true, target_family_id
    ) returning to_jsonb(products.*) into result;
  elsif p_action = 'update' then
    update public.products
    set name = coalesce(nullif(btrim(p_name), ''), name),
        size = btrim(coalesce(p_size, size)),
        design = btrim(coalesce(p_design, design)),
        image_url = btrim(coalesce(p_image_url, image_url)),
        sale_price = coalesce(p_sale_price, sale_price),
        cost_price = case when caller_role = 'admin' then coalesce(p_cost_price, cost_price) else cost_price end,
        is_active = coalesce(p_is_active, is_active),
        product_family_id = coalesce(target_family_id, product_family_id)
    where id = p_product_id
    returning to_jsonb(products.*) into result;
  elsif p_action = 'deactivate' then
    update public.products set is_active = false where id = p_product_id
    returning to_jsonb(products.*) into result;
  else
    raise exception 'Unknown product action';
  end if;
  if result is null then raise exception 'Product not found'; end if;
  return result;
end;
$$;

revoke all on function public.admin_manage_product(text, uuid, text, numeric, numeric, boolean, text, text, text, uuid, text) from public;
grant execute on function public.admin_manage_product(text, uuid, text, numeric, numeric, boolean, text, text, text, uuid, text) to authenticated;

-- كتالوج عام مجمّع حسب النوع؛ كل متغير يمثل مقاسًا وسعرًا مستقلًا.
create or replace function public.get_public_catalog(p_invite_token text default null)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(s) - 'id' from public.catalog_settings s where s.id = true), '{}'::jsonb),
    'marketer', (
      select jsonb_build_object('name', p.name)
      from public.profiles p
      where p.role in ('marketer', 'admin') and p.is_active is true
        and nullif(btrim(coalesce(p_invite_token, '')), '') is not null
        and p.catalog_invite_token = btrim(p_invite_token)
      limit 1
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'imageUrl', coalesce((select p0.image_url from public.products p0 where p0.product_family_id = f.id and p0.is_active is true order by p0.created_at limit 1), ''),
        'variants', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'size', p.size, 'design', p.design, 'imageUrl', p.image_url,
            'salePrice', p.sale_price
          ) order by p.size, p.created_at), '[]'::jsonb)
          from public.products p
          where p.product_family_id = f.id and p.is_active is true
        )
      ) order by f.created_at, f.name)
      from public.product_families f
      where f.is_active is true
        and exists (select 1 from public.products p where p.product_family_id = f.id and p.is_active is true)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_catalog(text) from public;
grant execute on function public.get_public_catalog(text) to anon, authenticated;

-- إجراء مستقل عن حالة التنفيذ لتأكيد العميل أو إلغاء التأكيد.
create or replace function public.update_order_confirmation(
  p_order_id uuid,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  caller_active boolean;
  caller_permissions jsonb;
  root_marketer_id uuid;
  root_group_id uuid;
  result jsonb;
begin
  select p.role, p.is_active, p.permissions into caller_role, caller_active, caller_permissions
  from public.profiles p where p.id = auth.uid();
  if caller_role is null or caller_active is not true then raise exception 'Active profile required'; end if;

  select o.marketer_id, o.order_group_id into root_marketer_id, root_group_id
  from public.orders o where o.id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if caller_role <> 'admin' and not (
    root_marketer_id = auth.uid()
    or coalesce((caller_permissions->>'view_all_orders')::boolean, false)
  ) then
    raise exception 'You do not have permission to confirm this order';
  end if;

  update public.orders
  set confirmation_status = case when p_confirmed then 'confirmed' else 'unconfirmed' end,
      confirmed_at = case when p_confirmed then now() else null end,
      confirmed_by = case when p_confirmed then auth.uid() else null end,
      updated_at = now()
  where (root_group_id is not null and order_group_id = root_group_id)
     or (root_group_id is null and id = p_order_id);

  select jsonb_build_object(
    'confirmation_status', o.confirmation_status,
    'confirmed_at', o.confirmed_at,
    'confirmed_by', o.confirmed_by,
    'confirmed_by_name', p.name
  ) into result
  from public.orders o
  left join public.profiles p on p.id = o.confirmed_by
  where o.id = p_order_id;
  return result;
end;
$$;

revoke all on function public.update_order_confirmation(uuid, boolean) from public;
grant execute on function public.update_order_confirmation(uuid, boolean) to authenticated;

-- نفس بيانات التقارير للمسوّق ذي صلاحية عرض الكل، مع النوع والمقاس والتأكيد.
create or replace function public.get_orders_for_marketer_all()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      (
        to_jsonb(o)
        || jsonb_build_object(
          'product_name', coalesce(pf.name || case when p.size <> '' then ' — ' || p.size else '' end, p.name),
          'product_family_name', pf.name,
          'product_variant_size', p.size,
          'marketer_name', m.name,
          'confirmed_by_name', confirmer.name,
          'order_group_id', o.order_group_id,
          'order_item_no', coalesce(o.order_item_no, 1)
        )
      ) - 'cost_price' - 'total_profit' - 'profit'
      order by o.created_at desc
    ), '[]'::jsonb
  )
  from public.orders o
  left join public.products p on p.id = o.product_id
  left join public.product_families pf on pf.id = p.product_family_id
  left join public.profiles m on m.id = o.marketer_id
  left join public.profiles confirmer on confirmer.id = o.confirmed_by
  where exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'marketer'
      and profile.is_active is true
      and lower(coalesce(profile.permissions->>'view_all_orders', 'false')) = 'true'
  );
$$;

grant execute on function public.get_orders_for_marketer_all() to authenticated;

-- إعادة إنشاء views العناصر لتضمين التأكيد واسم النوع/المقاس في كل شاشة وتقرير.
drop view if exists public.orders_for_admin_items;
create view public.orders_for_admin_items as
select base.*, o.order_group_id, coalesce(o.order_item_no, 1) as order_item_no,
       o.confirmation_status, o.confirmed_at, o.confirmed_by,
       confirmer.name as confirmed_by_name,
       pf.name as product_family_name, p.size as product_variant_size
from public.orders_for_admin base
join public.orders o on o.id = base.id
left join public.profiles confirmer on confirmer.id = o.confirmed_by
left join public.products p on p.id = o.product_id
left join public.product_families pf on pf.id = p.product_family_id;

drop view if exists public.orders_for_marketers_items;
create view public.orders_for_marketers_items as
select base.*, o.order_group_id, coalesce(o.order_item_no, 1) as order_item_no,
       o.confirmation_status, o.confirmed_at, o.confirmed_by,
       confirmer.name as confirmed_by_name,
       pf.name as product_family_name, p.size as product_variant_size
from public.orders_for_marketers base
join public.orders o on o.id = base.id
left join public.profiles confirmer on confirmer.id = o.confirmed_by
left join public.products p on p.id = o.product_id
left join public.product_families pf on pf.id = p.product_family_id;

grant select on public.orders_for_admin_items, public.orders_for_marketers_items to authenticated;
