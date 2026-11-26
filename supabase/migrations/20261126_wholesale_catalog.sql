-- كتالوج البيع بالجملة المرتبط بنظام الأوردرات الحالي.
-- الترحيل إضافي: لا يحذف بيانات قديمة ولا يغيّر حالات الأوردرات الحالية.

create extension if not exists pgcrypto;

-- تخزين صور المنتجات: القراءة عامة للكتالوج، والرفع/التعديل للمستخدمين المصرح لهم فقط.
insert into storage.buckets(id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

create or replace function public.can_manage_product_images()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active is true
      and (
        p.role = 'admin'
        or (p.role = 'marketer' and coalesce((p.permissions->>'edit_product')::boolean, false))
      )
  );
$$;

revoke all on function public.can_manage_product_images() from public;
grant execute on function public.can_manage_product_images() to authenticated;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select to public
  using (bucket_id = 'product-images');

drop policy if exists product_images_authorized_upload on storage.objects;
create policy product_images_authorized_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.can_manage_product_images());

drop policy if exists product_images_authorized_update on storage.objects;
create policy product_images_authorized_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.can_manage_product_images())
  with check (bucket_id = 'product-images' and public.can_manage_product_images());

drop policy if exists product_images_authorized_delete on storage.objects;
create policy product_images_authorized_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.can_manage_product_images());

alter table public.profiles
  add column if not exists catalog_invite_token text;

update public.profiles
set catalog_invite_token = replace(gen_random_uuid()::text, '-', '')
where catalog_invite_token is null or btrim(catalog_invite_token) = '';

alter table public.profiles
  alter column catalog_invite_token set default replace(gen_random_uuid()::text, '-', ''),
  alter column catalog_invite_token set not null;

create unique index if not exists profiles_catalog_invite_token_uidx
  on public.profiles(catalog_invite_token);

alter table public.products
  add column if not exists size text not null default '',
  add column if not exists design text not null default '',
  add column if not exists image_url text not null default '';

alter table public.orders
  add column if not exists client_governorate text not null default '',
  add column if not exists client_city text not null default '',
  add column if not exists product_name_snapshot text,
  add column if not exists catalog_request_id text,
  add column if not exists catalog_referrer_id uuid references public.profiles(id),
  add column if not exists order_source text not null default 'dashboard';

drop index if exists public.orders_catalog_request_id_uidx;
create index if not exists orders_catalog_request_id_idx
  on public.orders(catalog_request_id)
  where catalog_request_id is not null;

create index if not exists orders_catalog_referrer_id_idx
  on public.orders(catalog_referrer_id)
  where catalog_referrer_id is not null;

create table if not exists public.catalog_settings (
  id boolean primary key default true check (id = true),
  factory_name text not null default 'كتالوج المصنع',
  logo_url text not null default '',
  whatsapp_number text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.catalog_settings
  add column if not exists whatsapp_number text not null default '';

insert into public.catalog_settings(id, factory_name, logo_url)
values (true, 'كتالوج المصنع', '')
on conflict (id) do nothing;

create table if not exists public.catalog_order_requests (
  request_id text primary key,
  order_group_id uuid not null,
  created_at timestamptz not null default now()
);

revoke all on public.catalog_settings from anon, authenticated;
revoke all on public.catalog_order_requests from anon, authenticated;

-- نسخة منتجات خاصة بالأدمن تتضمن الحقول الجديدة، بدون التأثير على views القديمة.
drop view if exists public.products_catalog_admin;
create view public.products_catalog_admin as
select id, legacy_id, name, size, design, image_url, sale_price, cost_price, is_active, created_at
from public.products;
revoke all on public.products_catalog_admin from anon, authenticated;

create or replace function public.get_catalog_products_admin()
returns jsonb
language plpgsql
security definer
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
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.products p where p.is_active is true), '[]'::jsonb);
end;
$$;

revoke all on function public.get_catalog_products_admin() from public;
grant execute on function public.get_catalog_products_admin() to authenticated;

drop view if exists public.products_catalog_marketers;
create view public.products_catalog_marketers as
select p.id, p.legacy_id, p.name, p.size, p.design, p.image_url,
       p.sale_price, p.is_active, p.created_at
from public.products p
where p.is_active is true;
grant select on public.products_catalog_marketers to authenticated;

create or replace function public.get_catalog_settings_admin()
returns jsonb
language plpgsql
security definer
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
  return (select to_jsonb(s) - 'id' from public.catalog_settings s where s.id = true);
end;
$$;

revoke all on function public.get_catalog_settings_admin() from public;
grant execute on function public.get_catalog_settings_admin() to authenticated;

