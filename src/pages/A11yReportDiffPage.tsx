import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getA11yReport, listA11yAudits } from '@/lib/tauri'
import { openExternal } from '@/lib/openExternal'
import { A11yIssuesList } from '@/components/A11yIssuesList'
import { reportScore, scoreColor } from '@/utils/a11yScore'
import { diffReports, countDiffKinds, orderReportsByTime, type PageDiff } from '@/utils/a11yDiff'
import type { A11yReport } from '@/types'

export function A11yReportDiffPage() {
  const { idA, idB } = useParams<{ idA: string; idB: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<{
    key: string
    reportA: A11yReport | null
    reportB: A11yReport | null
    names: Record<string, string>
    error: string | null
  } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const key = `${idA}/${idB}`

  useEffect(() => {
    if (!idA || !idB) return
    const k = `${idA}/${idB}`
    let active = true
    Promise.all([getA11yReport(idA), getA11yReport(idB), listA11yAudits().catch(() => [])])
      .then(([a, b, audits]) => {
        if (!active) return
        // A is always the older report, so regressions/improvements follow
        // time regardless of which report the comparison was started from.
        const { older, newer } = orderReportsByTime(a, b)
        setLoaded({
          key: k,
          reportA: older,
          reportB: newer,
          names: Object.fromEntries(audits.map((x) => [x.id, x.name])),
          error: null,
        })
      })
      .catch((e) => {
        if (active) setLoaded({ key: k, reportA: null, reportB: null, names: {}, error: String(e) })
      })
    return () => {
      active = false
    }
  }, [idA, idB])

  const current = loaded?.key === key ? loaded : null
  const loading = !!idA && !!idB && current === null
  const reportA = current?.reportA ?? null
  const reportB = current?.reportB ?? null
  const names = current?.names ?? {}
  const loadError = current?.error ?? null

  const diffs = useMemo(() => (reportA && reportB ? diffReports(reportA, reportB) : []), [reportA, reportB])

  if (loading)
    return (
      <div className="text-muted-foreground" role="status">
        Loading...
      </div>
    )
  if (!reportA || !reportB)
    return (
      <div className="space-y-2" role="alert">
        <p className="text-muted-foreground">Could not load reports.</p>
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        <button onClick={() => navigate('/accessibility')} className="text-sm text-primary hover:underline">
          &larr; Accessibility
        </button>
      </div>
    )

  const scoreA = reportScore(reportA)
  const scoreB = reportScore(reportB)
  const counts = countDiffKinds(diffs)

  const sections: { key: PageDiff['kind']; title: string; cls: string }[] = [
    { key: 'regression', title: 'Regressions', cls: 'text-destructive' },
    { key: 'improvement', title: 'Improvements', cls: 'text-success' },
    { key: 'errored', title: 'Not comparable (errored)', cls: 'text-yellow-700 dark:text-yellow-400' },
    { key: 'added', title: 'New pages', cls: 'text-muted-foreground' },
    { key: 'removed', title: 'Removed pages', cls: 'text-muted-foreground' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/accessibility/reports/${idA}`)}
          className="text-sm text-primary hover:underline"
        >
          &larr; Back to report
        </button>
        <h2 className="text-2xl font-bold">Report Diff</h2>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground border border-border rounded-lg p-4 flex-wrap">
        <div>
          <span className="font-medium text-foreground">A (older):</span> {names[reportA.auditId] ?? reportA.auditId} —{' '}
          {new Date(reportA.startedAt).toLocaleString()}
          {scoreA != null && <span className={`ml-2 font-semibold ${scoreColor(scoreA)}`}>score {scoreA}</span>}
        </div>
        <div>
          <span className="font-medium text-foreground">B (newer):</span> {names[reportB.auditId] ?? reportB.auditId} —{' '}
          {new Date(reportB.startedAt).toLocaleString()}
          {scoreB != null && <span className={`ml-2 font-semibold ${scoreColor(scoreB)}`}>score {scoreB}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {counts.regression > 0 && (
          <span className="text-destructive font-medium">✗ {counts.regression} regressions</span>
        )}
        {counts.improvement > 0 && (
          <span className="text-success font-medium">✓ {counts.improvement} improvements</span>
        )}
        {counts.errored > 0 && (
          <span className="text-yellow-700 dark:text-yellow-400 font-medium">! {counts.errored} not comparable</span>
        )}
        {counts.added > 0 && <span className="text-muted-foreground">+{counts.added} new pages</span>}
        {counts.removed > 0 && <span className="text-muted-foreground">-{counts.removed} removed pages</span>}
        <span className="text-muted-foreground">{counts.unchanged} unchanged</span>
      </div>

      {sections.map(({ key, title, cls }) => {
        const items = diffs.filter((d) => d.kind === key)
        if (items.length === 0) return null
        return (
          <section key={key}>
            <h3 className={`text-lg font-semibold mb-2 ${cls}`}>
              {title} ({items.length})
            </h3>
            <div className="space-y-2">
              {items.map((d) => {
                const isOpen = expanded === d.url
                const expandable = d.addedIssues.length > 0 || d.resolvedIssues.length > 0
                const panelId = `diff-panel-${key}-${items.indexOf(d)}`
                return (
                  <div
                    key={d.url}
                    className={`border rounded-lg p-4 space-y-2 ${
                      d.kind === 'regression'
                        ? 'border-destructive/30 bg-destructive/5'
                        : d.kind === 'improvement'
                          ? 'border-success/30 bg-success/5'
                          : d.kind === 'errored'
                            ? 'border-warning/30 bg-warning/5'
                            : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <button
                        onClick={() => openExternal(d.url)}
                        className="text-sm font-mono text-primary hover:underline truncate"
                        title={d.url}
                      >
                        {d.url}
                      </button>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                        {(d.scoreA != null || d.scoreB != null) && (
                          <span title="Page score A → B">
                            <span className={d.scoreA != null ? scoreColor(d.scoreA) : ''}>{d.scoreA ?? '—'}</span>
                            {' → '}
                            <span className={d.scoreB != null ? scoreColor(d.scoreB) : ''}>{d.scoreB ?? '—'}</span>
                          </span>
                        )}
                        {expandable && (
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : d.url)}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} issue details for ${d.url}`}
                            className="hover:text-foreground px-1"
                          >
                            <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {d.addedIssues.length > 0 && (
                        <span className="text-destructive">
                          + {d.addedIssues.length} new issue{d.addedIssues.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {d.resolvedIssues.length > 0 && (
                        <span className="text-success">− {d.resolvedIssues.length} resolved</span>
                      )}
                      {d.kind === 'added' && <span className="text-muted-foreground">page added in B</span>}
                      {d.kind === 'removed' && <span className="text-muted-foreground">page removed in B</span>}
                      {d.errorA && (
                        <span className="text-yellow-700 dark:text-yellow-400">errored in A: {d.errorA}</span>
                      )}
                      {d.errorB && (
                        <span className="text-yellow-700 dark:text-yellow-400">errored in B: {d.errorB}</span>
                      )}
                    </div>
                    {isOpen && expandable && (
                      <div id={panelId}>
                        {d.addedIssues.length > 0 && <A11yIssuesList issues={d.addedIssues} maxHeight="240px" />}
                        {d.resolvedIssues.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-success mb-1">Resolved in B:</p>
                            <A11yIssuesList issues={d.resolvedIssues} maxHeight="240px" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
