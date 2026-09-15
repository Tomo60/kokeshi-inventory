import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import Modal from './Modal'
import RecurringExpenses from './RecurringExpenses'

// 分類ルール: 梱包材料（段ボール・緩衝材など）の購入費用は purchases（仕入）には計上せず、
// ここの 'materials'（梱包材料費）として expenses にのみ記録する。
// purchases は「販売する商品そのものの仕入」専用。両方に入れると二重計上になるので注意。
export const CATS = [
  { value: 'rent', label: '家賃', icon: '🏠' },
  { value: 'materials', label: '梱包材料費', icon: '📦' },
  { value: 'shipping', label: '送料', icon: '🚚' },
  { value: 'platform', label: '手数料', icon: '💳' },
  { value: 'equipment', label: '備品', icon: '🛠️' },
  { value: 'other', label: 'その他', icon: '📝' },
]
function getCat(v) { return CATS.find((c) => c.value === v) || { label: v || 'その他', icon: '📝' } }

const emptyForm = { category: 'rent', amount: '', expense_date: today(), payee: '', payment_method: '', note: '', is_recurring: false }

export default function Expenses({ expenses, recurring, reload }) {
  const [view, setView] = useState('records')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  function openAdd() { setEditing(null); setForm(emptyForm); setPhotoFile(null); setPhotoPreview(null); setFormOpen(true) }
  function openEdit(e) { setEditing(e); setForm({ ...emptyForm, ...e }); setPhotoFile(null); setPhotoPreview(null); setFormOpen(true) }

  function onPhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!form.amount) return alert('金額を入力してください')
    setSaving(true)
    let photo_url = editing ? editing.photo_url : null
    if (photoFile) {
      const url = await uploadPhoto(photoFile, 'expense')
      if (url) photo_url = url
    }
    const row = {
      category: form.category,
      amount: +form.amount,
      expense_date: form.expense_date,
      payee: form.payee || null,
      payment_method: form.payment_method || null,
      note: form.note || null,
      is_recurring: !!form.is_recurring,
      photo_url,
    }
    if (editing) await supabase.from('expenses').update(row).eq('id', editing.id)
    else await supabase.from('expenses').insert(row)
    setSaving(false)
    setFormOpen(false)
    await reload()
  }

  const months = {}
  expenses.forEach((e) => {
    const m = (e.expense_date || '').slice(0, 7) || '不明'
    if (!months[m]) months[m] = []
    months[m].push(e)
  })
  const monthKeys = Object.keys(months).sort().reverse()

  return (
    <>
      <div className="filter-row">
        <button className={'filter-btn' + (view === 'records' ? ' active' : '')} onClick={() => setView('records')}>経費記録</button>
        <button className={'filter-btn' + (view === 'recurring' ? ' active' : '')} onClick={() => setView('recurring')}>定期経費({recurring.filter((r) => r.active).length})</button>
      </div>

      {view === 'recurring' ? (
        <RecurringExpenses recurring={recurring} categories={CATS} reload={reload} />
      ) : (
      <>
      <div className="row-between">
        <h2 className="section-title">経費記録</h2>
        <button className="add-btn" onClick={openAdd}>+ 追加</button>
      </div>
      <div className="card">
        {CATS.map((cat) => {
          const total = expenses.filter((e) => e.category === cat.value).reduce((s, e) => s + (e.amount || 0), 0)
          if (!total) return null
          return (
            <div key={cat.value} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>{cat.icon}</span><span style={{ fontSize: 13 }}>{cat.label}</span></div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#2f4858' }}>{fmt(total)}</span>
            </div>
          )
        })}
      </div>

      {expenses.length === 0 && <div className="empty">経費を登録してください</div>}
      {monthKeys.map((m) => {
        const total = months[m].reduce((s, e) => s + (e.amount || 0), 0)
        return (
          <div key={m}>
            <div className="month-header">{m.replace('-', '年')}月　合計 {fmt(total)}</div>
            {months[m].map((e) => {
              const cat = getCat(e.category)
              return (
                <div className="card" key={e.id}>
                  <div className="row-between">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span className="category-badge">{cat.label}</span>
                      {e.is_recurring && <span className="recurring-badge">毎月</span>}
                      {e.recurring_expense_id && <span className="auto-badge">自動計上</span>}
                    </div>
                    <span className="item-sub">{e.expense_date}</span>
                  </div>
                  {(e.payee || e.payment_method) && (
                    <div className="item-sub" style={{ marginTop: 6 }}>
                      {e.payee && <>支払先: {e.payee}　</>}
                      {e.payment_method && <>支払方法: {e.payment_method}</>}
                    </div>
                  )}
                  {e.note && <div className="item-name" style={{ marginTop: 6 }}>{e.note}</div>}
                  <div className="row-between" style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#2f4858' }}>{fmt(e.amount)}</div>
                    <button className="edit-btn" onClick={() => openEdit(e)}>編集</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {formOpen && (
        <Modal title={editing ? '経費編集' : '経費登録'} onClose={() => setFormOpen(false)}>
          {(editing?.photo_url || photoPreview) && <img src={photoPreview || editing.photo_url} className="photo-preview" style={{ display: 'block' }} />}
          <label className="field-label">カテゴリ *</label>
          <select className="field-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATS.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <label className="field-label">金額(円) *</label>
          <input className="field-input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="例: 50000" />
          <label className="field-label">日付 *</label>
          <input className="field-input" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
          <label className="field-label">支払先</label>
          <input className="field-input" value={form.payee || ''} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="例: ○○不動産" />
          <label className="field-label">支払方法</label>
          <input className="field-input" value={form.payment_method || ''} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} placeholder="例: 口座引き落とし" />
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例: 7月分家賃" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <input type="checkbox" id="f-recurring" style={{ width: 18, height: 18 }} checked={!!form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
            <label htmlFor="f-recurring" style={{ fontSize: 13, color: '#555' }}>毎月の固定費</label>
          </div>
          <label className="field-label">領収書写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('expense-photo-input').click()}>📷 領収書を撮影・選択</div>
          <input id="expense-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhotoChange} />
          {editing?.recurring_expense_id && (
            <div className="item-sub" style={{ marginTop: 10 }}>
              この記録は定期経費テンプレートから自動計上されたものです。ここでの修正はこの月の実績にのみ反映され、テンプレートの金額は変わりません。
            </div>
          )}
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}
      </>
      )}
    </>
  )
}
