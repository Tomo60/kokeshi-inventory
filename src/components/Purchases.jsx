import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { saveWithRetry } from '../lib/retry'
import { fmt, today } from '../lib/format'
import { CONDITIONS } from '../lib/constants'
import { isCancelled, cancelLabel, cancelRow, restoreRow } from '../lib/cancel'
import Modal from './Modal'

// 分類ルール: このテーブルは「販売する商品そのものの仕入」専用。
// 梱包材料（段ボール・緩衝材など）の購入費用はここには計上せず、
// expenses のカテゴリ 'materials'（梱包材料費）にのみ記録する。両方に入れると二重計上になる。
const SOURCE_TYPES = [
  { value: 'market', label: 'フリーマーケット' },
  { value: 'online', label: 'ネット通販/オークション' },
  { value: 'shop', label: '専門店' },
  { value: 'wholesaler', label: '問屋' },
  { value: 'craftsperson', label: '作家・職人直接' },
  { value: 'other', label: 'その他' },
]

// フォームが扱う項目。ここに無い列は save() でも書かないので、
// needs_review や取り消しフラグ（deleted_at など）は編集・保存しても touch されない。
const emptyForm = {
  source_type: 'market', source: '', purchase_date: today(),
  total_amount: '', quantity: '', note: '',
  // アカウント（トモ / ゆゆ♥ など）。既定は空欄。
  // 店舗仕入れやフリマには「どのアカウントで買ったか」という概念がないため、
  // 既定値を入れてしまうと誤ったアカウントが静かに付いてアカウント別集計が狂う。
  channel_account: '',
  // 以下はいずれも purchases に既にある列。マイグレーションは不要。
  external_order_no: '', point_used: '', coupon_used: '', payment_method: '',
}

// アカウントの選択肢で「新しいアカウントを手入力する」を選んだときの値。
// 実際のアカウント名と衝突しない値にしておく。
const NEW_ACCOUNT = '\u0000new'
const emptyItemForm = {
  category: '', source_place: '', name: '', buy_price: '', sell_price: '',
  purchase_date: today(), storage_location: '', lot_number: '', condition: '', expected_sell_by: '',
  note: '',
}

// 「2026-10-17」→「2026年10月17日」。読めない値はそのまま出す。
function formatDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '')
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : (d || '日付なし')
}

function avgOf(form) {
  const total = +form.total_amount || 0
  const qty = +form.quantity || 0
  return qty > 0 ? Math.round(total / qty) : 0
}

// DBから読んだ値は null のことがあるので、文字列にしてから前後の空白を落とす。
const trimmed = (v) => String(v ?? '').trim()

