import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRunResults } from '@/lib/tauri'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { AuditRun, PageResult } from '@/types'

function keyForUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search + u.hash
  } catch {
    return url
  }
}

function compareRuns(a: AuditRun, b: AuditRun) {
  const mapA = new Map(a.results.map((r) => [keyForUrl(r.url), r]))
  const mapB = new Map(b.results.map((r) => [keyForUrl(r.url), r]))

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()])
  const added: { url: string; result: PageResult }[] = []
  const removed: { url: string; result: PageResult }[] = []
  const regressions: { url: string; from: PageResult; to: PageResult }[] = []
  const improvements: { url: string; from: PageResult; to: PageResult }[] = []
  const unchanged: { url: string; result: PageResult }[] = []

  for (const key of allKeys) {
    const rA = mapA.get(key)
    const rB = mapB.get(key)

    if (!rA && rB) {
      addOrPush(key, rB, added, removed, regressions, improvements, unchanged, 'added')
    } else if (rA && !rB) {
      addOrPush(key, rA, added, removed, regressions, improvements, unchanged, 'removed')
    } else if (rA && rB) {
      const passedA = !rA.error && rA.checks.every((c) => c.found)
      const passedB = !rB.error && rB.checks.every((c) => c.found)
      if (passedA && !passedB) {
        regressions.push({ url: rA.url, from: rA, to: rB })
      } else if (!passedA && passedB) {
        improvements.push({ url: rA.url, from: rA, to: rB })
      } else {
        unchanged.push({ url: rA.url, result: rA })
      }
    }
  }

  return { added, removed, regressions, improvements, unchanged }
}

function addOrPush(
  _key: string,
  result: PageResult,
  added: { url: string; result: PageResult }[],
  removed: { url: string; result: PageResult }[],
  _regressions: { url: string; from: PageResult; to: PageResult }[],
  _improvements: { url: string; from: PageResult; to: PageResult }[],
  _unchanged: { url: string; result: PageResult }[],
  type: 'added' | 'removed',
) {
  if (type === 'added') added.push({ url: result.url, result })
  else removed.push({ url: result.url, result })
}

export function RunDiffPage() {
  const { runIdA, runIdB } = useParams<{ runIdA: string; runIdB: string }>()
  const navigate = useNavigate()
  const [runA, setRunA] = useState<AuditRun | null>(null)
  const [runB, setRunB] = useState<AuditRun | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!runIdA || !runIdB) return
    Promise.all([getRunResults(runIdA), getRunResults(runIdB)])
      .then(([a, b]) => {
        setRunA(a)
        setRunB(b)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [runIdA, runIdB])

  if (loading) return <div className="text-muted-foreground">Loading...</div>
  if (!runA || !runB) return <div className="text-muted-foreground">Could not load runs.</div>

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
          <span className="font-medium text-foreground">Run A:</span>{' '}
          {new Date(runA.startedAt).toLocaleString()} ({runA.results.length} URLs)
        </div>
        <div>
          <span className="font-medium text-foreground">Run B:</span>{' '}
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
        <span className="text-muted-foreground">{diff.unchanged.length} unchanged</span>
      </div>

      {diff.regressions.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-destructive mb-2">
            Regressions ({diff.regressions.length})
          </h3>
          <div className="space-y-2">
            {diff.regressions.map((r) => (
              <DiffCard
                key={r.url}
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
                key={r.url}
                url={r.url}
                a={r.from}
                b={r.to}
                type="improvement"
              />
            ))}
          </div>
        </section>
      )}
    </div>
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
  type: 'regression' | 'improvement'
}) {
  const colorClass = type === 'regression' ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5'

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${colorClass}`}>
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => openUrl(url)}
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
          <span className="font-medium text-muted-foreground">Run A</span>
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
          <span className="font-medium text-muted-foreground">Run B</span>
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
