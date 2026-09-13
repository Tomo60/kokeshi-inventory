import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import { monthKeyOf } from '../lib/recurringExpenses'
import Modal from './Modal'

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

export default function RecurringExpenses({ recurring, categories, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const thisMonthKey = monthKeyOf(new Date())
  const activeList = recurring.filter((r) => r.active)
  const monthlyTotal = activeList.reduce((s, r) => s + (r.amount || 0), 0)

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
    const { error } = editing
      ? await supabase.from('recurring_expenses').update(row).eq('id', editing.id)
      : await supabase.from('recurring_expenses').insert(row)
    setSaving(false)
    if (error) return alert(`保存に失敗しました: ${error.message}`)
    setFormOpen(false)
    await reload()
  }

  async function toggleActive(r) {
    const { error } = await supabase.from('recurring_expenses').update({ active: !r.active }).eq('id', r.id)
    if (error) return alert(`更新に失敗しました: ${error.message}`)
    await reload()
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
          アプリを開いたときに、計上日を過ぎた当月分が経費記録へ自動で追加されます
        </div>
      </div>

      {recurring.length === 0 && <div className="empty">家賃などの毎月発生する固定費を登録してください</div>}
      {recurring.map((r) => {
        const cat = getCat(r.category)
        const done = r.last_generated_month === thisMonthKey
        return (
          <div className="card" key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
            <div className="row-between">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18 }}>{cat.icon}</span>
                <span className="category-badge">{cat.label}</span>
                <span className="recurring-badge">毎月{r.day_of_month}日</span>
                {!r.active && <span className="status-badge status-sold">停止中</span>}
              </div>
              <span className="item-sub">{done ? '当月計上済み' : '当月未計上'}</span>
            </div>
            {(r.payee || r.payment_method) && (
              <div className="item-sub" style={{ marginTop: 6 }}>
                {r.payee && <>支払先: {r.payee}　</>}
                {r.payment_method && <>支払方法: {r.payment_method}</>}
              </div>
            )}
            {r.note && <div className="item-name" style={{ marginTop: 6 }}>{r.note}</div>}
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
          <label className="field-label">開始日 *</label>
          <input className="field-input" type="date" value={form.start_date || ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <label className="field-label">終了日（空欄なら終了日なし）</label>
          <input className="field-input" type="date" value={form.end_date || ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <input type="checkbox" id="f-active" style={{ width: 18, height: 18 }} checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            <label htmlFor="f-active" style={{ fontSize: 13, color: '#555' }}>自動計上を有効にする</label>
          </div>
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
