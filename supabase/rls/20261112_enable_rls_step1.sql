-- ============================================================================
-- RLS（Row Level Security）第1段: ログインした人だけが読み書きできるようにする
-- ============================================================================
--
-- ⚠️ このファイルは「まだ実行しない」SQLです。
--    supabase/migrations/ ではなく supabase/rls/ に置いてあるのは、
--    「保留中のマイグレーションをまとめて適用」する操作で誤って流れないようにするためです。
--
-- 実行していいのは、次の3つがすべて揃ってからです:
--   (a) ログイン機能のPRがマージされ、本番（Vercel）に反映されている
--   (b) オーナー様が実際にログインできることを確認している
--   (c) オーナー様の承認がある
--
-- 順番を間違えると（＝ログイン機能が本番に出る前にこれを実行すると）、
-- 本番のアプリは全画面がエラーになります。アプリは anon key で接続しており、
-- RLSを有効にするとポリシーに合わない読み書きはすべて拒否されるためです。
--
-- 全体を1つのトランザクションで囲んでいるので、途中で失敗すれば何も変わりません。
-- 切り戻しは supabase/rls/20261112_rollback_rls_step1.sql です。
--
-- このファイルで変えないもの（第2段で扱う）:
--   ・ストレージのバケット mingay-photos が public=true であること
--   ・storage.objects の "public access" ポリシー
--   → 写真は現在、鍵なしでURLだけで誰でも見られる状態のままです。
-- ============================================================================

begin;

-- 1) まずポリシーを作る。RLSを有効にする前に作っておくことで、
--    「有効なのにポリシーが0件」＝全件拒否、という事故を防ぐ。
--    （recurring_expenses で実際に起きたことがある。schema.sql の注記を参照）
--    create policy に if not exists が無いため、存在確認を挟んで何度流しても安全にする。
do $$
declare
  t text;
  tables text[] := array[
    'business_info', 'customers', 'expenses', 'items', 'purchase_items',
    'purchases', 'recurring_expenses', 'sales', 'shipments'
  ];
begin
  foreach t in array tables loop
    -- ログイン済み（authenticated）なら、そのテーブルを自由に読み書きできる。
    -- 利用者はオーナー様1名だけなので、行ごとの絞り込み（user_id 等）は入れない。
    -- 将来、人ごとに見える範囲を変える必要が出たら、ここを using/with check で絞る。
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || '_authenticated_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_authenticated_all', t
      );
    end if;
  end loop;
end $$;

-- 2) 9テーブルすべてで RLS を有効にする。
--    これより前の行でポリシーを作ってあるので、ログイン済みの操作は通り続ける。
alter table public.business_info      enable row level security;
alter table public.customers          enable row level security;
alter table public.expenses           enable row level security;
alter table public.items              enable row level security;
alter table public.purchase_items     enable row level security;
alter table public.purchases          enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.sales              enable row level security;
alter table public.shipments          enable row level security;

-- 3) 既存の「誰にでも全部許可」ポリシーを削除する。
--    どちらも roles=PUBLIC / using=true / with check=true で、
--    残したままRLSを有効にしても素通しになり、保護にならない。
drop policy if exists business_info_anon_all on public.business_info;
drop policy if exists shipments_anon_all     on public.shipments;

-- 4) 仕上がりの確認（この select の結果を報告に残す）。
--    期待: 9行すべて rls_enabled = true、policies = 1、anon_all_left = 0。
select c.relname                                           as tbl,
       c.relrowsecurity                                     as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policies g
         where g.schemaname = 'public' and g.tablename = c.relname
           and g.policyname like '%anon_all')               as anon_all_left
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;

commit;
