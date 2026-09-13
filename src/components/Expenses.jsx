import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import Modal from './Modal'

const CATS = [
  { value: 'rent', label: '家賃', icon: '🏠' },
  { value: 'materials', label: '梱包材料費', icon: '📦' },
  { value: 'shipping', label: '送料', icon: '🚚' },
  { value: 'platform', label: '手数料', icon: '💳' },
  { value: 'equipment', label: '備品', icon: '🛠️' },
  { value: 'other', label: 'その他', icon: '📝' },
]
function getCat(v) { return CATS.find((c) => c.value === v) || { label: v || 'その他', icon: '📝' } }

const emptyForm = { category: 'rent', amount: '', expense_date: today(), note: '', is_recurring: false }

export default function Expenses({ expenses, reload }) {
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span className="category-badge">{cat.label}</span>
                      {e.is_recurring && <span className="recurring-badge">毎月</span>}
                    </div>
                    <span className="item-sub">{e.expense_date}</span>
                  </div>
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
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例: 7月分家賃" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <input type="checkbox" id="f-recurring" style={{ width: 18, height: 18 }} checked={!!form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
            <label htmlFor="f-recurring" style={{ fontSize: 13, color: '#555' }}>毎月の固定費</label>
          </div>
          <label className="field-label">領収書写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('expense-photo-input').click()}>📷 領収書を撮影・選択</div>
          <input id="expense-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhotoChange} />
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}
    </>
  )
}
