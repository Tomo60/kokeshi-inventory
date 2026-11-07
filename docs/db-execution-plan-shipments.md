# 発送伝票テーブル（shipments）のDB実行計画

本番Supabase（mingei プロジェクト）へ `shipments` テーブルを追加するための手順書。
**このPRの時点ではDBには何も適用していない。** オーナーの承認後に、下記のSQLを実行する。

- 対象プロジェクト: `threvmcnpovykcgrhybh`
- 作成日: 2026-11-01
- 影響範囲: 新しいテーブルを1つ追加するだけ。**既存7テーブルのデータは一切変更しない**（既存行を読む・書く文を1つも含まない）

---

## 1. 実行前の確認（スナップショット取得）

実行前に次のクエリを流し、結果を記録しておく。実行後に同じクエリを流して、
既存テーブルの件数・合計が1つも変わっていないことを突き合わせるために使う。

```sql
select
  (select count(*) from items)              as items,
  (select count(*) from customers)          as customers,
  (select count(*) from sales)              as sales,
  (select count(*) from purchases)          as purchases,
  (select count(*) from purchase_items)     as purchase_items,
  (select count(*) from expenses)           as expenses,
  (select count(*) from recurring_expenses) as recurring_expenses,
  (select coalesce(sum(total_amount),0) from purchases) as purchases_total,
  (select coalesce(sum(point_used),0)   from purchases) as purchases_points,
  (select coalesce(sum(amount),0)       from expenses)  as expenses_total,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='shipments') as shipments_exists;
```

実行前の期待値（2026-11-01 時点の実績値）:

| 項目 | 値 |
|------|-----|
| purchases 件数 / 合計 / ポイント計 | 81件 / ¥207,927 / ¥25,560 |
| shipments_exists | 0（まだ存在しない） |

※ items / sales / expenses などの件数は実行当日の値をその場で記録する。

## 2. 実行するSQL

`supabase/schema.sql` を **Supabase ダッシュボードの SQL Editor から** 実行する。
このファイルは全体が冪等（何度実行しても同じ結果）に書かれているため、ファイル全体を流して問題ない。

> **Table Editor から手でテーブルを作ってはいけない。**
> Table Editor で作成すると Row Level Security が既定で有効になり、ポリシーが無いままだと
> アプリからは常に0件・保存もできない状態になる（`recurring_expenses` で実際に起きた不具合と同じ）。

ファイル全体ではなく追加分だけを流す場合は、以下の3ブロックを順番に実行する。

```sql
-- (1) テーブル作成
create table if not exists shipments (
  id bigint generated always as identity primary key,
  sale_id bigint references sales(id) on delete set null,
  shipped_on date not null default current_date,
  carrier text,
  method text,
  tracking_no text,
  shipping_cost numeric not null default 0,
  recipient text,
  destination text,
  note text,
  photo_url text,
  created_at timestamptz not null default now()
);

-- (2) 追跡番号の二重登録を防ぐ部分ユニーク索引（未入力の行は何件でも作れる）
create unique index if not exists shipments_tracking_no_uniq
  on shipments (tracking_no) where tracking_no is not null;

-- (3) RLS: ポリシーを作ってから無効にする（既存7テーブルと同じ挙動にしつつ、将来有効化しても壊れないように）
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shipments' and policyname = 'shipments_anon_all'
  ) then
    create policy shipments_anon_all on shipments for all using (true) with check (true);
  end if;
end $$;
alter table shipments disable row level security;
```

## 3. 実行後の確認

```sql
-- (a) テーブルと索引ができているか
select table_name from information_schema.tables
 where table_schema='public' and table_name='shipments';
select indexname from pg_indexes
 where schemaname='public' and tablename='shipments';

-- (b) RLSが「無効」で、かつポリシーが1件あるか（既存テーブルと同じ方針になっているか）
select relname, relrowsecurity as rls有効
  from pg_class
 where relnamespace='public'::regnamespace and relkind='r' and relname='shipments';
select policyname from pg_policies
 where schemaname='public' and tablename='shipments';

-- (c) 既存テーブルが1行も変わっていないか → 手順1と同じクエリを流して突き合わせる
```

判定基準:

| 確認項目 | 期待値 |
|----------|--------|
| shipments テーブル | 存在する |
| 索引 | `shipments_pkey` と `shipments_tracking_no_uniq` が存在する |
| `rls有効` | **false**（既存7テーブルと同じ） |
| ポリシー | `shipments_anon_all` が1件 |
| 既存7テーブルの件数・合計 | 手順1の記録と完全一致 |
| shipments の件数 | 0件（空のテーブルができるだけ） |

アプリ側の確認:

1. 発送タブを開く → 「発送した伝票を登録してください」と出る（⚠️の警告が出たらRLSかテーブル名を見直す）
2. テスト用に1件登録してみる → 一覧に出る → 編集できる
3. 同じ追跡番号でもう1件登録しようとする → 「既に登録されています」と止まる
4. テスト行は後述のSQLで削除する

## 4. 取り消し方法（ロールバック）

追加したものを消すだけで、既存データには触れない。

```sql
-- テスト行だけ消す場合（本番データを入れ始めた後はこちらは使わない）
delete from shipments;

-- 追加そのものを取り消す場合（テーブル・索引・ポリシーがまとめて消える）
drop table if exists shipments;
```

注意点:

- `drop table` を実行すると、登録した発送記録は**すべて失われる**（取り消せない）。本番データを入れ始めた後は使わない。
- 発送記録を消しても、Storage（`mingay-photos` バケット）に上がった伝票の写真は残る。
  行だけが消えて写真が孤児になるため、不要な写真は Storage 側で個別に削除する必要がある。
- アプリ側は「`shipments` が読めなければ発送タブにだけ警告を出し、他の機能は通常どおり動く」作りにしてあるため、
  `drop table` した状態でもアプリは壊れない。

## 5. 未決事項（オーナー確認待ち）

- 発送記録の**削除機能はこのPRには入れていない**。削除は取り消せず、写真も孤児になるため、
  経費画面と同じ確認画面を付ける形で別途ご判断いただきたい。
- 発送記録の**変更・削除の履歴（取消フラグ）**は持っていない。電子帳簿保存法の観点で履歴が必要かは未確認。
- `sales` は現在0件のため、発送と売上の紐付けは実際には当面「未紐付け」で運用することになる。
