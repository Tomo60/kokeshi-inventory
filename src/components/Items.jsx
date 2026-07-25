import { useState } from 'react'
import QRCode from 'qrcode'
import { supabase, uploadPhoto } from '../lib/supabase'
import { fmt } from '../lib/format'
import Modal from './Modal'

const emptyForm = { code: '', name: '', category: '', source_place: '', buy_price: '', sell_price: '', note: '' }

function ItemCard({ item, onEdit, onSell, onReturn, onQr }) {
  const sold = item.status === 'sold'
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {item.photo_url ? (
          <img src={item.photo_url} className="photo-thumb" onError={(e) => (e.target.style.display = 'none')} />
        ) : (
          <div style={{ width: 60, height: 60, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px dashed #ddd', fontSize: 20 }}>📷</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <span className={'status-badge ' + (sold ? 'status-sold' : 'status-in')}>{sold ? '売済み' : '在庫中'}</span>
            {item.code && <span className="code-badge">{item.code}</span>}
          </div>
          <div className="item-name">{item.name}</div>
          <div className="price-row">
            {item.sell_price ? <span className="price-tag">売値 {fmt(item.sell_price)}</span> : null}
            {item.buy_price ? <span className="price-tag">仕入 {fmt(item.buy_price)}</span> : null}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="edit-btn" style={{ flex: 1 }} onClick={() => onEdit(item)}>編集</button>
        <button className="qr-btn" onClick={() => onQr(item)}>QR</button>
        {!sold && <button className="sold-btn" style={{ flex: 1 }} onClick={() => onSell(item)}>販売済みにする</button>}
        {sold && <button className="return-btn" style={{ flex: 1 }} onClick={() => onReturn(item)}>在庫に戻す</button>}
      </div>
    </div>
  )
}

export default function Items({ items, reload }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [qrItem, setQrItem] = useState(null)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [formOpen, setFormOpen] = useState(false)

  const inCount = items.filter((i) => i.status === 'in_stock').length
  const soldCount = items.filter((i) => i.status === 'sold').length
  const filtered = items.filter((i) => {
    if (filter === 'in_stock' && i.status !== 'in_stock') return false
    if (filter === 'sold' && i.status !== 'sold') return false
    if (search) {
      const w = search.toLowerCase()
      if (!(i.name || '').toLowerCase().includes(w) && !(i.code || '').toLowerCase().includes(w) && !(i.category || '').toLowerCase().includes(w)) return false
    }
    return true
  })

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
  }
  function openEdit(item) {
    setEditing(item)
    setForm({ ...emptyForm, ...item })
    setPhotoFile(null)
    setPhotoPreview(null)
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
    if (!form.name) return alert('商品名を入力してください')
    setSaving(true)
    let photo_url = editing ? editing.photo_url : null
    if (photoFile) {
      const url = await uploadPhoto(photoFile, 'item')
      if (url) photo_url = url
    }
    const row = {
      code: form.code || null,
      name: form.name,
      category: form.category || null,
      source_place: form.source_place || null,
      buy_price: form.buy_price ? +form.buy_price : null,
      sell_price: form.sell_price ? +form.sell_price : null,
      note: form.note || null,
      photo_url,
    }
    if (editing) {
      await supabase.from('items').update(row).eq('id', editing.id)
    } else {
      await supabase.from('items').insert({ ...row, status: 'in_stock' })
    }
    setSaving(false)
    setEditing(null)
    setForm(emptyForm)
    await reload()
  }

  async function setStatus(item, status) {
    await supabase.from('items').update({ status }).eq('id', item.id)
    await reload()
  }

  async function openQr(item) {
    setQrItem(item)
    const url = `${location.origin}?code=${encodeURIComponent(item.code || item.id)}`
    const dataUrl = await QRCode.toDataURL(url, { width: 200, color: { dark: '#2f4858', light: '#ffffff' } })
    setQrDataUrl(dataUrl)
  }

  async function printLabel(item) {
    const url = `${location.origin}?code=${encodeURIComponent(item.code || item.id)}`
    const dataUrl = await QRCode.toDataURL(url, { width: 90, color: { dark: '#2f4858', light: '#ffffff' } })
    const pa = document.getElementById('print-area')
    pa.innerHTML = `<div class="price-label">
      <div><div class="price-label-name">${item.name}</div><div class="price-label-sub">${item.category || ''}</div></div>
      <div class="price-label-bottom">
        <div><div class="price-label-price">${fmt(item.sell_price)}</div><div class="price-label-code">${item.code || ''}</div></div>
        <img src="${dataUrl}" width="75" height="75" />
      </div>
    </div>`
    pa.style.display = 'block'
    setTimeout(() => {
      window.print()
      pa.style.display = 'none'
    }, 100)
  }

  return (
    <>
      <div className="row-between">
        <h2 className="section-title">在庫一覧 ({filtered.length}件)</h2>
        <button className="add-btn" onClick={() => { openAdd(); setFormOpen(true) }}>+ 登録</button>
      </div>
      <input
        className="search-input"
        placeholder="🔍 名前・コード・カテゴリで検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="filter-row">
        <button className={'filter-btn' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>すべて({items.length})</button>
        <button className={'filter-btn' + (filter === 'in_stock' ? ' active' : '')} onClick={() => setFilter('in_stock')}>在庫中({inCount})</button>
        <button className={'filter-btn' + (filter === 'sold' ? ' active' : '')} onClick={() => setFilter('sold')}>売済み({soldCount})</button>
      </div>
      {filtered.length === 0 && <div className="empty">該当する商品がありません</div>}
      {filtered.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          onEdit={(i) => { openEdit(i); setFormOpen(true) }}
          onSell={(i) => setStatus(i, 'sold')}
          onReturn={(i) => setStatus(i, 'in_stock')}
          onQr={openQr}
        />
      ))}

      {formOpen && (
        <Modal title={editing ? '商品編集' : '商品登録'} onClose={() => setFormOpen(false)}>
          {(editing?.photo_url || photoPreview) && (
            <img src={photoPreview || editing.photo_url} className="photo-preview" style={{ display: 'block' }} />
          )}
          <label className="field-label">管理コード</label>
          <input className="field-input" value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例: A-001" />
          <label className="field-label">商品名 *</label>
          <input className="field-input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: 手彫り木工皿" />
          <label className="field-label">カテゴリ</label>
          <input className="field-input" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="例: 木工品" />
          <label className="field-label">仕入元・産地</label>
          <input className="field-input" value={form.source_place || ''} onChange={(e) => setForm({ ...form, source_place: e.target.value })} placeholder="例: 岩手" />
          <label className="field-label">仕入値(円)</label>
          <input className="field-input" type="number" value={form.buy_price || ''} onChange={(e) => setForm({ ...form, buy_price: e.target.value })} />
          <label className="field-label">売値(円)</label>
          <input className="field-input" type="number" value={form.sell_price || ''} onChange={(e) => setForm({ ...form, sell_price: e.target.value })} />
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="field-label">写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('item-photo-input').click()}>📷 タップして写真を選択</div>
          <input id="item-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhotoChange} />
          <button className="save-btn" disabled={saving} onClick={async () => { await save(); setFormOpen(false) }}>
            {saving ? '保存中...' : editing ? '保存する' : '登録する'}
          </button>
        </Modal>
      )}

      {qrItem && (
        <Modal title="QRコード / 値札" onClose={() => setQrItem(null)}>
          <div className="qr-container">
            {qrDataUrl && <img src={qrDataUrl} width={180} height={180} />}
            <div className="qr-label">{qrItem.code}<br />{qrItem.name}</div>
          </div>
          <button className="print-btn" style={{ width: '100%' }} onClick={() => printLabel(qrItem)}>🖨 値札を印刷</button>
        </Modal>
      )}
    </>
  )
}
