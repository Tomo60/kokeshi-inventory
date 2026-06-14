import { useState, useEffect } from "react";

const SUPABASE_URL = "https://yjhhrqujmemlzghvvomx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_utdf4r58eY6WQKMQbZ-2UA_rwUAQe2v";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { data, ok: res.ok, status: res.status };
}

const DEMO_ITEMS = [
  { id: 1, name: "津軽こけし", origin: "青森", type: "伝統工芸", buy_price: 3200, sell_price: 5800, stock: 4, alert_threshold: 2 },
  { id: 2, name: "鳴子こけし", origin: "宮城", type: "伝統工芸", buy_price: 2800, sell_price: 4500, stock: 1, alert_threshold: 2 },
  { id: 3, name: "土湯こけし", origin: "福島", type: "伝統工芸", buy_price: 1900, sell_price: 3200, stock: 8, alert_threshold: 3 },
];
const DEMO_TRANSACTIONS = [
  { id: 1, item_id: 1, type: "purchase", quantity: 5, unit_price: 3200, date: "2025-05-01", note: "春の仕入れ" },
  { id: 2, item_id: 1, type: "sale", quantity: 1, unit_price: 5800, date: "2025-05-10", note: "" },
  { id: 3, item_id: 2, type: "purchase", quantity: 3, unit_price: 2800, date: "2025-05-15", note: "" },
  { id: 4, item_id: 2, type: "sale", quantity: 2, unit_price: 4500, date: "2025-05-20", note: "" },
];

