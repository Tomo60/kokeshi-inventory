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
  purchase_date date, -- 仕入日付。滞留期間(仕入日から現在までの経過日数)の起点として使用
  storage_location text, -- 保存場所(棚番号・保管場所など)
  lot_number text, -- ロット番号
  condition text, -- 状態/コンディション（例: new, like_new, good, fair, poor, junk）
  expected_sell_by date, -- 想定販売期限
  note text,
  created_at timestamptz not null default now()
);

-- Existing installs (fresh `create table` above is skipped once the table exists):
-- run these to add the new purchase-management columns to an already-provisioned database.
alter table items add column if not exists purchase_date date;
alter table items add column if not exists storage_location text;
alter table items add column if not exists lot_number text;
alter table items add column if not exists condition text;
alter table items add column if not exists expected_sell_by date;

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
  payee text, -- 支払先
  payment_method text, -- 支払方法
  note text,
  is_recurring boolean not null default false,
  photo_url text,
  created_at timestamptz not null default now()
  -- recurring_expense_id は recurring_expenses 作成後に下の alter table で追加する
);

-- 定期経費テンプレート（家賃など毎月同日に発生する固定費の定義）。
-- 実績は expenses に自動生成され、このテーブルは「何を・いくら・毎月何日に計上するか」だけを保持する。
create table if not exists recurring_expenses (
  id bigint generated always as identity primary key,
  category text not null,
  amount numeric not null,
  day_of_month integer not null check (day_of_month between 1 and 28), -- 全ての月に存在する日のみ許可
  payee text,
  payment_method text,
  note text,
  active boolean not null default true,
  start_date date not null default current_date,
  end_date date,
  last_generated_month text, -- 'YYYY-MM'。重複生成の防止に使用
  created_at timestamptz not null default now()
);

-- 定期経費まわりの expenses 側の列。新規・既存どちらのデータベースでもここで追加される
-- （recurring_expense_id は上の recurring_expenses 作成後でないと外部キーを張れないため、この位置）。
alter table expenses add column if not exists payee text;
alter table expenses add column if not exists payment_method text;
alter table expenses add column if not exists recurring_expense_id bigint references recurring_expenses(id) on delete set null;

-- 売上の多販路・複数アカウント対応（Phase 1）。
-- 既存の fee_rate / ad_rate（率）は後方互換のため残し、入力UIは fee_amount / ad_amount（実額）を主とする。
alter table sales add column if not exists platform text not null default 'mercari'; -- 'mercari' | 'mercari_shops' | 'base' | 'yahoo_auction' | 'store' | 'other'
alter table sales add column if not exists channel_account text; -- 販路内のアカウント（メルカリの複数アカウントのどれか）
alter table sales add column if not exists external_order_no text; -- 取引ID等。API連携が無いため任意入力
alter table sales add column if not exists fee_amount numeric; -- 手数料(実額)
alter table sales add column if not exists ad_amount numeric; -- 広告費(実額)
alter table sales add column if not exists payout_amount numeric; -- 実際の振込額
alter table sales add column if not exists payout_date date; -- 入金日(わかれば)
alter table sales add column if not exists sale_status text not null default 'completed'; -- 'completed' | 'returned' | 'cancelled' | 'discounted'
alter table sales add column if not exists needs_review boolean not null default false; -- channel_account 等が未確定な過去分のフラグ

-- 既存データの初期化（移行時の1回のみ）。
-- 移行日より前に作られた行だけを対象にすることで、この schema.sql を後から再実行しても
-- 移行後に入力された行には影響しないようにしている。
-- ただし、移行前の行について確認済みとして needs_review を外した場合、再実行すると再度フラグが付く点に注意。
update sales set platform = 'mercari' where platform is null;
update sales set needs_review = true where channel_account is null and created_at < '2026-09-17';

-- データマイグレーション: 経費「手数料」カテゴリの内部値を 'platform' から 'platform_fee' へ改名。
-- sales テーブルの platform 列（販売チャネル区分）との名称衝突を避けるための変更で、表示ラベルは「手数料」のまま。
-- 対象行が無ければ何も起きないため、何度実行しても安全（冪等）。
update expenses set category = 'platform_fee' where category = 'platform';

-- Row Level Security: disabled by default for personal single-user use with the anon key.
-- Enable + add policies if you plan to expose this beyond a trusted personal device.
