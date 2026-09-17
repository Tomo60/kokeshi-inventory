import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmt, today } from '../lib/format'
import { PLATFORMS, SALE_STATUSES, ACCOUNT_REQUIRED_PLATFORMS, platformLabel, saleStatusLabel, isCountedSale } from '../lib/constants'
import Modal from './Modal'

const emptyForm = {
  item_id: '', customer_id: '', sell_price: '',
  platform: 'mercari', channel_account: '', external_order_no: '',
  fee_rate: '0', ad_rate: '0', fee_amount: '', ad_amount: '', shipping_fee: '0',
  payout_amount: '', payout_date: '', sale_status: 'completed',
  sold_at: today(), note: '',
}

// 実額(fee_amount / ad_amount)が入力されていればそれを優先し、
// 未入力なら従来どおり率(fee_rate / ad_rate)から計算する。
function feeOf(form) {
  const sell = +form.sell_price || 0
  if (form.fee_amount !== '' && form.fee_amount != null) return +form.fee_amount || 0
  return Math.round((sell * (+form.fee_rate || 0)) / 100)
}
function adOf(form) {
  const sell = +form.sell_price || 0
  if (form.ad_amount !== '' && form.ad_amount != null) return +form.ad_amount || 0
  return Math.round((sell * (+form.ad_rate || 0)) / 100)
}
function calcNet(form) {
  return (+form.sell_price || 0) - feeOf(form) - adOf(form) - (+form.shipping_fee || 0)
}
const usesActualAmounts = (form) =>
  (form.fee_amount !== '' && form.fee_amount != null) || (form.ad_amount !== '' && form.ad_amount != null)

