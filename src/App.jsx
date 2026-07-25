import { useEffect, useState, useCallback } from 'react'
import { supabase, isConfigured } from './lib/supabase'
import Dashboard from './components/Dashboard'
import Items from './components/Items'
import Sales from './components/Sales'
import Purchases from './components/Purchases'
import Expenses from './components/Expenses'
import Customers from './components/Customers'

const TABS = [
  { key: 'dashboard', label: 'ダッシュボード', icon: '📊' },
  { key: 'items', label: '在庫', icon: '📦' },
  { key: 'sales', label: '販売', icon: '💰' },
  { key: 'purchases', label: '仕入', icon: '🛒' },
  { key: 'expenses', label: '経費', icon: '💴' },
  { key: 'customers', label: '顧客', icon: '👥' },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [items, setItems] = useState([])
  const [sales, setSales] = useState([])
  const [purchases, setPurchases] = useState([])
  const [customers, setCustomers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const [i, s, p, c, e] = await Promise.all([
        supabase.from('items').select('*').order('created_at', { ascending: false }),
        supabase.from('sales').select('*').order('sold_at', { ascending: false }),
        supabase.from('purchases').select('*').order('created_at', { ascending: false }),
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      ])
      const firstError = [i, s, p, c, e].find((r) => r.error)?.error
      if (firstError) throw firstError
      setItems(i.data || [])
      setSales(s.data || [])
      setPurchases(p.data || [])
      setCustomers(c.data || [])
      setExpenses(e.data || [])
      setLoadError(null)
    } catch (err) {
      setLoadError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isConfigured) reload()
    else setLoading(false)
  }, [reload])

  const shared = { items, sales, purchases, customers, expenses, reload }

  return (
    <>
      <div id="print-area" />
      <div className="header">
        <span className="nav-icon">📦</span>
        <span className="header-title">Mingay</span>
      </div>
      <div className="content">
        {!isConfigured ? (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>⚙️ 初期設定が必要です</div>
            <div className="item-sub">
              Supabaseの接続情報が設定されていません。<br />
              <code>.env.example</code> を <code>.env</code> にコピーし、
              <code>VITE_SUPABASE_URL</code> と <code>VITE_SUPABASE_ANON_KEY</code> を設定してください。
              テーブル作成手順は <code>supabase/schema.sql</code> と README を参照してください。
            </div>
          </div>
        ) : loading ? (
          <div className="empty">読み込み中...</div>
        ) : loadError ? (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title" style={{ marginTop: 0 }}>⚠️ データの読み込みに失敗しました</div>
            <div className="item-sub">{loadError}</div>
            <button className="add-btn" style={{ marginTop: 10 }} onClick={reload}>再読み込み</button>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard {...shared} />}
            {tab === 'items' && <Items {...shared} />}
            {tab === 'sales' && <Sales {...shared} />}
            {tab === 'purchases' && <Purchases {...shared} />}
            {tab === 'expenses' && <Expenses {...shared} />}
            {tab === 'customers' && <Customers {...shared} />}
          </>
        )}
      </div>
      <div className="nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'nav-btn' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </>
  )
}