drop function if exists public.admin_update_catalog_settings(text, text);
create or replace function public.admin_update_catalog_settings(
  p_factory_name text,
  p_logo_url text default '',
  p_whatsapp_number text default ''
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
  insert into public.catalog_settings(id, factory_name, logo_url, whatsapp_number, updated_at)
  values (true, coalesce(nullif(btrim(coalesce(p_factory_name, '')), ''), (select factory_name from public.catalog_settings where id = true), 'كتالوج المصنع'), btrim(coalesce(p_logo_url, '')), btrim(coalesce(p_whatsapp_number, '')), now())
  on conflict (id) do update set
    factory_name = excluded.factory_name,
    logo_url = excluded.logo_url,
    whatsapp_number = excluded.whatsapp_number,
    updated_at = now()
  returning to_jsonb(catalog_settings.*) - 'id' into result;
  return result;
end;
$$;

revoke all on function public.admin_update_catalog_settings(text, text, text) from public;
grant execute on function public.admin_update_catalog_settings(text, text, text) to authenticated;

-- نسخة جديدة من RPC إدارة المنتج تحفظ حقول الكتالوج بالإضافة للحقول القديمة.
drop function if exists public.admin_manage_product(text, uuid, text, numeric, numeric, boolean);
create or replace function public.admin_manage_product(
  p_action text,
  p_product_id uuid default null,
  p_name text default null,
  p_sale_price numeric default 0,
  p_cost_price numeric default 0,
  p_is_active boolean default true,
  p_size text default '',
  p_design text default '',
  p_image_url text default ''
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

  if p_action = 'create' then
    insert into public.products(name, size, design, image_url, sale_price, cost_price, is_active)
    values (btrim(coalesce(p_name, '')), btrim(coalesce(p_size, '')), btrim(coalesce(p_design, '')),
            btrim(coalesce(p_image_url, '')), coalesce(p_sale_price, 0),
            case when caller_role = 'admin' then coalesce(p_cost_price, 0) else 0 end, true)
    returning to_jsonb(products.*) into result;
  elsif p_action = 'update' then
    update public.products
    set name = btrim(coalesce(p_name, name)),
        size = btrim(coalesce(p_size, size)),
        design = btrim(coalesce(p_design, design)),
        image_url = btrim(coalesce(p_image_url, image_url)),
        sale_price = coalesce(p_sale_price, sale_price),
        cost_price = case when caller_role = 'admin' then coalesce(p_cost_price, cost_price) else cost_price end,
        is_active = coalesce(p_is_active, is_active)
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

revoke all on function public.admin_manage_product(text, uuid, text, numeric, numeric, boolean, text, text, text) from public;
grant execute on function public.admin_manage_product(text, uuid, text, numeric, numeric, boolean, text, text, text) to authenticated;

-- RPC عامة لا تعرض أي جدول للزائر. المصدر يُحل من رمز الدعوة ويظل محفوظًا في كل سطر أوردر.
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
      where p.role in ('marketer', 'admin')
        and p.is_active is true
        and nullif(btrim(coalesce(p_invite_token, '')), '') is not null
        and p.catalog_invite_token = btrim(p_invite_token)
      limit 1
    ),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'size', p.size,
        'design', p.design,
        'imageUrl', p.image_url,
        'salePrice', p.sale_price
      ) order by p.created_at desc)
      from public.products p where p.is_active is true
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_catalog(text) from public;
grant execute on function public.get_public_catalog(text) to anon, authenticated;

