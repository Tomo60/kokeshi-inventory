// 定期経費（家賃などの毎月固定費）の自動計上ロジック。
//
// 現状はアプリ起動時に generateRecurringExpenses() を1回呼ぶ方式だが、
// 判定・行組み立ての純粋関数と Supabase アクセスを分けてあるため、
// 将来 Supabase Edge Function + pg_cron の日次バッチへ移す際は
// generateRecurringExpenses() に service role のクライアントを渡すだけで流用できる。
import { supabase } from './supabase'
import { withRetry } from './retry'

const pad2 = (n) => String(n).padStart(2, '0')

/** Date から 'YYYY-MM' を得る（ローカルタイム基準） */
export const monthKeyOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`

/** Date から 'YYYY-MM-DD' を得る（ローカルタイム基準。toISOString はUTCになるため使わない） */
export const dateKeyOf = (date) => `${monthKeyOf(date)}-${pad2(date.getDate())}`

/** 'YYYY-MM' と日から 'YYYY-MM-DD' を組み立てる */
export const dueDateOf = (monthKey, dayOfMonth) => `${monthKey}-${pad2(dayOfMonth)}`

/** 'YYYY-MM' の1ヶ月前の 'YYYY-MM' を返す */
export function previousMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`
}

// 日付文字列の計算はUTCで行う。ローカルタイムで new Date('YYYY-MM-DD') を扱うと
// タイムゾーンによって1日ずれることがあるため。
const partsOf = (dateStr) => dateStr.split('-').map(Number)

