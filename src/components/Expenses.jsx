import { useState } from 'react'
import { supabase, uploadPhoto } from '../lib/supabase'
import { saveWithRetry } from '../lib/retry'
import { fmt, today } from '../lib/format'
import { isCancelled, cancelLabel, cancelRow, restoreRow } from '../lib/cancel'
import Modal from './Modal'
import RecurringExpenses from './RecurringExpenses'

// 分類ルール: 梱包材料（段ボール・緩衝材など）の購入費用は purchases（仕入）には計上せず、
// ここの 'materials'（梱包材料費）として expenses にのみ記録する。
// purchases は「販売する商品そのものの仕入」専用。両方に入れると二重計上になるので注意。
export const CATS = [
  { value: 'rent', label: '家賃', icon: '🏠' },
  // 入居時に一回限りかかる費用（ハウスクリーニング・鍵交換・仲介手数料など）。
  // 毎月発生する 'rent'（家賃）とは分けて集計したいので別カテゴリにしている。
  { value: 'move_in', label: '入居費用', icon: '🔑' },
  // 水道代・ガス代・電気代など。家賃と同じ物件にかかる費用だが、
  // 毎月額が変わるので 'rent'（定額の家賃）とは分けて集計する。
  { value: 'utilities', label: '水道光熱費', icon: '💡' },
  { value: 'materials', label: '梱包材料費', icon: '📦' },
  { value: 'shipping', label: '送料', icon: '🚚' },
  // 'platform_fee' は経費（手数料）カテゴリの内部値。
  // sales テーブルの platform 列（メルカリ等の販売チャネル区分）とは無関係な別物。
  { value: 'platform_fee', label: '手数料', icon: '💳' },
  { value: 'equipment', label: '備品', icon: '🛠️' },
  { value: 'other', label: 'その他', icon: '📝' },
]

// 旧内部値 → 新内部値の互換マップ。
// コードのデプロイとデータマイグレーション(schema.sql の update 文)は同時に反映できないため、
// 旧値のまま残っている行も正しいカテゴリとして表示・集計できるようにしている。
// 本番DBで update を適用し、旧値の行が 0 件になったことを確認できたら、このマップは削除してよい。
const LEGACY_CATEGORY_ALIASES = { platform: 'platform_fee' }
export const normalizeCategory = (v) => LEGACY_CATEGORY_ALIASES[v] || v

function getCat(v) {
  const key = normalizeCategory(v)
  return CATS.find((c) => c.value === key) || { label: key || 'その他', icon: '📝' }
}

const emptyForm = { category: 'rent', amount: '', expense_date: today(), payee: '', payment_method: '', note: '', is_recurring: false }

