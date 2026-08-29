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

// 滞留期間の警戒しきい値（日数）
export const AGING_WARN_DAYS = 30
export const AGING_DANGER_DAYS = 90

export function agingLevel(days) {
  if (days == null) return null
  if (days >= AGING_DANGER_DAYS) return 'danger'
  if (days >= AGING_WARN_DAYS) return 'warn'
  return 'ok'
}
