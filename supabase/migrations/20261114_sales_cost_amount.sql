-- 利益の定義統一（PR-X / 経理決定 2026-11-12）
--
--   利益（net_profit）= 販売価格 − 仕入原価(cost_amount) − 手数料 − 広告費 − 送料
--
-- このファイルは「既存のデータベースに cost_amount を足し、cost_amount と net_profit を
-- not null にする」ための1回限りのマイグレーションです。新規に作るデータベースでは
-- supabase/schema.sql がこれと同じ状態を作るので、実行する必要はありません。
--
-- 実行する場所: Supabase ダッシュボードの SQL Editor（anon key からは実行できません）。
-- 実行する時期: コードのデプロイ後。net_profit を not null にするため、net_profit を
--   必ず保存する新しい販売フォームが本番に出ているほうが安全です（古いコードが
--   net_profit なしで insert すると保存エラーになります）。
--
-- 安全装置:
--   ・全体が1つのトランザクションなので、途中で失敗すれば何も変わりません。
--   ・埋め戻せない行（原価が分からない行）が残っていると、not null を付ける前に
--     raise exception で止まります。0 で埋めて利益を過大にすることはしません。
--
-- 切り戻し: supabase/migrations/20261114_sales_cost_amount_rollback.sql

begin;

-- 1. 列の追加（すでにあれば何もしない）
alter table sales add column if not exists cost_amount numeric;

-- 2. 既存行の埋め戻し。
--    紐付いた商品(items)の仕入値が引ける行だけを埋める。
--    商品に紐付いていない行・商品の仕入値が未設定の行は、ここでは埋めない（下の 3 で止まる）。
update sales s
   set cost_amount = i.buy_price
  from items i
 where i.id = s.item_id
   and s.cost_amount is null
   and i.buy_price is not null;

-- 3. 埋め戻せなかった行が残っていないか確認する。
--    残っていれば、どの行かを示して中断する（not null は付けない）。
do $mingay$
declare
  v_null_cost bigint;
  v_null_net  bigint;
  v_ids       text;
begin
  select count(*) filter (where cost_amount is null),
         count(*) filter (where net_profit is null)
    into v_null_cost, v_null_net
    from sales;

  if v_null_cost > 0 or v_null_net > 0 then
    select coalesce(string_agg(id::text, ', ' order by id), '(なし)')
      into v_ids
      from (select id from sales
             where cost_amount is null or net_profit is null
             order by id limit 50) t;
    raise exception
      E'手で埋める必要のある行が残っています。\n'
      '  cost_amount が NULL: %件 / net_profit が NULL: %件\n'
      '  該当する id（先頭50件まで）: %\n'
      '  売上1件ごとの仕入原価を入れてから、このファイルを再実行してください。'
      '（無償で入手したものだけ 0 を入れてください。分からない行を一律 0 にすると利益が過大になります）',
      v_null_cost, v_null_net, v_ids;
  end if;
end
$mingay$;

-- 4. not null を付ける。
--    cost_amount: 原価の未入力を黙って 0 として計上しないため（経理の指示）。
--    net_profit : フォールバックを廃止し、登録時に必ず保存する方式に統一したため。
alter table sales alter column cost_amount set not null;
alter table sales alter column net_profit  set not null;

-- 5. 仕上がりの確認。cost_amount と net_profit がともに is_nullable='NO' になっていること。
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'sales'
   and column_name in ('cost_amount', 'net_profit')
 order by column_name;

commit;
