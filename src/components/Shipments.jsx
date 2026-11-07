import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { saveWithRetry } from '../lib/retry'
import { fmt, today } from '../lib/format'
import { CARRIERS, SHIP_METHODS, carrierLabel, shipMethodLabel, carrierForMethod } from '../lib/constants'
import Modal from './Modal'

// 発送伝票の記録画面。
//
// 設計の前提:
// ・売上(sales)との紐付け(sale_id)は「任意」。発送した時点では取引が確定していない場合や、
//   過去分の伝票を後からまとめて入力する場合があるため、未紐付けのまま保存して後で結び直せる。
// ・1つの売上に対して複数回の発送（分割発送・再送）が起こりうるので、売上1:発送多の構造にしている。
// ・追跡番号は任意入力。空欄のまま何件でも保存できるが、入力した場合は二重登録を防ぐ
//   （DB側の部分ユニーク索引 shipments_tracking_no_uniq と、保存前のこの画面側の確認の二重構え）。
const emptyForm = {
  shipped_on: today(),
  method: 'rakuraku',
  carrier: 'yamato',
  tracking_no: '',
  shipping_cost: '',
  recipient: '',
  destination: '',
  sale_id: '',
  note: '',
}

/** 売上の選択肢に出す表示名。商品名が引けない場合も日付と金額で見分けられるようにする */
function saleLabel(sale, items) {
  const item = items.find((i) => i.id === sale.item_id)
  const name = item ? item.name : '商品未設定'
  const order = sale.external_order_no ? ` / ${sale.external_order_no}` : ''
  return `${sale.sold_at} ${name} ${fmt(sale.sell_price)}${order}`
}

