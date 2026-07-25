# Mingay

小規模事業者向けの在庫・販売管理アプリ。ダッシュボード、在庫管理（QRコード・値札印刷）、販売記録（手数料・広告費・送料込みの純利益計算）、仕入帳、経費帳、顧客管理をひとつのモバイル向けアプリにまとめています。

kokeshi-inventory と同じ思想（個人〜小規模事業主が一人でスマホから使う、Supabaseをバックエンドにした軽量アプリ）を踏襲しつつ、React + Vite 構成に刷新し、商材を特定ジャンルに固定しない汎用項目設計にしています。

## 機能

- **ダッシュボード**: 在庫数/売済数/売上/純利益のKPI、月別売上・利益グラフ、CSV出力
- **在庫管理**: 商品登録・写真・QRコード・値札印刷・検索/フィルタ
- **販売記録**: 手数料率・広告費率・送料から純利益を自動計算、顧客紐付け
- **仕入帳**: 仕入先・仕入記録の管理、仕入れから在庫への追加
- **経費帳**: カテゴリ別経費、月次固定費、領収書写真
- **顧客管理**: 購入履歴・累計購入額

## セットアップ

1. Supabase プロジェクトを作成し、`supabase/schema.sql` の内容をSQL Editorで実行する
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
