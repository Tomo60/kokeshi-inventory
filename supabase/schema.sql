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

-- Existing installs: 取消フラグ（論理削除）の列。
-- deleted_at が NULL なら有効な行。NULL でなければ「取り消し済み」で、
-- アプリの一覧・集計からは外れる。行は決して消さない。
-- 詳細と ロールバックSQL は supabase/migrations/20261107_add_cancel_flag.sql を参照。
alter table purchases add column if not exists deleted_at     timestamptz;
alter table purchases add column if not exists deleted_reason text;
alter table purchases add column if not exists deleted_by     text;
create index if not exists purchases_active_idx on purchases (purchase_date desc) where deleted_at is null;

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

-- Existing installs: expenses にも同じ取消フラグを足す（経費タブの「削除」を論理削除に変えたため）。
alter table expenses add column if not exists deleted_at     timestamptz;
alter table expenses add column if not exists deleted_reason text;
alter table expenses add column if not exists deleted_by     text;
create index if not exists expenses_active_idx on expenses (expense_date desc) where deleted_at is null;

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

-- 仕入れの後追い集計対応。メルカリ等での購入を、取引単位で突き合わせられるようにする。
-- 列名と型は sales 側の同名列（channel_account / external_order_no / needs_review）に合わせている。
-- point_used / coupon_used を not null default 0 にしているのは、既存の金額系（total_amount /
-- quantity）と揃えるためで、`total_amount - point_used` のような式でNULLが伝播するのを防ぐ。
alter table purchases add column if not exists channel_account text; -- 販路内のアカウント
alter table purchases add column if not exists external_order_no text; -- 取引ID等。API連携が無いため任意入力
alter table purchases add column if not exists point_used numeric not null default 0; -- 利用ポイント
alter table purchases add column if not exists coupon_used numeric not null default 0; -- 利用クーポン
alter table purchases add column if not exists payment_method text; -- 支払方法
alter table purchases add column if not exists needs_review boolean not null default false; -- 取引IDやアカウントが未確定な行のフラグ

-- 取引IDの二重登録を防ぐ部分ユニーク索引。
-- 取引IDは任意入力なので、NULL を対象外にして未入力の行は何件でも作れるようにしている。
-- 販路ごとに採番体系が違うため、販路（purchases は source、sales は platform）との複合にしている。
create unique index if not exists purchases_source_order_no_uniq
  on purchases (source, external_order_no) where external_order_no is not null;
create unique index if not exists sales_platform_order_no_uniq
  on sales (platform, external_order_no) where external_order_no is not null;

-- 発送伝票の記録。
-- sale_id を NULL 可にしているのは、発送した時点では取引が確定していない場合や、
-- 過去分の伝票を後からまとめて入力する場合に、未紐付けのまま保存して後で結び直せるようにするため。
-- 1つの売上に対して分割発送・再送が起こりうるので、売上1:発送多の構造にしている
-- （sales 側に列を足す形にすると1売上1発送しか持てない）。
-- on delete set null にしているのは、売上を消しても「発送した事実」と伝票の写真は残すため。
-- shipping_cost を not null default 0 にしているのは既存の金額系と揃えるためで、合計の算出でNULLが伝播するのを防ぐ。
create table if not exists shipments (
  id bigint generated always as identity primary key,
  sale_id bigint references sales(id) on delete set null,
  shipped_on date not null default current_date,
  carrier text, -- 'yamato' | 'japanpost' | 'sagawa' | 'other'
  method text, -- 'rakuraku' | 'nekoposu' | 'compact' | 'takkyubin' | 'yuyu' | 'yupacket' | 'yupacket_post' | 'yupack' | 'other'
  tracking_no text, -- 追跡番号。API連携が無いため任意入力
  shipping_cost numeric not null default 0, -- 送料（実額）
  recipient text, -- お届け先の名前
  destination text, -- お届け先（都道府県・市区町村など）
  note text,
  photo_url text, -- 伝票の写真
  created_at timestamptz not null default now()
);

