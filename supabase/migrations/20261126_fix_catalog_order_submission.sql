-- إصلاح فشل حفظ أوردر الكتالوج متعدد الأصناف.
-- بعض النسخ القديمة أنشأت فهرسًا فريدًا على catalog_request_id
-- رغم أن نفس الطلب قد يحتوي أكثر من سطر منتج.

drop index if exists public.orders_catalog_request_id_uidx;

create index if not exists orders_catalog_request_id_idx
  on public.orders(catalog_request_id)
  where catalog_request_id is not null;

alter table public.orders
  add column if not exists product_name_snapshot text;

alter table public.catalog_settings
  add column if not exists whatsapp_number text not null default '';
