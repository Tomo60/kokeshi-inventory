import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import Modal from './Modal'

const emptyForm = { item_id: '', customer_id: '', sell_price: '', fee_rate: '0', ad_rate: '0', shipping_fee: '0', sold_at: today(), note: '' }

function calcNet(form) {
  const sell = +form.sell_price || 0
  const fee = Math.round((sell * (+form.fee_rate || 0)) / 100)
  const ad = Math.round((sell * (+form.ad_rate || 0)) / 100)
  return sell - fee - ad - (+form.shipping_fee || 0)
}

export default function Sales({ items, sales, customers, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const inStockItems = items.filter((i) => i.status === 'in_stock')

  function openAdd(item) {
    setForm({ ...emptyForm, item_id: item ? item.id : '', sell_price: item ? item.sell_price || '' : '' })
    setFormOpen(true)
  }

  async function save() {
    if (!form.sell_price) return alert('販売価格を入力してください')
    setSaving(true)
    const net = calcNet(form)
    const row = {
      item_id: form.item_id || null,
      customer_id: form.customer_id || null,
      sell_price: +form.sell_price,
      fee_rate: +form.fee_rate || 0,
      ad_rate: +form.ad_rate || 0,
      shipping_fee: +form.shipping_fee || 0,
      net_profit: net,
      sold_at: form.sold_at,
      note: form.note || null,
    }
    await supabase.from('sales').insert(row)
    if (form.item_id) {
      await supabase.from('items').update({ status: 'sold' }).eq('id', form.item_id)
    }
    setSaving(false)
    setFormOpen(false)
    await reload()
  }

  return (
    <>
      <div className="row-between">
        <h2 className="section-title">販売記録</h2>
        <button className="add-btn" onClick={() => openAdd(null)}>+ 記録</button>
      </div>
      {sales.length === 0 && <div className="empty">販売記録がありません</div>}
      {sales.map((s) => {
        const item = items.find((i) => i.id === s.item_id) || {}
        const customer = customers.find((c) => c.id === s.customer_id) || {}
        const net = s.net_profit != null ? s.net_profit : (s.sell_price || 0) - (item.buy_price || 0)
        return (
          <div className="card" key={s.id}>
            <div className="row-between">
              <span className="code-badge">{item.code || '手動記録'}</span>
              <span className="item-sub">{s.sold_at}</span>
            </div>
            <div className="item-name">{item.name || s.note || '不明'}</div>
            {customer.name && <div className="item-sub">👤 {customer.name}</div>}
            <div className="price-row">
              <span className="price-tag">販売 {fmt(s.sell_price)}</span>
              {s.fee_rate ? <span className="price-tag">手数料{s.fee_rate}%</span> : null}
              {s.ad_rate ? <span className="price-tag">広告{s.ad_rate}%</span> : null}
              {s.shipping_fee ? <span className="price-tag">送料 {fmt(s.shipping_fee)}</span> : null}
              <span className="price-tag" style={{ color: net >= 0 ? '#2e8b57' : '#e74c3c', fontWeight: 700 }}>純利 {fmt(net)}</span>
            </div>
          </div>
        )
      })}

      {formOpen && (
        <Modal title="販売記録" onClose={() => setFormOpen(false)}>
          <label className="field-label">商品</label>
          <select className="field-input" value={form.item_id} onChange={(e) => {
            const item = items.find((i) => i.id === +e.target.value)
            setForm({ ...form, item_id: e.target.value, sell_price: item ? item.sell_price || form.sell_price : form.sell_price })
          }}>
            <option value="">-- メルカリ等の単発販売 --</option>
            {inStockItems.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} ` : ''}{i.name}</option>)}
          </select>
          <label className="field-label">顧客</label>
          <select className="field-input" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">-- 未指定 --</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="field-label">販売価格(円) *</label>
          <input className="field-input" type="number" value={form.sell_price} onChange={(e) => setForm({ ...form, sell_price: e.target.value })} />
          <label className="field-label">日付 *</label>
          <input className="field-input" type="date" value={form.sold_at} onChange={(e) => setForm({ ...form, sold_at: e.target.value })} />
          <label className="field-label">手数料率(%)</label>
          <input className="field-input" type="number" value={form.fee_rate} onChange={(e) => setForm({ ...form, fee_rate: e.target.value })} />
          <label className="field-label">広告費率(%)</label>
          <input className="field-input" type="number" value={form.ad_rate} onChange={(e) => setForm({ ...form, ad_rate: e.target.value })} />
          <label className="field-label">送料(円)</label>
          <input className="field-input" type="number" value={form.shipping_fee} onChange={(e) => setForm({ ...form, shipping_fee: e.target.value })} />
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="商品を選ばない場合は商品名など" />
          <div className="calc-box">
            <div className="item-sub">自動計算（手数料・広告費・送料差引後）</div>
            <div className="calc-result">純利益: {fmt(calcNet(form))}</div>
          </div>
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : '記録する'}</button>
        </Modal>
      )}
    </>
  )
}
