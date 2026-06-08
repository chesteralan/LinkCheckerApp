import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { getRunResults } from '@/lib/tauri'
import { openUrl } from '@tauri-apps/plugin-opener'
import { VirtualList } from '@/components/VirtualList'
import type { AuditRun, SelectorCheck, PageResult } from '@/types'

const ITEM_HEIGHT_DETAILED = 100
const ITEM_HEIGHT_TABLE = 42

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { audits, targetLists, checkTemplates } = useStore()
  const [run, setRun] = useState<AuditRun | null>(null)
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errored'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'detailed' | 'table'>('detailed')

  useEffect(() => {
    if (runId) {
      getRunResults(runId)
        .then(setRun)
        .catch(() => setRun(null))
    }
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
    if (filter === 'passed' && (r.error || !r.checks.every((c) => c.found))) return false
    if (filter === 'failed' && (r.error || !r.checks.some((c) => !c.found))) return false
    if (filter === 'errored' && !r.error) return false
    if (searchQuery) {
      const text = JSON.stringify(r).toLowerCase()
      if (!text.includes(searchQuery.toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/history')} className="text-sm text-primary hover:underline">
            &larr; History
          </button>
          <h2 className="text-2xl font-bold">{audit?.name ?? 'Quick Audit'}</h2>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            run.status === 'completed'
              ? 'bg-success/10 text-success'
              : run.status === 'cancelled'
                ? 'bg-warning/10 text-warning'
                : run.status === 'running'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-destructive/10 text-destructive'
          }`}
        >
          {run.status}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Run at {date}</span>
          <span>
            {run.results.length} URL{run.results.length !== 1 ? 's' : ''}
          </span>
          {tl && (
            <span>
              {tl.urls.length} target{tl.urls.length !== 1 ? 's' : ''}
            </span>
          )}
          {ct && (
            <span>
              {ct.checks.length} selector{ct.checks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

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
        <input
          type="text"
          placeholder="Filter by any value..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary w-64"
        />
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <button
          onClick={() => setFilter(filter === 'passed' ? 'all' : 'passed')}
          className={`${filter === 'passed' ? 'underline font-medium' : ''} text-success hover:underline`}
        >
          ✓ passed {displayedResults.filter((r) => !r.error && r.checks.every((c) => c.found)).length}
        </button>
        <button
          onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
          className={`${filter === 'failed' ? 'underline font-medium' : ''} text-destructive hover:underline`}
        >
          ✗ failed {displayedResults.filter((r) => !r.error && r.checks.some((c) => !c.found)).length}
        </button>
        <button
          onClick={() => setFilter(filter === 'errored' ? 'all' : 'errored')}
          className={`${filter === 'errored' ? 'underline font-medium' : ''} text-muted-foreground hover:underline`}
        >
          ⚠ errored {displayedResults.filter((r) => r.error).length}
        </button>
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="text-xs text-primary hover:underline">
            clear filter
          </button>
        )}
      </div>

      {view === 'detailed' ? (
        displayedResults.length > 0 ? (
          <VirtualList<PageResult>
            items={displayedResults}
            itemHeight={ITEM_HEIGHT_DETAILED}
            className="overflow-y-auto h-full space-y-2"
            renderItem={(result) => (
              <div key={result.url} className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`w-2 h-2 shrink-0 rounded-full ${
                        result.error
                          ? 'bg-destructive'
                          : result.checks.every((c) => c.found)
                            ? 'bg-success'
                            : 'bg-destructive'
                      }`}
                    />
                    <button
                      onClick={() => openUrl(result.url)}
                      className="text-sm font-mono text-primary hover:underline truncate cursor-pointer"
                      title={result.url}
                    >
                      {result.url}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {result.status &&
                      (result.error ? (
                        <span className="text-xs text-destructive">Error</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{result.status}</span>
                      ))}
                    {result.responseTimeMs != null && (
                      <span className="text-xs text-muted-foreground">{result.responseTimeMs}ms</span>
                    )}
                  </div>
                </div>
                {result.error && <p className="text-xs text-destructive">{result.error}</p>}
                {result.pageTitle && <p className="text-xs text-muted-foreground">{result.pageTitle}</p>}
                {result.checks.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {result.checks.map((cr) => (
                      <span
                        key={cr.selectorCheckId}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                          cr.found ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        <span>{cr.found ? '✓' : '✗'}</span>
                        <span>{cr.label}</span>
                        {cr.textContent && <span className="opacity-70">— {cr.textContent}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No results match the current filter.</p>
        )
      ) : (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium w-64 resize-x overflow-hidden">URL</th>
                <th className="px-3 py-2 font-medium w-20 resize-x overflow-hidden">Status</th>
                <th className="px-3 py-2 font-medium w-20 resize-x overflow-hidden">Time</th>
                <th className="px-3 py-2 font-medium w-48 resize-x overflow-hidden">Title</th>
                {selectors.map((sel) => (
                  <th key={sel.id} className="px-3 py-2 font-medium min-w-24 resize-x overflow-hidden">
                    {sel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayedResults.length > 0 ? (
                <VirtualList<PageResult>
                  items={displayedResults}
                  itemHeight={ITEM_HEIGHT_TABLE}
                  renderItem={(result) => (
                    <tr key={result.url} className="hover:bg-muted/30" style={{ height: ITEM_HEIGHT_TABLE }}>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => openUrl(result.url)}
                          className="text-primary hover:underline text-xs font-mono truncate max-w-[300px] block"
                          title={result.url}
                        >
                          {result.url}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {result.error ? <span className="text-destructive">Error</span> : result.status}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{result.responseTimeMs}ms</td>
                      <td
                        className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]"
                        title={result.pageTitle ?? undefined}
                      >
                        {result.pageTitle ?? '—'}
                      </td>
                      {selectors.map((sel) => {
                        const cr = result.checks.find((c) => c.selectorCheckId === sel.id)
                        return (
                          <td key={sel.id} className="px-3 py-2 text-xs">
                            {!cr ? (
                              <span className="text-muted-foreground">—</span>
                            ) : cr.found ? (
                              <span className="text-success">
                                ✓
                                {cr.textContent ? (
                                  <span className="text-muted-foreground ml-1">({cr.textContent})</span>
                                ) : (
                                  ''
                                )}
                              </span>
                            ) : (
                              <span className="text-destructive">
                                ✗
                                {cr.textContent ? (
                                  <span className="text-muted-foreground ml-1">({cr.textContent})</span>
                                ) : (
                                  ''
                                )}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )}
                />
              ) : (
                <tr>
                  <td colSpan={4 + selectors.length} className="p-4 text-sm text-muted-foreground">
                    No results match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
