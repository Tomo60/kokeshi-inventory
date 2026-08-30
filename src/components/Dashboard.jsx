import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { fmt, thisMonth, downloadCsv, today, daysSince } from '../lib/format'
import { conditionLabel, AGING_DANGER_DAYS } from '../lib/constants'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

function Kpi({ label, value, color }) {
  return (
    <div className="kpi-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
    </div>
  )
}

function netProfit(sale, items) {
  if (sale.net_profit != null) return sale.net_profit
  const item = items.find((i) => i.id === sale.item_id) || {}
  return (sale.sell_price || 0) - (item.buy_price || 0)
}

function exportItemsCsv(items) {
  const rows = [
    ['管理コード', '名前', 'カテゴリ', '仕入元', '仕入値', '売値', 'ステータス', '仕入日付', '滞留日数', '保存場所', 'ロット番号', '状態', '想定販売期限', 'メモ', '登録日'],
    ...items.map((i) => [
      i.code, i.name, i.category, i.source_place, i.buy_price, i.sell_price,
      i.status === 'in_stock' ? '在庫中' : '売済み',
      i.purchase_date || '',
      i.status === 'in_stock' ? (daysSince(i.purchase_date || i.created_at) ?? '') : '',
      i.storage_location || '', i.lot_number || '', conditionLabel(i.condition), i.expected_sell_by || '',
      i.note || '', (i.created_at || '').slice(0, 10),
    ]),
  ]
  downloadCsv(`mingay-items-${today()}.csv`, rows)
}

function exportSalesCsv(sales, items, customers) {
  const rows = [
    ['管理コード', '商品名', '顧客名', '販売価格', '仕入値', '手数料率', '広告費率', '送料', '純利益', '販売日', 'メモ'],
    ...sales.map((s) => {
      const item = items.find((i) => i.id === s.item_id) || {}
      const customer = customers.find((c) => c.id === s.customer_id) || {}
      return [
        item.code || '', item.name || s.note || '不明', customer.name || '', s.sell_price,
        item.buy_price || 0, s.fee_rate || 0, s.ad_rate || 0, s.shipping_fee || 0,
        netProfit(s, items), s.sold_at || '', s.note || '',
      ]
    }),
  ]
  downloadCsv(`mingay-sales-${today()}.csv`, rows)
}

export default function Dashboard({ items, sales, purchases, expenses, customers }) {
  const inStock = items.filter((i) => i.status === 'in_stock')
  const soldItems = items.filter((i) => i.status === 'sold')
  const staleCount = inStock.filter((i) => (daysSince(i.purchase_date || i.created_at) ?? 0) >= AGING_DANGER_DAYS).length
  const totalSell = sales.reduce((s, x) => s + (x.sell_price || 0), 0)
  const totalNet = sales.reduce((s, x) => s + netProfit(x, items), 0)
  const cm = thisMonth()
  const monthExpenses = expenses.filter((e) => (e.expense_date || '').startsWith(cm))
  const totalMonthExpense = monthExpenses.reduce((s, e) => s + (e.amount || 0), 0)

  const monthly = {}
  sales.forEach((s) => {
    const m = (s.sold_at || '').slice(0, 7)
    if (!m) return
    if (!monthly[m]) monthly[m] = { revenue: 0, net: 0 }
    monthly[m].revenue += s.sell_price || 0
    monthly[m].net += netProfit(s, items)
  })
  const months = Object.keys(monthly).sort().slice(-6)
  const labels = months.map((m) => m.replace('-', '/'))

  const revenueData = {
    labels,
    datasets: [{ label: '売上', data: months.map((m) => monthly[m].revenue), backgroundColor: '#2980b9' }],
  }
  const profitData = {
    labels,
    datasets: [{
      label: '純利益',
      data: months.map((m) => monthly[m].net),
      backgroundColor: months.map((m) => (monthly[m].net >= 0 ? '#2e8b57' : '#e74c3c')),
    }],
  }
  const chartOpts = { responsive: true, plugins: { legend: { display: false } } }

  return (
    <>
      <h2 className="section-title">サマリー</h2>
      <div className="card-grid">
        <Kpi label="在庫数" value={`${inStock.length}点`} color="#2f4858" />
        <Kpi label="売済数" value={`${soldItems.length}点`} color="#2e8b57" />
        <Kpi label="売上合計" value={fmt(totalSell)} color="#2980b9" />
        <Kpi label="純利合計" value={fmt(totalNet)} color={totalNet >= 0 ? '#8e44ad' : '#e74c3c'} />
      </div>
      <div className="card-grid" style={{ marginTop: 10 }}>
        <Kpi label="今月の経費" value={fmt(totalMonthExpense)} color="#c0392b" />
        <Kpi label="仕入回数" value={`${purchases.length}回`} color="#e67e22" />
        <Kpi label={`長期滞留(${AGING_DANGER_DAYS}日+)`} value={`${staleCount}点`} color="#c0392b" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 4 }}>
        <button className="add-btn" style={{ background: '#2e8b57', flex: 1 }} onClick={() => exportItemsCsv(items)}>⬇ 在庫CSV</button>
        <button className="add-btn" style={{ background: '#2980b9', flex: 1 }} onClick={() => exportSalesCsv(sales, items, customers)}>⬇ 販売CSV</button>
      </div>

      {months.length > 0 && (
        <>
          <h2 className="section-title">月別売上・利益（直近6ヶ月）</h2>
          <div className="card"><Bar data={revenueData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: '月別売上' } } }} /></div>
          <div className="card"><Bar data={profitData} options={{ ...chartOpts, plugins: { ...chartOpts.plugins, title: { display: true, text: '月別純利益' } } }} /></div>
        </>
      )}

      <h2 className="section-title">最近登録した商品</h2>
      {items.length === 0 && <div className="empty">商品を登録してください</div>}
      {items.slice(0, 5).map((i) => (
        <div className="card" key={i.id} style={{ padding: '10px 12px' }}>
          <div className="row-between">
            <span className={'status-badge ' + (i.status === 'sold' ? 'status-sold' : 'status-in')}>
              {i.status === 'sold' ? '売済み' : '在庫中'}
            </span>
            {i.code && <span className="code-badge">{i.code}</span>}
          </div>
          <div className="item-name" style={{ marginTop: 4 }}>{i.name}</div>
          <div className="price-row">
            {i.sell_price ? <span className="price-tag">売値 {fmt(i.sell_price)}</span> : null}
            {i.buy_price ? <span className="price-tag">仕入 {fmt(i.buy_price)}</span> : null}
          </div>
        </div>
      ))}
    </>
  )
}