create or replace function public.create_public_catalog_order(
  p_invite_token text,
  p_request_id text,
  p_client_name text,
  p_client_phone text,
  p_client_governorate text,
  p_client_city text,
  p_client_address text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_key text := nullif(btrim(coalesce(p_request_id, '')), '');
  marketer uuid;
  referrer_role text;
  order_owner_id uuid;
  group_id uuid := gen_random_uuid();
  item jsonb;
  item_no integer;
  item_product_id uuid;
  item_quantity integer;
  total_quantity integer := 0;
  product_row record;
  first_order record;
  already_group uuid;
begin
  if request_key is null or length(request_key) > 120 then
    raise exception 'A valid request id is required';
  end if;
  if nullif(btrim(coalesce(p_client_name, '')), '') is null
     or nullif(btrim(coalesce(p_client_phone, '')), '') is null
     or nullif(btrim(coalesce(p_client_governorate, '')), '') is null
     or nullif(btrim(coalesce(p_client_city, '')), '') is null
     or nullif(btrim(coalesce(p_client_address, '')), '') is null then
    raise exception 'Customer name, phone, governorate, city, and address are required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one product is required';
  end if;

  if nullif(btrim(coalesce(p_invite_token, '')), '') is not null then
    select id, role into marketer, referrer_role
    from public.profiles
    where role in ('marketer', 'admin') and is_active is true and catalog_invite_token = btrim(p_invite_token)
    limit 1;
    if marketer is null then raise exception 'Invalid marketer invite link'; end if;
  end if;

  order_owner_id := marketer;
  if order_owner_id is null then
    select id into order_owner_id
    from public.profiles
    where role = 'admin' and is_active is true
    limit 1;
  end if;
  if order_owner_id is null then
    raise exception 'No active admin is available to receive catalog orders';
  end if;

  insert into public.catalog_order_requests(request_id, order_group_id)
  values (request_key, group_id)
  on conflict (request_id) do nothing;

  if not found then
    select order_group_id into already_group
    from public.catalog_order_requests where request_id = request_key;
    select o.id, coalesce(o.legacy_id, 'ORD-' || lpad(o.order_no::text, 4, '0')) as order_number,
           o.order_group_id
    into first_order
    from public.orders o where o.order_group_id = already_group
    order by o.order_item_no, o.created_at, o.id limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'orderNumber', first_order.order_number);
  end if;

  for item, item_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    item_product_id := nullif(item->>'productId', '')::uuid;
    item_quantity := (item->>'quantity')::integer;
    if item_product_id is null or item_quantity is null or item_quantity < 1 then
      raise exception 'Every item needs a valid product and quantity';
    end if;
    if (select count(*) from jsonb_array_elements(p_items) other
        where other->>'productId' = item_product_id::text) > 1 then
      raise exception 'Duplicate products are not allowed';
    end if;
    select id, name, sale_price, cost_price into product_row
    from public.products where id = item_product_id and is_active is true;
    if product_row.id is null then raise exception 'Product is not available'; end if;
    total_quantity := total_quantity + item_quantity;
  end loop;

  if total_quantity < 30 then
    raise exception 'Minimum wholesale order is 30 dozen';
  end if;

  for item, item_no in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    item_product_id := (item->>'productId')::uuid;
    item_quantity := (item->>'quantity')::integer;
    select id, name, sale_price, cost_price into product_row
    from public.products where id = item_product_id and is_active is true;
    insert into public.orders(
      client_name, client_phone, client_address, client_governorate, client_city,
      product_id, product_name_snapshot, quantity, sale_price, cost_price, status, marketer_id,
      catalog_referrer_id, notes, order_group_id, order_item_no, catalog_request_id, order_source
    ) values (
      btrim(p_client_name), btrim(p_client_phone), btrim(p_client_address),
      btrim(p_client_governorate), btrim(p_client_city), product_row.id, product_row.name, item_quantity,
      product_row.sale_price, product_row.cost_price,
      'new'::public.order_status, order_owner_id,
      marketer, btrim(coalesce(p_notes, '')),
      group_id, item_no, case when item_no = 1 then request_key else null end, 'catalog'
    );
  end loop;

  select o.id, coalesce(o.legacy_id, 'ORD-' || lpad(o.order_no::text, 4, '0')) as order_number,
         o.order_group_id
  into first_order
  from public.orders o where o.order_group_id = group_id
  order by o.order_item_no, o.created_at, o.id limit 1;

  return jsonb_build_object('ok', true, 'duplicate', false,
    'orderNumber', first_order.order_number);
end;
$$;

revoke all on function public.create_public_catalog_order(text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_catalog_order(text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

-- views جديدة تضيف بيانات العميل القادمة من الكتالوج دون تغيير أسماء الحقول القديمة.
drop view if exists public.orders_for_admin_items;
create view public.orders_for_admin_items as
select base.*, o.order_group_id, coalesce(o.order_item_no, 1) as order_item_no,
       o.client_governorate, o.client_city, o.catalog_referrer_id, o.order_source,
       referrer.name as catalog_referrer_name
from public.orders_for_admin base
join public.orders o on o.id = base.id
left join public.profiles referrer on referrer.id = o.catalog_referrer_id;

drop view if exists public.orders_for_marketers_items;
create view public.orders_for_marketers_items as
select base.*, o.order_group_id, coalesce(o.order_item_no, 1) as order_item_no,
       o.client_governorate, o.client_city, o.order_source
from public.orders_for_marketers base
join public.orders o on o.id = base.id;

grant select on public.orders_for_admin_items, public.orders_for_marketers_items to authenticated;