/** 'YYYY-MM-DD' の曜日を返す（0=日曜 〜 6=土曜） */
export function weekdayOf(dateStr) {
  const [y, m, d] = partsOf(dateStr)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * 計上日が土日にあたる場合、その次の平日（月曜）へずらす純粋関数。
 * 土曜なら+2日、日曜なら+1日、平日はそのまま。
 *
 * 家賃などの引き落としは金融機関の休業日を避けて翌営業日になるため、
 * 実際の出金日に合わせて計上する。
 * 例: 27日が土曜 → 29日(月) / 27日が日曜 → 28日(月)
 *
 * 祝日は考慮していない（土日のみ）。2月28日が土日の場合など、
 * ずらした結果が翌月になることもある。呼び出し側はその前提で扱うこと。
 */
export function shiftToBusinessDay(dateStr) {
  const shift = { 6: 2, 0: 1 }[weekdayOf(dateStr)] || 0
  if (shift === 0) return dateStr
  const [y, m, d] = partsOf(dateStr)
  const shifted = new Date(Date.UTC(y, m - 1, d + shift))
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

/**
 * テンプレートの、ある月(monthKey)分の実際の計上日を返す。
 * 土日ずらしを適用済みの 'YYYY-MM-DD'。
 */
export function dueDateFor(template, monthKey) {
  return shiftToBusinessDay(dueDateOf(monthKey, Number(template.day_of_month)))
}

/**
 * テンプレートが、指定した月(monthKey)分の計上対象かを判定する純粋関数。
 * - active であること
 * - その月分の計上日（土日ずらし後）を今日が過ぎている（当日を含む）こと
 * - その月分をまだ生成していないこと
 * - 計上日が start_date 〜 end_date の範囲内であること
 *
 * 「まだ生成していない」の判定に >= を使っているのは、ずらした結果が翌月に
 * かかる月（2月28日が土日の場合など）を翌月になってから計上する際、
 * 既に計上済みの月を二重に計上しないようにするため。
 */
export function shouldGenerate(template, now = new Date(), monthKey = monthKeyOf(now)) {
  if (!template || template.active === false) return false
  const day = Number(template.day_of_month)
  if (!Number.isInteger(day) || day < 1 || day > 28) return false

  // その月分、またはそれ以降の月分を既に計上済みなら対象外
  if (template.last_generated_month && template.last_generated_month >= monthKey) return false

  const dueDate = dueDateFor(template, monthKey)
  if (dateKeyOf(now) < dueDate) return false

  if (template.start_date && dueDate < template.start_date) return false
  if (template.end_date && dueDate > template.end_date) return false
  return true
}

/** テンプレートから expenses に insert する行を組み立てる純粋関数 */
export function buildExpenseRow(template, now = new Date(), monthKey = monthKeyOf(now)) {
  return {
    category: template.category,
    amount: template.amount,
    expense_date: dueDateFor(template, monthKey),
    payee: template.payee || null,
    payment_method: template.payment_method || null,
    note: template.note || null,
    is_recurring: true,
    recurring_expense_id: template.id,
  }
}

/**
 * 有効な定期経費テンプレートのうち未計上のものを expenses へ自動計上する。
 * 生成できたテンプレートだけ last_generated_month をその月に更新して重複計上を防ぐ。
 *
 * 前月と当月の2ヶ月分を見るのは、土日ずらしによって計上日が翌月へかかる場合
 * （2月28日が土日の場合など）に、前月分を取りこぼさないため。
 *
 * 呼び出し側の起動処理を止めないため、例外は投げずに結果を返す。
 *
 * この処理はアプリ起動時の最初のリクエストになるため、DBが休止していたり回線が不安定だと
 * ここで失敗しやすい。一時的な失敗は withRetry で自動的に再試行する。
 *
 * @param {object} [client] Supabaseクライアント（Edge Functionからは service role を渡す）
 * @param {Date} [now]
 * @param {{onRetry?: Function}} [options] 再試行時の通知（画面に「接続を再試行中」と出すため）
 * @returns {Promise<{generated: number, skipped: boolean, error: string|null}>}
 */
export async function generateRecurringExpenses(client = supabase, now = new Date(), options = {}) {
  const retryOpts = { onRetry: options.onRetry }
  try {
    const { data, error } = await withRetry(
      () => client.from('recurring_expenses').select('*').eq('active', true),
      retryOpts,
    )
    if (error) {
      // マイグレーション未適用（テーブルが無い）場合もここに入る。アプリ本体は動かしたいので握りつぶす。
      console.warn('定期経費テンプレートを取得できませんでした:', error.message)
      return { generated: 0, skipped: true, error: error.message }
    }

    const templates = data || []
    if (templates.length === 0) return { generated: 0, skipped: false, error: null }

    // 古い月から順に処理する。last_generated_month には最後に計上した月が残る。
    const currentMonth = monthKeyOf(now)
    const months = [previousMonthKey(currentMonth), currentMonth]

    let generated = 0
    for (const monthKey of months) {
      for (const template of templates) {
        if (!shouldGenerate(template, now, monthKey)) continue

        const row = buildExpenseRow(template, now, monthKey)
        // last_generated_month の更新が前回失敗していても二重計上しないための保険。
        // 同一テンプレート・同一計上日の実績が既にあれば insert せずマークだけ進める。
        const { data: existing, error: existingError } = await withRetry(
          () => client
            .from('expenses')
            .select('id')
            .eq('recurring_expense_id', template.id)
            .eq('expense_date', row.expense_date)
            .limit(1),
          retryOpts,
        )
        if (existingError) {
          console.warn(`定期経費の重複確認に失敗しました (id=${template.id}):`, existingError.message)
          continue
        }
        if (!existing || existing.length === 0) {
          const { error: insertError } = await withRetry(() => client.from('expenses').insert(row), retryOpts)
          if (insertError) {
            console.warn(`定期経費の自動計上に失敗しました (id=${template.id}):`, insertError.message)
            continue
          }
          generated += 1
        }
        // 計上に成功したものだけ既計上マークを進める（失敗分は次回の起動で再試行される）
        const { error: updateError } = await withRetry(
          () => client
            .from('recurring_expenses')
            .update({ last_generated_month: monthKey })
            .eq('id', template.id),
          retryOpts,
        )
        if (updateError) {
          console.warn(`定期経費の計上済み月の更新に失敗しました (id=${template.id}):`, updateError.message)
          continue
        }
        // 後続の月の判定に反映させるため、手元のテンプレートも更新しておく
        template.last_generated_month = monthKey
      }
    }
    return { generated, skipped: false, error: null }
  } catch (err) {
    console.warn('定期経費の自動計上でエラーが発生しました:', err)
    return { generated: 0, skipped: true, error: err.message || String(err) }
  }
}