const fmt = (n) => `¥${Number(n).toLocaleString()}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function KokeshiInventory() {
  const [tab, setTab] = useState("dashboard");
  const [items, setItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [useDemo, setUseDemo] = useState(false);
  const [modal, setModal] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [ri, rt] = await Promise.all([
        sbFetch("items?select=*&order=id"),
        sbFetch("transactions?select=*&order=id"),
      ]);
      if (!ri.ok || !rt.ok) {
        const errMsg = JSON.stringify(ri.ok ? rt.data : ri.data);
        setError(`Supabase接続エラー: ${errMsg}`);
        setUseDemo(true);
        setItems(DEMO_ITEMS);
        setTransactions(DEMO_TRANSACTIONS);
      } else {
        setItems(Array.isArray(ri.data) ? ri.data : []);
        setTransactions(Array.isArray(rt.data) ? rt.data : []);
        setUseDemo(false);
      }
    } catch (e) {
      setError(`接続エラー: ${e.message}`);
      setUseDemo(true);
      setItems(DEMO_ITEMS);
      setTransactions(DEMO_TRANSACTIONS);
    }
    setLoading(false);
  }

  const alertItems = items.filter((i) => i.stock <= i.alert_threshold);
  const totalRevenue = transactions.filter((t) => t.type === "sale").reduce((s, t) => s + t.unit_price * t.quantity, 0);
  const totalCost = transactions.filter((t) => t.type === "purchase").reduce((s, t) => s + t.unit_price * t.quantity, 0);
  const totalProfit = totalRevenue - totalCost;

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <span style={styles.headerEmoji}>🪆</span>
        <span style={styles.headerTitle}>こけし在庫帳</span>
        {useDemo && <span style={styles.demoBadge}>デモ</span>}
      </div>

      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
        </div>
      )}

      {alertItems.length > 0 && !error && (
        <div style={styles.alertBanner}>
          ⚠️ 在庫わずか: {alertItems.map((i) => i.name).join("・")}
        </div>
      )}

      <div style={styles.content}>
        {loading ? (
          <div style={styles.center}>読み込み中…</div>
        ) : (
          <>
            {tab === "dashboard" && <Dashboard items={items} totalRevenue={totalRevenue} totalCost={totalCost} totalProfit={totalProfit} alertItems={alertItems} />}
            {tab === "items" && <ItemList items={items} setModal={setModal} />}
            {tab === "transactions" && <TransactionList transactions={transactions} items={items} setModal={setModal} />}
          </>
        )}
      </div>

      <div style={styles.nav}>
        {[
          { key: "dashboard", label: "ダッシュボード", icon: "📊" },
          { key: "items", label: "在庫", icon: "🪆" },
          { key: "transactions", label: "仕入・販売", icon: "📝" },
        ].map(({ key, label, icon }) => (
          <button key={key} style={{ ...styles.navBtn, ...(tab === key ? styles.navBtnActive : {}) }} onClick={() => setTab(key)}>
            <span style={styles.navIcon}>{icon}</span>
            <span style={styles.navLabel}>{label}</span>
          </button>
        ))}
      </div>

      {modal?.type === "addItem" && <ItemModal onClose={() => setModal(null)} onSave={loadData} useDemo={useDemo} items={items} setItems={setItems} />}
      {modal?.type === "editItem" && <ItemModal item={modal.data} onClose={() => setModal(null)} onSave={loadData} useDemo={useDemo} items={items} setItems={setItems} />}
      {modal?.type === "addTx" && <TxModal items={items} onClose={() => setModal(null)} onSave={loadData} useDemo={useDemo} transactions={transactions} setTransactions={setTransactions} setItems={setItems} />}
    </div>
  );
}

function Dashboard({ items, totalRevenue, totalCost, totalProfit, alertItems }) {
  return (
    <div>
      <h2 style={styles.sectionTitle}>サマリー</h2>
      <div style={styles.cardGrid}>
        <KpiCard label="総在庫数" value={`${items.reduce((s, i) => s + i.stock, 0)} 点`} color="#c0392b" />
        <KpiCard label="売上合計" value={fmt(totalRevenue)} color="#27ae60" />
        <KpiCard label="仕入合計" value={fmt(totalCost)} color="#2980b9" />
        <KpiCard label="利益合計" value={fmt(totalProfit)} color={totalProfit >= 0 ? "#8e44ad" : "#e74c3c"} />
      </div>
      {alertItems.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>⚠️ 在庫アラート</h2>
          {alertItems.map((i) => (
            <div key={i.id} style={styles.alertCard}>
              <span>{i.name}（{i.origin}）</span>
              <span style={{ color: "#c0392b", fontWeight: 700 }}>残り {i.stock} 点</span>
            </div>
          ))}
        </>
      )}
      <h2 style={styles.sectionTitle}>種類別在庫</h2>
      {items.map((i) => (
        <div key={i.id} style={styles.itemRow}>
          <div>
            <div style={styles.itemName}>{i.name}</div>
            <div style={styles.itemSub}>{i.origin} / 売値 {fmt(i.sell_price)}</div>
          </div>
          <div style={{ ...styles.stockBadge, background: i.stock <= i.alert_threshold ? "#fdecea" : "#eafaf1", color: i.stock <= i.alert_threshold ? "#c0392b" : "#1e8449" }}>
            {i.stock} 点
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ ...styles.kpiCard, borderTop: `3px solid ${color}` }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color }}>{value}</div>
    </div>
  );
}

function ItemList({ items, setModal }) {
  return (
    <div>
      <div style={styles.rowBetween}>
        <h2 style={styles.sectionTitle}>在庫一覧</h2>
        <button style={styles.addBtn} onClick={() => setModal({ type: "addItem" })}>＋ 追加</button>
      </div>
      {items.map((item) => (
        <div key={item.id} style={styles.card}>
          <div style={styles.rowBetween}>
            <div>
              <div style={styles.itemName}>{item.name}</div>
              <div style={styles.itemSub}>{item.origin} ／ {item.type}</div>
            </div>
            <button style={styles.editBtn} onClick={() => setModal({ type: "editItem", data: item })}>編集</button>
          </div>
          <div style={styles.priceRow}>
            <span style={styles.priceTag}>仕入 {fmt(item.buy_price)}</span>
            <span style={styles.priceTag}>売値 {fmt(item.sell_price)}</span>
            <span style={{ ...styles.priceTag, color: "#27ae60" }}>利益 {fmt(item.sell_price - item.buy_price)}</span>
          </div>
          <div style={styles.itemSub}>在庫: <b>{item.stock} 点</b>　アラート: {item.alert_threshold} 点以下</div>
        </div>
      ))}
      {items.length === 0 && <div style={styles.empty}>こけしを追加してください</div>}
    </div>
  );
}

function TransactionList({ transactions, items, setModal }) {
  const getName = (id) => items.find((i) => i.id === id)?.name || "不明";
  const sorted = [...transactions].sort((a, b) => b.date?.localeCompare(a.date));
  return (
    <div>
      <div style={styles.rowBetween}>
        <h2 style={styles.sectionTitle}>仕入・販売記録</h2>
        <button style={styles.addBtn} onClick={() => setModal({ type: "addTx" })}>＋ 記録</button>
      </div>
      {sorted.map((tx) => (
        <div key={tx.id} style={styles.card}>
          <div style={styles.rowBetween}>
            <span style={{ ...styles.txBadge, background: tx.type === "sale" ? "#eafaf1" : "#eaf0fb", color: tx.type === "sale" ? "#1e8449" : "#2980b9" }}>
              {tx.type === "sale" ? "販売" : "仕入"}
            </span>
            <span style={styles.itemSub}>{tx.date}</span>
          </div>
          <div style={styles.itemName}>{getName(tx.item_id)}</div>
          <div style={styles.priceRow}>
            <span style={styles.priceTag}>{tx.quantity} 点</span>
            <span style={styles.priceTag}>{fmt(tx.unit_price)} / 点</span>
            <span style={{ ...styles.priceTag, fontWeight: 700 }}>合計 {fmt(tx.unit_price * tx.quantity)}</span>
          </div>
          {tx.note && <div style={styles.itemSub}>📝 {tx.note}</div>}
        </div>
      ))}
      {transactions.length === 0 && <div style={styles.empty}>記録がまだありません</div>}
    </div>
  );
}

function ItemModal({ item, onClose, onSave, useDemo, items, setItems }) {
  const [form, setForm] = useState({
    name: item?.name || "", origin: item?.origin || "", type: item?.type || "伝統工芸",
    buy_price: item?.buy_price || "", sell_price: item?.sell_price || "",
    stock: item?.stock ?? 0, alert_threshold: item?.alert_threshold ?? 2,
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    if (!form.name || !form.buy_price || !form.sell_price) return alert("必須項目を入力してください");
    setSaving(true);
    const row = { ...form, buy_price: +form.buy_price, sell_price: +form.sell_price, stock: +form.stock, alert_threshold: +form.alert_threshold };
    if (useDemo) {
      if (item) setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, ...row } : i));
      else setItems((prev) => [...prev, { ...row, id: Date.now() }]);
    } else {
      if (item) {
        await sbFetch(`items?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify(row) });
      } else {
        await sbFetch("items", { method: "POST", body: JSON.stringify(row) });
      }
      await onSave();
    }
    setSaving(false);
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={styles.modalTitle}>{item ? "こけし編集" : "こけし追加"}</h3>
      <Field label="名前 *" value={form.name} onChange={set("name")} placeholder="例: 津軽こけし" />
      <Field label="産地 *" value={form.origin} onChange={set("origin")} placeholder="例: 青森" />
      <Field label="種類" value={form.type} onChange={set("type")} placeholder="例: 伝統工芸" />
      <Field label="仕入値 (円) *" value={form.buy_price} onChange={set("buy_price")} type="number" placeholder="例: 3000" />
      <Field label="売値 (円) *" value={form.sell_price} onChange={set("sell_price")} type="number" placeholder="例: 5000" />
      <Field label="現在庫数" value={form.stock} onChange={set("stock")} type="number" />
      <Field label="アラート閾値 (点以下)" value={form.alert_threshold} onChange={set("alert_threshold")} type="number" />
      <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
    </Overlay>
  );
}

