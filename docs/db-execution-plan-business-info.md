# 事業情報テーブル（business_info）のDB実行計画

本番Supabase（mingei プロジェクト）へ `business_info` テーブルを追加し、古物商許可の情報を1行登録するための手順書。
**このPRの時点ではDBには何も適用していない。** オーナーの最終承認後に、下記のSQLを実行する。

- 対象プロジェクト: `threvmcnpovykcgrhybh`
- 作成日: 2026-11-01
- 影響範囲: 新しいテーブルを1つ追加し、そこへ1行だけ登録する。**既存7テーブルのデータは一切変更しない**（既存行を読む・書く文を1つも含まない）

---

## 1. 登録する値

| 項目 | 値 |
|------|-----|
| 許可証番号 | 第451390020428号 |
| 交付年月日 | 2026-08-05 |
| 公安委員会 | 神奈川県公安委員会 |
| 行商 | しない（false） |

**氏名・生年月日・住所は登録しない。** テーブルにその列を作っていないため、入れる場所がない。
許可証の記録に必要なのは上記4項目であり、Supabaseの公開鍵がブラウザに配信される構成では、
必要以上の個人情報を持たない方が安全なため。

## 2. 実行前の確認（スナップショット取得）

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
     where table_schema='public' and table_name='business_info') as business_info_exists;
```

実行前の期待値（2026-11-01 時点の実績値）:

| 項目 | 値 |
|------|-----|
| purchases 件数 / 合計 / ポイント計 | 71件 / ¥188,774 / ¥25,560 |
| business_info_exists | 0（まだ存在しない） |

※ items / sales / expenses などの件数は実行当日の値をその場で記録する。

## 3. 実行するSQL

`supabase/schema.sql` を **Supabase ダッシュボードの SQL Editor から** 実行してテーブルを作る。
このファイルは全体が冪等（何度実行しても同じ結果）に書かれているため、ファイル全体を流して問題ない。

> **Table Editor から手でテーブルを作ってはいけない。**
> Table Editor で作成すると Row Level Security が既定で有効になり、ポリシーが無いままだと
> アプリからは常に0件・保存もできない状態になる（`recurring_expenses` で実際に起きた不具合と同じ）。

### (1) テーブル作成（schema.sql に含まれる部分）

```sql
create table if not exists business_info (
  id smallint primary key default 1 check (id = 1),
  license_no text,
  license_issued_on date,
  public_safety_commission text,
  peddling boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
```

`check (id = 1)` により、2行目を入れようとすると制約違反で弾かれる（1行しか存在しえない）。

### (2) RLS（schema.sql に含まれる部分）

ポリシーを作ってから無効にする。既存テーブルと同じ挙動にしつつ、将来 RLS を有効にしても
ポリシー0件で全件拒否にならないようにするため。

```sql
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_info' and policyname = 'business_info_anon_all'
  ) then
    create policy business_info_anon_all on business_info for all using (true) with check (true);
  end if;
end $$;
alter table business_info disable row level security;
```

### (3) 許可情報の登録（1行）

アプリの「設定」タブから入力してもよいが、SQLで入れる場合は次を実行する。
`on conflict` を付けているので、二重に実行しても2行にはならず上書きになる。

```sql
insert into business_info (id, license_no, license_issued_on, public_safety_commission, peddling, note)
values (1, '第451390020428号', '2026-08-05', '神奈川県公安委員会', false, null)
on conflict (id) do update set
  license_no = excluded.license_no,
  license_issued_on = excluded.license_issued_on,
  public_safety_commission = excluded.public_safety_commission,
  peddling = excluded.peddling,
  updated_at = now();
```

## 4. 実行後の確認

```sql
-- (a) テーブルができていて、1行だけあるか
select count(*) as 件数 from business_info;
select * from business_info;

-- (b) RLSが「無効」で、かつポリシーが1件あるか（既存テーブルと同じ方針になっているか）
select relname, relrowsecurity as rls有効
  from pg_class
 where relnamespace='public'::regnamespace and relkind='r' and relname='business_info';
select policyname from pg_policies
 where schemaname='public' and tablename='business_info';

-- (c) 2行目が入らないことの確認（エラーになるのが正しい。エラーが出ずに通ったら制約が効いていない）
--     実行するとエラーメッセージが出るだけで、データは変わらない。
insert into business_info (id) values (2);

-- (d) 既存テーブルが1行も変わっていないか → 手順2と同じクエリを流して突き合わせる
```

判定基準:

| 確認項目 | 期待値 |
|----------|--------|
| business_info テーブル | 存在する |
| 件数 | **1行**（0行でも2行でもない） |
| 登録内容 | 第451390020428号 / 2026-08-05 / 神奈川県公安委員会 / peddling=false |
| 氏名・生年月日・住所 | **列そのものが無い**（入っていない） |
| `rls有効` | **false**（既存テーブルと同じ） |
| ポリシー | `business_info_anon_all` が1件 |
| `insert ... values (2)` | 制約違反でエラーになる |
| 既存7テーブルの件数・合計 | 手順2の記録と完全一致 |

アプリ側の確認:

1. 設定タブを開く → 許可証番号・交付年月日・公安委員会・行商が表示される
2. ⚠️の警告が出る場合はRLSかテーブル名を見直す（表示されないのはテーブルが読めていない状態）
3. 編集 → 保存 → 再読み込みして値が変わっている（= アプリから書き込めている）
4. 保存後も件数が1行のままであること（`select count(*) from business_info;`）

## 5. 取り消し方法（ロールバック）

追加したものを消すだけで、既存データには触れない。

```sql
-- 登録した1行だけを消す場合
delete from business_info where id = 1;

-- 追加そのものを取り消す場合（テーブル・ポリシーがまとめて消える）
drop table if exists business_info;
```

注意点:

- `drop table` を実行すると、登録した許可情報は失われる。ただし許可証そのものは手元にあるため、再登録すれば復旧できる（取り返しのつかないデータではない）。
- アプリ側は「`business_info` が読めなければ設定タブにだけ警告を出し、他の機能は通常どおり動く」作りにしてあるため、`drop table` した状態でもアプリは壊れない。

## 6. セキュリティ上の申し送り（1行）

**現在の構成では、データベースの行単位のアクセス制御（RLS）を全テーブルで無効にしており、かつSupabaseの公開鍵はブラウザに配信される。** 個人で使う前提の設定であり、利用者が増える場合は権限管理の設計が別途必要。

## 7. 未着手（意図的に手を付けていないもの）

- **古物台帳の改修**（品目区分・特徴・相手方情報など）は専門家の確認待ちのため着手していない。
  なお現状、`purchase_items` が0行で仕入と商品が全く紐付いていないため、品目ごとの特徴は記録されていない。
