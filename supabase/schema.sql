-- Mingay inventory app schema
-- Run this in the Supabase SQL editor for a fresh project.
-- Also create a public storage bucket named "mingay-photos" (Storage > New bucket > Public).

create table if not exists items (
  id bigint generated always as identity primary key,
  code text,
  name text not null,
  category text,
  source_place text,
  buy_price numeric,
  sell_price numeric,
  status text not null default 'in_stock', -- 'in_stock' | 'sold'
  photo_url text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id bigint generated always as identity primary key,
  name text not null,
  contact text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id bigint generated always as identity primary key,
  item_id bigint references items(id) on delete set null,
  customer_id bigint references customers(id) on delete set null,
  sell_price numeric not null,
  fee_rate numeric default 0,
  ad_rate numeric default 0,
  shipping_fee numeric default 0,
  net_profit numeric,
  sold_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id bigint generated always as identity primary key,
  source_type text,
  source text,
  purchase_date date not null default current_date,
  total_amount numeric not null default 0,
  quantity numeric not null default 0,
  avg_amount numeric default 0,
  note text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_items (
  id bigint generated always as identity primary key,
  purchase_id bigint references purchases(id) on delete cascade,
  item_id bigint references items(id) on delete cascade
);

create table if not exists expenses (
  id bigint generated always as identity primary key,
  category text not null,
  amount numeric not null,
  expense_date date not null default current_date,
  note text,
  is_recurring boolean not null default false,
  photo_url text,
  created_at timestamptz not null default now()
);

-- Row Level Security: disabled by default for personal single-user use with the anon key.
-- Enable + add policies if you plan to expose this beyond a trusted personal device.