export default function Sales({ items, sales, customers, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const inStockItems = items.filter((i) => i.status === 'in_stock')

  // 表記ゆれを防ぐため、これまでに入力されたアカウント名をサジェスト候補として出す
  const knownAccounts = [...new Set(sales.map((s) => s.channel_account).filter(Boolean))].sort()
  const accountRequired = ACCOUNT_REQUIRED_PLATFORMS.includes(form.platform)

  function openAdd(item) {
    setForm({ ...emptyForm, item_id: item ? item.id : '', sell_price: item ? item.sell_price || '' : '' })
    setFormOpen(true)
  }

  async function save() {
    if (!form.sell_price) return alert('販売価格を入力してください')
    if (accountRequired && !form.channel_account.trim()) {
      return alert(`${platformLabel(form.platform)}は複数アカウント運用のため、アカウント名を入力してください`)
    }
    setSaving(true)
    const net = calcNet(form)
    const row = {
      item_id: form.item_id || null,
      customer_id: form.customer_id || null,
      sell_price: +form.sell_price,
      platform: form.platform,
      channel_account: form.channel_account.trim() || null,
      external_order_no: form.external_order_no.trim() || null,
      fee_rate: +form.fee_rate || 0,
      ad_rate: +form.ad_rate || 0,
      fee_amount: form.fee_amount === '' ? null : +form.fee_amount,
      ad_amount: form.ad_amount === '' ? null : +form.ad_amount,
      shipping_fee: +form.shipping_fee || 0,
      payout_amount: form.payout_amount === '' ? null : +form.payout_amount,
      payout_date: form.payout_date || null,
      sale_status: form.sale_status,
      needs_review: false, // 新規入力は必要項目が揃っている前提
      net_profit: net,
      sold_at: form.sold_at,
      note: form.note || null,
    }
    const { error } = await supabase.from('sales').insert(row)
    if (error) {
      setSaving(false)
      return alert(`保存に失敗しました: ${error.message}`)
    }
    // 返品・キャンセルは在庫を減らさない（売れていないため在庫に残す）
    if (form.item_id && isCountedSale(row)) {
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
        const counted = isCountedSale(s)
        return (
          <div className="card" key={s.id} style={{ opacity: counted ? 1 : 0.6 }}>
            <div className="row-between">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span className="code-badge">{item.code || '手動記録'}</span>
                <span className="category-badge">{platformLabel(s.platform || 'mercari')}</span>
                {s.channel_account && <span className="code-badge">@{s.channel_account}</span>}
                {!counted && <span className="status-badge status-sold">{saleStatusLabel(s.sale_status)}</span>}
                {s.needs_review && <span className="aging-badge aging-warn">要確認</span>}
              </div>
              <span className="item-sub">{s.sold_at}</span>
            </div>
            <div className="item-name">{item.name || s.note || '不明'}</div>
            {customer.name && <div className="item-sub">👤 {customer.name}</div>}
            <div className="price-row">
              <span className="price-tag">販売 {fmt(s.sell_price)}</span>
              {s.fee_amount != null ? <span className="price-tag">手数料 {fmt(s.fee_amount)}</span> : s.fee_rate ? <span className="price-tag">手数料{s.fee_rate}%</span> : null}
              {s.ad_amount != null ? <span className="price-tag">広告 {fmt(s.ad_amount)}</span> : s.ad_rate ? <span className="price-tag">広告{s.ad_rate}%</span> : null}
              {s.shipping_fee ? <span className="price-tag">送料 {fmt(s.shipping_fee)}</span> : null}
              <span className="price-tag" style={{ color: net >= 0 ? '#2e8b57' : '#e74c3c', fontWeight: 700 }}>純利 {fmt(net)}</span>
            </div>
            {(s.payout_amount != null || s.payout_date || s.external_order_no) && (
              <div className="item-sub" style={{ marginTop: 4 }}>
                {s.payout_amount != null && <>入金 {fmt(s.payout_amount)}　</>}
                {s.payout_date && <>入金日 {s.payout_date}　</>}
                {s.external_order_no && <>取引ID {s.external_order_no}</>}
              </div>
            )}
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
          <label className="field-label">成約日 *（入力日ではなく売れた日）</label>
          <input className="field-input" type="date" value={form.sold_at} onChange={(e) => setForm({ ...form, sold_at: e.target.value })} />

          <label className="field-label">販路 *</label>
          <select className="field-input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.icon} {p.label}</option>)}
          </select>
          <label className="field-label">アカウント{accountRequired ? ' *' : '（任意）'}</label>
          <input
            className="field-input"
            list="sales-account-options"
            value={form.channel_account}
            onChange={(e) => setForm({ ...form, channel_account: e.target.value })}
            placeholder={knownAccounts.length ? '入力済みの候補から選択、または新規入力' : '例: メイン垢'}
          />
          <datalist id="sales-account-options">
            {knownAccounts.map((a) => <option key={a} value={a} />)}
          </datalist>
          <label className="field-label">取引ID（任意）</label>
          <input className="field-input" value={form.external_order_no} onChange={(e) => setForm({ ...form, external_order_no: e.target.value })} placeholder="メルカリの取引IDなど" />
          <label className="field-label">ステータス *</label>
          <select className="field-input" value={form.sale_status} onChange={(e) => setForm({ ...form, sale_status: e.target.value })}>
            {SALE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <label className="field-label">手数料(円)（実額。入力すると率より優先）</label>
          <input className="field-input" type="number" value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value })} placeholder="例: 1000" />
          <label className="field-label">広告費(円)（実額。入力すると率より優先）</label>
          <input className="field-input" type="number" value={form.ad_amount} onChange={(e) => setForm({ ...form, ad_amount: e.target.value })} />
          <label className="field-label">送料(円)</label>
          <input className="field-input" type="number" value={form.shipping_fee} onChange={(e) => setForm({ ...form, shipping_fee: e.target.value })} />
          <label className="field-label">入金額(円)（任意）</label>
          <input className="field-input" type="number" value={form.payout_amount} onChange={(e) => setForm({ ...form, payout_amount: e.target.value })} />
          <label className="field-label">入金日（任意）</label>
          <input className="field-input" type="date" value={form.payout_date} onChange={(e) => setForm({ ...form, payout_date: e.target.value })} />

          <details style={{ marginTop: 14 }}>
            <summary className="item-sub" style={{ cursor: 'pointer' }}>手数料率・広告費率で入力する（実額が未入力のときのみ使用）</summary>
            <label className="field-label">手数料率(%)</label>
            <input className="field-input" type="number" value={form.fee_rate} onChange={(e) => setForm({ ...form, fee_rate: e.target.value })} />
            <label className="field-label">広告費率(%)</label>
            <input className="field-input" type="number" value={form.ad_rate} onChange={(e) => setForm({ ...form, ad_rate: e.target.value })} />
          </details>

          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="商品を選ばない場合は商品名など" />
          <div className="calc-box">
            <div className="item-sub">自動計算（{usesActualAmounts(form) ? '実額' : '率'}ベース・手数料・広告費・送料差引後）</div>
            <div className="calc-result">純利益: {fmt(calcNet(form))}</div>
            <div className="item-sub" style={{ marginTop: 4 }}>手数料 {fmt(feeOf(form))} / 広告費 {fmt(adOf(form))}</div>
          </div>
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : '記録する'}</button>
        </Modal>
      )}
    </>
  )
}
