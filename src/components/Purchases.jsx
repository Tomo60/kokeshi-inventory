import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import { CONDITIONS } from '../lib/constants'
import Modal from './Modal'

const SOURCE_TYPES = [
  { value: 'market', label: 'フリーマーケット' },
  { value: 'online', label: 'ネット通販/オークション' },
  { value: 'shop', label: '専門店' },
  { value: 'wholesaler', label: '問屋' },
  { value: 'craftsperson', label: '作家・職人直接' },
  { value: 'other', label: 'その他' },
]

const emptyForm = { source_type: 'market', source: '', purchase_date: today(), total_amount: '', quantity: '', note: '' }
const emptyItemForm = {
  category: '', source_place: '', name: '', buy_price: '', sell_price: '',
  purchase_date: today(), storage_location: '', lot_number: '', condition: '', expected_sell_by: '',
  note: '',
}

function avgOf(form) {
  const total = +form.total_amount || 0
  const qty = +form.quantity || 0
  return qty > 0 ? Math.round(total / qty) : 0
}

export default function Purchases({ purchases, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [itemPhotoFile, setItemPhotoFile] = useState(null)
  const [itemPhotoPreview, setItemPhotoPreview] = useState(null)

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
    setFormOpen(true)
  }
  function openEdit(p) {
    setEditing(p)
    setForm({ ...emptyForm, ...p })
    setPhotoFile(null)
    setPhotoPreview(null)
    setFormOpen(true)
  }

  function onPhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function save() {
    const total = +form.total_amount
    const qty = +form.quantity
    if (!total || !qty) return alert('合計仕入額と仕入点数を入力してください')
    setSaving(true)
    let photo_url = editing ? editing.photo_url : null
    if (photoFile) {
      const url = await uploadPhoto(photoFile, 'purchase')
      if (url) photo_url = url
    }
    const row = {
      source_type: form.source_type,
      source: form.source || null,
      purchase_date: form.purchase_date,
      total_amount: total,
      quantity: qty,
      avg_amount: avgOf(form),
      note: form.note || null,
      photo_url,
    }
    if (editing) await supabase.from('purchases').update(row).eq('id', editing.id)
    else await supabase.from('purchases').insert(row)
    setSaving(false)
    setFormOpen(false)
    await reload()
  }

  function openLink(p) {
    setLinking(p)
    setItemForm({ ...emptyItemForm, buy_price: p.avg_amount, purchase_date: p.purchase_date || today() })
    setItemPhotoFile(null)
    setItemPhotoPreview(null)
  }

  function onItemPhotoChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setItemPhotoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setItemPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function addToInventory() {
    if (!itemForm.name) return alert('商品名を入力してください')
    let photo_url = null
    if (itemPhotoFile) photo_url = await uploadPhoto(itemPhotoFile, 'item')
    const { data, error } = await supabase.from('items').insert({
      name: itemForm.name,
      category: itemForm.category || null,
      source_place: itemForm.source_place || null,
      buy_price: itemForm.buy_price ? +itemForm.buy_price : null,
      sell_price: itemForm.sell_price ? +itemForm.sell_price : null,
      purchase_date: itemForm.purchase_date || null,
      storage_location: itemForm.storage_location || null,
      lot_number: itemForm.lot_number || null,
      condition: itemForm.condition || null,
      expected_sell_by: itemForm.expected_sell_by || null,
      note: itemForm.note || null,
      photo_url,
      status: 'in_stock',
    }).select()
    if (!error && data && data[0]) {
      await supabase.from('purchase_items').insert({ purchase_id: linking.id, item_id: data[0].id })
    }
    setLinking(null)
    await reload()
    alert('在庫に追加しました')
  }

  const totalAmount = purchases.reduce((s, p) => s + (p.total_amount || 0), 0)
  const totalItems = purchases.reduce((s, p) => s + (p.quantity || 0), 0)
  const avgAmount = totalItems > 0 ? Math.round(totalAmount / totalItems) : 0

  return (
    <>
      <h2 className="section-title">仕入サマリー</h2>
      <div className="card-grid">
        <div className="kpi-card" style={{ borderTop: '3px solid #2f4858' }}><div className="kpi-label">総仕入額</div><div className="kpi-value">{fmt(totalAmount)}</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #2980b9' }}><div className="kpi-label">総仕入点数</div><div className="kpi-value">{totalItems}点</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #8e44ad' }}><div className="kpi-label">仕入回数</div><div className="kpi-value">{purchases.length}回</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #e67e22' }}><div className="kpi-label">平均仕入値</div><div className="kpi-value">{fmt(avgAmount)}</div></div>
      </div>

      <div className="row-between" style={{ marginTop: 14 }}>
        <h2 className="section-title" style={{ margin: 0 }}>仕入記録</h2>
        <button className="add-btn" onClick={openAdd}>+ 仕入登録</button>
      </div>
      {purchases.length === 0 && <div className="empty">仕入れを登録してください</div>}
      {purchases.map((p) => {
        const sourceLabel = (SOURCE_TYPES.find((s) => s.value === p.source_type) || {}).label || p.source_type
        return (
          <div className="card" key={p.id}>
            {p.photo_url && <img src={p.photo_url} className="photo-thumb" style={{ float: 'right', marginLeft: 10 }} onError={(e) => (e.target.style.display = 'none')} />}
            <div className="row-between"><span className="category-badge">{sourceLabel}</span><span className="item-sub">{p.purchase_date}</span></div>
            <div className="item-name" style={{ marginTop: 6 }}>{p.source}</div>
            <div className="price-row">
              <span className="price-tag">合計 {fmt(p.total_amount)}</span>
              <span className="price-tag">{p.quantity}点</span>
              <span className="price-tag" style={{ color: '#2f4858', fontWeight: 700 }}>平均 {fmt(p.avg_amount)}/点</span>
            </div>
            {p.note && <div className="item-sub">📝 {p.note}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', clear: 'both' }}>
              <button className="edit-btn" onClick={() => openEdit(p)}>編集</button>
              <button className="link-btn" onClick={() => openLink(p)}>在庫に追加</button>
            </div>
          </div>
        )
      })}

      {formOpen && (
        <Modal title={editing ? '仕入編集' : '仕入登録'} onClose={() => setFormOpen(false)}>
          {(editing?.photo_url || photoPreview) && <img src={photoPreview || editing.photo_url} className="photo-preview" style={{ display: 'block' }} />}
          <label className="field-label">仕入先種別 *</label>
          <select className="field-input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
            {SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="field-label">仕入先名</label>
          <input className="field-input" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="例: ○○市 / 出品者名など" />
          <label className="field-label">仕入日 *</label>
          <input className="field-input" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
          <label className="field-label">合計仕入額(円) *</label>
          <input className="field-input" type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="例: 15000" />
          <label className="field-label">仕入点数 *</label>
          <input className="field-input" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="例: 5" />
          <div className="calc-box"><div className="item-sub">自動計算</div><div className="calc-result">1点あたりの平均仕入値: {fmt(avgOf(form))}</div></div>
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="field-label">写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('purchase-photo-input').click()}>📷 タップして写真を選択</div>
          <input id="purchase-photo-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoChange} />
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}

      {linking && (
        <Modal title="在庫に追加" onClose={() => setLinking(null)}>
          <div className="calc-box" style={{ marginBottom: 14 }}>
            <div className="item-sub">この仕入れから</div>
            <div className="calc-result">平均仕入値 {fmt(linking.avg_amount)}/点</div>
            <div className="item-sub" style={{ marginTop: 4 }}>で在庫に商品を追加します</div>
          </div>
          <label className="field-label">商品名 *</label>
          <input className="field-input" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
          <label className="field-label">カテゴリ</label>
          <input className="field-input" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
          <label className="field-label">仕入元・産地</label>
          <input className="field-input" value={itemForm.source_place} onChange={(e) => setItemForm({ ...itemForm, source_place: e.target.value })} />
          <label className="field-label">仕入値(円)（平均値が自動入力）</label>
          <input className="field-input" type="number" value={itemForm.buy_price} onChange={(e) => setItemForm({ ...itemForm, buy_price: e.target.value })} />
          <label className="field-label">売値(円)</label>
          <input className="field-input" type="number" value={itemForm.sell_price} onChange={(e) => setItemForm({ ...itemForm, sell_price: e.target.value })} placeholder="例: 5000" />
          <label className="field-label">仕入日付（仕入記録の日付が自動入力）</label>
          <input className="field-input" type="date" value={itemForm.purchase_date || ''} onChange={(e) => setItemForm({ ...itemForm, purchase_date: e.target.value })} />
          <label className="field-label">保存場所（棚番号・保管場所）</label>
          <input className="field-input" value={itemForm.storage_location} onChange={(e) => setItemForm({ ...itemForm, storage_location: e.target.value })} placeholder="例: A棚-3 / 倉庫2F" />
          <label className="field-label">ロット番号</label>
          <input className="field-input" value={itemForm.lot_number} onChange={(e) => setItemForm({ ...itemForm, lot_number: e.target.value })} />
          <label className="field-label">状態・コンディション</label>
          <select className="field-input" value={itemForm.condition} onChange={(e) => setItemForm({ ...itemForm, condition: e.target.value })}>
            <option value="">未設定</option>
            {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <label className="field-label">想定販売期限</label>
          <input className="field-input" type="date" value={itemForm.expected_sell_by || ''} onChange={(e) => setItemForm({ ...itemForm, expected_sell_by: e.target.value })} />
          <label className="field-label">メモ</label>
          <input className="field-input" value={itemForm.note} onChange={(e) => setItemForm({ ...itemForm, note: e.target.value })} />
          <label className="field-label">写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('link-item-photo-input').click()}>📷 タップして写真を選択</div>
          <input id="link-item-photo-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={onItemPhotoChange} />
          {itemPhotoPreview && <img src={itemPhotoPreview} className="photo-preview" style={{ display: 'block' }} />}
          <button className="save-btn" onClick={addToInventory}>在庫に追加する</button>
        </Modal>
      )}
    </>
  )
}
