import type { A11yReport, A11yIssue } from '@/types'
import { reportScore } from '@/utils/a11yScore'

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  serious: '#ea580c',
  moderate: '#ca8a04',
  minor: '#6b7280',
}

function issueRow(i: A11yIssue): string {
  const color = SEVERITY_COLORS[i.severity ?? ''] ?? SEVERITY_COLORS.minor
  return `<tr>
    <td><span class="badge" style="background:${color}1a;color:${color}">${esc(i.severity ?? 'minor')}</span></td>
    <td><code>${esc(i.issueType)}</code></td>
    <td>${esc(i.wcag)}</td>
    <td>${esc((i.standards ?? []).filter((x) => x !== 'wcag').join(', '))}</td>
    <td><code>${esc(i.selector)}</code></td>
    <td>${esc(i.message)}</td>
    <td>${i.helpUrl ? `<a href="${esc(i.helpUrl)}">WCAG</a>` : ''}</td>
  </tr>`
}

export function a11yReportToHtml(report: A11yReport, auditName: string): string {
  const score = reportScore(report)
  const scoreColor =
    score != null ? (score >= 90 ? '#16a34a' : score >= 70 ? '#ca8a04' : score >= 40 ? '#ea580c' : '#dc2626') : '#6b7280'
  const s = report.summary

  const typeCounts = new Map<string, number>()
  for (const r of report.results) {
    for (const i of r.issues) typeCounts.set(i.issueType, (typeCounts.get(i.issueType) ?? 0) + 1)
  }
  const typeRows = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<tr><td><code>${esc(t)}</code></td><td>${n}</td></tr>`)
    .join('')

  const pageSections = report.results
    .map((r) => {
      const issues = r.issues.length
        ? `<table><thead><tr><th>Severity</th><th>Rule</th><th>WCAG</th><th>Standards</th><th>Element</th><th>Message</th><th></th></tr></thead><tbody>${r.issues.map(issueRow).join('')}</tbody></table>`
        : `<p class="clean">${r.error ? `Error: ${esc(r.error)}` : 'No issues found.'}</p>`
      return `<section class="page">
        <h3><a href="${esc(r.url)}">${esc(r.url)}</a></h3>
        <p class="meta">${r.status ?? '—'}${r.pageTitle ? ` · ${esc(r.pageTitle)}` : ''}${r.responseTimeMs != null ? ` · ${r.responseTimeMs}ms` : ''}</p>
        ${issues}
      </section>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Accessibility Report — ${esc(auditName || report.auditId)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; }
  h3 { font-size: 0.95rem; margin: 1.5rem 0 0.25rem; word-break: break-all; }
  .meta { color: #6b7280; font-size: 0.85rem; margin-top: 0; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 0.75rem 1rem; min-width: 110px; }
  .card .num { font-size: 1.4rem; font-weight: 600; }
  .card .lbl { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; }
  .score { font-size: 2.5rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  code { font-family: ui-monospace, monospace; font-size: 0.75rem; background: #f3f4f6; padding: 0.1rem 0.25rem; border-radius: 3px; }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
  .clean { color: #16a34a; font-size: 0.85rem; }
  a { color: #2563eb; }
  @media print { body { margin: 0; } .page { break-inside: avoid; } }
</style>
</head>
<body>
<h1>Accessibility Report — ${esc(auditName || report.auditId)}</h1>
<p class="meta">
  ${esc(report.startedAt)}${report.completedAt ? ` → ${esc(report.completedAt)}` : ''} ·
  Status: ${esc(report.status)} · Engine report ${esc(report.id.slice(0, 8))}
</p>

<div class="cards">
  <div class="card"><div class="score" style="color:${scoreColor}">${score ?? '—'}</div><div class="lbl">Score / 100</div></div>
  <div class="card"><div class="num">${s.totalPages}</div><div class="lbl">Pages</div></div>
  <div class="card"><div class="num">${s.pagesWithIssues}</div><div class="lbl">With issues</div></div>
  <div class="card"><div class="num" style="color:#dc2626">${s.critical}</div><div class="lbl">Critical</div></div>
  <div class="card"><div class="num" style="color:#ea580c">${s.serious}</div><div class="lbl">Serious</div></div>
  <div class="card"><div class="num" style="color:#ca8a04">${s.moderate}</div><div class="lbl">Moderate</div></div>
  <div class="card"><div class="num" style="color:#6b7280">${s.minor}</div><div class="lbl">Minor</div></div>
</div>

${typeRows ? `<h2>Issues by type</h2><table><thead><tr><th>Rule</th><th>Count</th></tr></thead><tbody>${typeRows}</tbody></table>` : ''}

<h2>Pages (${report.results.length})</h2>
${pageSections}

<p class="meta" style="margin-top:2rem">Generated by LinkCheckerApp · Score = 100 minus severity-weighted issue penalties (critical 10, serious 5, moderate 2, minor 1), averaged across successfully scanned pages.</p>
</body>
</html>`
}
