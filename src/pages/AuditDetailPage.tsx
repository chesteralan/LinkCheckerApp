import { useId, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useRun } from '@/hooks/useRun'
import { useHotkeys } from '@/hooks/useHotkeys'
import { ProgressBar } from '@/components/ProgressBar'
import { ResultsTable } from '@/components/ResultsTable'
import { LiveSummary } from '@/components/LiveSummary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { saveTextFile } from '@/lib/tauri'
import { toCsv } from '@/utils/csv'
import { pageOutcome } from '@/utils/runDiff'
import { TrendsChart } from '@/components/TrendsChart'
import type { Audit, AuditRun } from '@/types'

type AuditTab = 'overview' | 'results' | 'trends'

const TABS: { id: AuditTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'results', label: 'Results' },
  { id: 'trends', label: 'Trends' },
]

/**
 * Waits for the store, then mounts the detail view keyed by audit id, so moving
 * between audits never carries edits or run options over (A-24, A-26).
 */
export function AuditDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { audits, loading } = useStore()
  if (loading) return <div className="text-muted-foreground">Loading...</div>
  const audit = audits.find((a) => a.id === id)
  if (!audit) return <div className="text-muted-foreground">Audit not found.</div>
  return <AuditDetail key={audit.id} audit={audit} />
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function AuditDetail({ audit }: { audit: Audit }) {
  const navigate = useNavigate()
  const { targetLists, checkTemplates, updateAudit, deleteAudit } = useStore()
  const runner = useRun()
  const formId = useId()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(audit?.name ?? '')
  const [editMode, setEditMode] = useState<'sequential' | 'batch'>((audit?.config.mode as 'sequential' | 'batch') ?? 'batch')
  const [editBatchSize, setEditBatchSize] = useState(audit?.config.batchSize ?? 5)
  const [editTimeoutSecs, setEditTimeoutSecs] = useState(audit?.config.timeoutSecs ?? 10)
  const [editHeaders, setEditHeaders] = useState<Record<string, string>>(audit?.config.headers ?? {})
  const [editHeaderKey, setEditHeaderKey] = useState('')
  const [editHeaderVal, setEditHeaderVal] = useState('')
  const [editCookies, setEditCookies] = useState<{ key: string; value: string }[]>(audit?.config.cookies ?? [])
  const [editCookieKey, setEditCookieKey] = useState('')
  const [editCookieVal, setEditCookieVal] = useState('')
  const [editOriginOverride, setEditOriginOverride] = useState(audit?.originOverride ?? '')
  const [editUrlPostfix, setEditUrlPostfix] = useState(audit?.urlPostfix ?? '')
  const [originOverride, setOriginOverride] = useState(audit?.originOverride ?? '')
  const [urlPostfix, setUrlPostfix] = useState(audit?.urlPostfix ?? '')
  const [activeTab, setActiveTab] = useState<AuditTab>('overview')
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errored'>('all')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const a = audit
  const tl = targetLists.find((t) => t.id === a.targetListId)
  const ct = checkTemplates.find((c) => c.id === a.checkTemplateId)

  // The runner is global; only show its run here when it belongs to this audit (A-27).
  const runnerIsThisAudit = runner.ownerKey === `/audits/${a.id}`
  const thisRun = runnerIsThisAudit ? runner.run : null
  const thisRunning = runnerIsThisAudit && runner.running
  const otherRunning = runner.running && !runnerIsThisAudit

  function triggerRun() {
    if (runner.running) return
    setActiveTab('results')
    void runner.start(a.id, originOverride || undefined, urlPostfix || undefined)
  }

  useHotkeys(
    {
      'Mod+r': triggerRun,
      // Cmd/Ctrl+Enter submits the edit form (A-25).
      'Mod+Enter': () => {
        if (editing) void handleUpdate()
      },
    },
    true,
  )

  function startEdit() {
    setEditName(a.name)
    setEditMode(a.config.mode as 'sequential' | 'batch')
    setEditBatchSize(a.config.batchSize)
    setEditTimeoutSecs(a.config.timeoutSecs)
    setEditHeaders(a.config.headers ?? {})
    setEditHeaderKey('')
    setEditHeaderVal('')
    setEditCookies(a.config.cookies ?? [])
    setEditCookieKey('')
    setEditCookieVal('')
    setEditOriginOverride(a.originOverride ?? '')
    setEditUrlPostfix(a.urlPostfix ?? '')
    setActionError(null)
    setEditing(true)
  }

  async function handleUpdate() {
    if (!editName.trim() || saving) return
    setSaving(true)
    setActionError(null)
    try {
      await updateAudit(a.id, {
        name: editName.trim(),
        config: {
          mode: editMode,
          batchSize: Math.max(1, editBatchSize || 1),
          timeoutSecs: Math.max(1, editTimeoutSecs || 1),
          headers: editHeaders,
          cookies: editCookies,
        },
        // An empty string clears the value on the backend.
        originOverride: editOriginOverride.trim(),
        urlPostfix: editUrlPostfix.trim(),
      })
      setOriginOverride(editOriginOverride.trim())
      setUrlPostfix(editUrlPostfix.trim())
      setEditing(false)
    } catch (e) {
      setActionError(`Could not save the audit: ${errorText(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setConfirmDelete(false)
    setActionError(null)
    try {
      await deleteAudit(a.id)
      navigate('/audits')
    } catch (e) {
      setActionError(`Could not delete the audit: ${errorText(e)}`)
    }
  }

  async function handleClearBaseline() {
    setActionError(null)
    try {
      await updateAudit(a.id, { baselineRunId: null })
    } catch (e) {
      setActionError(`Could not clear the baseline: ${errorText(e)}`)
    }
  }

  async function exportCsv(run: AuditRun, selectors: { id: string; label: string; selector: string }[]) {
    const header = ['URL', 'Status', 'Response Time (ms)', 'Error', 'Page Title', ...selectors.map((s) => s.label)]
    const rows = run.results.map((r) => [
      r.url,
      r.status,
      r.responseTimeMs,
      r.error,
      r.pageTitle,
      ...selectors.map((sel) => {
        const cr = r.checks.find((c) => c.selectorCheckId === sel.id)
        return cr ? `${cr.found ? '✓' : '✗'}${cr.textContent ? ` (${cr.textContent})` : ''}` : '—'
      }),
    ])
    setActionError(null)
    try {
      await saveTextFile({
        defaultName: `${a.name}-${new Date().toISOString().slice(0, 10)}.csv`,
        content: toCsv(header, rows),
        filterName: 'CSV',
        extensions: ['csv'],
      })
    } catch (e) {
      setActionError(`Export failed: ${errorText(e)}`)
    }
  }

  const filteredResults = (thisRun?.results ?? []).filter((r) => filter === 'all' || pageOutcome(r) === filter)
  const runnerError = runnerIsThisAudit || !runner.running ? runner.error : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/audits')} className="text-sm text-primary hover:underline">
            &larr; Audits
          </button>
          <h2 className="text-2xl font-bold">{a.name}</h2>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        {tl?.name ?? 'Unknown'} · {tl?.urls.length ?? 0} URLs
        {' — '}
        {ct?.name ?? 'Unknown'} · {ct?.checks.length ?? 0} selectors
        {a.originOverride && (
          <>
            {' '}
            · Origin: <span className="font-mono text-xs">{a.originOverride}</span>
          </>
        )}
        {a.urlPostfix && (
          <>
            {' '}
            · Postfix: <span className="font-mono text-xs">{a.urlPostfix}</span>
          </>
        )}
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      {runnerError && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          <span>Run failed: {runnerError}</span>
          <button onClick={runner.clearError} className="text-xs underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

      {otherRunning && runner.runPagePath && (
        <p className="text-sm text-muted-foreground">
          Another run is in progress.{' '}
          <button onClick={() => navigate(runner.runPagePath!)} className="text-primary hover:underline">
            View running audit
          </button>
        </p>
      )}

      <div className="border-b border-border">
        <div className="flex" role="tablist" aria-label="Audit sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`${formId}-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`${formId}-panel`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.id === 'results' && thisRun ? ` (${thisRun.results.length})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`${formId}-panel`} aria-labelledby={`${formId}-tab-${activeTab}`}>
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="flex gap-2 justify-between items-center">
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleUpdate}
                    disabled={!editName.trim() || saving}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={startEdit}
                    className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-4 py-2 border border-destructive text-destructive rounded-md text-sm hover:bg-destructive/10 transition-colors"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!editing && (
              <div>
                {thisRunning ? (
                  <button
                    onClick={runner.cancel}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Cancel Run
                  </button>
                ) : (
                  <button
                    onClick={triggerRun}
                    disabled={otherRunning}
                    title={otherRunning ? 'Another run is in progress' : undefined}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Run Audit
                  </button>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-4 border border-border rounded-lg p-4 bg-muted/20">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label htmlFor={`${formId}-name`} className="text-sm text-muted-foreground block mb-1">Name</label>
                  <input
                    id={`${formId}-name`}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor={`${formId}-mode`} className="text-sm text-muted-foreground block mb-1">Mode</label>
                  <select
                    id={`${formId}-mode`}
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as 'sequential' | 'batch')}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="sequential">Sequential</option>
                    <option value="batch">Batch</option>
                  </select>
                </div>
                {editMode === 'batch' && (
                  <div>
                    <label htmlFor={`${formId}-batch`} className="text-sm text-muted-foreground block mb-1">Batch Size</label>
                    <input
                      id={`${formId}-batch`}
                      type="number"
                      min={1}
                      max={20}
                      value={editBatchSize}
                      onChange={(e) => setEditBatchSize(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor={`${formId}-timeout`} className="text-sm text-muted-foreground block mb-1">Timeout (s)</label>
                  <input
                    id={`${formId}-timeout`}
                    type="number"
                    min={1}
                    max={120}
                    value={editTimeoutSecs}
                    onChange={(e) => setEditTimeoutSecs(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor={`${formId}-edit-origin`} className="text-sm text-muted-foreground block mb-1">Origin Override</label>
                  <input
                    id={`${formId}-edit-origin`}
                    type="text"
                    placeholder="https://staging.example.com"
                    value={editOriginOverride}
                    onChange={(e) => setEditOriginOverride(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                  />
                </div>
                <div>
                  <label htmlFor={`${formId}-edit-postfix`} className="text-sm text-muted-foreground block mb-1">URL Postfix</label>
                  <input
                    id={`${formId}-edit-postfix`}
                    type="text"
                    placeholder="?utm_source=test"
                    value={editUrlPostfix}
                    onChange={(e) => setEditUrlPostfix(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                  />
                </div>
                </div>
                <div className="col-span-3 border border-border rounded-lg p-3">
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                      Custom Headers {Object.keys(editHeaders).length > 0 && `(${Object.keys(editHeaders).length})`}
                    </summary>
                    <div className="mt-3 space-y-2">
                      {Object.entries(editHeaders).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-primary">{k}</span>
                          <span className="text-muted-foreground">:</span>
                          <span className="flex-1 truncate">{v}</span>
                          <button
                            onClick={() => {
                              const next = { ...editHeaders }
                              delete next[k]
                              setEditHeaders(next)
                            }}
                            aria-label={`Remove header ${k}`}
                            className="text-destructive hover:underline shrink-0"
                          >
                            <span aria-hidden="true">✕</span>
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Header-Name"
                          aria-label="New header name"
                          value={editHeaderKey}
                          onChange={(e) => setEditHeaderKey(e.target.value)}
                          className="flex-1 px-2 py-1 border border-border rounded text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <input
                          type="text"
                          placeholder="Value"
                          aria-label="New header value"
                          value={editHeaderVal}
                          onChange={(e) => setEditHeaderVal(e.target.value)}
                          className="flex-1 px-2 py-1 border border-border rounded text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          onClick={() => {
                            if (!editHeaderKey.trim()) return
                            setEditHeaders((prev) => ({ ...prev, [editHeaderKey.trim()]: editHeaderVal }))
                            setEditHeaderKey('')
                            setEditHeaderVal('')
                          }}
                          className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
                        >
                          Add<span className="sr-only"> header</span>
                        </button>
                      </div>
                    </div>
                    </details>
                  </div>
                  <div className="col-span-3 border border-border rounded-lg p-3">
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                        Cookies {editCookies.length > 0 && `(${editCookies.length})`}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {editCookies.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-primary">{c.key}</span>
                            <span className="text-muted-foreground">=</span>
                            <span className="flex-1 truncate">{c.value}</span>
                            <button
                              onClick={() => setEditCookies((prev) => prev.filter((_, j) => j !== i))}
                              aria-label={`Remove cookie ${c.key}`}
                              className="text-destructive hover:underline shrink-0"
                            >
                              <span aria-hidden="true">✕</span>
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Name"
                            aria-label="New cookie name"
                            value={editCookieKey}
                            onChange={(e) => setEditCookieKey(e.target.value)}
                            className="flex-1 px-2 py-1 border border-border rounded text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            aria-label="New cookie value"
                            value={editCookieVal}
                            onChange={(e) => setEditCookieVal(e.target.value)}
                            className="flex-1 px-2 py-1 border border-border rounded text-xs bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            onClick={() => {
                              if (!editCookieKey.trim()) return
                              setEditCookies((prev) => [...prev, { key: editCookieKey.trim(), value: editCookieVal }])
                              setEditCookieKey('')
                              setEditCookieVal('')
                            }}
                            className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
                          >
                            Add<span className="sr-only"> cookie</span>
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
          ) : (
            <>
              {tl && (
                <div>
                  <h4 className="text-sm font-medium mb-1">URLs ({tl.urls.length})</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {tl.urls.map((url, i) => (
                      <div key={i} className="text-sm font-mono text-muted-foreground truncate">
                        {url}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ct && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Selectors to check</h4>
                  <div className="space-y-1">
                    {ct.checks.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm">
                        <code className="px-1.5 py-0.5 bg-muted rounded text-xs">{c.selector}</code>
                        <span className="text-muted-foreground">{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${formId}-run-origin`} className="text-sm text-muted-foreground block mb-1">Origin Override (optional)</label>
                    <input
                      id={`${formId}-run-origin`}
                      type="text"
                      placeholder="https://staging.example.com"
                      value={originOverride}
                      onChange={(e) => setOriginOverride(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${formId}-run-postfix`} className="text-sm text-muted-foreground block mb-1">URL Postfix (optional)</label>
                    <input
                      id={`${formId}-run-postfix`}
                      type="text"
                      placeholder="?utm_source=test"
                      value={urlPostfix}
                      onChange={(e) => setUrlPostfix(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
              {a?.baselineRunId && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Baseline run: </span>
                  <button
                    onClick={() => navigate(`/history/${a.baselineRunId}`)}
                    className="text-primary underline hover:no-underline"
                  >
                    {a.baselineRunId.slice(0, 8)}…
                  </button>
                  <button
                    onClick={handleClearBaseline}
                    className="ml-2 text-xs text-destructive hover:underline"
                  >
                    Clear<span className="sr-only"> baseline</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div className="space-y-4">
          {thisRunning && runner.progress && (
            <ProgressBar checked={runner.progress.checked} total={runner.progress.total} />
          )}

          {thisRunning && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                Running...
              </div>
              <button
                onClick={runner.cancel}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {(thisRun || thisRunning) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <LiveSummary results={thisRun?.results ?? []} filter={filter} onFilterChange={setFilter} />
                {thisRun && !thisRunning && (
                  <button
                    onClick={() => exportCsv(thisRun, ct?.checks ?? [])}
                    className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
                  >
                    Export CSV
                  </button>
                )}
              </div>
              <ResultsTable results={filteredResults} selectors={ct?.checks ?? []} />
            </div>
          )}

          {!thisRun && !thisRunning && (
            <p className="text-sm text-muted-foreground">Press "Run Audit" to start checking URLs.</p>
          )}
        </div>
      )}

      {activeTab === 'trends' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Trends</h3>
          <TrendsChart auditId={a.id} />
        </div>
      )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Audit"
        message={`Delete the audit "${a.name}" and all of its saved runs? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
