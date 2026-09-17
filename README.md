# Mingay

小規模事業者向けの在庫・販売管理アプリ。ダッシュボード、在庫管理（QRコード・値札印刷）、販売記録（手数料・広告費・送料込みの純利益計算）、仕入帳、経費帳、顧客管理をひとつのモバイル向けアプリにまとめています。

kokeshi-inventory と同じ思想（個人〜小規模事業主が一人でスマホから使う、Supabaseをバックエンドにした軽量アプリ）を踏襲しつつ、React + Vite 構成に刷新し、商材を特定ジャンルに固定しない汎用項目設計にしています。

## 機能

- **ダッシュボード**: 在庫数/売済数/売上/純利益のKPI、月別売上・利益グラフ、CSV出力
- **在庫管理**: 商品登録・写真・QRコード・値札印刷・検索/フィルタ、仕入日付・保存場所・ロット番号・状態(コンディション)・想定販売期限の管理、滞留期間（仕入日からの経過日数）の表示と滞留が長い順の並び替え
- **販売記録**: 販路（メルカリ/メルカリShops/BASE/ヤフオク/店舗など）・アカウント・取引ID・ステータスの記録、手数料/広告費の実額入力（未入力時は率から自動計算）、入金額・入金日の記録、顧客紐付け

### 販売記録の運用ルール

- 日付は**成約日（sold_at）**を入力する（入力日ではない）。突合も成約日ベースで行う
- **取引ごとに1行**を維持し、複数取引をまとめて1行に合算しない
- 販路内に複数アカウントがある場合（メルカリ・メルカリShops）は、新規入力時にアカウント名が必須。表記ゆれを防ぐため入力済みの候補がサジェストされる
- 手数料・広告費は**実額**の入力を推奨。実額を入れるとその値が使われ、未入力なら従来どおり率から計算する（既存データとの互換のため率の列も残している）
- 返品・キャンセルのステータスを付けた売上は、売上・利益・顧客の購入実績の集計から除外される
- 過去分でアカウントが特定できない行は `needs_review`（要確認）フラグで管理し、無理に全件特定しない
- **仕入帳**: 仕入先・仕入記録の管理、仕入れから在庫への追加
- **経費帳**: カテゴリ別経費、領収書写真、支払先・支払方法の記録、定期経費テンプレート（家賃などの毎月固定費を登録しておくと、計上日を過ぎた当月分をアプリ起動時に自動計上）
- **顧客管理**: 購入履歴・累計購入額

## セットアップ

1. Supabase プロジェクトを作成し、`supabase/schema.sql` の内容をSQL Editorで実行する
   - 既存プロジェクトに対して仕入管理項目（仕入日付・保存場所・ロット番号・状態・想定販売期限）を追加する場合は、`supabase/schema.sql` 末尾の `alter table items add column if not exists ...` を SQL Editor で実行してください（anon keyからは実行できないため、Supabase の SQL Editor で手動実行が必要です）
   - 既存プロジェクトに定期経費機能を追加する場合は、`supabase/schema.sql` の `create table if not exists recurring_expenses (...)` と、その直後の `alter table expenses add column if not exists ...` 3行を SQL Editor で実行してください
   - 既存プロジェクトに売上の多販路・複数アカウント対応を追加する場合は、`supabase/schema.sql` の `alter table sales add column if not exists ...` 9行と、その直後の初期化用 `update` 2行を SQL Editor で実行してください
2. Storage に `mingay-photos` という名前の公開バケットを作成する
3. `.env.example` を `.env` にコピーし、Supabaseの URL と anon key を設定する

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. 依存関係をインストールして起動

   ```
   npm install
   npm run dev
   ```

## デプロイ

Vercel等の静的ホスティングに `npm run build` の出力（`dist/`）をデプロイしてください。環境変数（`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`）をホスティング先にも設定する必要があります。

> 個人利用を想定し、認証なし・Supabase anon keyをフロントエンドに含める構成です。複数人で使う、または公開環境に置く場合はSupabaseのRow Level Securityと認証の追加を検討してください。
