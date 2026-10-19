// Supabase への読み書きを一時的な失敗から自動で立ち直らせるための仕組み。
//
// 背景: 2026年9月の「経費が入力できない」不具合は、無料プランのプロジェクトが休止
// （一定期間アクセスがないとスリープし、次のリクエストが起床のきっかけになる）していたのが原因だった。
// 起床には数秒かかるため、最初の1〜2回のリクエストは必ず失敗する。
// 有料プランへの移行で休止自体は起きなくなる想定だが、スマホの回線切り替えや瞬断など
// 「もう一度投げれば通る」種類の失敗は今後も起きるため、アプリ側でも吸収する。
//
// 方針: 一時的だと判断できるものだけを再試行する。
// 列が無い・制約違反・権限不足のような直しようのないエラーを再試行しても成功しないので、
// ユーザーを無駄に待たせないよう対象外にし、すぐエラーを返す。

// ゲートウェイ・プロキシが一時的な不調を示すHTTPステータス
const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 544])

// Postgres / PostgREST が「今は繋がらない」ことを示すコード
const TRANSIENT_CODES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection（休止中のDBへの接続）
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '53300', // too_many_connections
  '57P03', // cannot_connect_now（起動中）
  '57014', // query_canceled（タイムアウト）
])

// ブラウザの fetch が失敗した場合、レスポンス本文が無いためメッセージでしか判別できない。
// 「TypeError: Failed to fetch」(Chrome) / 「Load failed」(Safari) などの形で届く。
const TRANSIENT_MESSAGE =
  /failed to fetch|fetch failed|load failed|network\s*error|networkerror|timeout|timed out|aborted|connection (closed|reset|refused|terminated)|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i

/** そのエラーが「もう一度投げれば通るかもしれない」種類のものかを判定する */
export function isTransientError(error) {
  if (!error) return false
  if (error.status != null && TRANSIENT_HTTP_STATUS.has(Number(error.status))) return true
  if (error.code != null && TRANSIENT_CODES.has(String(error.code))) return true
  return TRANSIENT_MESSAGE.test(`${error.name || ''} ${error.message || ''}`)
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// supabase-js は PostgREST のエラーを例外ではなく { data, error } で返すが、
// 通信そのものが失敗したときは throw することもある。
// 呼び出し側で両方を書き分けずに済むよう、ここで必ず { data, error } の形に揃える。
async function settle(run) {
  try {
    const result = await run()
    if (result && typeof result === 'object' && 'error' in result) return result
    return { data: result, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

// 1.2秒 → 2.4秒 → 4.8秒（合計約8.4秒待つ）。休止からの起床はおおむねこの範囲で終わる。
export const RETRY_DEFAULTS = { retries: 3, baseDelayMs: 1200 }

/**
 * Supabase の呼び出しを、一時的な失敗のあいだ指数バックオフで再試行する。
 * 例外は投げず、常に supabase-js と同じ { data, error } を返す。
 *
 * @param {() => Promise<any>} run 毎回呼び直せるようにクエリを関数で渡す
 *   （PostgrestBuilder は一度 await すると再利用できないため）
 * @param {object} [options]
 * @param {number} [options.retries] 再試行の回数（初回は含まない）
 * @param {number} [options.baseDelayMs] 1回目の待ち時間
 * @param {(info: {attempt: number, retries: number, waitMs: number, error: Error}) => void} [options.onRetry]
 *   再試行の直前に呼ばれる。「接続中」表示の切り替えなどに使う
 * @param {(ms: number) => Promise<void>} [options.sleep] テスト用に待ち方を差し替える
 */
export async function withRetry(run, options = {}) {
  const { retries, baseDelayMs, onRetry, sleep = defaultSleep } = { ...RETRY_DEFAULTS, ...options }
  for (let attempt = 0; ; attempt++) {
    const result = await settle(run)
    if (!result.error || attempt >= retries || !isTransientError(result.error)) return result
    const waitMs = baseDelayMs * 2 ** attempt
    console.warn(`接続に失敗したため ${waitMs}ms 後に再試行します (${attempt + 1}/${retries}):`, result.error.message)
    onRetry?.({ attempt: attempt + 1, retries, waitMs, error: result.error })
    await sleep(waitMs)
  }
}

/** エラーを利用者向けの日本語メッセージにする */
export function describeError(error) {
  if (!error) return '原因不明のエラーが発生しました'
  if (isTransientError(error)) {
    return `サーバーに接続できませんでした（自動で${RETRY_DEFAULTS.retries}回再試行しましたが復帰しませんでした）。`
      + `通信状況を確認して、もう一度お試しください。（詳細: ${error.message}）`
  }
  return error.message || String(error)
}

/**
 * 保存処理の共通ラッパ。一時的な失敗は自動で再試行し、最終的に失敗したら理由を画面に出す。
 * 「無言で失敗してフォームだけ閉じる」＝利用者から見て「入力できない」状態を作らないためのもの。
 *
 * @param {() => Promise<any>} run
 * @param {string} label 「経費の保存」のような操作名。そのままメッセージに使う
 * @returns {Promise<{ok: boolean, data: any, error: Error|null}>}
 */
export async function saveWithRetry(run, label, options = {}) {
  const { data, error } = await withRetry(run, options)
  if (error) {
    console.error(`${label}に失敗しました:`, error)
    alert(`${label}に失敗しました\n\n${describeError(error)}`)
    return { ok: false, data: null, error }
  }
  return { ok: true, data, error: null }
}
