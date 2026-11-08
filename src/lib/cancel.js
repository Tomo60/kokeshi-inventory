import { supabase } from './supabase'
import { saveWithRetry } from './retry'

// 取消フラグ（論理削除）の共通処理。
//
// 方針: 行は消さない。deleted_at を立てて「取り消し済み」にし、
// 一覧・集計からは外す。deleted_at を NULL に戻せば元どおりになる。
// 物理削除をしないので、何をいつ・なぜ取り消したかが必ず残る。

// deleted_at 列がまだ無いデータベース（マイグレーション未適用）でも
// アプリが壊れないよう、undefined は「有効」として扱う。
export const isCancelled = (row) => !!(row && row.deleted_at)

export const activeOnly = (rows) => (rows || []).filter((r) => !isCancelled(r))
export const cancelledOnly = (rows) => (rows || []).filter((r) => isCancelled(r))

// 表示用のラベル。「削除」ではなく「取り消し」で統一する
// （戻せることが文言から伝わるようにするため）。
export function cancelLabel(row) {
  if (!isCancelled(row)) return ''
  const at = String(row.deleted_at).slice(0, 16).replace('T', ' ')
  const who = row.deleted_by ? `／${row.deleted_by}` : ''
  return `取り消し ${at}${who}`
}

// 取り消す。reason は必須（何のために取り消したのかを必ず残すため）。
export function cancelRow(table, id, reason, by, label) {
  return saveWithRetry(
    () => supabase.from(table).update({
      deleted_at: new Date().toISOString(),
      deleted_reason: reason,
      deleted_by: by || null,
    }).eq('id', id),
    label,
  )
}

// 取り消しを取り消す（元に戻す）。理由と実行者も一緒に消す。
export function restoreRow(table, id, label) {
  return saveWithRetry(
    () => supabase.from(table).update({
      deleted_at: null,
      deleted_reason: null,
      deleted_by: null,
    }).eq('id', id),
    label,
  )
}
