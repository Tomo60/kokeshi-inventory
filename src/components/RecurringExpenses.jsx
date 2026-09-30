import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveWithRetry } from '../lib/retry'
import { fmt, today } from '../lib/format'
import { dueDateOf, nonBusinessReason, nextScheduled } from '../lib/recurringExpenses'
import Modal from './Modal'

// 「次回の計上予定」の表示。計上されない設定なら理由を出す。
// 設定は保存できてもエラーは出ないため、これが唯一の気づく手がかりになる。
function NextDue({ template, box = false }) {
  const next = nextScheduled(template)
  const wrap = (children, warn) => (
    box
      ? <div className="calc-box" style={{ marginTop: 14, borderColor: warn ? '#e74c3c' : undefined }}>{children}</div>
      : <div style={{ marginTop: 4 }}>{children}</div>
  )

  if (!next.date) {
    return wrap(
      <div className="item-sub" style={{ color: '#c0392b', fontWeight: 600 }}>
        ⚠️ この設定では計上されません（{next.reason}）
      </div>,
      true,
    )
  }

  // 計上日が土日・祝日でずれた場合は、元の日と理由も添える
  const plainDue = dueDateOf(next.monthKey, Number(template.day_of_month))
  const shift = next.date !== plainDue
    ? `（${Number(template.day_of_month)}日が${nonBusinessReason(plainDue)}のため繰り下げ）`
    : ''

  return wrap(
    <div className="item-sub">
      {next.overdue
        ? <>次にアプリを開いたときに <b>{next.date}</b> 付けで計上されます{shift}</>
        : <>次回の計上予定: <b>{next.date}</b>{shift}</>}
    </div>,
    false,
  )
}

const emptyForm = {
  category: 'rent',
  amount: '',
  day_of_month: 1,
  payee: '',
  payment_method: '',
  note: '',
  active: true,
  start_date: today(),
  end_date: '',
}

