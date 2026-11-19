-- 送料の「未入力」と「0円」を区別できるようにする（PR-Y）
--
--   NULL   = 未入力（送料がいくらだったか分からない。着払いで額が不明な場合もここ）
--   0      = 当社の負担なし（着払いで受取人が払った・送料込みで出品者が払った）
--   正の数 = 当社が払った額
--
-- これまで shipments.shipping_cost は `numeric not null default 0` で、入力欄を空欄のまま
-- 保存すると 0 が入っていた。そのため登録済みの3件がすべて ¥0 になり、「本当に0円だったのか、
-- 入れ忘れたのか」が後から区別できなくなっていた。
--
-- 実行する場所: Supabase ダッシュボードの SQL Editor（anon key からは実行できません）。
-- 実行する時期: コードのデプロイ後。先に適用しても古いコードは 0 を送るだけなので壊れませんが、
--   「空欄→NULL」で保存する新しい画面が本番に出てから適用するほうが分かりやすいです。
--
-- 安全装置: 全体が1つのトランザクションなので、途中で失敗すれば何も変わりません。
--   既存の行の値は書き換えません（制約だけを外します）。
--
-- ❗既存3件（id=1〜3）の 0 は、このファイルでは触りません。
--   id=1 は 2026-11-10 の着払い伝票（¥1,380・受取人負担）と同じ荷物かどうかが未確定で、
--   伝票の送り状番号「…9062-5700」が登録済み3件のどれとも一致しないため、
--   「まだ登録されていない4件目の発送」である可能性が残っています。
--   id=2・3 は送料の実額が未確認です。
--   行ごとの判断がつき、オーナー様の承認が得られてから個別に直します。参考SQL（まだ実行しない）:
--     update shipments set shipping_cost = null where id in (2, 3);   -- 未入力に直す場合
--     -- 戻すSQL: update shipments set shipping_cost = 0 where id in (2, 3);
--
-- 切り戻し: supabase/migrations/20261115_shipping_cost_nullable_rollback.sql

begin;

-- 適用前の状態（is_nullable='NO' / column_default='0' のはず）
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shipments' and column_name = 'shipping_cost';

alter table shipments alter column shipping_cost drop not null;
alter table shipments alter column shipping_cost drop default;

-- 仕上がりの確認。is_nullable='YES' / column_default が空 になっていること。
select column_name, data_type, is_nullable, column_default,
       (select count(*) from shipments) as rows_all,
       (select count(*) from shipments where shipping_cost is null) as cost_null,
       (select count(*) from shipments where shipping_cost = 0) as cost_zero
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shipments' and column_name = 'shipping_cost';

commit;
