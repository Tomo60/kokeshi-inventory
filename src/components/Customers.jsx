import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt } from '../lib/format'
import { isCountedSale } from '../lib/constants'
import Modal from './Modal'

const emptyForm = { name: '', contact: '', note: '' }

export default function Customers({ customers, sales, items, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  function openAdd() { setEditing(null); setForm(emptyForm); setFormOpen(true) }
  function openEdit(c) { setEditing(c); setForm({ ...emptyForm, ...c }); setFormOpen(true) }

  async function save() {
    if (!form.name) return alert('顧客名を入力してください')
    setSaving(true)
    const row = { name: form.name, contact: form.contact || null, note: form.note || null }
    if (editing) await supabase.from('customers').update(row).eq('id', editing.id)
    else await supabase.from('customers').insert(row)
    setSaving(false)
    setFormOpen(false)
    await reload()
  }

  return (
    <>
      <div className="row-between">
        <h2 className="section-title">顧客一覧</h2>
        <button className="add-btn" onClick={openAdd}>+ 追加</button>
      </div>
      {customers.length === 0 && <div className="empty">顧客を登録してください</div>}
      {customers.map((c) => {
        // 返品・キャンセルは購入実績に含めない
        const cSales = sales.filter((s) => s.customer_id === c.id && isCountedSale(s))
        const total = cSales.reduce((s, x) => s + (x.sell_price || 0), 0)
        return (
          <div className="card" key={c.id}>
            <div className="row-between">
              <div>
                <div className="item-name">{c.name}</div>
                <div className="item-sub">{c.contact || ''}</div>
              </div>
              <button className="edit-btn" onClick={() => openEdit(c)}>編集</button>
            </div>
            <div className="price-row">
              <span className="price-tag">購入回数: {cSales.length}回</span>
              <span className="price-tag">累計: {fmt(total)}</span>
            </div>
            {c.note && <div className="item-sub" style={{ marginTop: 4 }}>📝 {c.note}</div>}
            {cSales.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="item-sub" style={{ marginBottom: 4 }}>購入履歴:</div>
                {cSales.slice(0, 3).map((s) => {
                  const item = items.find((i) => i.id === s.item_id) || {}
                  return <div className="item-sub" key={s.id}>・{item.name || '不明'} {fmt(s.sell_price)} ({s.sold_at})</div>
                })}
                {cSales.length > 3 && <div className="item-sub">他 {cSales.length - 3}件...</div>}
              </div>
            )}
          </div>
        )
      })}

      {formOpen && (
        <Modal title={editing ? '顧客編集' : '顧客登録'} onClose={() => setFormOpen(false)}>
          <label className="field-label">顧客名 *</label>
          <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="field-label">連絡先</label>
          <input className="field-input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="例: メール・SNSアカウントなど" />
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}
    </>
  )
}
