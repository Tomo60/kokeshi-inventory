-- 20261115_shipping_cost_nullable.sql の切り戻し
--
-- これを実行すると、shipments.shipping_cost は `numeric not null default 0` に戻ります。
--
-- 実行する場所: Supabase ダッシュボードの SQL Editor。
-- 全体が1つのトランザクションなので、途中で失敗すれば何も変わりません。所要は1分未満です。
--
-- ❗NULL の行があると `set not null` は失敗します。
--   その場合、このファイルは「NULL の行が何件あるか」を示して中断します。
--   NULL の行は「送料が未入力」という情報を持っているので、0 で潰すかどうかは判断が必要です。
--   ・0 で潰してよい（当社の負担なしだった）と確認できたなら、下の「NULL を0で埋める場合」を使う
--   ・判断がつかないなら、画面側（PR-Y）だけを戻し、列は NULL 可のままにしておく
--     （新しいコードを戻せば空欄は保存できなくなるので、NULL が増えることはありません）
--
-- 画面側も戻す必要があります。新しいコードは空欄を NULL として送るため、
-- not null に戻した状態で空欄保存すると保存エラーになります。PR-Y をリバートしてください。

begin;

-- 1. NULL の行が残っていないか確認する。残っていれば中断する。
do $mingay$
declare
  v_null bigint;
  v_ids  text;
begin
  select count(*) into v_null from shipments where shipping_cost is null;
  if v_null > 0 then
    select coalesce(string_agg(id::text, ', ' order by id), '(なし)')
      into v_ids
      from (select id from shipments where shipping_cost is null order by id limit 50) t;
    raise exception
      E'送料が未入力(NULL)の行が残っているため not null に戻せません。\n'
      '  該当: %件 / id（先頭50件まで）: %\n'
      '  それぞれの送料を入れるか、「当社の負担なし」と確認できた行だけ 0 を入れてから再実行してください。'
      '（分からない行を一律 0 にすると、送料がかかっていないように見えてしまいます）',
      v_null, v_ids;
  end if;
end
$mingay$;

-- 2. 制約を戻す
alter table shipments alter column shipping_cost set default 0;
alter table shipments alter column shipping_cost set not null;

-- 3. 仕上がりの確認。is_nullable='NO' / column_default='0' に戻っていること。
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shipments' and column_name = 'shipping_cost';

commit;


-- ───────────────────────────────────────────────────────────────
-- NULL を0で埋める場合（「当社の負担なし」と確認できたときだけ）
-- 上のブロックは実行せず、こちらを実行してください。
-- 埋める前に、どの行が対象になるかを必ず見てください:
--   select id, shipped_on, carrier, method, tracking_no, note from shipments where shipping_cost is null order by id;
-- ───────────────────────────────────────────────────────────────
-- begin;
-- update shipments set shipping_cost = 0 where shipping_cost is null;
-- alter table shipments alter column shipping_cost set default 0;
-- alter table shipments alter column shipping_cost set not null;
-- select column_name, is_nullable, column_default from information_schema.columns
--  where table_schema = 'public' and table_name = 'shipments' and column_name = 'shipping_cost';
-- commit;
