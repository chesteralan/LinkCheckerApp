import { useEffect, useState } from 'react'
import { useStore } from '@/hooks/useStore'
import { listAllRuns, clearHistory } from '@/lib/tauri'
import type { AuditRun } from '@/types'

export function RunHistoryPage() {
  const { audits, targetLists, checkTemplates } = useStore()
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true)
    listAllRuns()
      .then(setRuns)
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function handleClear() {
    await clearHistory()
    setRuns([])
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (runs.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Run History</h2>
        <p className="text-muted-foreground text-sm">No runs yet. Run an audit to see results here.</p>
      </div>
    )
  }

  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Run History</h2>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
        >
          Clear History
        </button>
      </div>

      <div className="space-y-3">
        {sorted.map((run) => {
          const audit = audits.find((a) => a.id === run.auditId)
          const tl = targetLists.find((t) => t.id === audit?.targetListId)
          const ct = checkTemplates.find((c) => c.id === audit?.checkTemplateId)
          const date = new Date(run.startedAt).toLocaleString()

          return (
            <div key={run.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{audit?.name ?? 'Unknown audit'}</h3>
                  <p className="text-sm text-muted-foreground">
                    {tl?.name ?? '?'} → {ct?.name ?? '?'}
                  </p>
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

              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <span className="text-muted-foreground">{date}</span>
                <span>{run.results.length} URLs</span>
                <span className="text-success">✓ {run.summary.passed}</span>
                <span className="text-destructive">✗ {run.summary.failed}</span>
                <span className="text-muted-foreground">⚠ {run.summary.errored}</span>
                {run.summary.avgResponseTimeMs > 0 && (
                  <span className="text-muted-foreground">
                    avg {Math.round(run.summary.avgResponseTimeMs)}ms
                  </span>
                )}
              </div>

              {run.results.length > 0 && (
                <details className="mt-3">
                  <summary className="text-sm text-primary cursor-pointer hover:underline">
                    Show details
                  </summary>
                  <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
                    {run.results.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm py-1 px-2 rounded hover:bg-muted/30">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          r.error ? 'bg-destructive' :
                          r.checks.every((c) => c.found) ? 'bg-success' :
                          'bg-warning'
                        }`} />
                        <span className="font-mono text-xs truncate flex-1">{r.url}</span>
                        {r.status && <span className="text-muted-foreground">{r.status}</span>}
                        {r.responseTimeMs != null && (
                          <span className="text-muted-foreground">{r.responseTimeMs}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
