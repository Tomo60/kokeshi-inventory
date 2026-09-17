// 定期経費（家賃などの毎月固定費）の自動計上ロジック。
//
// 現状はアプリ起動時に generateRecurringExpenses() を1回呼ぶ方式だが、
// 判定・行組み立ての純粋関数と Supabase アクセスを分けてあるため、
// 将来 Supabase Edge Function + pg_cron の日次バッチへ移す際は
// generateRecurringExpenses() に service role のクライアントを渡すだけで流用できる。
import { supabase } from './supabase'

const pad2 = (n) => String(n).padStart(2, '0')

/** Date から 'YYYY-MM' を得る（ローカルタイム基準） */
export const monthKeyOf = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`

/** 'YYYY-MM' と日から 'YYYY-MM-DD' を組み立てる */
export const dueDateOf = (monthKey, dayOfMonth) => `${monthKey}-${pad2(dayOfMonth)}`

/**
 * テンプレートが当月分の計上対象かを判定する純粋関数。
 * - active であること
 * - 当月の計上日(day_of_month)を今日が過ぎている（当日を含む）こと
 * - 当月分をまだ生成していない（last_generated_month が当月でない）こと
 * - 計上日が start_date 〜 end_date の範囲内であること
 */
export function shouldGenerate(template, now = new Date()) {
  if (!template || template.active === false) return false
  const day = Number(template.day_of_month)
  if (!Number.isInteger(day) || day < 1 || day > 28) return false

  const monthKey = monthKeyOf(now)
  if (template.last_generated_month === monthKey) return false
  if (now.getDate() < day) return false

  const dueDate = dueDateOf(monthKey, day)
  if (template.start_date && dueDate < template.start_date) return false
  if (template.end_date && dueDate > template.end_date) return false
  return true
}

/** テンプレートから expenses に insert する行を組み立てる純粋関数 */
export function buildExpenseRow(template, now = new Date()) {
  return {
    category: template.category,
    amount: template.amount,
    expense_date: dueDateOf(monthKeyOf(now), Number(template.day_of_month)),
    payee: template.payee || null,
    payment_method: template.payment_method || null,
    note: template.note || null,
    is_recurring: true,
    recurring_expense_id: template.id,
  }
}

/**
 * 有効な定期経費テンプレートのうち当月分が未計上のものを expenses へ自動計上する。
 * 生成できたテンプレートだけ last_generated_month を当月に更新して重複計上を防ぐ。
 *
 * 呼び出し側の起動処理を止めないため、例外は投げずに結果を返す。
 * @returns {Promise<{generated: number, skipped: boolean, error: string|null}>}
 */
export async function generateRecurringExpenses(client = supabase, now = new Date()) {
  try {
    const { data, error } = await client.from('recurring_expenses').select('*').eq('active', true)
    if (error) {
      // マイグレーション未適用（テーブルが無い）場合もここに入る。アプリ本体は動かしたいので握りつぶす。
      console.warn('定期経費テンプレートを取得できませんでした:', error.message)
      return { generated: 0, skipped: true, error: error.message }
    }

    const targets = (data || []).filter((t) => shouldGenerate(t, now))
    if (targets.length === 0) return { generated: 0, skipped: false, error: null }

    const monthKey = monthKeyOf(now)
    let generated = 0
    for (const template of targets) {
      const row = buildExpenseRow(template, now)
      // last_generated_month の更新が前回失敗していても二重計上しないための保険。
      // 同一テンプレート・同一計上日の実績が既にあれば insert せずマークだけ進める。
      const { data: existing, error: existingError } = await client
        .from('expenses')
        .select('id')
        .eq('recurring_expense_id', template.id)
        .eq('expense_date', row.expense_date)
        .limit(1)
      if (existingError) {
        console.warn(`定期経費の重複確認に失敗しました (id=${template.id}):`, existingError.message)
        continue
      }
      if (!existing || existing.length === 0) {
        const { error: insertError } = await client.from('expenses').insert(row)
        if (insertError) {
          console.warn(`定期経費の自動計上に失敗しました (id=${template.id}):`, insertError.message)
          continue
        }
        generated += 1
      }
      // 計上に成功したものだけ既計上マークを進める（失敗分は次回の起動で再試行される）
      const { error: updateError } = await client
        .from('recurring_expenses')
        .update({ last_generated_month: monthKey })
        .eq('id', template.id)
      if (updateError) {
        console.warn(`定期経費の計上済み月の更新に失敗しました (id=${template.id}):`, updateError.message)
      }
    }
    return { generated, skipped: false, error: null }
  } catch (err) {
    console.warn('定期経費の自動計上でエラーが発生しました:', err)
    return { generated: 0, skipped: true, error: err.message || String(err) }
  }
}
