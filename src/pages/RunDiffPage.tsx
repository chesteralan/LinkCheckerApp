import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRunResults } from '@/lib/tauri'
import { openExternal } from '@/lib/openExternal'
import type { AuditRun, PageResult } from '@/types'
import { compareRuns, orderRunsByTime, pageOutcome, type DiffSingle } from '@/utils/runDiff'

export function RunDiffPage() {
  const { runIdA, runIdB } = useParams<{ runIdA: string; runIdB: string }>()
  const navigate = useNavigate()
  const pairKey = `${runIdA}/${runIdB}`
  const [loaded, setLoaded] = useState<{
    key: string
    runs: [AuditRun, AuditRun] | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!runIdA || !runIdB) return
    let active = true
    const key = `${runIdA}/${runIdB}`
    Promise.all([getRunResults(runIdA), getRunResults(runIdB)])
      .then(([a, b]) => {
        // Always diff older -> newer, whatever order the runs were selected in (A-23).
        if (active) setLoaded({ key, runs: orderRunsByTime(a, b), error: null })
      })
      .catch((e) => {
        if (active) setLoaded({ key, runs: null, error: String(e) })
      })
    return () => {
      active = false
    }
  }, [runIdA, runIdB])

  if (loaded?.key !== pairKey) return <div className="text-muted-foreground">Loading...</div>
  const [runA, runB] = loaded.runs ?? [null, null]
  const error = loaded.error
  if (error || !runA || !runB)
    return (
      <div className="space-y-2">
        <p className="text-destructive text-sm">Could not load runs{error ? `: ${error}` : '.'}</p>
        <button onClick={() => navigate('/history')} className="text-sm text-primary hover:underline">
          &larr; History
        </button>
      </div>
    )

  const diff = compareRuns(runA, runB)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/history')} className="text-sm text-primary hover:underline">
          &larr; History
        </button>
        <h2 className="text-2xl font-bold">Run Diff</h2>
      </div>

      <div className="flex items-center gap-6 text-sm text-muted-foreground border border-border rounded-lg p-4">
        <div>
          <span className="font-medium text-foreground">Before:</span>{' '}
          {new Date(runA.startedAt).toLocaleString()} ({runA.results.length} URLs)
        </div>
        <div>
          <span className="font-medium text-foreground">After:</span>{' '}
          {new Date(runB.startedAt).toLocaleString()} ({runB.results.length} URLs)
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {diff.regressions.length > 0 && (
          <span className="text-destructive font-medium">✗ {diff.regressions.length} regressions</span>
        )}
        {diff.improvements.length > 0 && (
          <span className="text-success font-medium">✓ {diff.improvements.length} improvements</span>
        )}
        {diff.added.length > 0 && (
          <span className="text-muted-foreground">+{diff.added.length} new URLs</span>
        )}
        {diff.removed.length > 0 && (
          <span className="text-muted-foreground">-{diff.removed.length} removed URLs</span>
        )}
        {diff.changed.length > 0 && <span className="text-warning font-medium">~{diff.changed.length} changed</span>}
        <span className="text-muted-foreground">{diff.unchanged.length} unchanged</span>
      </div>

      {diff.matchedByPath && (
        <p className="text-xs text-muted-foreground">
          The runs used different origins, so pages are matched by path, query and fragment.
        </p>
      )}

      {diff.regressions.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-destructive mb-2">
            Regressions ({diff.regressions.length})
          </h3>
          <div className="space-y-2">
            {diff.regressions.map((r) => (
              <DiffCard
                key={r.key}
                url={r.url}
                a={r.from}
                b={r.to}
                type="regression"
              />
            ))}
          </div>
        </section>
      )}

      {diff.improvements.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-success mb-2">
            Improvements ({diff.improvements.length})
          </h3>
          <div className="space-y-2">
            {diff.improvements.map((r) => (
              <DiffCard
                key={r.key}
                url={r.url}
                a={r.from}
                b={r.to}
                type="improvement"
              />
            ))}
          </div>
        </section>
      )}

      {diff.changed.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-2">Changed ({diff.changed.length})</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Same pass/fail state, but the error or individual check results differ.
          </p>
          <div className="space-y-2">
            {diff.changed.map((r) => (
              <DiffCard key={r.key} url={r.url} a={r.from} b={r.to} type="changed" />
            ))}
          </div>
        </section>
      )}

      <UrlListSection title="New URLs" entries={diff.added} />
      <UrlListSection title="Removed URLs" entries={diff.removed} />
    </div>
  )
}

function UrlListSection({ title, entries }: { title: string; entries: DiffSingle[] }) {
  if (entries.length === 0) return null
  return (
    <section>
      <h3 className="text-lg font-semibold mb-2">
        {title} ({entries.length})
      </h3>
      <ul className="border border-border rounded-lg divide-y divide-border text-sm">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center justify-between gap-4 px-4 py-2">
            <button
              onClick={() => openExternal(e.url)}
              className="font-mono text-primary hover:underline truncate text-left"
              title={e.url}
            >
              {e.url}
            </button>
            <span className="text-xs text-muted-foreground shrink-0">
              {pageOutcome(e.result)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DiffCard({
  url,
  a,
  b,
  type,
}: {
  url: string
  a: PageResult
  b: PageResult
  type: 'regression' | 'improvement' | 'changed'
}) {
  const colorClass =
    type === 'regression'
      ? 'border-destructive/30 bg-destructive/5'
      : type === 'improvement'
        ? 'border-success/30 bg-success/5'
        : 'border-border'

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${colorClass}`}>
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => openExternal(url)}
          className="text-sm font-mono text-primary hover:underline truncate cursor-pointer"
          title={url}
        >
          {url}
        </button>
        <span className="text-xs text-muted-foreground shrink-0">
          {a.responseTimeMs ?? '?'}ms → {b.responseTimeMs ?? '?'}ms
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <span className="font-medium text-muted-foreground">Before</span>
          {a.error ? (
            <p className="text-destructive mt-1">{a.error}</p>
          ) : (
            <div className="mt-1 space-y-1">
              {a.checks.map((c) => (
                <span
                  key={c.selectorCheckId}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full mr-1 ${
                    c.found ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {c.found ? '✓' : '✗'} {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div>
          <span className="font-medium text-muted-foreground">After</span>
          {b.error ? (
            <p className="text-destructive mt-1">{b.error}</p>
          ) : (
            <div className="mt-1 space-y-1">
              {b.checks.map((c) => (
                <span
                  key={c.selectorCheckId}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full mr-1 ${
                    c.found ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {c.found ? '✓' : '✗'} {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
