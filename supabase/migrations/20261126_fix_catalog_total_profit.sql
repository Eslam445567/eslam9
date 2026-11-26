-- إصلاح رفض إنشاء أوردر الكتالوج بسبب total_profit المحسوب تلقائيًا.
-- لا يتم إدخال total_profit يدويًا؛ قاعدة البيانات تحسبه من سعر البيع والتكلفة والكمية.

alter table public.orders
  add column if not exists product_name_snapshot text,
  add column if not exists catalog_referrer_id uuid references public.profiles(id);

drop index if exists public.orders_catalog_request_id_uidx;
create index if not exists orders_catalog_request_id_idx
  on public.orders(catalog_request_id)
  where catalog_request_id is not null;

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
  referrer_id uuid;
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
    select id, role into referrer_id, referrer_role
    from public.profiles
    where role in ('marketer', 'admin')
      and is_active is true
      and catalog_invite_token = btrim(p_invite_token)
    limit 1;
    if referrer_id is null then raise exception 'Invalid marketer invite link'; end if;
  end if;

  -- orders.marketer_id is required by the existing system. For an admin link,
  -- keep the admin as the owner; for a direct catalog visit, use an active admin
  -- as the internal owner while leaving catalog_referrer_id empty.
  order_owner_id := referrer_id;
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
    select o.id, coalesce(o.legacy_id, 'ORD-' || lpad(o.order_no::text, 4, '0')) as order_number
    into first_order
    from public.orders o
    where o.order_group_id = already_group
    order by o.order_item_no, o.created_at, o.id
    limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'orderNumber', first_order.order_number);
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
      product_id, product_name_snapshot, quantity, sale_price, cost_price,
      status, marketer_id, catalog_referrer_id, notes, order_group_id,
      order_item_no, catalog_request_id, order_source
    ) values (
      btrim(p_client_name), btrim(p_client_phone), btrim(p_client_address),
      btrim(p_client_governorate), btrim(p_client_city), product_row.id,
      product_row.name, item_quantity, product_row.sale_price, product_row.cost_price,
      'new'::public.order_status,
      order_owner_id,
      referrer_id, btrim(coalesce(p_notes, '')), group_id, item_no,
      case when item_no = 1 then request_key else null end, 'catalog'
    );
  end loop;

  select o.id, coalesce(o.legacy_id, 'ORD-' || lpad(o.order_no::text, 4, '0')) as order_number
  into first_order
  from public.orders o
  where o.order_group_id = group_id
  order by o.order_item_no, o.created_at, o.id
  limit 1;

  return jsonb_build_object('ok', true, 'duplicate', false, 'orderNumber', first_order.order_number);
end;
$$;

revoke all on function public.create_public_catalog_order(text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_catalog_order(text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;
