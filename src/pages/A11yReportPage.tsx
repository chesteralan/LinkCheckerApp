import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  getA11yReport,
  listA11yAudits,
  listA11yReports,
  saveTextFile,
  deleteA11yReport,
  rerunA11yPages,
  cancelA11yRun,
} from '@/lib/tauri'
import { openExternal } from '@/lib/openExternal'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { A11yIssuesList, A11ySeverityBadge } from '@/components/A11yIssuesList'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { reportScore, scoreColor } from '@/utils/a11yScore'
import { standardsLabel } from '@/utils/a11yStandards'
import { a11yReportToHtml } from '@/lib/a11yReportHtml'
import { toCsv, type CsvCell } from '@/utils/csv'
import type { A11yReport, A11yIssue, A11yReportInfo, A11yProgressEvent } from '@/types'

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
  const [rerunProgress, setRerunProgress] = useState<{ checked: number; total: number } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Which reportId the current `report`/`loadError` belong to.
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const rerunUnlisten = useRef<UnlistenFn | null>(null)

  // Drop the re-run progress listener on unmount.
  useEffect(
    () => () => {
      rerunUnlisten.current?.()
      rerunUnlisten.current = null
    },
    [],
  )

  useEffect(() => {
    if (!reportId) return
    let active = true
    getA11yReport(reportId)
      .then(async (r) => {
        if (!active) return
        setReport(r)
        setLoadError(null)
        setLoadedId(reportId)
        setTrend([])
        setSiblingReports([])
        const audits = await listA11yAudits().catch(() => [])
        if (!active) return
        setAuditName(audits.find((a) => a.id === r.auditId)?.name ?? '')

        const infos = (await listA11yReports().catch(() => []))
          .filter((i) => i.auditId === r.auditId)
          .sort((a, b) => b.timestampMs - a.timestampMs)
        if (!active) return
        setSiblingReports(infos.filter((i) => i.id !== r.id))

        const recent = infos.slice(0, 8)
        const scored = await Promise.all(
          recent.map(async (i) => {
            const rep = await getA11yReport(i.id).catch(() => null)
            const score = rep ? reportScore(rep) : null
            return score != null ? { date: i.startedAt.slice(0, 10), score } : null
          }),
        )
        if (!active) return
        setTrend(scored.filter((x): x is { date: string; score: number } => x !== null).reverse())
      })
      .catch((e) => {
        if (!active) return
        setReport(null)
        setLoadError(String(e))
        setLoadedId(reportId)
      })
    return () => {
      active = false
    }
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

  if (reportId && loadedId !== reportId)
    return (
      <div className="text-muted-foreground" role="status">
        Loading...
      </div>
    )
  if (!report)
    return (
      <div className="space-y-4" role="alert">
        <p className="text-muted-foreground">Could not load this report.</p>
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        <button onClick={() => navigate('/accessibility')} className="text-sm text-primary hover:underline">
          &larr; Accessibility
        </button>
      </div>
    )

  const s = report.summary
  const score = reportScore(report)

  async function exportFile(defaultName: string, content: string, filterName: string, ext: string) {
    setActionError(null)
    try {
      await saveTextFile({ defaultName, content, filterName, extensions: [ext] })
    } catch (e) {
      setActionError(`Export failed: ${String(e)}`)
    }
  }

  async function handleExportHtml() {
    if (!report) return
    await exportFile(`a11y-report-${auditName || reportId}.html`, a11yReportToHtml(report, auditName), 'HTML', 'html')
  }

  async function handleExport(format: 'json' | 'csv') {
    if (!report) return
    let content: string
    if (format === 'json') {
      content = JSON.stringify(report, null, 2)
    } else {
      const header = [
        'URL',
        'Page Title',
        'Status',
        'Response Time (ms)',
        'Error',
        'Severity',
        'WCAG',
        'Element',
        'Selector',
        'Message',
      ]
      const rows: CsvCell[][] = report.results.flatMap((r) => {
        const base: CsvCell[] = [r.url, r.pageTitle, r.status, r.responseTimeMs, r.error]
        return r.issues.length > 0
          ? r.issues.map((i) => [...base, i.severity, i.wcag, i.element, i.selector, i.message])
          : [[...base, '', '', '', '', '']]
      })
      content = toCsv(header, rows)
    }
    await exportFile(`a11y-report-${reportId}.${format}`, content, format.toUpperCase(), format)
  }

  const erroredCount = report.results.filter((r) => r.error).length

  async function handleRerun(urls?: string[]) {
    if (!reportId || rerunning) return
    setRerunning(true)
    setRerunError(null)
    setRerunProgress(null)
    try {
      // Re-runs emit only progress/result events (flagged rerun: true); the
      // command's result is the terminal signal.
      rerunUnlisten.current?.()
      rerunUnlisten.current = await listen<A11yProgressEvent>('a11y:progress', (e) => {
        if (e.payload.rerun && e.payload.reportId === reportId) {
          setRerunProgress({ checked: e.payload.checked, total: e.payload.total })
        }
      })
      const updated = await rerunA11yPages(reportId, urls)
      setReport(updated)
    } catch (e) {
      setRerunError(String(e))
    } finally {
      rerunUnlisten.current?.()
      rerunUnlisten.current = null
      setRerunning(false)
      setRerunProgress(null)
      setRetryingUrl(null)
    }
  }

  async function handleCancelRerun() {
    try {
      await cancelA11yRun()
    } catch (e) {
      setRerunError(`Could not cancel: ${String(e)}`)
    }
  }

  async function handleDelete() {
    if (!reportId) return
    try {
      await deleteA11yReport(reportId)
      navigate('/accessibility')
    } catch (e) {
      setConfirmDelete(false)
      setActionError(`Could not delete report: ${String(e)}`)
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
              type="button"
              onClick={() => handleRerun()}
              disabled={rerunning || report.status === 'running'}
              className="text-xs px-3 py-1 border border-primary text-primary rounded-md hover:bg-primary/10 transition-colors disabled:opacity-50"
              title="Re-scan pages that failed with an error"
            >
              {rerunning
                ? `Re-running…${rerunProgress ? ` ${rerunProgress.checked}/${rerunProgress.total}` : ''}`
                : `Re-run failed (${erroredCount})`}
            </button>
          )}
          {rerunning && (
            <button
              type="button"
              onClick={handleCancelRerun}
              className="text-xs px-3 py-1 border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
            >
              Cancel re-run
            </button>
          )}
          {siblingReports.length > 0 && (
            <button
              onClick={() => setShowCompare(true)}
              className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
            >
              Compare
            </button>
          )}
          <button
            onClick={handleExportHtml}
            className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
          >
            Export HTML
          </button>
          <button
            onClick={() => handleExport('json')}
            className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
          >
            Export JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
          >
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

      {(rerunError || actionError) && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive space-y-1"
        >
          {rerunError && <p>Re-run failed: {rerunError}</p>}
          {actionError && <p>{actionError}</p>}
        </div>
      )}
      {rerunning && (
        <p className="sr-only" role="status" aria-live="polite">
          {rerunProgress ? `Re-running ${rerunProgress.checked} of ${rerunProgress.total} pages` : 'Re-running pages'}
        </p>
      )}

      <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
        <span>
          {new Date(report.startedAt).toLocaleString()} · {s.totalPages} page{s.totalPages !== 1 ? 's' : ''}
          {report.completedAt && ` · finished ${new Date(report.completedAt).toLocaleTimeString()}`}
        </span>
        <span className="text-xs bg-muted px-2 py-0.5 rounded" title="Standards this report was audited against">
          {standardsLabel(report.standards)}
        </span>
        {report.engine && (
          <span
            className="text-xs bg-muted px-2 py-0.5 rounded"
            title="Engine this report was scanned with; re-runs use the same engine and rules"
          >
            {report.engine === 'axe-core' ? 'axe-core' : 'Static HTML'}
            {report.minSeverity && report.minSeverity !== 'minor' ? ` · ${report.minSeverity}+` : ''}
          </span>
        )}
        {score != null && (
          <span
            className={`text-lg font-bold ${scoreColor(score)}`}
            title="100 minus severity-weighted issue penalties, averaged across scanned pages"
          >
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
            type="button"
            aria-pressed={severityFilter === f}
            onClick={() => setSeverityFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              severityFilter === f
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border hover:bg-muted'
            }`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <input
          type="text"
          placeholder="Filter pages..."
          aria-label="Filter pages"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary w-64"
        />
      </div>

      <div className="space-y-2">
        {filteredResults.length > 0 ? (
          filteredResults.map((r, idx) => {
            const isOpen = expanded === r.url
            const panelId = `a11y-page-panel-${idx}`
            return (
              <div key={r.url} className="border border-border rounded-lg p-4 space-y-2">
                <div className="w-full flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className={`w-2 h-2 shrink-0 rounded-full ${
                        r.error ? 'bg-destructive' : r.issues.length > 0 ? 'bg-warning' : 'bg-success'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => openExternal(r.url)}
                      className="text-sm font-mono text-primary hover:underline truncate"
                      title={`Open ${r.url} in browser`}
                    >
                      {r.url}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.url)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${r.url}`}
                    className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground hover:text-foreground rounded px-1"
                  >
                    {r.status != null && <span>{r.status}</span>}
                    {r.responseTimeMs != null && <span>{r.responseTimeMs}ms</span>}
                    {r.error ? (
                      <span className="text-destructive">error</span>
                    ) : r.issues.length > 0 ? (
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
                    <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </button>
                </div>
                {r.error && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-destructive">{r.error}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRetryingUrl(r.url)
                        handleRerun([r.url])
                      }}
                      disabled={rerunning || report.status === 'running'}
                      aria-label={`Retry ${r.url}`}
                      className="text-xs px-2 py-0.5 border border-border rounded hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {retryingUrl === r.url && rerunning ? 'Retrying…' : 'Retry'}
                    </button>
                  </div>
                )}
                {r.pageTitle && <p className="text-xs text-muted-foreground">{r.pageTitle}</p>}
                {isOpen && (
                  <div id={panelId}>
                    {r.issues.length > 0 && <A11yIssuesList issues={r.issues} maxHeight="320px" />}
                    {r.truncated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Results truncated: the engine stopped recording issues for this page after its limit.
                      </p>
                    )}
                    {r.issues.length === 0 && !r.error && (
                      <p className="text-xs text-muted-foreground">No accessibility issues found.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <p className="text-sm text-muted-foreground">No pages match the current filter.</p>
        )}
      </div>

      <Modal open={showCompare} onClose={() => setShowCompare(false)} title="Compare with another report">
        <div className="space-y-2">
          {siblingReports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setShowCompare(false)
                navigate(`/accessibility/reports/diff/${reportId}/${r.id}`)
              }}
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
        onConfirm={handleDelete}
        message="Delete this report? This cannot be undone."
      />
    </div>
  )
}
