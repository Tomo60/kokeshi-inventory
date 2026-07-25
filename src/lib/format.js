export const fmt = (n) => `¥${Number(n || 0).toLocaleString()}`
export const today = () => new Date().toISOString().slice(0, 10)
export const thisMonth = () => new Date().toISOString().slice(0, 7)

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