export default function Shipments({ shipments, shipmentsError, sales, items, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
    setFormOpen(true)
  }

  function openEdit(s) {
    setEditing(s)
    // DBのNULLをそのまま入力欄に入れると React が警告を出すため、空文字に寄せる
    setForm({
      ...emptyForm,
      ...s,
      tracking_no: s.tracking_no || '',
      shipping_cost: s.shipping_cost ?? '',
      recipient: s.recipient || '',
      destination: s.destination || '',
      sale_id: s.sale_id || '',
      note: s.note || '',
    })
    setPhotoFile(null)
    setPhotoPreview(null)
    setFormOpen(true)
  }

  // 発送方法を変えたら配送業者も既定値に追従させる。
  // 「らくらくメルカリ便なのに日本郵便」のような取り違えを防ぐのが目的で、
  // 業者は後から手で変えられる（その他の方法のときは触らない）。
  function onMethodChange(method) {
    const carrier = carrierForMethod(method)
    setForm((f) => ({ ...f, method, carrier: carrier || f.carrier }))
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
    if (!form.shipped_on) return alert('発送日を入力してください')
    const tracking = form.tracking_no.trim()
    // 追跡番号の二重登録チェック。DB側の部分ユニーク索引でも弾かれるが、
    // 保存エラーとして出るより先に、どの伝票と重複しているかを伝えたい
    if (tracking) {
      const dup = shipments.find((s) => s.tracking_no === tracking && s.id !== editing?.id)
      if (dup) return alert(`追跡番号 ${tracking} は ${dup.shipped_on} の発送記録で既に登録されています`)
    }
    setSaving(true)
    let photo_url = editing ? editing.photo_url : null
    if (photoFile) {
      const url = await uploadPhoto(photoFile, 'shipment')
      if (url) photo_url = url
    }
    const row = {
      shipped_on: form.shipped_on,
      method: form.method || null,
      carrier: form.carrier || null,
      tracking_no: tracking || null,
      shipping_cost: form.shipping_cost === '' ? 0 : +form.shipping_cost,
      recipient: form.recipient || null,
      destination: form.destination || null,
      sale_id: form.sale_id ? +form.sale_id : null,
      note: form.note || null,
      photo_url,
    }
    const { ok } = await saveWithRetry(
      () => (editing
        ? supabase.from('shipments').update(row).eq('id', editing.id)
        : supabase.from('shipments').insert(row)),
      '発送記録の保存',
    )
    setSaving(false)
    // 失敗したらフォームは閉じない（入力内容を残す）
    if (!ok) return
    setFormOpen(false)
    await reload()
  }

  // テーブル未作成でもアプリ全体は動かす方針のため、この画面だけで理由を説明する。
  // （recurring_expenses で「常に0件」に気づけなかった件の再発防止）
  if (shipmentsError) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>⚠️ 発送記録テーブルがまだ使えません</div>
        <div className="item-sub">
          {shipmentsError}<br /><br />
          この機能は <code>shipments</code> テーブルを使います。まだ作成されていない場合は、
          <code>supabase/schema.sql</code> を Supabase の SQL Editor で実行してください。<br />
          テーブルを Table Editor から手で作ると Row Level Security が既定で有効になり、
          ポリシーが無いままだと常に0件・保存できない状態になります。必ず SQL Editor から実行してください。
        </div>
      </div>
    )
  }

  const totalCost = shipments.reduce((s, x) => s + (x.shipping_cost || 0), 0)
  const unlinked = shipments.filter((s) => !s.sale_id).length
  const withTracking = shipments.filter((s) => s.tracking_no).length

  return (
    <>
      <h2 className="section-title">発送サマリー</h2>
      <div className="card-grid">
        <div className="kpi-card" style={{ borderTop: '3px solid #2f4858' }}><div className="kpi-label">発送件数</div><div className="kpi-value">{shipments.length}件</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #2980b9' }}><div className="kpi-label">送料合計</div><div className="kpi-value">{fmt(totalCost)}</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #8e44ad' }}><div className="kpi-label">追跡番号あり</div><div className="kpi-value">{withTracking}件</div></div>
        <div className="kpi-card" style={{ borderTop: '3px solid #e67e22' }}><div className="kpi-label">売上と未紐付け</div><div className="kpi-value">{unlinked}件</div></div>
      </div>

      <div className="row-between" style={{ marginTop: 14 }}>
        <h2 className="section-title" style={{ margin: 0 }}>発送記録</h2>
        <button className="add-btn" onClick={openAdd}>+ 発送登録</button>
      </div>
      {shipments.length === 0 && <div className="empty">発送した伝票を登録してください</div>}
      {shipments.map((s) => {
        const sale = s.sale_id ? sales.find((x) => x.id === s.sale_id) : null
        return (
          <div className="card" key={s.id}>
            {s.photo_url && <img src={s.photo_url} className="photo-thumb" style={{ float: 'right', marginLeft: 10 }} onError={(e) => (e.target.style.display = 'none')} />}
            <div className="row-between">
              <span className="category-badge">{shipMethodLabel(s.method) || '発送方法未設定'}</span>
              <span className="item-sub">{s.shipped_on}</span>
            </div>
            <div className="item-name" style={{ marginTop: 6 }}>{s.recipient || '宛先未記入'}</div>
            {s.destination && <div className="item-sub">📍 {s.destination}</div>}
            <div className="price-row">
              {s.carrier && <span className="price-tag">{carrierLabel(s.carrier)}</span>}
              <span className="price-tag">送料 {fmt(s.shipping_cost)}</span>
              {s.tracking_no
                ? <span className="price-tag" style={{ color: '#2f4858', fontWeight: 700 }}>追跡 {s.tracking_no}</span>
                : <span className="price-tag">追跡番号なし</span>}
            </div>
            {sale
              ? <div className="item-sub">🔗 {saleLabel(sale, items)}</div>
              : <div className="item-sub">🔗 売上と未紐付け</div>}
            {s.note && <div className="item-sub">📝 {s.note}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', clear: 'both' }}>
              <button className="edit-btn" onClick={() => openEdit(s)}>編集</button>
            </div>
          </div>
        )
      })}

      {formOpen && (
        <Modal title={editing ? '発送編集' : '発送登録'} onClose={() => setFormOpen(false)}>
          {(editing?.photo_url || photoPreview) && <img src={photoPreview || editing.photo_url} className="photo-preview" style={{ display: 'block' }} />}
          <label className="field-label">発送日 *</label>
          <input className="field-input" type="date" value={form.shipped_on} onChange={(e) => setForm({ ...form, shipped_on: e.target.value })} />
          <label className="field-label">発送方法</label>
          <select className="field-input" value={form.method} onChange={(e) => onMethodChange(e.target.value)}>
            {SHIP_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <label className="field-label">配送業者（発送方法に合わせて自動選択）</label>
          <select className="field-input" value={form.carrier || ''} onChange={(e) => setForm({ ...form, carrier: e.target.value })}>
            <option value="">未設定</option>
            {CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <label className="field-label">追跡番号（任意・入力すると二重登録を防げます）</label>
          <input className="field-input" value={form.tracking_no} onChange={(e) => setForm({ ...form, tracking_no: e.target.value })} placeholder="例: 123456789012" />
          <label className="field-label">送料(円)</label>
          <input className="field-input" type="number" value={form.shipping_cost} onChange={(e) => setForm({ ...form, shipping_cost: e.target.value })} placeholder="例: 210" />
          <label className="field-label">宛先（お届け先の名前）</label>
          <input className="field-input" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} placeholder="例: ○○様" />
          <label className="field-label">お届け先（都道府県・市区町村など）</label>
          <input className="field-input" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="例: 宮城県大崎市" />
          <label className="field-label">紐付ける売上（任意・後から結び直せます）</label>
          <select className="field-input" value={form.sale_id} onChange={(e) => setForm({ ...form, sale_id: e.target.value })}>
            <option value="">紐付けない</option>
            {sales.map((s) => <option key={s.id} value={s.id}>{saleLabel(s, items)}</option>)}
          </select>
          {sales.length === 0 && (
            <div className="item-sub">売上がまだ登録されていないため、いまは紐付けできません。発送だけ記録しておき、売上を登録してから編集で結び直せます。</div>
          )}
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <label className="field-label">伝票の写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('shipment-photo-input').click()}>📷 タップして伝票を撮影</div>
          <input id="shipment-photo-input" type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPhotoChange} />
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
        </Modal>
      )}
    </>
  )
}