-- 追跡番号の二重登録を防ぐ部分ユニーク索引。
-- 追跡番号は任意入力なので、NULL を対象外にして未入力の行は何件でも作れるようにしている。
-- 取引ID（purchases.external_order_no / sales.external_order_no）とは違い、販路や業者との複合にしていない。
-- 追跡番号は業者をまたいで実質的に一意で、かつ「どの業者で出したか記憶違いのまま再入力する」ことが
-- 二重登録の主な原因になるため、業者を含めると弾けなくなるのを避けている。
create unique index if not exists shipments_tracking_no_uniq
  on shipments (tracking_no) where tracking_no is not null;

-- 事業情報（古物商許可の記録）。
-- 古物営業法で定められた「許可証の番号・交付年月日・公安委員会」を帳簿側からも参照できるようにする。
--
-- 設計上の決めごと:
-- ・1行しか存在しない設計。`id smallint primary key default 1 check (id = 1)` により、
--   2行目を入れようとすると制約違反で弾かれる（取り違えや二重登録が起きない）。
-- ・氏名・生年月日・住所などの個人情報は意図的に持たない。
--   許可証そのものの記録に必要なのは番号・交付日・公安委員会・行商の有無であり、
--   Supabaseの公開鍵がブラウザに配信される構成では、持たせない方が安全なため。
-- ・peddling（行商する／しない）は許可証の記載事項なので、boolean で保持する。
create table if not exists business_info (
  id smallint primary key default 1 check (id = 1),
  license_no text, -- 許可証番号（例: 第000000000000号）
  license_issued_on date, -- 交付年月日
  public_safety_commission text, -- 許可を出した公安委員会
  peddling boolean not null default false, -- 行商する(true)／しない(false)
  note text,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security（RLS）について
-- ============================================================================
--
-- ⚠️ このファイルは RLS の状態を変えません。意図的にそうしています。
--
-- RLS の設定は supabase/rls/ のスクリプトだけで管理します:
--   ・supabase/rls/20261112_enable_rls_step1.sql   … 有効化（ログイン必須にする）
--   ・supabase/rls/20261112_rollback_rls_step1.sql … 切り戻し
--
-- このファイルに `alter table ... enable/disable row level security` を書かないのは、
-- schema.sql を再実行したときに保護が勝手に外れたり、逆にログイン機能が本番に
-- 出る前に有効化されて全画面エラーになったりするのを防ぐためです。
--
-- 【新しくプロジェクトを作った場合】
-- Postgres の既定どおり、create table したテーブルは RLS が無効です。つまり
-- anon key を知っている人なら誰でも読み書きできる状態から始まります。
-- anon key はブラウザ向けのJSバンドルに埋め込まれるため秘密にはできません。
-- **自分だけの検証用でなければ、このファイルを流したあとに
--   supabase/rls/20261112_enable_rls_step1.sql も必ず流してください。**
-- アプリ側は src/components/Login.jsx のログインを通さないとデータを読みに行かない
-- 作りになっているので、ログイン用のユーザーを Supabase の
-- Authentication → Users から1つ作る必要があります（手順は README）。
--
-- 【過去にはまった点。消さずに残しています】
-- ・RLS を有効にしただけでポリシーを作らないと、全件拒否になる。
--   2026-09-27 に recurring_expenses だけこの状態になっており、定期経費機能が
--   一度も動いていなかった（アプリからは常に0件・保存もできない）。
--   そのため enable_rls_step1.sql は「ポリシーを作ってから有効にする」順序にしてある。
-- ・Supabase ダッシュボードの Table Editor からテーブルを作ると RLS が既定で有効になる。
--   このファイルを使わず手作業でテーブルを足すと、そのテーブルだけ挙動が変わる。
-- ・shipments と business_info には以前 `..._anon_all`（誰にでも全部許可）という
--   ポリシーがあった。将来 RLS を有効にしたときの全件拒否を避けるための保険だったが、
--   残したまま RLS を有効にしても素通しになり保護にならないため、
--   enable_rls_step1.sql で削除する。このファイルでも再作成しない。
--
-- 確認:
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
--   select schemaname, tablename, policyname, roles, cmd from pg_policies
--    where schemaname = 'public' order by tablename;
-- ============================================================================
