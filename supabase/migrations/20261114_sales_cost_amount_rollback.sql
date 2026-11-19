-- 20261114_sales_cost_amount.sql の切り戻し
--
-- これを実行すると、sales は「cost_amount 列が無く、net_profit が NULL 可」という
-- マイグレーション前の状態に戻ります。
--
-- 実行する場所: Supabase ダッシュボードの SQL Editor。
-- 全体が1つのトランザクションなので、途中で失敗すれば何も変わりません。所要は1分未満です。
--
-- 注意:
--   ・cost_amount 列を削除すると、そこに入っていた売上1行ごとの仕入原価は失われます。
--     コードだけ戻して原価の値は残したい場合は、下の「列を残す場合」のほうを使ってください。
--   ・画面側（Sales.jsx / Dashboard.jsx）も同時に戻す必要があります。新しいコードは
--     cost_amount を必ず送るため、列が無いと保存できません。PR-X をリバートしてください。

begin;

-- 1. not null を外す（列を消す前に外しておく。列削除だけでも制約は消えるが、
--    「not null だけ外して様子を見る」段階で止めたい場合にそのまま使えるようにしている）
alter table sales alter column net_profit  drop not null;
alter table sales alter column cost_amount drop not null;

-- 2. 列を削除する
alter table sales drop column if exists cost_amount;

-- 3. 仕上がりの確認。
--    net_profit が is_nullable='YES' で1行だけ返り、cost_amount は返らないこと。
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'sales'
   and column_name in ('cost_amount', 'net_profit')
 order by column_name;

commit;


-- ───────────────────────────────────────────────────────────────
-- 列を残す場合（原価の値は残したまま、not null だけ外す）
-- 上のブロックは実行せず、こちらだけを実行してください。
-- ───────────────────────────────────────────────────────────────
-- begin;
-- alter table sales alter column net_profit  drop not null;
-- alter table sales alter column cost_amount drop not null;
-- select column_name, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'sales'
--    and column_name in ('cost_amount', 'net_profit') order by column_name;
-- commit;
