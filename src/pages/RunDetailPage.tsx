import { useEffect, useState } from 'react'
import { useStore } from '@/hooks/useStore'
import { listAllRuns } from '@/lib/tauri'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { AuditRun, SelectorCheck } from '@/types'

interface Props {
  runId: string
  onBack: () => void
}

export function RunDetailPage({ runId, onBack }: Props) {
  const { audits, targetLists, checkTemplates } = useStore()
  const [run, setRun] = useState<AuditRun | null>(null)
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errored'>('all')
  const [view, setView] = useState<'detailed' | 'table'>('detailed')

  useEffect(() => {
    listAllRuns().then((runs) => {
      const found = runs.find((r) => r.id === runId)
      if (found) setRun(found)
    })
  }, [runId])

  if (!run) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  const audit = audits.find((a) => a.id === run.auditId)
  const tl = targetLists.find((t) => t.id === audit?.targetListId)
  const ct = checkTemplates.find((c) => c.id === audit?.checkTemplateId)
  const date = new Date(run.startedAt).toLocaleString()

  const selectors: SelectorCheck[] = []
  const seen = new Set<string>()
  for (const pr of run.results) {
    for (const cr of pr.checks) {
      if (!seen.has(cr.selectorCheckId)) {
        seen.add(cr.selectorCheckId)
        selectors.push({ id: cr.selectorCheckId, selector: cr.selector, label: cr.label })
      }
    }
  }

  const displayedResults = run.results.filter((r) => {
    if (filter === 'passed') return !r.error && r.checks.every((c) => c.found)
    if (filter === 'failed') return !r.error && r.checks.some((c) => !c.found)
    if (filter === 'errored') return !!r.error
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-primary hover:underline">&larr; History</button>
          <h2 className="text-2xl font-bold">{audit?.name ?? 'Quick Audit'}</h2>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          run.status === 'completed' ? 'bg-success/10 text-success' :
          run.status === 'cancelled' ? 'bg-warning/10 text-warning' :
          run.status === 'running' ? 'bg-primary/10 text-primary' :
          'bg-destructive/10 text-destructive'
        }`}>
          {run.status}
        </span>
      </div>

      {(audit || tl || ct) && (
        <div className="text-sm text-muted-foreground flex gap-4">
          {audit && <span>Audit: {audit.name}</span>}
          {tl && <span>Targets: {tl.name}</span>}
          {ct && <span>Template: {ct.name}</span>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('detailed')}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${view === 'detailed' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          Detailed
        </button>
        <button
          onClick={() => setView('table')}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${view === 'table' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          Table
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted-foreground">{date}</span>
        {run.completedAt && (
          <span className="text-muted-foreground">
            Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
          </span>
        )}
        <span>{run.results.length} URLs</span>
        <button
          onClick={() => setFilter(filter === 'passed' ? 'all' : 'passed')}
          className={`text-success ${filter === 'passed' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
        >✓ {run.summary.passed} passed</button>
        <button
          onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
          className={`text-destructive ${filter === 'failed' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
        >✗ {run.summary.failed} failed</button>
        <button
          onClick={() => setFilter(filter === 'errored' ? 'all' : 'errored')}
          className={`text-muted-foreground ${filter === 'errored' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
        >⚠ {run.summary.errored} errored</button>
        {run.summary.avgResponseTimeMs > 0 && (
          <span className="text-muted-foreground">
            Avg {Math.round(run.summary.avgResponseTimeMs)}ms
          </span>
        )}
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="text-xs text-primary hover:underline cursor-pointer">clear filter</button>
        )}
      </div>

      {view === 'detailed' ? (
        <div className="space-y-4">
          {displayedResults.map((result, i) => (
            <div key={i} className="border border-border rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  result.error ? 'bg-destructive' :
                  result.checks.every((c) => c.found) ? 'bg-success' : 'bg-warning'
                }`} />
                <button
                  onClick={() => openUrl(result.url)}
                  className="font-mono text-sm hover:text-primary hover:underline truncate"
                >
                  {result.url}
                </button>
                <span className="text-xs text-muted-foreground shrink-0">
                  {result.error ? result.error : `${result.status} – ${result.responseTimeMs}ms`}
                </span>
              </div>

              {result.pageTitle && (
                <p className="text-xs text-muted-foreground mb-2">
                  Title: {result.pageTitle}
                </p>
              )}

              <div className="grid gap-2">
                {selectors.map((sel) => {
                  const cr = result.checks.find((c) => c.selectorCheckId === sel.id)
                  if (!cr) return null
                  return (
                    <div key={sel.id} className="text-sm flex items-start gap-2">
                      <span className={cr.found ? 'text-success shrink-0' : 'text-destructive shrink-0'}>
                        {cr.found ? '✓' : '✗'}
                      </span>
                      <div>
                        <span className="font-medium">{sel.label}</span>
                        <span className="text-muted-foreground ml-2 font-mono text-xs">{sel.selector}</span>
                        {cr.found && (
                          <span className="text-muted-foreground ml-2">
                            (found {cr.count} time{cr.count !== 1 ? 's' : ''})
                          </span>
                        )}
                        {cr.found && cr.textContent && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[600px]" title={cr.textContent}>
                            {cr.textContent}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Title</th>
                {selectors.map((sel) => (
                  <th key={sel.id} className="px-3 py-2 font-medium" title={sel.selector}>
                    {sel.label || sel.selector}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedResults.map((result, i) => (
                <tr key={i} className={`hover:bg-muted/30 ${result.error ? 'bg-destructive/5' : result.checks.every((c) => c.found) ? '' : 'bg-warning/5'}`}>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => openUrl(result.url)}
                      className="font-mono text-xs hover:text-primary hover:underline truncate max-w-[300px] block"
                    >
                      {result.url}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {result.error ? (
                      <span className="text-destructive">Error</span>
                    ) : (
                      result.status
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{result.responseTimeMs}ms</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]" title={result.pageTitle}>
                    {result.pageTitle}
                  </td>
                  {selectors.map((sel) => {
                    const cr = result.checks.find((c) => c.selectorCheckId === sel.id)
                    return (
                      <td key={sel.id} className="px-3 py-2 text-xs">
                        {!cr ? (
                          <span className="text-muted-foreground">—</span>
                        ) : cr.found ? (
                          <span className="text-success" title={cr.textContent ?? undefined}>
                            ✓{cr.count > 1 ? ` (${cr.count})` : ''}
                          </span>
                        ) : (
                          <span className="text-destructive">✗</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
