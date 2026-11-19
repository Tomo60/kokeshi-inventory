-- ============================================================================
-- RLS 第1段の切り戻し
-- ============================================================================
--
-- 使う場面: RLSを有効にしたあとアプリが使えなくなり、原因の切り分けより先に
--           まず元に戻したいとき。これを流せば 2026-11-12 以前の状態に戻ります。
--
-- ⚠️ 戻すと、サイトのURLを知っている人が誰でも帳簿を読み書き削除できる状態に
--    戻ります。応急処置として使い、戻したあとに原因を直してからもう一度進めてください。
--
-- 全体を1つのトランザクションで囲んでいるので、途中で失敗すれば何も変わりません。
-- ============================================================================

begin;

-- 1) RLS を無効に戻す。これだけでアプリ（anon key）はすぐ元どおり読み書きできる。
alter table public.business_info      disable row level security;
alter table public.customers          disable row level security;
alter table public.expenses           disable row level security;
alter table public.items              disable row level security;
alter table public.purchase_items     disable row level security;
alter table public.purchases          disable row level security;
alter table public.recurring_expenses disable row level security;
alter table public.sales              disable row level security;
alter table public.shipments          disable row level security;

-- 2) 削除した2つのポリシーを戻す。
--    RLSが無効な間は効かないが、将来また有効にしたときに
--    「ポリシー0件で全件拒否」にならないための保険として元の形に戻しておく。
--    （元の定義: for all / roles=PUBLIC / using=true / with check=true）
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_info'
      and policyname = 'business_info_anon_all'
  ) then
    create policy business_info_anon_all on public.business_info
      for all using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shipments'
      and policyname = 'shipments_anon_all'
  ) then
    create policy shipments_anon_all on public.shipments
      for all using (true) with check (true);
  end if;
end $$;

-- 3) 追加した authenticated 用ポリシーを削除する。
--    ※ 残したままでも害はない（RLSが無効なら効かない）。もう一度第1段をやり直す
--      つもりなら、この手順3は飛ばして残しておいてよい。
drop policy if exists business_info_authenticated_all      on public.business_info;
drop policy if exists customers_authenticated_all          on public.customers;
drop policy if exists expenses_authenticated_all           on public.expenses;
drop policy if exists items_authenticated_all              on public.items;
drop policy if exists purchase_items_authenticated_all     on public.purchase_items;
drop policy if exists purchases_authenticated_all          on public.purchases;
drop policy if exists recurring_expenses_authenticated_all on public.recurring_expenses;
drop policy if exists sales_authenticated_all              on public.sales;
drop policy if exists shipments_authenticated_all          on public.shipments;

-- 4) 仕上がりの確認。期待: 9行すべて rls_enabled = false。
select c.relname           as tbl,
       c.relrowsecurity     as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;

commit;
