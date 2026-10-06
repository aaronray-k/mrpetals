import type { Issue } from './validate'

function csvCell(v: string | number | null) {
  const s = v == null ? '' : String(v)
  // Quote everything; neutralise leading = + - @ so Excel doesn't run a cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export function issuesToCsv(issues: Issue[], sheet: string) {
  const header = ['sheet', 'row', 'column', 'level', 'message']
  const lines = issues.map((i) => [sheet, i.row, i.column, i.level, i.message].map(csvCell).join(','))
  // BOM so Excel opens it as UTF-8.
  return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n')
}

export function downloadCsv(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
