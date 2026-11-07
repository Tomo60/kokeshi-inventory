-- 取消フラグ（論理削除）を purchases と expenses に追加する。
--
-- なぜ必要か:
--   これまで経費タブの「削除」は行そのものを消していた（物理削除）ため、
--   消した記録は二度と戻せず、何をいつ消したのかも残らなかった。
--   古物台帳・確定申告の裏付けとして、消した事実そのものを残す必要がある。
--   仕入タブには削除機能が無かったが、同じ理由で先に器を用意しておく。
--
-- 設計:
--   deleted_at が NULL なら有効な行。NULL でなければ「取り消し済み」。
--   アプリの一覧・集計はすべて deleted_at is null の行だけを使うので、
--   この列を足しただけでは画面の金額は一切変わらない。
--   行は決して消さない。取り消しても deleted_at を NULL に戻せば元どおりになる。
--
-- 実行しても既存のデータは一切書き換わらない（列が増えるだけで、
-- 既存の行はすべて deleted_at が NULL ＝ 有効のまま）。
-- 冪等なので、二度流しても同じ結果になる。

alter table purchases add column if not exists deleted_at     timestamptz;
alter table purchases add column if not exists deleted_reason text;
alter table purchases add column if not exists deleted_by     text;

alter table expenses  add column if not exists deleted_at     timestamptz;
alter table expenses  add column if not exists deleted_reason text;
alter table expenses  add column if not exists deleted_by     text;

-- 有効な行だけを日付順に引くときのための部分インデックス。
create index if not exists purchases_active_idx on purchases (purchase_date desc) where deleted_at is null;
create index if not exists expenses_active_idx  on expenses  (expense_date  desc) where deleted_at is null;

comment on column purchases.deleted_at     is '取り消した日時。NULLなら有効な行。物理削除はしない。';
comment on column purchases.deleted_reason is '取り消した理由（画面で入力）。';
comment on column purchases.deleted_by     is '取り消した人。現在は手入力。利用者が増えたら認証と結び付ける。';
comment on column expenses.deleted_at      is '取り消した日時。NULLなら有効な行。物理削除はしない。';
comment on column expenses.deleted_reason  is '取り消した理由（画面で入力）。';
comment on column expenses.deleted_by      is '取り消した人。現在は手入力。利用者が増えたら認証と結び付ける。';

-- ---------------------------------------------------------------------------
-- ロールバック（戻すとき）
--
-- 注意: ロールバックすると、それまでに記録した「取り消しの履歴」は失われ、
--       取り消した行が有効な行として復活する（＝集計に入り直す）。
--       運用を始めた後に戻すのは危険なので、戻すなら早い段階で。
--
-- drop index if exists purchases_active_idx;
-- drop index if exists expenses_active_idx;
-- alter table purchases drop column if exists deleted_by;
-- alter table purchases drop column if exists deleted_reason;
-- alter table purchases drop column if exists deleted_at;
-- alter table expenses  drop column if exists deleted_by;
-- alter table expenses  drop column if exists deleted_reason;
-- alter table expenses  drop column if exists deleted_at;
-- ---------------------------------------------------------------------------
