// 商品の状態/コンディション。フリマ等で一般的な区分に準拠。
export const CONDITIONS = [
  { value: 'new', label: '新品' },
  { value: 'like_new', label: '未使用に近い' },
  { value: 'good', label: '目立った傷や汚れなし' },
  { value: 'fair', label: 'やや傷や汚れあり' },
  { value: 'poor', label: '傷や汚れあり' },
  { value: 'junk', label: '全体的に状態が悪い' },
]

export const conditionLabel = (value) => (CONDITIONS.find((c) => c.value === value) || {}).label || value || ''

// 売上の販路。sales.platform の内部値。
// （経費カテゴリの 'platform_fee'（手数料）とは無関係な別物）
export const PLATFORMS = [
  { value: 'mercari', label: 'メルカリ', icon: '🛍️' },
  { value: 'mercari_shops', label: 'メルカリShops', icon: '🏪' },
  { value: 'base', label: 'BASE', icon: '🧺' },
  { value: 'yahoo_auction', label: 'ヤフオク', icon: '🔨' },
  { value: 'store', label: '店舗・対面', icon: '🏬' },
  { value: 'other', label: 'その他', icon: '📦' },
]

export const platformLabel = (value) => (PLATFORMS.find((p) => p.value === value) || {}).label || value || ''

// 販路内に複数アカウントが存在しうるため、新規入力時に channel_account を必須とする販路
export const ACCOUNT_REQUIRED_PLATFORMS = ['mercari', 'mercari_shops']

// 売上のステータス。sales.sale_status の内部値。
// counted=false のステータスは売上・利益の集計対象から除外する。
export const SALE_STATUSES = [
  { value: 'completed', label: '完了', counted: true },
  { value: 'discounted', label: '値引き成立', counted: true },
  { value: 'returned', label: '返品', counted: false },
  { value: 'cancelled', label: 'キャンセル', counted: false },
]

export const saleStatusLabel = (value) => (SALE_STATUSES.find((s) => s.value === value) || {}).label || value || ''

/** 売上・利益の集計に含めるべき売上かどうか（返品・キャンセルは除外） */
export function isCountedSale(sale) {
  const status = SALE_STATUSES.find((s) => s.value === (sale?.sale_status || 'completed'))
  return status ? status.counted : true
}

// 滞留期間の警戒しきい値（日数）
export const AGING_WARN_DAYS = 30
export const AGING_DANGER_DAYS = 90

export function agingLevel(days) {
  if (days == null) return null
  if (days >= AGING_DANGER_DAYS) return 'danger'
  if (days >= AGING_WARN_DAYS) return 'warn'
  return 'ok'
}
