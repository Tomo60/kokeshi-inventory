import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveWithRetry } from '../lib/retry'
import Modal from './Modal'

// 事業情報（古物商許可の記録）の設定画面。
//
// 設計の前提:
// ・business_info は1行しか存在しない（DB側で id = 1 に制約をかけている）。
//   そのため新規作成と編集を分けず、常に id=1 への upsert で保存する。
// ・氏名・生年月日・住所などの個人情報は、この画面でも意図的に扱わない。
//   Supabaseの公開鍵はブラウザに配信される構成のため、許可証の記載事項のうち
//   番号・交付日・公安委員会・行商の有無だけを持つ。
const emptyForm = {
  license_no: '',
  license_issued_on: '',
  public_safety_commission: '',
  peddling: 'false',
  note: '',
}

export default function Settings({ businessInfo, businessInfoError, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  function openEdit() {
    setForm({
      ...emptyForm,
      ...(businessInfo || {}),
      license_no: businessInfo?.license_no || '',
      license_issued_on: businessInfo?.license_issued_on || '',
      public_safety_commission: businessInfo?.public_safety_commission || '',
      // DBは boolean、select の値は文字列なので変換して持つ
      peddling: businessInfo?.peddling ? 'true' : 'false',
      note: businessInfo?.note || '',
    })
    setFormOpen(true)
  }

  async function save() {
    setSaving(true)
    const row = {
      id: 1, // 1行だけのテーブル。常に同じ行を上書きする
      license_no: form.license_no || null,
      license_issued_on: form.license_issued_on || null,
      public_safety_commission: form.public_safety_commission || null,
      peddling: form.peddling === 'true',
      note: form.note || null,
      updated_at: new Date().toISOString(),
    }
    const { ok } = await saveWithRetry(
      () => supabase.from('business_info').upsert(row),
      '事業情報の保存',
    )
    setSaving(false)
    // 失敗したらフォームは閉じない（入力内容を残す）
    if (!ok) return
    setFormOpen(false)
    await reload()
  }

  // テーブル未作成でもアプリ全体は動かす方針のため、この画面だけで理由を説明する。
  // （recurring_expenses で「常に0件」に気づけなかった件の再発防止）
  if (businessInfoError) {
    return (
      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>⚠️ 事業情報テーブルがまだ使えません</div>
        <div className="item-sub">
          {businessInfoError}<br /><br />
          この機能は <code>business_info</code> テーブルを使います。まだ作成されていない場合は、
          <code>supabase/schema.sql</code> を Supabase の SQL Editor で実行してください。<br />
          テーブルを Table Editor から手で作ると Row Level Security が既定で有効になり、
          ポリシーが無いままだと常に0件・保存できない状態になります。必ず SQL Editor から実行してください。
        </div>
      </div>
    )
  }

  const info = businessInfo

  return (
    <>
      <h2 className="section-title">古物商許可</h2>
      {!info || !info.license_no ? (
        <div className="card">
          <div className="empty" style={{ padding: '10px 0' }}>許可証の情報が登録されていません</div>
          <button className="add-btn" onClick={openEdit}>+ 許可証の情報を登録</button>
        </div>
      ) : (
        <div className="card">
          <div className="item-sub">許可証番号</div>
          <div className="item-name" style={{ marginBottom: 8 }}>{info.license_no}</div>
          <div className="item-sub">交付年月日</div>
          <div className="item-name" style={{ marginBottom: 8 }}>{info.license_issued_on || '未登録'}</div>
          <div className="item-sub">公安委員会</div>
          <div className="item-name" style={{ marginBottom: 8 }}>{info.public_safety_commission || '未登録'}</div>
          <div className="price-row">
            <span className="price-tag" style={{ fontWeight: 700, color: '#2f4858' }}>
              行商: {info.peddling ? 'する' : 'しない'}
            </span>
          </div>
          {info.note && <div className="item-sub">📝 {info.note}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="edit-btn" onClick={openEdit}>編集</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>この画面で扱わない情報</div>
        <div className="item-sub">
          氏名・生年月日・住所は保存しません。許可証そのものの記録に必要なのは
          番号・交付年月日・公安委員会・行商の有無であり、必要以上の個人情報を持たない方針です。<br /><br />
          なお現在の構成では、データベースの行単位のアクセス制御（RLS）は全テーブルで無効にしており、
          Supabaseの公開鍵はブラウザに配信されます。個人で使う前提の設定です。
          利用者が増える場合は、権限管理の設計が別途必要になります。
        </div>
      </div>

      {formOpen && (
        <Modal title="古物商許可の情報" onClose={() => setFormOpen(false)}>
          <label className="field-label">許可証番号</label>
          <input className="field-input" value={form.license_no} onChange={(e) => setForm({ ...form, license_no: e.target.value })} placeholder="例: 第000000000000号" />
          <label className="field-label">交付年月日</label>
          <input className="field-input" type="date" value={form.license_issued_on} onChange={(e) => setForm({ ...form, license_issued_on: e.target.value })} />
          <label className="field-label">公安委員会</label>
          <input className="field-input" value={form.public_safety_commission} onChange={(e) => setForm({ ...form, public_safety_commission: e.target.value })} placeholder="例: ○○県公安委員会" />
          <label className="field-label">行商</label>
          <select className="field-input" value={form.peddling} onChange={(e) => setForm({ ...form, peddling: e.target.value })}>
            <option value="false">しない</option>
            <option value="true">する</option>
          </select>
          <label className="field-label">メモ</label>
          <input className="field-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="item-sub" style={{ marginTop: 10 }}>
            氏名・生年月日・住所は入力しないでください（保存する項目がありません）。
          </div>
          <button className="save-btn" disabled={saving} onClick={save}>{saving ? '保存中...' : '保存する'}</button>
        </Modal>
      )}
    </>
  )
}
