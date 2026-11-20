import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getA11yReport, listA11yAudits } from '@/lib/tauri'
import { openUrl } from '@tauri-apps/plugin-opener'
import { A11yIssuesList, A11ySeverityBadge } from '@/components/A11yIssuesList'
import { reportScore, pageScore, scoreColor } from '@/utils/a11yScore'
import type { A11yReport, A11yIssue } from '@/types'

interface PageDiff {
  url: string
  kind: 'regression' | 'improvement' | 'added' | 'removed' | 'unchanged'
  addedIssues: A11yIssue[]
  resolvedIssues: A11yIssue[]
  scoreA: number | null
  scoreB: number | null
}

function typeCounts(issues: A11yIssue[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of issues) m.set(i.issueType, (m.get(i.issueType) ?? 0) + 1)
  return m
}

function diffReports(a: A11yReport, b: A11yReport): PageDiff[] {
  const mapA = new Map(a.results.map((r) => [r.url, r]))
  const mapB = new Map(b.results.map((r) => [r.url, r]))
  const allUrls = new Set([...mapA.keys(), ...mapB.keys()])
  const diffs: PageDiff[] = []

  for (const url of allUrls) {
    const ra = mapA.get(url)
    const rb = mapB.get(url)
    if (!ra && rb) {
      diffs.push({ url, kind: 'added', addedIssues: rb.issues, resolvedIssues: [], scoreA: null, scoreB: pageScore(rb.issues) })
      continue
    }
    if (ra && !rb) {
      diffs.push({ url, kind: 'removed', addedIssues: [], resolvedIssues: ra.issues, scoreA: pageScore(ra.issues), scoreB: null })
      continue
    }
    if (!ra || !rb) continue

    const countsA = typeCounts(ra.issues)
    const countsB = typeCounts(rb.issues)

    // Take the excess/deficit count per issue type so a type going
    // 3→1 reports 2 resolved issues, not all 3.
    const excess = new Map<string, number>()
    for (const [t, n] of countsB) {
      const d = n - (countsA.get(t) ?? 0)
      if (d > 0) excess.set(t, d)
    }
    const deficit = new Map<string, number>()
    for (const [t, n] of countsA) {
      const d = n - (countsB.get(t) ?? 0)
      if (d > 0) deficit.set(t, d)
    }
    const newIssues = rb.issues.filter((i) => {
      const take = excess.get(i.issueType) ?? 0
      if (take <= 0) return false
      excess.set(i.issueType, take - 1)
      return true
    })
    const goneIssues = ra.issues.filter((i) => {
      const take = deficit.get(i.issueType) ?? 0
      if (take <= 0) return false
      deficit.set(i.issueType, take - 1)
      return true
    })

    const hasNew = newIssues.length > 0
    const hasGone = goneIssues.length > 0
    const kind = hasNew ? 'regression' : hasGone ? 'improvement' : 'unchanged'
    diffs.push({
      url,
      kind,
      addedIssues: newIssues,
      resolvedIssues: goneIssues,
      scoreA: pageScore(ra.issues),
      scoreB: pageScore(rb.issues),
    })
  }

  const order = { regression: 0, improvement: 1, added: 2, removed: 3, unchanged: 4 }
  return diffs.sort((x, y) => order[x.kind] - order[y.kind])
}

