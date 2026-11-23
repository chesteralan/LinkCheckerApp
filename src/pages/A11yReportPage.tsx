import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getA11yReport, listA11yAudits, listA11yReports, writeFile, deleteA11yReport, rerunA11yPages } from '@/lib/tauri'
import { save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { A11yIssuesList, A11ySeverityBadge } from '@/components/A11yIssuesList'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { reportScore, scoreColor } from '@/utils/a11yScore'
import { standardsLabel } from '@/utils/a11yStandards'
import { a11yReportToHtml } from '@/lib/a11yReportHtml'
import type { A11yReport, A11yIssue, A11yReportInfo } from '@/types'

const SEVERITY_FILTERS = ['all', 'critical', 'serious', 'moderate', 'minor'] as const

export function A11yReportPage() {
  const { reportId } = useParams<{ reportId: string }>()
  const navigate = useNavigate()
  const [report, setReport] = useState<A11yReport | null>(null)
  const [auditName, setAuditName] = useState('')
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITY_FILTERS)[number]>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [trend, setTrend] = useState<{ date: string; score: number }[]>([])
  const [siblingReports, setSiblingReports] = useState<A11yReportInfo[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [retryingUrl, setRetryingUrl] = useState<string | null>(null)
  const [rerunError, setRerunError] = useState<string | null>(null)

  useEffect(() => {
    if (!reportId) return
    getA11yReport(reportId)
      .then(async (r) => {
        setReport(r)
        const audits = await listA11yAudits().catch(() => [])
        setAuditName(audits.find((a) => a.id === r.auditId)?.name ?? '')

        const infos = (await listA11yReports().catch(() => []))
          .filter((i) => i.auditId === r.auditId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        setSiblingReports(infos.filter((i) => i.id !== r.id))

        const recent = infos.slice(0, 8)
        const scored = await Promise.all(
          recent.map(async (i) => {
            const rep = await getA11yReport(i.id).catch(() => null)
            const score = rep ? reportScore(rep) : null
            return score != null ? { date: i.startedAt.slice(0, 10), score } : null
          }),
        )
        setTrend(scored.filter((x): x is { date: string; score: number } => x !== null).reverse())
      })
      .catch(() => setReport(null))
  }, [reportId])

  const filteredResults = useMemo(() => {
    if (!report) return []
    const q = searchQuery.toLowerCase()
    return report.results.filter((r) => {
      if (q && !JSON.stringify(r).toLowerCase().includes(q)) return false
      if (severityFilter === 'all') return true
      return r.issues.some((i) => i.severity === severityFilter)
    })
  }, [report, severityFilter, searchQuery])

  const allIssues = useMemo(() => {
    if (!report) return [] as { issue: A11yIssue; url: string }[]
    return report.results.flatMap((r) => r.issues.map((issue) => ({ issue, url: r.url })))
  }, [report])

  const issueTypeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const { issue } of allIssues) m.set(issue.issueType, (m.get(issue.issueType) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [allIssues])

  if (!report) return <div className="text-muted-foreground">Loading...</div>

  const s = report.summary
  const score = reportScore(report)

  async function handleExportHtml() {
    if (!report) return
    const path = await save({
      defaultPath: `a11y-report-${auditName || reportId}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!path) return
    await writeFile(path, a11yReportToHtml(report, auditName))
  }

  async function handleExport(format: 'json' | 'csv') {
    if (!report) return
    const ext = format
    const path = await save({
      defaultPath: `a11y-report-${reportId}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    })
    if (!path) return
    const content =
      format === 'json'
        ? JSON.stringify(report, null, 2)
        : [
            'URL,Page Title,Status,Response Time (ms),Error,Severity,WCAG,Element,Selector,Message',
            ...report.results.flatMap((r) =>
              r.issues.length > 0
                ? r.issues.map((i) =>
                    [r.url, r.pageTitle ?? '', r.status ?? '', r.responseTimeMs ?? '', r.error ?? '', i.severity ?? '', i.wcag ?? '', i.element, i.selector, i.message]
                      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                      .join(',')
                  )
                : [[r.url, r.pageTitle ?? '', r.status ?? '', r.responseTimeMs ?? '', r.error ?? '', '', '', '', '', ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')]
            ),
          ].join('\n')
    await writeFile(path, content)
  }

  const erroredCount = report.results.filter((r) => r.error).length

  async function handleRerun(urls?: string[]) {
    if (!reportId || rerunning) return
    setRerunning(true)
    setRerunError(null)
    try {
      const updated = await rerunA11yPages(reportId, urls)
      setReport(updated)
    } catch (e) {
      setRerunError(String(e))
    } finally {
      setRerunning(false)
      setRetryingUrl(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/accessibility')} className="text-sm text-primary hover:underline">
            &larr; Accessibility
          </button>
          <h2 className="text-2xl font-bold">{auditName || 'Accessibility Report'}</h2>
        </div>
        <div className="flex items-center gap-2">
          {erroredCount > 0 && (
            <button
              onClick={() => handleRerun()}
              disabled={rerunning}
              className="text-xs px-3 py-1 border border-primary text-primary rounded-md hover:bg-primary/10 transition-colors disabled:opacity-50"
              title="Re-scan pages that failed with an error"
            >
              {rerunning ? 'Re-running…' : `Re-run failed (${erroredCount})`}
            </button>
          )}
          {rerunError && <span className="text-xs text-destructive">{rerunError}</span>}
          {siblingReports.length > 0 && (
            <button
              onClick={() => setShowCompare(true)}
              className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
            >
              Compare
            </button>
          )}
          <button onClick={handleExportHtml} className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors">
            Export HTML
          </button>
          <button onClick={() => handleExport('json')} className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors">
            Export JSON
          </button>
          <button onClick={() => handleExport('csv')} className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors">
            Export CSV
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs px-3 py-1 border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Delete
          </button>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              report.status === 'completed'
                ? 'bg-success/10 text-success'
                : report.status === 'cancelled'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-primary/10 text-primary'
            }`}
          >
            {report.status}
          </span>
        </div>
      </div>

      <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
        <span>
          {new Date(report.startedAt).toLocaleString()} · {s.totalPages} page{s.totalPages !== 1 ? 's' : ''}
          {report.completedAt && ` · finished ${new Date(report.completedAt).toLocaleTimeString()}`}
        </span>
        <span className="text-xs bg-muted px-2 py-0.5 rounded" title="Standards this report was audited against">
          {standardsLabel(report.standards)}
        </span>
        {score != null && (
          <span className={`text-lg font-bold ${scoreColor(score)}`} title="100 minus severity-weighted issue penalties, averaged across scanned pages">
            {score}
            <span className="text-xs font-normal text-muted-foreground">/100</span>
          </span>
        )}
      </div>

      {trend.length >= 2 && (
        <div className="border border-border rounded-lg p-3">
          <h3 className="text-sm font-medium mb-2">Score trend — last {trend.length} reports</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Pages</p>
          <p className="text-xl font-semibold">{s.totalPages}</p>
        </div>
        <div className="border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">With issues</p>
          <p className="text-xl font-semibold">{s.pagesWithIssues}</p>
        </div>
        <div className="border border-destructive/40 rounded-lg p-3">
          <p className="text-xs text-destructive">Critical</p>
          <p className="text-xl font-semibold text-destructive">{s.critical}</p>
        </div>
        <div className="border border-orange-500/40 rounded-lg p-3">
          <p className="text-xs text-orange-600 dark:text-orange-400">Serious</p>
          <p className="text-xl font-semibold text-orange-600 dark:text-orange-400">{s.serious}</p>
        </div>
        <div className="border border-yellow-500/40 rounded-lg p-3">
          <p className="text-xs text-yellow-700 dark:text-yellow-400">Moderate</p>
          <p className="text-xl font-semibold text-yellow-700 dark:text-yellow-400">{s.moderate}</p>
        </div>
        <div className="border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Minor</p>
          <p className="text-xl font-semibold">{s.minor}</p>
        </div>
      </div>

      {issueTypeCounts.length > 0 && (
        <div className="border border-border rounded-lg p-3">
          <h3 className="text-sm font-medium mb-2">Issues by type</h3>
          <div className="flex flex-wrap gap-2">
            {issueTypeCounts.map(([type, count]) => (
              <button
                key={type}
                onClick={() => {
                  const first = allIssues.find((i) => i.issue.issueType === type)
                  if (first) {
                    setExpanded(first.url)
                    setSearchQuery(first.url)
                  }
                }}
                className="text-xs px-2 py-1 bg-muted rounded hover:bg-muted/70 transition-colors"
                title={`${count} occurrence${count > 1 ? 's' : ''}`}
              >
                {type} <span className="text-muted-foreground">×{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {SEVERITY_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setSeverityFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              severityFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter pages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary w-64"
        />
      </div>

      <div className="space-y-2">
        {filteredResults.length > 0 ? (
          filteredResults.map((r) => (
            <div key={r.url} className="border border-border rounded-lg p-4 space-y-2">
              <div
                onClick={() => setExpanded(expanded === r.url ? null : r.url)}
                className="w-full flex items-center justify-between gap-4 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 shrink-0 rounded-full ${
                      r.error ? 'bg-destructive' : r.issues.length > 0 ? 'bg-warning' : 'bg-success'
                    }`}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); openUrl(r.url) }}
                    className="text-sm font-mono text-primary hover:underline truncate"
                    title={r.url}
                  >
                    {r.url}
                  </button>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                  {r.status && <span>{r.status}</span>}
                  {r.responseTimeMs != null && <span>{r.responseTimeMs}ms</span>}
                  {r.issues.length > 0 ? (
                    <span className="flex gap-1 items-center">
                      {(['critical', 'serious', 'moderate', 'minor'] as const).map((sev) => {
                        const n = r.issues.filter((i) => i.severity === sev).length
                        return n > 0 ? (
                          <span key={sev} className="inline-flex items-center gap-0.5">
                            <A11ySeverityBadge severity={sev} />
                            <span>×{n}</span>
                          </span>
                        ) : null
                      })}
                    </span>
                  ) : (
                    <span className="text-success">clean</span>
                  )}
                  <span>{expanded === r.url ? '▲' : '▼'}</span>
                </div>
              </div>
              {r.error && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-destructive">{r.error}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRetryingUrl(r.url)
                      handleRerun([r.url])
                    }}
                    disabled={rerunning}
                    className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {retryingUrl === r.url && rerunning ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}
              {r.pageTitle && <p className="text-xs text-muted-foreground">{r.pageTitle}</p>}
              {expanded === r.url && r.issues.length > 0 && (
                <A11yIssuesList issues={r.issues} maxHeight="320px" />
              )}
              {expanded === r.url && r.issues.length === 0 && !r.error && (
                <p className="text-xs text-muted-foreground">No accessibility issues found.</p>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No pages match the current filter.</p>
        )}
      </div>

      <Modal open={showCompare} onClose={() => setShowCompare(false)} title="Compare with another report">
        <div className="space-y-2">
          {siblingReports.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate(`/accessibility/reports/diff/${reportId}/${r.id}`)}
              className="w-full text-left border border-border rounded-lg p-3 hover:border-primary transition-colors"
            >
              <div className="text-sm font-medium">{new Date(r.startedAt).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{r.id.slice(0, 8)}</div>
            </button>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (reportId) {
            await deleteA11yReport(reportId)
            navigate('/accessibility')
          }
        }}
        message="Delete this report? This cannot be undone."
      />
    </div>
  )
}