// purchases は有効な行だけ（App.jsx で取り消し済みを除いて渡している）。
// allPurchases は取り消し済みも含む全行で、「取消済みも表示」のときだけ使う。
export default function Purchases({ purchases, allPurchases, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(null)
  // 取り消し（論理削除）まわり。行は消さず、合計から外すだけ。
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBy, setCancelBy] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [itemPhotoFile, setItemPhotoFile] = useState(null)
  const [itemPhotoPreview, setItemPhotoPreview] = useState(null)
  // アカウントを選択肢から選ぶか、新しい名前を手入力するか。
  const [newAccount, setNewAccount] = useState(false)

  // これまでに使われたアカウント名を、既存データからそのまま拾って選択肢にする。
  // 手で打たせないのが要点。「ゆゆ♥」のハート（U+2665）を打ち直すと
  // 見た目がそっくりな別の字（♡ U+2661 など）になり、別アカウント扱いで集計が割れる。
  // 取り消し済みの行も候補に含めるため allPurchases を優先して見る。
  const accountSource = allPurchases || purchases
  const knownAccounts = [...new Set((accountSource || []).map((p) => p.channel_account).filter(Boolean))].sort()
  // 支払方法も同じ考え方で、入力済みの値を候補に出して表記ゆれを防ぐ。
  const knownMethods = [...new Set((accountSource || []).map((p) => p.payment_method).filter(Boolean))].sort()

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setPhotoFile(null)
    setPhotoPreview(null)
    setConfirmingCancel(false)
    setNewAccount(false)
    setFormOpen(true)
  }
  function openEdit(p) {
    setEditing(p)
    setForm({ ...emptyForm, ...p })
    setPhotoFile(null)
    setPhotoPreview(null)
    setConfirmingCancel(false)
    // 既存のアカウントは必ず候補に含まれる（候補は既存データから作っているため）ので、
    // 編集を開いた時点では手入力モードにしない。
    setNewAccount(false)
    setFormOpen(true)
  }

  // 行は消さずに取り消しフラグを立てる（論理削除）。確認画面を経たうえでのみ呼ばれる。
  async function cancelRecord() {
    if (!editing) return
    if (!cancelReason.trim()) return alert('取り消す理由を入力してください')
    setCancelling(true)
    const { ok } = await cancelRow('purchases', editing.id, cancelReason.trim(), cancelBy.trim(), '仕入記録の取り消し')
    setCancelling(false)
    if (!ok) return
    setCancelReason('')
    setCancelBy('')
    setConfirmingCancel(false)
    setFormOpen(false)
    await reload()
  }

  // 取り消しを取り消す（元に戻す）。deleted_at を NULL に戻すだけ。
  async function restore(p) {
    setRestoringId(p.id)
    const { ok } = await restoreRow('purchases', p.id, '仕入記録の取り消しを元に戻す')
    setRestoringId(null)
    if (!ok) return
    await reload()
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
    // 書き込む列はここに挙げたものだけ。編集のときも同じなので、
    // ここに無い列（needs_review、deleted_at / deleted_reason / deleted_by、created_at）は
    // 編集・保存しても一切変わらない。
    const row = {
      source_type: form.source_type,
      source: form.source || null,
      purchase_date: form.purchase_date,
      total_amount: total,
      quantity: qty,
      avg_amount: avgOf(form),
      note: form.note || null,
      photo_url,
      // 空欄は NULL にする（「未設定」と「空文字」が混ざらないように）。
      channel_account: trimmed(form.channel_account) || null,
      external_order_no: trimmed(form.external_order_no) || null,
      payment_method: trimmed(form.payment_method) || null,
      // point_used / coupon_used は NOT NULL の列なので、空欄は 0 にする。
      // ポイントとクーポンは商品代金から引かない方針なので、合計仕入額には影響しない。
      point_used: +form.point_used || 0,
      coupon_used: +form.coupon_used || 0,
    }
    const { ok } = await saveWithRetry(
      () => (editing
        ? supabase.from('purchases').update(row).eq('id', editing.id)
        : supabase.from('purchases').insert(row)),
      '仕入記録の保存',
    )
    setSaving(false)
    // 失敗したらフォームは閉じない（入力内容を残す）
    if (!ok) return
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
    const { ok, data } = await saveWithRetry(() => supabase.from('items').insert({
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
    }).select(), '在庫への追加')
    // 失敗したらモーダルを閉じずに入力内容を残す（以前は失敗しても「追加しました」と出ていた）
    if (!ok) return
    if (data && data[0]) {
      // 商品自体は登録できているので、仕入との紐付けだけ失敗した場合はそれだけを伝える
      await saveWithRetry(
        () => supabase.from('purchase_items').insert({ purchase_id: linking.id, item_id: data[0].id }),
        '仕入と商品の紐付け（商品は在庫に追加されています）',
      )
    }
    setLinking(null)
    await reload()
    alert('在庫に追加しました')
  }

  // サマリーは常に有効な行だけ。取り消した分は金額にも点数にも入れない。
  const totalAmount = purchases.reduce((s, p) => s + (p.total_amount || 0), 0)
  const totalItems = purchases.reduce((s, p) => s + (p.quantity || 0), 0)
  const avgAmount = totalItems > 0 ? Math.round(totalAmount / totalItems) : 0

  const cancelledCount = (allPurchases || []).filter(isCancelled).length
  const visible = showCancelled ? (allPurchases || purchases) : purchases

  // 購入日ごとにまとめる。App.jsx が購入日の新しい順で取ってくるので、
  // 最初に出てきた順にキーを積むだけで、見出しも新しい日付から並ぶ。
  const days = {}
  const dayKeys = []
  visible.forEach((p) => {
    const d = p.purchase_date || '日付なし'
    if (!days[d]) { days[d] = []; dayKeys.push(d) }
    days[d].push(p)
  })

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
      {/* 取り消し済みがある場合だけ、表示の切り替えを出す（普段は邪魔にならないように） */}
      {cancelledCount > 0 && (
        <div className="filter-row" style={{ marginTop: 10 }}>
          <button
            className={'filter-btn' + (showCancelled ? ' active' : '')}
            onClick={() => setShowCancelled((v) => !v)}
          >
            取消済みも表示({cancelledCount})
          </button>
        </div>
      )}

      {purchases.length === 0 && !showCancelled && <div className="empty">仕入れを登録してください</div>}
      {dayKeys.map((d) => {
      // 見出しの件数・点数・金額は有効な行だけ。取り消した分は数えない。
      const active = days[d].filter((p) => !isCancelled(p))
      const dayAmount = active.reduce((s, p) => s + (p.total_amount || 0), 0)
      const dayQty = active.reduce((s, p) => s + (p.quantity || 0), 0)
      return (
        <div key={d}>
          <div className="month-header">
            {formatDay(d)}　{active.length}件・{dayQty}点・{fmt(dayAmount)}
          </div>
          {days[d].map((p) => {
        const sourceLabel = (SOURCE_TYPES.find((s) => s.value === p.source_type) || {}).label || p.source_type
        const off = isCancelled(p)
        return (
          <div className={'card' + (off ? ' cancelled-card' : '')} key={p.id}>
            {p.photo_url && <img src={p.photo_url} className="photo-thumb" style={{ float: 'right', marginLeft: 10 }} onError={(e) => (e.target.style.display = 'none')} />}
            <div className="row-between">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="category-badge">{sourceLabel}</span>
                {off && <span className="cancelled-badge">取消済み</span>}
              </div>
              <span className="item-sub">{p.purchase_date}</span>
            </div>
            <div className="item-name" style={{ marginTop: 6, textDecoration: off ? 'line-through' : 'none', color: off ? '#999' : undefined }}>{p.source}</div>
            <div className="price-row">
              <span className="price-tag">合計 {fmt(p.total_amount)}</span>
              <span className="price-tag">{p.quantity}点</span>
              <span className="price-tag" style={{ color: off ? '#999' : '#2f4858', fontWeight: 700 }}>平均 {fmt(p.avg_amount)}/点</span>
            </div>
            {p.note && <div className="item-sub">📝 {p.note}</div>}
            {off && (
              <div className="item-sub" style={{ marginTop: 6 }}>
                🚫 {cancelLabel(p)}<br />
                理由: {p.deleted_reason || '（記録なし）'}<br />
                この行は仕入サマリーの合計・点数に入っていません。
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', clear: 'both' }}>
              {off ? (
                <button className="edit-btn" disabled={restoringId === p.id} onClick={() => restore(p)}>
                  {restoringId === p.id ? '戻しています...' : '元に戻す'}
                </button>
              ) : (
                <>
                  <button className="edit-btn" onClick={() => openEdit(p)}>編集</button>
                  <button className="link-btn" onClick={() => openLink(p)}>在庫に追加</button>
                </>
              )}
            </div>
          </div>
        )
          })}
        </div>
      )
      })}

      {/* 取り消しの確認画面。記録自体は残るが、合計から外れるので内容を見せてから実行する */}
      {formOpen && confirmingCancel && editing && (
        <Modal title="この仕入記録を取り消しますか？" onClose={() => setConfirmingCancel(false)}>
          <div className="calc-box" style={{ marginTop: 0 }}>
            <div className="item-sub">仕入日: <b>{editing.purchase_date}</b></div>
            <div className="item-sub">仕入先: <b>{editing.source || '（なし）'}</b></div>
            <div className="item-sub">メモ: <b>{editing.note || '（なし）'}</b></div>
            <div className="calc-result" style={{ marginTop: 6 }}>{fmt(editing.total_amount)} / {editing.quantity}点</div>
          </div>
          <div className="item-sub" style={{ marginTop: 12 }}>
            取り消すと、この記録は<b>仕入サマリーの合計・点数から外れます</b>。記録そのものは消えずに残り、
            「取消済みも表示」から<b>いつでも元に戻せます</b>。
          </div>
          <label className="field-label">取り消す理由 *</label>
          <input
            className="field-input"
            value={cancelReason}
            onChange={(ev) => setCancelReason(ev.target.value)}
            placeholder="例: 二重に登録してしまったため"
          />
          <label className="field-label">取り消した人</label>
          <input
            className="field-input"
            value={cancelBy}
            onChange={(ev) => setCancelBy(ev.target.value)}
            placeholder="例: トモ"
          />
          <button className="danger-btn" disabled={cancelling} onClick={cancelRecord}>
            {cancelling ? '取り消しています...' : '取り消す'}
          </button>
          <button className="cancel-btn" disabled={cancelling} onClick={() => setConfirmingCancel(false)}>
            やめる
          </button>
        </Modal>
      )}

      {formOpen && !confirmingCancel && (
        <Modal title={editing ? '仕入編集' : '仕入登録'} onClose={() => setFormOpen(false)}>
          {(editing?.photo_url || photoPreview) && <img src={photoPreview || editing.photo_url} className="photo-preview" style={{ display: 'block' }} />}
          <label className="field-label">仕入先種別 *</label>
          <select className="field-input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
            {SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="field-label">仕入先名</label>
          <input className="field-input" value={form.source || ''} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="例: ○○市 / 出品者名など" />

          {/* アカウント。候補は既存データから作るので、「ゆゆ♥」を打ち直さずに選べる。
              既定は「（未設定）」。店舗仕入れやフリマには付けないため。 */}
          <label className="field-label">アカウント（どのアカウントで買ったか）</label>
          <select
            className="field-input"
            value={newAccount ? NEW_ACCOUNT : (form.channel_account || '')}
            onChange={(e) => {
              const v = e.target.value
              if (v === NEW_ACCOUNT) {
                setNewAccount(true)
                setForm({ ...form, channel_account: '' })
              } else {
                setNewAccount(false)
                setForm({ ...form, channel_account: v })
              }
            }}
          >
            <option value="">（未設定）</option>
            {knownAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
            <option value={NEW_ACCOUNT}>＋ 新しいアカウントを入力...</option>
          </select>
          {newAccount && (
            <input
              className="field-input"
              style={{ marginTop: 6 }}
              value={form.channel_account || ''}
              onChange={(e) => setForm({ ...form, channel_account: e.target.value })}
              placeholder="新しいアカウント名"
              autoFocus
            />
          )}
          <div className="item-sub">
            店舗やフリマでの仕入れは「（未設定）」のままにしてください。
          </div>

          <label className="field-label">仕入日 *</label>
          <input className="field-input" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
          <label className="field-label">合計仕入額(円) *</label>
          <input className="field-input" type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="例: 15000" />
          <label className="field-label">仕入点数 *</label>
          <input className="field-input" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="例: 5" />
          <div className="calc-box"><div className="item-sub">自動計算</div><div className="calc-result">1点あたりの平均仕入値: {fmt(avgOf(form))}</div></div>

          {/* ポイント・クーポンは記録のためだけに持つ。商品代金からは引かないので
              合計仕入額や平均仕入値には影響しない（方針）。 */}
          <label className="field-label">ポイント利用(円)</label>
          <input
            className="field-input" type="number" min="0"
            value={form.point_used ?? ''}
            onChange={(e) => setForm({ ...form, point_used: e.target.value })}
            placeholder="使っていなければ空欄 / 例: 400"
          />
          <label className="field-label">クーポン利用(円)</label>
          <input
            className="field-input" type="number" min="0"
            value={form.coupon_used ?? ''}
            onChange={(e) => setForm({ ...form, coupon_used: e.target.value })}
            placeholder="使っていなければ空欄"
          />
          <div className="item-sub">
            ポイント・クーポンは記録だけで、合計仕入額からは引きません。
          </div>

          <label className="field-label">支払方法</label>
          <input
            className="field-input"
            list="purchase-method-options"
            value={form.payment_method || ''}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            placeholder={knownMethods.length ? '入力済みの候補から選択、または新規入力' : '例: メルカード / コンビニ支払い'}
          />
          <datalist id="purchase-method-options">
            {knownMethods.map((m) => <option key={m} value={m} />)}
          </datalist>

          <label className="field-label">商品ID・取引ID</label>
          <input
            className="field-input"
            value={form.external_order_no || ''}
            onChange={(e) => setForm({ ...form, external_order_no: e.target.value })}
            placeholder="例: m12345678901"
          />

          {/* 備考は長くなる（配送方法・送料・状態・経緯などを書くため）。
              1行の入力欄だと全文が見えず、気づかないまま消してしまう恐れがあるので複数行にする。 */}
          <label className="field-label">メモ（配送方法・送料・状態なども、ここに書いてください）</label>
          <textarea
            className="field-input"
            rows={6}
            value={form.note || ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <div className="item-sub">{(form.note || '').length}文字</div>

          <label className="field-label">写真</label>
          <div className="photo-upload" onClick={() => document.getElementById('purchase-photo-input').click()}>📷 タップして写真を選択</div>
          <input id="purchase-photo-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoChange} />
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : editing ? '保存する' : '登録する'}</button>
          {/* 登録時には出さない。既にある記録を取り消すときだけ */}
          {editing && (
            <button className="delete-btn" disabled={saving} onClick={() => setConfirmingCancel(true)}>
              この記録を取り消す
            </button>
          )}
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
