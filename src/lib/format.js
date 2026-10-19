export const fmt = (n) => `¥${Number(n || 0).toLocaleString()}`
export const today = () => new Date().toISOString().slice(0, 10)
export const thisMonth = () => new Date().toISOString().slice(0, 7)

// Days elapsed since a date string (YYYY-MM-DD). Used for 滞留期間 (stock aging).
export function daysSince(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
