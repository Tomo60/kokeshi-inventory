import { useState } from 'react'
import { supabase } from '../lib/supabase'

// ログイン画面。
//
// 方針:
// ・メールアドレス＋パスワードのみ。マジックリンク（メール内のURLで入る方式）は使わない。
// ・この画面に「新規登録」は置かない。利用者はオーナー様1名だけで、
//   アカウントは Supabase のダッシュボードから作る運用にしているため。
//   ※画面に新規登録を置くと、誰でも自分のアカウントを作れてしまう。そうなると
//     RLSのポリシー（authenticated なら読み書き可）を素通りされ、保護の意味がなくなる。
//     同じ理由で、Supabase側の「Enable sign ups」も無効にしておく必要がある（READMEに手順）。
// ・パスワードを忘れた場合もダッシュボードから再設定する運用。画面には再設定を置かない。

// Supabase が返す英語のエラーを、画面に出す日本語にする。
// 想定外のものはそのまま出す（原因が分からなくなるより、英語でも出たほうがよい）。
function messageOf(error) {
  const raw = error?.message || ''
  if (/Invalid login credentials/i.test(raw)) {
    return 'メールアドレスまたはパスワードが違います。'
  }
  if (/Email not confirmed/i.test(raw)) {
    return 'このメールアドレスはまだ確認が済んでいません。Supabaseのダッシュボードでユーザーを作り直すか、確認を済ませてください。'
  }
  if (/Failed to fetch|NetworkError|network/i.test(raw)) {
    return 'サーバーに接続できませんでした。通信状況を確かめて、もう一度お試しください。'
  }
  if (/rate limit|too many/i.test(raw)) {
    return '試行回数が多すぎます。しばらく待ってからもう一度お試しください。'
  }
  return raw || 'ログインできませんでした。'
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const mail = email.trim()
    if (!mail || !password) {
      setError('メールアドレスとパスワードを入力してください。')
      return
    }
    setBusy(true)
    setError(null)
    // 成功した場合は onAuthStateChange（App.jsx）が受け取って画面が切り替わるので、
    // ここでは何もしない。busy を false に戻すのも失敗したときだけでよい。
    const { error: err } = await supabase.auth.signInWithPassword({ email: mail, password })
    if (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <div className="card login-card">
      <div className="section-title" style={{ marginTop: 0 }}>🔒 ログイン</div>
      <div className="item-sub" style={{ marginBottom: 4 }}>
        Mingay の帳簿を開くには、ログインが必要です。
      </div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="login-email">メールアドレス</label>
        <input
          id="login-email"
          className="field-input"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <label className="field-label" htmlFor="login-password">パスワード</label>
        <input
          id="login-password"
          className="field-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        {error ? <div className="login-error">{error}</div> : null}
        <button className="add-btn login-submit" type="submit" disabled={busy}>
          {busy ? 'ログインしています...' : 'ログイン'}
        </button>
      </form>
      <div className="item-sub login-note">
        パスワードが分からなくなった場合は、Supabaseのダッシュボードから再設定してください。
      </div>
    </div>
  )
}
