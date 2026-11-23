import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { getRunResults, saveTextFile } from '@/lib/tauri'
import { openExternal } from '@/lib/openExternal'
import { VirtualList, VirtualTable } from '@/components/VirtualList'
import { Modal } from '@/components/Modal'
import { A11yIssuesList } from '@/components/A11yIssuesList'
import { toCsv } from '@/utils/csv'
import { pageOutcome } from '@/utils/runDiff'
import type { AuditRun, SelectorCheck, PageResult, A11yIssue } from '@/types'

const ITEM_HEIGHT_DETAILED = 100
const ITEM_HEIGHT_TABLE = 42

const resultKey = (r: PageResult, i: number) => `${i}:${r.url}`

/** CSV export of a run: one row per (page, check), or one row for a page without checks. */
function runToCsv(run: AuditRun): string {
  const header = ['URL', 'Page Title', 'Status', 'Status Text', 'Response Time (ms)', 'Error', 'Check Label', 'Check Type', 'Found', 'Count']
  const rows = run.results.flatMap((r) => {
    const base = [r.url, r.pageTitle, r.status, r.statusText, r.responseTimeMs, r.error]
    return r.checks.length > 0
      ? r.checks.map((c) => [...base, c.label, c.checkType, c.found, c.count])
      : [[...base, '', '', '', '']]
  })
  return toCsv(header, rows)
}

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { audits, targetLists, checkTemplates, createCheckTemplate, updateAudit } = useStore()
  // Keyed by runId so a new :runId shows "Loading" until its own fetch settles (A-65).
  const [loaded, setLoaded] = useState<{ runId: string; run: AuditRun | null; error: string | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingBaseline, setSavingBaseline] = useState(false)
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errored'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'detailed' | 'table'>('detailed')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [expandedA11y, setExpandedA11y] = useState<string | null>(null)
  const [a11yModal, setA11yModal] = useState<{ title: string; issues: A11yIssue[] } | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!runId) return
    let active = true
    getRunResults(runId)
      .then((r) => {
        if (active) setLoaded({ runId, run: r, error: null })
      })
      .catch((e) => {
        if (active) setLoaded({ runId, run: null, error: String(e) })
      })
    return () => {
      active = false
    }
  }, [runId])

  const renderDetailed = useCallback(
    (result: PageResult) => (
      <DetailedResult
        result={result}
        expandedA11y={expandedA11y}
        onToggleA11y={(key) => setExpandedA11y((cur) => (cur === key ? null : key))}
      />
    ),
    [expandedA11y],
  )

  const run = loaded && loaded.runId === runId ? loaded.run : null
  const loadError = loaded && loaded.runId === runId ? loaded.error : null

  if (runId && loaded?.runId !== runId) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!run) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load this run{loadError ? `: ${loadError}` : '.'}
        </p>
        <button onClick={() => navigate('/history')} className="text-sm text-primary hover:underline">
          &larr; History
        </button>
      </div>
    )
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
        selectors.push({
          id: cr.selectorCheckId,
          selector: cr.selector,
          label: cr.label,
          checkType: cr.checkType,
        })
      }
    }
  }

  // Counters come from the whole run, not the filtered view (A-66).
  const counts = { passed: 0, failed: 0, errored: 0 }
  for (const r of run.results) counts[pageOutcome(r)]++

  const displayedResults = run.results.filter((r) => {
    if (filter !== 'all' && pageOutcome(r) !== filter) return false
    if (searchQuery) {
      const text = JSON.stringify(r).toLowerCase()
      if (!text.includes(searchQuery.toLowerCase())) return false
    }
    return true
  })

  async function handleExport(format: 'json' | 'csv') {
    setShowExportMenu(false)
    if (!run) return
    const ext = format === 'json' ? 'json' : 'csv'
    const content = format === 'json' ? JSON.stringify(run, null, 2) : runToCsv(run)
    setActionError(null)
    try {
      await saveTextFile({
        defaultName: `${audit?.name ?? 'run'}-${run.id}.${ext}`,
        content,
        filterName: format.toUpperCase(),
        extensions: [ext],
      })
    } catch (e) {
      setActionError(`Export failed: ${String(e)}`)
    }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim() || selectors.length === 0) return
    setActionError(null)
    try {
      const created = await createCheckTemplate(templateName.trim(), selectors)
      setShowSaveTemplate(false)
      setTemplateName('')
      navigate(`/check-templates/${created.id}`)
    } catch (e) {
      setActionError(`Could not create the template: ${String(e)}`)
    }
  }

  async function handleSetBaseline() {
    if (!audit || !run) return
    const isBaseline = audit.baselineRunId === run.id
    setSavingBaseline(true)
    setActionError(null)
    try {
      // Through the store so every page sees the new baseline (A-30).
      await updateAudit(audit.id, { baselineRunId: isBaseline ? null : run.id })
    } catch (e) {
      setActionError(`Could not update the baseline: ${String(e)}`)
    } finally {
      setSavingBaseline(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/history')} className="text-sm text-primary hover:underline">
            &larr; History
          </button>
          <h2 className="text-2xl font-bold">{audit?.name ?? 'Quick Audit'}</h2>
        </div>
        <div className="flex items-center gap-2">
          {selectors.length > 0 && (
            <button
              onClick={() => {
                setTemplateName((audit?.name ?? 'Quick Audit') + ' - Template')
                setShowSaveTemplate(true)
              }}
              className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
            >
              Save as Template
            </button>
          )}
          {audit && (
            <button
              onClick={handleSetBaseline}
              disabled={savingBaseline}
              aria-pressed={audit.baselineRunId === run.id}
              title={audit.baselineRunId === run.id ? 'Click to clear the baseline' : undefined}
              className={`text-xs px-3 py-1 border rounded-md transition-colors ${
                audit.baselineRunId === run.id
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-border hover:bg-muted'
              }`}
            >
              {audit.baselineRunId === run.id ? (
                <>
                  <span aria-hidden="true">★ </span>Baseline
                </>
              ) : (
                'Set as Baseline'
              )}
            </button>
          )}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              aria-haspopup="menu"
              aria-expanded={showExportMenu}
              className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
            >
              Export
            </button>
            {showExportMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-lg z-50 min-w-[100px]"
              >
                <button
                  role="menuitem"
                  onClick={() => handleExport('json')}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  JSON
                </button>
                <button
                  role="menuitem"
                  onClick={() => handleExport('csv')}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                >
                  CSV
                </button>
              </div>
            )}
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
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

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
          aria-pressed={view === 'detailed'}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${view === 'detailed' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          Detailed
        </button>
        <button
          onClick={() => setView('table')}
          aria-pressed={view === 'table'}
          className={`px-3 py-1 text-xs rounded-md border transition-colors ${view === 'table' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          Table
        </button>
        <input
          type="text"
          placeholder="Filter by any value..."
          aria-label="Filter results by any value"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ml-auto px-3 py-1.5 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary w-64"
        />
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <button
          onClick={() => setFilter(filter === 'passed' ? 'all' : 'passed')}
          aria-pressed={filter === 'passed'}
          className={`${filter === 'passed' ? 'underline font-medium' : ''} text-success hover:underline`}
        >
          <span aria-hidden="true">✓ </span>passed {counts.passed}
        </button>
        <button
          onClick={() => setFilter(filter === 'failed' ? 'all' : 'failed')}
          aria-pressed={filter === 'failed'}
          className={`${filter === 'failed' ? 'underline font-medium' : ''} text-destructive hover:underline`}
        >
          <span aria-hidden="true">✗ </span>failed {counts.failed}
        </button>
        <button
          onClick={() => setFilter(filter === 'errored' ? 'all' : 'errored')}
          aria-pressed={filter === 'errored'}
          className={`${filter === 'errored' ? 'underline font-medium' : ''} text-muted-foreground hover:underline`}
        >
          <span aria-hidden="true">⚠ </span>errored {counts.errored}
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
            getKey={resultKey}
            estimateHeight={ITEM_HEIGHT_DETAILED}
            className="max-h-[70vh] overflow-y-auto"
            itemClassName="pb-2"
            renderItem={renderDetailed}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No results match the current filter.</p>
        )
      ) : (
        <VirtualTable<PageResult>
          items={displayedResults}
          getKey={resultKey}
          estimateRowHeight={ITEM_HEIGHT_TABLE}
          colSpan={4 + selectors.length}
          className="border border-border rounded-lg overflow-auto max-h-[70vh]"
          tableClassName="w-full text-sm"
          tableStyle={{ tableLayout: 'fixed' }}
          tbodyClassName="divide-y divide-border"
          header={
            <thead className="sticky top-0 z-10 bg-background">
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
          }
          empty={
            <tr>
              <td colSpan={4 + selectors.length} className="p-4 text-sm text-muted-foreground">
                No results match the current filter.
              </td>
            </tr>
          }
          renderRow={(result, index, rowProps) => (
            <tr key={resultKey(result, index)} {...rowProps} className="hover:bg-muted/30">
              <td className="px-3 py-2">
                <button
                  onClick={() => openExternal(result.url)}
                  className="text-primary hover:underline text-xs font-mono truncate max-w-[300px] block"
                  title={result.url}
                >
                  {result.url}
                </button>
              </td>
              <td className="px-3 py-2 text-xs">
                {result.error ? <span className="text-destructive">Error</span> : result.status}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {result.responseTimeMs != null ? `${result.responseTimeMs}ms` : '—'}
              </td>
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
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">Not checked</span>
                      </span>
                    ) : cr.found ? (
                      <span className="text-success">
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">Found</span>
                        {cr.textContent ? <span className="text-muted-foreground ml-1">({cr.textContent})</span> : ''}
                      </span>
                    ) : cr.checkType === 'accessibility' && cr.a11yIssues && cr.a11yIssues.length > 0 ? (
                      <button
                        onClick={() => setA11yModal({ title: `${result.url} — ${cr.label}`, issues: cr.a11yIssues })}
                        className="text-destructive hover:underline"
                        title="View accessibility issues"
                      >
                        <span aria-hidden="true">✗ </span>
                        {cr.a11yIssues.length} issue{cr.a11yIssues.length > 1 ? 's' : ''}
                      </button>
                    ) : (
                      <span className="text-destructive">
                        <span aria-hidden="true">✗</span>
                        <span className="sr-only">Not found</span>
                        {cr.textContent ? <span className="text-muted-foreground ml-1">({cr.textContent})</span> : ''}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          )}
        />
      )}

      <Modal
        open={a11yModal !== null}
        onClose={() => setA11yModal(null)}
        title={a11yModal?.title ?? 'Accessibility Issues'}
      >
        {a11yModal && <A11yIssuesList issues={a11yModal.issues} maxHeight="400px" />}
      </Modal>

      <Modal open={showSaveTemplate} onClose={() => setShowSaveTemplate(false)} title="Save as Check Template">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Template name"
            aria-label="Template name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground">
            Template will include {selectors.length} check{selectors.length !== 1 ? 's' : ''} from this run.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSaveTemplate}
              disabled={!templateName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Create Template
            </button>
            <button
              onClick={() => setShowSaveTemplate(false)}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function DetailedResult({
  result,
  expandedA11y,
  onToggleA11y,
}: {
  result: PageResult
  expandedA11y: string | null
  onToggleA11y: (key: string) => void
}) {
  const outcome = pageOutcome(result)
  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`w-2 h-2 shrink-0 rounded-full ${outcome === 'passed' ? 'bg-success' : 'bg-destructive'}`}
            aria-hidden="true"
          />
          <span className="sr-only">{outcome}:</span>
          <button
            onClick={() => openExternal(result.url)}
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
          {result.checks.map((cr) => {
            const key = `${result.url}::${cr.selectorCheckId}`
            return (
              <span
                key={cr.selectorCheckId}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
                  cr.found ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                }`}
              >
                <span aria-hidden="true">{cr.found ? '✓' : '✗'}</span>
                <span className="sr-only">{cr.found ? 'Found:' : 'Not found:'}</span>
                <span>{cr.label}</span>
                <span className="opacity-50 text-[10px] uppercase">{cr.checkType}</span>
                {cr.textContent && <span className="opacity-70">— {cr.textContent}</span>}
                {cr.checkType === 'accessibility' && cr.a11yIssues && cr.a11yIssues.length > 0 && (
                  <button
                    onClick={() => onToggleA11y(key)}
                    aria-expanded={expandedA11y === key}
                    className="ml-1 text-[10px] text-primary hover:underline"
                  >
                    {cr.a11yIssues.length} issue{cr.a11yIssues.length > 1 ? 's' : ''}
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {expandedA11y?.startsWith(`${result.url}::`) &&
        (() => {
          const checkId = expandedA11y.slice(result.url.length + 2)
          const cr = result.checks.find((c) => c.selectorCheckId === checkId)
          return cr?.a11yIssues && cr.a11yIssues.length > 0 ? (
            <div className="pt-1">
              <p className="text-[10px] text-muted-foreground mb-1">{cr.label}</p>
              <A11yIssuesList issues={cr.a11yIssues} maxHeight="260px" />
            </div>
          ) : null
        })()}
    </div>
  )
}