function TxModal({ items, onClose, onSave, useDemo, transactions, setTransactions, setItems }) {
  const [form, setForm] = useState({ item_id: items[0]?.id || "", type: "purchase", quantity: 1, unit_price: "", date: today(), note: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const found = items.find((i) => i.id === +form.item_id);
    if (found) setForm((f) => ({ ...f, unit_price: f.type === "sale" ? found.sell_price : found.buy_price }));
  }, [form.item_id, form.type]);

  async function handleSave() {
    if (!form.item_id || !form.unit_price || !form.quantity) return alert("必須項目を入力してください");
    setSaving(true);
    const row = { ...form, item_id: +form.item_id, quantity: +form.quantity, unit_price: +form.unit_price };
    if (useDemo) {
      setTransactions((prev) => [...prev, { ...row, id: Date.now() }]);
      setItems((prev) => prev.map((i) => i.id === row.item_id ? { ...i, stock: i.stock + (row.type === "purchase" ? +row.quantity : -row.quantity) } : i));
    } else {
      await sbFetch("transactions", { method: "POST", body: JSON.stringify(row) });
      const item = items.find((i) => i.id === row.item_id);
      if (item) {
        const newStock = item.stock + (row.type === "purchase" ? +row.quantity : -row.quantity);
        await sbFetch(`items?id=eq.${item.id}`, { method: "PATCH", body: JSON.stringify({ stock: newStock }) });
      }
      await onSave();
    }
    setSaving(false);
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={styles.modalTitle}>仕入・販売記録</h3>
      <label style={styles.label}>こけし</label>
      <select style={styles.input} value={form.item_id} onChange={set("item_id")}>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}（{i.origin}）</option>)}
      </select>
      <label style={styles.label}>種別</label>
      <select style={styles.input} value={form.type} onChange={set("type")}>
        <option value="purchase">仕入</option>
        <option value="sale">販売</option>
      </select>
      <Field label="数量" value={form.quantity} onChange={set("quantity")} type="number" />
      <Field label="単価 (円)" value={form.unit_price} onChange={set("unit_price")} type="number" />
      <Field label="日付" value={form.date} onChange={set("date")} type="date" />
      <Field label="メモ" value={form.note} onChange={set("note")} placeholder="任意" />
      <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>{saving ? "保存中…" : "記録"}</button>
    </Overlay>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <>
      <label style={styles.label}>{label}</label>
      <input style={styles.input} type={type} value={value} onChange={onChange} placeholder={placeholder} />
    </>
  );
}

