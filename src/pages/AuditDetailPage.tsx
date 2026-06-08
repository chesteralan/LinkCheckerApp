import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { save } from '@tauri-apps/plugin-dialog'
import { useStore } from '@/hooks/useStore'
import { useRun } from '@/hooks/useRun'
import { useHotkeys } from '@/hooks/useHotkeys'
import { ProgressBar } from '@/components/ProgressBar'
import { ResultsTable } from '@/components/ResultsTable'
import { LiveSummary } from '@/components/LiveSummary'
import { writeFile } from '@/lib/tauri'
import { csvEscape } from '@/utils/csv'
import type { AuditRun } from '@/types'

type AuditTab = 'overview' | 'results'

export function AuditDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { audits, targetLists, checkTemplates, updateAudit, deleteAudit } = useStore()
  const runner = useRun()

  const audit = audits.find((a) => a.id === id)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(audit?.name ?? '')
  const [editMode, setEditMode] = useState<'sequential' | 'batch'>(audit?.config.mode ?? 'batch')
  const [editBatchSize, setEditBatchSize] = useState(audit?.config.batchSize ?? 5)
  const [editTimeoutSecs, setEditTimeoutSecs] = useState(audit?.config.timeoutSecs ?? 10)
  const [editOriginOverride, setEditOriginOverride] = useState(audit?.originOverride ?? '')
  const [editUrlPostfix, setEditUrlPostfix] = useState(audit?.urlPostfix ?? '')
  const [originOverride, setOriginOverride] = useState(audit?.originOverride ?? '')
  const [urlPostfix, setUrlPostfix] = useState(audit?.urlPostfix ?? '')
  const [activeTab, setActiveTab] = useState<AuditTab>('overview')
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'errored'>('all')

  useHotkeys(
    {
      'Cmd+r': () => {
        if (audit && !runner.running) {
          setActiveTab('results')
          runner.start(audit.id, originOverride || undefined, urlPostfix || undefined)
        }
      },
      'Ctrl+r': () => {
        if (audit && !runner.running) {
          setActiveTab('results')
          runner.start(audit.id, originOverride || undefined, urlPostfix || undefined)
        }
      },
      'Cmd+Enter': () => {
        if (editing && editName.trim()) {
          setOriginOverride(editOriginOverride)
          setUrlPostfix(editUrlPostfix)
          setEditing(false)
        }
      },
      'Ctrl+Enter': () => {
        if (editing && editName.trim()) {
          setOriginOverride(editOriginOverride)
          setUrlPostfix(editUrlPostfix)
          setEditing(false)
        }
      },
    },
    true,
  )

  if (!audit) {
    return <div className="text-muted-foreground">Audit not found.</div>
  }
  const a = audit

  const tl = targetLists.find((t) => t.id === a.targetListId)
  const ct = checkTemplates.find((c) => c.id === a.checkTemplateId)

  function startEdit() {
    setEditName(a.name)
    setEditMode(a.config.mode)
    setEditBatchSize(a.config.batchSize)
    setEditTimeoutSecs(a.config.timeoutSecs)
    setEditOriginOverride(a.originOverride ?? '')
    setEditUrlPostfix(a.urlPostfix ?? '')
    setEditing(true)
  }

  async function handleUpdate() {
    if (!editName.trim()) return
    await updateAudit(a.id, {
      name: editName,
      config: { mode: editMode, batchSize: editBatchSize, timeoutSecs: editTimeoutSecs },
      originOverride: editOriginOverride,
      urlPostfix: editUrlPostfix,
    })
    setOriginOverride(editOriginOverride)
    setUrlPostfix(editUrlPostfix)
    setEditing(false)
  }

  async function handleDelete() {
    await deleteAudit(a.id)
    navigate('/audits')
  }

  async function handleRun() {
    setActiveTab('results')
    await runner.start(a.id, originOverride || undefined, urlPostfix || undefined)
  }

  async function exportCsv(run: AuditRun, selectors: { id: string; label: string; selector: string }[]) {
    const path = await save({
      defaultPath: `${a.name}-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return

    const header = ['URL', 'Status', 'Response Time (ms)', 'Error', 'Page Title']
      .concat(selectors.map((s) => s.label))
      .join(',')

    const rows = run.results.map((r) => {
      const cols = [
        csvEscape(r.url),
        r.status?.toString() ?? '',
        r.responseTimeMs?.toString() ?? '',
        csvEscape(r.error ?? ''),
        csvEscape(r.pageTitle ?? ''),
      ]
      selectors.forEach((sel) => {
        const cr = r.checks.find((c) => c.selectorCheckId === sel.id)
        cols.push(cr ? `${cr.found ? '✓' : '✗'}${cr.textContent ? ` (${cr.textContent})` : ''}` : '—')
      })
      return cols.join(',')
    })

    const content = [header, ...rows].join('\n')
    await writeFile(path, content)
  }

  const filteredResults = (runner.run?.results ?? []).filter((r) => {
    if (filter === 'passed') return !r.error && r.checks.every((c) => c.found)
    if (filter === 'failed') return !r.error && r.checks.some((c) => !c.found)
    if (filter === 'errored') return !!r.error
    return true
  })

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

      <div className="border-b border-border">
        <div className="flex">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === 'results'
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Results{runner.run ? ` (${runner.run.results.length})` : ''}
          </button>
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="flex gap-2 justify-between items-center">
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button
                    onClick={handleUpdate}
                    disabled={!editName.trim()}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Save
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
                    onClick={handleDelete}
                    className="px-4 py-2 border border-destructive text-destructive rounded-md text-sm hover:bg-destructive/10 transition-colors"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
            {!editing && (
              <div>
                {runner.running ? (
                  <button
                    onClick={runner.cancel}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Cancel Run
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
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
                  <label className="text-sm text-muted-foreground block mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Mode</label>
                  <select
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
                    <label className="text-sm text-muted-foreground block mb-1">Batch Size</label>
                    <input
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
                  <label className="text-sm text-muted-foreground block mb-1">Timeout (s)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={editTimeoutSecs}
                    onChange={(e) => setEditTimeoutSecs(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">Origin Override</label>
                  <input
                    type="text"
                    placeholder="https://staging.example.com"
                    value={editOriginOverride}
                    onChange={(e) => setEditOriginOverride(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">URL Postfix</label>
                  <input
                    type="text"
                    placeholder="?utm_source=test"
                    value={editUrlPostfix}
                    onChange={(e) => setEditUrlPostfix(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                  />
                </div>
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
                    <label className="text-sm text-muted-foreground block mb-1">Origin Override (optional)</label>
                    <input
                      type="text"
                      placeholder="https://staging.example.com"
                      value={originOverride}
                      onChange={(e) => setOriginOverride(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground block mb-1">URL Postfix (optional)</label>
                    <input
                      type="text"
                      placeholder="?utm_source=test"
                      value={urlPostfix}
                      onChange={(e) => setUrlPostfix(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'results' && (
        <div className="space-y-4">
          {runner.progress && <ProgressBar checked={runner.progress.checked} total={runner.progress.total} />}

          {runner.running && (
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

          {(runner.run || runner.running) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <LiveSummary results={runner.run?.results ?? []} filter={filter} onFilterChange={setFilter} />
                {runner.run && !runner.running && (
                  <button
                    onClick={() => exportCsv(runner.run!, ct?.checks ?? [])}
                    className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
                  >
                    Export CSV
                  </button>
                )}
              </div>
              <ResultsTable results={filteredResults} selectors={ct?.checks ?? []} />
            </div>
          )}

          {!runner.run && !runner.running && !runner.progress && (
            <p className="text-sm text-muted-foreground">Press "Run Audit" to start checking URLs.</p>
          )}
        </div>
      )}
    </div>
  )
}