// expenses は有効な行だけ（App.jsx で取り消し済みを除いて渡している）。
// allExpenses は取り消し済みも含む全行で、「取消済みも表示」のときだけ使う。
export default function Expenses({ expenses, allExpenses, recurring, recurringError, reload }) {
  const [view, setView] = useState('records')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  // 取り消しの確認画面を出しているか。記録は残るが、集計から外れる操作なので必ずここを通す
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBy, setCancelBy] = useState('')
  // 取り消し済みの行も一覧に出すか
  const [showCancelled, setShowCancelled] = useState(false)
  const [restoringId, setRestoringId] = useState(null)

  function closeForm() { setFormOpen(false); setConfirmingCancel(false) }
  function openAdd() { setEditing(null); setForm(emptyForm); setPhotoFile(null); setPhotoPreview(null); setConfirmingCancel(false); setFormOpen(true) }
  function openEdit(e) { setEditing(e); setForm({ ...emptyForm, ...e }); setPhotoFile(null); setPhotoPreview(null); setConfirmingCancel(false); setFormOpen(true) }

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
    // 一時的な通信失敗は saveWithRetry が自動で再試行する。
    // それでも失敗したときは、以前のように無言でフォームを閉じるのではなく、
    // 入力内容を残したまま理由を表示する（「入力できない」状態に見せない）。
    const { ok } = await saveWithRetry(
      () => (editing
        ? supabase.from('expenses').update(row).eq('id', editing.id)
        : supabase.from('expenses').insert(row)),
      '経費の保存',
    )
    setSaving(false)
    if (!ok) return
    closeForm()
    await reload()
  }

  // 行は消さずに取り消しフラグを立てる（論理削除）。確認画面を経たうえでのみ呼ばれる。
  // 失敗時は保存と同じように理由を画面に出し、確認画面は閉じずに残す。
  async function cancelRecord() {
    if (!editing) return
    if (!cancelReason.trim()) return alert('取り消す理由を入力してください')
    setCancelling(true)
    const { ok } = await cancelRow('expenses', editing.id, cancelReason.trim(), cancelBy.trim(), '経費の取り消し')
    setCancelling(false)
    if (!ok) return
    setCancelReason('')
    setCancelBy('')
    closeForm()
    await reload()
  }

  // 取り消しを取り消す（元に戻す）。deleted_at を NULL に戻すだけ。
  async function restore(e) {
    setRestoringId(e.id)
    const { ok } = await restoreRow('expenses', e.id, '経費の取り消しを元に戻す')
    setRestoringId(null)
    if (!ok) return
    await reload()
  }

  const cancelledCount = (allExpenses || []).filter(isCancelled).length
  // 一覧に出す行。合計は常に有効な行だけで計算する。
  const visible = showCancelled ? (allExpenses || expenses) : expenses

  const months = {}
  visible.forEach((e) => {
    const m = (e.expense_date || '').slice(0, 7) || '不明'
    if (!months[m]) months[m] = []
    months[m].push(e)
  })
  const monthKeys = Object.keys(months).sort().reverse()

  return (
    <>
      <div className="filter-row">
        <button className={'filter-btn' + (view === 'records' ? ' active' : '')} onClick={() => setView('records')}>経費記録</button>
        <button className={'filter-btn' + (view === 'recurring' ? ' active' : '')} onClick={() => setView('recurring')}>
          定期経費({recurringError ? '!' : recurring.filter((r) => r.active).length})
        </button>
      </div>

      {view === 'recurring' ? (
        <RecurringExpenses recurring={recurring} recurringError={recurringError} categories={CATS} reload={reload} />
      ) : (
      <>
      <div className="row-between">
        <h2 className="section-title">経費記録</h2>
        <button className="add-btn" onClick={openAdd}>+ 追加</button>
      </div>
      <div className="card">
        {CATS.map((cat) => {
          const total = expenses.filter((e) => normalizeCategory(e.category) === cat.value).reduce((s, e) => s + (e.amount || 0), 0)
          if (!total) return null
          return (
            <div key={cat.value} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>{cat.icon}</span><span style={{ fontSize: 13 }}>{cat.label}</span></div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#2f4858' }}>{fmt(total)}</span>
            </div>
          )
        })}
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

      {expenses.length === 0 && !showCancelled && <div className="empty">経費を登録してください</div>}
      {monthKeys.map((m) => {
        // 合計は有効な行だけ。取り消した分は金額に入れない。
        const total = months[m].filter((e) => !isCancelled(e)).reduce((s, e) => s + (e.amount || 0), 0)
        return (
          <div key={m}>
            <div className="month-header">{m.replace('-', '年')}月　合計 {fmt(total)}</div>
            {months[m].map((e) => {
              const cat = getCat(e.category)
              const off = isCancelled(e)
              return (
                <div className={'card' + (off ? ' cancelled-card' : '')} key={e.id}>
                  <div className="row-between">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18 }}>{cat.icon}</span>
                      <span className="category-badge">{cat.label}</span>
                      {e.is_recurring && <span className="recurring-badge">毎月</span>}
                      {e.recurring_expense_id && <span className="auto-badge">自動計上</span>}
                      {off && <span className="cancelled-badge">取消済み</span>}
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
                  {off && (
                    <div className="item-sub" style={{ marginTop: 6 }}>
                      🚫 {cancelLabel(e)}<br />
                      理由: {e.deleted_reason || '（記録なし）'}<br />
                      この行は合計に入っていません。
                    </div>
                  )}
                  <div className="row-between" style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: off ? '#999' : '#2f4858', textDecoration: off ? 'line-through' : 'none' }}>{fmt(e.amount)}</div>
                    {off ? (
                      <button className="edit-btn" disabled={restoringId === e.id} onClick={() => restore(e)}>
                        {restoringId === e.id ? '戻しています...' : '元に戻す'}
                      </button>
                    ) : (
                      <button className="edit-btn" onClick={() => openEdit(e)}>編集</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {/* 取り消しの確認画面。記録自体は残るが、集計から外れるので内容を見せてから実行する */}
      {formOpen && confirmingCancel && editing && (
        <Modal title="この経費記録を取り消しますか？" onClose={() => setConfirmingCancel(false)}>
          <div className="calc-box" style={{ marginTop: 0 }}>
            <div className="item-sub">日付: <b>{editing.expense_date}</b></div>
            <div className="item-sub">費目: <b>{getCat(editing.category).icon} {getCat(editing.category).label}</b></div>
            <div className="item-sub">メモ: <b>{editing.note || '（なし）'}</b></div>
            <div className="calc-result" style={{ marginTop: 6 }}>{fmt(editing.amount)}</div>
          </div>
          <div className="item-sub" style={{ marginTop: 12 }}>
            取り消すと、この記録は<b>合計から外れます</b>。記録そのものは消えずに残り、
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
          {editing.recurring_expense_id && (
            <div className="item-sub" style={{ marginTop: 10 }}>
              この記録は定期経費テンプレートから<b>自動計上</b>されたものです。取り消しても、
              テンプレート側の計上済みの月の記録は変わらないため、<b>同じ月が自動で計上し直されることはありません</b>。
              この月の分を改めて残したい場合は、手入力で登録してください。
            </div>
          )}
          <button className="danger-btn" disabled={cancelling} onClick={cancelRecord}>
            {cancelling ? '取り消しています...' : '取り消す'}
          </button>
          <button className="cancel-btn" disabled={cancelling} onClick={() => setConfirmingCancel(false)}>
            やめる
          </button>
        </Modal>
      )}

      {formOpen && !confirmingCancel && (
        <Modal title={editing ? '経費編集' : '経費登録'} onClose={closeForm}>
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
          {/* 登録時には出さない。既にある記録を取り消すときだけ */}
          {editing && (
            <button className="delete-btn" disabled={saving} onClick={() => setConfirmingCancel(true)}>
              この記録を取り消す
            </button>
          )}
        </Modal>
      )}
      </>
      )}
    </>
  )
}