export function A11yReportDiffPage() {
  const { idA, idB } = useParams<{ idA: string; idB: string }>()
  const navigate = useNavigate()
  const [reportA, setReportA] = useState<A11yReport | null>(null)
  const [reportB, setReportB] = useState<A11yReport | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!idA || !idB) return
    Promise.all([getA11yReport(idA), getA11yReport(idB), listA11yAudits().catch(() => [])])
      .then(([a, b, audits]) => {
        setReportA(a)
        setReportB(b)
        setNames(Object.fromEntries(audits.map((x) => [x.id, x.name])))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [idA, idB])

  const diffs = useMemo(
    () => (reportA && reportB ? diffReports(reportA, reportB) : []),
    [reportA, reportB],
  )

  if (loading) return <div className="text-muted-foreground">Loading...</div>
  if (!reportA || !reportB) return <div className="text-muted-foreground">Could not load reports.</div>

  const scoreA = reportScore(reportA)
  const scoreB = reportScore(reportB)
  const counts = {
    regression: diffs.filter((d) => d.kind === 'regression').length,
    improvement: diffs.filter((d) => d.kind === 'improvement').length,
    added: diffs.filter((d) => d.kind === 'added').length,
    removed: diffs.filter((d) => d.kind === 'removed').length,
    unchanged: diffs.filter((d) => d.kind === 'unchanged').length,
  }

  const sections: { key: PageDiff['kind']; title: string; cls: string }[] = [
    { key: 'regression', title: 'Regressions', cls: 'text-destructive' },
    { key: 'improvement', title: 'Improvements', cls: 'text-success' },
    { key: 'added', title: 'New pages', cls: 'text-muted-foreground' },
    { key: 'removed', title: 'Removed pages', cls: 'text-muted-foreground' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/accessibility/reports/${idA}`)} className="text-sm text-primary hover:underline">
          &larr; Report A
        </button>
        <h2 className="text-2xl font-bold">Report Diff</h2>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground border border-border rounded-lg p-4 flex-wrap">
        <div>
          <span className="font-medium text-foreground">A:</span> {names[reportA.auditId] ?? reportA.auditId} —{' '}
          {new Date(reportA.startedAt).toLocaleString()}
          {scoreA != null && <span className={`ml-2 font-semibold ${scoreColor(scoreA)}`}>score {scoreA}</span>}
        </div>
        <div>
          <span className="font-medium text-foreground">B:</span> {names[reportB.auditId] ?? reportB.auditId} —{' '}
          {new Date(reportB.startedAt).toLocaleString()}
          {scoreB != null && <span className={`ml-2 font-semibold ${scoreColor(scoreB)}`}>score {scoreB}</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {counts.regression > 0 && <span className="text-destructive font-medium">✗ {counts.regression} regressions</span>}
        {counts.improvement > 0 && <span className="text-success font-medium">✓ {counts.improvement} improvements</span>}
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
              {items.map((d) => (
                <div
                  key={d.url}
                  className={`border rounded-lg p-4 space-y-2 ${
                    d.kind === 'regression'
                      ? 'border-destructive/30 bg-destructive/5'
                      : d.kind === 'improvement'
                        ? 'border-success/30 bg-success/5'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <button
                      onClick={() => openUrl(d.url)}
                      className="text-sm font-mono text-primary hover:underline truncate"
                      title={d.url}
                    >
                      {d.url}
                    </button>
                    <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                      {d.scoreA != null && d.scoreB != null && (
                        <span>
                          <span className={scoreColor(d.scoreA)}>{d.scoreA}</span>
                          {' → '}
                          <span className={scoreColor(d.scoreB)}>{d.scoreB}</span>
                        </span>
                      )}
                      <button
                        onClick={() => setExpanded(expanded === d.url ? null : d.url)}
                        className="hover:text-foreground"
                      >
                        {expanded === d.url ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {d.addedIssues.length > 0 && (
                      <span className="text-destructive">
                        + {d.addedIssues.length} new issue{d.addedIssues.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {d.resolvedIssues.length > 0 && (
                      <span className="text-success">
                        − {d.resolvedIssues.length} resolved
                      </span>
                    )}
                    {d.kind === 'added' && <span className="text-muted-foreground">page added in B</span>}
                    {d.kind === 'removed' && <span className="text-muted-foreground">page removed in B</span>}
                  </div>
                  {expanded === d.url && d.addedIssues.length > 0 && (
                    <A11yIssuesList issues={d.addedIssues} maxHeight="240px" />
                  )}
                  {expanded === d.url && d.resolvedIssues.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-success mb-1">Resolved in B:</p>
                      <A11yIssuesList issues={d.resolvedIssues} maxHeight="240px" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