export default function RecurringExpenses({ recurring, recurringError, categories, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const activeList = recurring.filter((r) => r.active)
  const monthlyTotal = activeList.reduce((s, r) => s + (r.amount || 0), 0)

  // 入力中の内容で「次回の計上予定」を計算するための、テンプレート相当のオブジェクト。
  // フォームの値は文字列なので、空文字は null に寄せて保存時と同じ形にする。
  const draft = {
    day_of_month: form.day_of_month,
    active: form.active,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    // 編集時は既に計上した月を考慮する（当月分が済んでいれば次回は翌月になる）
    last_generated_month: editing ? editing.last_generated_month : null,
  }

  function getCat(v) {
    return categories.find((c) => c.value === v) || { label: v || 'その他', icon: '📝' }
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }
  function openEdit(r) {
    setEditing(r)
    setForm({ ...emptyForm, ...r, end_date: r.end_date || '' })
    setFormOpen(true)
  }

  async function save() {
    if (!form.amount) return alert('金額を入力してください')
    const day = Number(form.day_of_month)
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return alert('計上日は1〜28の範囲で入力してください（全ての月に存在する日のみ）')
    }
    setSaving(true)
    const row = {
      category: form.category,
      amount: +form.amount,
      day_of_month: day,
      payee: form.payee || null,
      payment_method: form.payment_method || null,
      note: form.note || null,
      active: !!form.active,
      start_date: form.start_date || today(),
      end_date: form.end_date || null,
    }
    const { ok } = await saveWithRetry(
      () => (editing
        ? supabase.from('recurring_expenses').update(row).eq('id', editing.id)
        : supabase.from('recurring_expenses').insert(row)),
      '定期経費テンプレートの保存',
    )
    setSaving(false)
    if (!ok) return
    setFormOpen(false)
    await reload()
  }

  async function toggleActive(r) {
    const { ok } = await saveWithRetry(
      () => supabase.from('recurring_expenses').update({ active: !r.active }).eq('id', r.id),
      r.active ? '自動計上の停止' : '自動計上の再開',
    )
    if (!ok) return
    await reload()
  }

  // テーブルが読めないと「0件」と見分けがつかず、テーブル未作成やアクセス権の問題に
  // 気づけないまま「登録しても増えない」ように見えるため、理由をはっきり出す。
  if (recurringError) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>⚠️ 定期経費テンプレートを読み込めませんでした</div>
        <div className="item-sub">{recurringError}</div>
        <div className="item-sub" style={{ marginTop: 8 }}>
          テーブル(<code>recurring_expenses</code>)が作成されていないか、アクセス権の設定が必要な可能性があります。
          作成手順は <code>supabase/schema.sql</code> と README を参照してください。
        </div>
        <button className="add-btn" style={{ marginTop: 10 }} onClick={reload}>再読み込み</button>
      </div>
    )
  }

  return (
    <>
      <div className="row-between">
        <h2 className="section-title">定期経費テンプレート</h2>
        <button className="add-btn" onClick={openAdd}>+ 追加</button>
      </div>
      <div className="calc-box" style={{ marginTop: 0 }}>
        <div className="item-sub">有効なテンプレート {activeList.length}件</div>
        <div className="calc-result">毎月の固定費合計 {fmt(monthlyTotal)}</div>
        <div className="item-sub" style={{ marginTop: 4 }}>
          アプリを開いたときに、計上日を過ぎた当月分が経費記録へ自動で追加されます。
          計上日が土日・祝日にあたる月は、金融機関の休業日を避けて休み明けの営業日に計上します
        </div>
      </div>

      {recurring.length === 0 && <div className="empty">家賃などの毎月発生する固定費を登録してください</div>}
      {recurring.map((r) => {
        const cat = getCat(r.category)
        return (
          <div className="card" key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
            <div className="row-between">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18 }}>{cat.icon}</span>
                <span className="category-badge">{cat.label}</span>
                <span className="recurring-badge">毎月{r.day_of_month}日</span>
                {!r.active && <span className="status-badge status-sold">停止中</span>}
              </div>
            </div>
            {(r.payee || r.payment_method) && (
              <div className="item-sub" style={{ marginTop: 6 }}>
                {r.payee && <>支払先: {r.payee}　</>}
                {r.payment_method && <>支払方法: {r.payment_method}</>}
              </div>
            )}
            {r.note && <div className="item-name" style={{ marginTop: 6 }}>{r.note}</div>}
            <NextDue template={r} />
            {(r.start_date || r.end_date) && (
              <div className="item-sub" style={{ marginTop: 4 }}>
                期間: {r.start_date || '—'} 〜 {r.end_date || '終了日なし'}
              </div>
            )}
            <div className="row-between" style={{ marginTop: 6 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2f4858' }}>{fmt(r.amount)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="edit-btn" onClick={() => openEdit(r)}>編集</button>
                <button className={r.active ? 'sold-btn' : 'return-btn'} onClick={() => toggleActive(r)}>
                  {r.active ? '停止する' : '再開する'}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {formOpen && (
        <Modal title={editing ? '定期経費の編集' : '定期経費の登録'} onClose={() => setFormOpen(false)}>
          <label className="field-label">カテゴリ *</label>
          <select className="field-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <label className="field-label">金額(円) *</label>
          <input className="field-input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="例: 50000" />
          <label className="field-label">毎月の計上日 *（1〜28）</label>
          <input className="field-input" type="number" min="1" max="28" value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
          <label className="field-label">支払先</label>
          <input className="field-input" value={form.payee || ''} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="例: ○○不動産" />
          <label className="field-label">支払方法</label>
          <input className="field-input" value={form.payment_method || ''} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} placeholder="例: 口座引き落とし" />
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例: 店舗家賃" />
          <label className="field-label">開始日 *（この日以降の計上日から対象になります）</label>
          <input className="field-input" type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <label className="field-label">終了日</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="field-input" style={{ flex: 1 }} type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            {/* 日付欄をタップしただけで今日の日付が入ってしまう端末があるため、
                意図せず終了日が入った場合にすぐ戻せるようにする */}
            {form.end_date && (
              <button className="edit-btn" style={{ whiteSpace: 'nowrap' }} onClick={() => setForm({ ...form, end_date: '' })}>クリア</button>
            )}
          </div>
          <div className="item-sub" style={{ marginTop: 4 }}>
            ずっと続く費用は<b>空欄</b>にしてください。日付を入れると、その日以降は計上されなくなります
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <input type="checkbox" id="f-active" style={{ width: 18, height: 18 }} checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            <label htmlFor="f-active" style={{ fontSize: 13, color: '#555' }}>自動計上を有効にする</label>
          </div>
          {/* 入力内容でその場に計上予定を出す。計上されない設定なら保存前に気づける */}
          <NextDue template={draft} box />
          {editing && (
            <div className="item-sub" style={{ marginTop: 10 }}>
              金額を変更しても、すでに計上済みの実績は変わりません。当月分を直したい場合は経費記録側で修正してください。
            </div>
          )}
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}
    </>
  )
}