const styles = {
  app: { fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif", background: "#fdf6f0", minHeight: "100vh", paddingBottom: 70, maxWidth: 430, margin: "0 auto", position: "relative" },
  header: { background: "#6b2737", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 0, zIndex: 10 },
  headerEmoji: { fontSize: 22 },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: 2 },
  demoBadge: { marginLeft: "auto", fontSize: 11, background: "#fff3", padding: "2px 8px", borderRadius: 10, color: "#ffe" },
  errorBanner: { background: "#fdecea", color: "#c0392b", fontSize: 12, padding: "8px 14px", borderBottom: "1px solid #f1948a", wordBreak: "break-all" },
  alertBanner: { background: "#fff3cd", color: "#856404", fontSize: 13, padding: "8px 14px", borderBottom: "1px solid #ffc107" },
  content: { padding: "12px 14px" },
  center: { textAlign: "center", padding: 40, color: "#888" },
  nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", display: "flex", borderTop: "1px solid #e0d6ce", zIndex: 20 },
  navBtn: { flex: 1, border: "none", background: "none", padding: "8px 0", cursor: "pointer", color: "#999", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  navBtnActive: { color: "#6b2737" },
  navIcon: { fontSize: 20 },
  navLabel: { fontSize: 10 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#4a1a24", marginBottom: 10, marginTop: 14 },
  cardGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 },
  kpiCard: { background: "#fff", borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 4px #0001" },
  kpiLabel: { fontSize: 11, color: "#888", marginBottom: 4 },
  kpiValue: { fontSize: 18, fontWeight: 700 },
  alertCard: { background: "#fdecea", borderRadius: 8, padding: "10px 14px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" },
  card: { background: "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 10, boxShadow: "0 1px 4px #0001" },
  itemRow: { background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px #0001" },
  itemName: { fontSize: 15, fontWeight: 700, color: "#2c1010", marginBottom: 2 },
  itemSub: { fontSize: 12, color: "#888" },
  stockBadge: { borderRadius: 8, padding: "4px 12px", fontSize: 14, fontWeight: 700 },
  priceRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, marginBottom: 4 },
  priceTag: { fontSize: 12, color: "#555", background: "#f5f0eb", padding: "2px 8px", borderRadius: 6 },
  txBadge: { fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 12 },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  addBtn: { background: "#6b2737", color: "#fff", border: "none", borderRadius: 8, padding: "6px 16px", fontSize: 13, cursor: "pointer" },
  editBtn: { background: "#f0e6e8", color: "#6b2737", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" },
  empty: { textAlign: "center", color: "#aaa", padding: 30, fontSize: 13 },
  overlay: { position: "fixed", inset: 0, background: "#0006", zIndex: 50, display: "flex", alignItems: "flex-end" },
  modalBox: { background: "#fff", width: "100%", maxWidth: 430, margin: "0 auto", borderRadius: "16px 16px 0 0", padding: "20px 18px 32px", maxHeight: "85vh", overflowY: "auto" },
  modalTitle: { fontSize: 16, fontWeight: 700, color: "#4a1a24", marginBottom: 14, marginTop: 0 },
  closeBtn: { float: "right", background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#888" },
  label: { display: "block", fontSize: 12, color: "#666", marginBottom: 3, marginTop: 10 },
  input: { width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", fontSize: 14, boxSizing: "border-box", background: "#fafafa" },
  saveBtn: { marginTop: 18, width: "100%", background: "#6b2737", color: "#fff", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 15, fontWeight: 700, cursor: "pointer" },
};
