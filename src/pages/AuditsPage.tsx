import { useState, useCallback } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { useStore } from '@/hooks/useStore'
import { useAuditRunner } from '@/hooks/useAuditRunner'
import { useHotkeys } from '@/hooks/useHotkeys'
import { ProgressBar } from '@/components/ProgressBar'
import { ResultsTable } from '@/components/ResultsTable'
import { writeFile } from '@/lib/tauri'
import type { Audit, AuditRun } from '@/types'

const modes = [
  { value: 'sequential', label: 'Sequential (1 at a time)' },
  { value: 'batch', label: 'Batch (configurable concurrency)' },
] as const

type AuditTab = 'overview' | 'results'

export function AuditsPage() {
  const { audits, targetLists, checkTemplates, loading, createAudit, updateAudit, deleteAudit } = useStore()
  const runner = useAuditRunner()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [targetListId, setTargetListId] = useState('')
  const [checkTemplateId, setCheckTemplateId] = useState('')
  const [mode, setMode] = useState<'sequential' | 'batch'>('batch')
  const [batchSize, setBatchSize] = useState(5)
  const [timeoutSecs, setTimeoutSecs] = useState(10)
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null)
  const [activeTab, setActiveTab] = useState<AuditTab>('overview')
  const [editingAudit, setEditingAudit] = useState(false)
  const [editName, setEditName] = useState('')
  const [editMode, setEditMode] = useState<'sequential' | 'batch'>('batch')
  const [editBatchSize, setEditBatchSize] = useState(5)
  const [editTimeoutSecs, setEditTimeoutSecs] = useState(10)

  function resetForm() {
    setName('')
    setTargetListId('')
    setCheckTemplateId('')
    setMode('batch')
    setBatchSize(5)
    setTimeoutSecs(10)
    setShowForm(false)
  }

  function selectAudit(audit: Audit) {
    setSelectedAudit(audit)
    setActiveTab('overview')
    setEditingAudit(false)
  }

  function startEdit() {
    if (!selectedAudit) return
    setEditName(selectedAudit.name)
    setEditMode(selectedAudit.config.mode)
    setEditBatchSize(selectedAudit.config.batchSize)
    setEditTimeoutSecs(selectedAudit.config.timeoutSecs)
    setEditingAudit(true)
  }

  async function handleUpdate() {
    if (!selectedAudit || !editName.trim()) return
    await updateAudit(selectedAudit.id, {
      name: editName,
      config: { mode: editMode, batchSize: editBatchSize, timeoutSecs: editTimeoutSecs },
    })
    setSelectedAudit((prev) => prev ? { ...prev, name: editName, config: { mode: editMode, batchSize: editBatchSize, timeoutSecs: editTimeoutSecs } } : null)
    setEditingAudit(false)
  }

  async function handleCreate() {
    if (!name.trim() || !targetListId || !checkTemplateId) return
    await createAudit(name, targetListId, checkTemplateId, {
      mode,
      batchSize,
      timeoutSecs,
    })
    resetForm()
  }

  async function handleRun() {
    if (!selectedAudit) return
    setActiveTab('results')
    await runner.start(selectedAudit.id)
  }

  const handleCreateCb = useCallback(() => { if (showForm) handleCreate() }, [showForm, name, targetListId, checkTemplateId, mode, batchSize, timeoutSecs])
  const handleResetCb = useCallback(() => { if (showForm) resetForm() }, [showForm])
  const handleRunCb = useCallback(() => { if (selectedAudit && !runner.running) handleRun() }, [selectedAudit, runner.running])

  useHotkeys({
    Escape: handleResetCb,
    'Cmd+Enter': handleCreateCb,
    'Ctrl+Enter': handleCreateCb,
    'Cmd+r': handleRunCb,
    'Ctrl+r': handleRunCb,
  }, showForm || !!selectedAudit)

  const selectedTargetList = selectedAudit
    ? targetLists.find((tl) => tl.id === selectedAudit.targetListId)
    : null
  const selectedCheckTemplate = selectedAudit
    ? checkTemplates.find((ct) => ct.id === selectedAudit.checkTemplateId)
    : null

  async function exportCsv(run: AuditRun, selectors: { id: string; label: string; selector: string }[]) {
    const path = await save({
      defaultPath: `${selectedAudit?.name ?? 'audit'}-${new Date().toISOString().slice(0, 10)}.csv`,
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

  function csvEscape(val: string): string {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Audits</h2>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Audit
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/20">
          <input
            type="text"
            placeholder="Audit name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Target List</label>
              <select
                value={targetListId}
                onChange={(e) => setTargetListId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a list...</option>
                {targetLists.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name} ({tl.urls.length} URLs)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Check Template</label>
              <select
                value={checkTemplateId}
                onChange={(e) => setCheckTemplateId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a template...</option>
                {checkTemplates.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} ({ct.checks.length} checks)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'sequential' | 'batch')}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {modes.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            {mode === 'batch' && (
              <div>
                <label className="text-sm text-muted-foreground block mb-1">Batch Size</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Timeout (seconds)</label>
              <input
                type="number"
                min={1}
                max={120}
                value={timeoutSecs}
                onChange={(e) => setTimeoutSecs(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !targetListId || !checkTemplateId}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Audit list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {audits.map((audit) => {
          const tl = targetLists.find((t) => t.id === audit.targetListId)
          const ct = checkTemplates.find((c) => c.id === audit.checkTemplateId)
          return (
            <button
              key={audit.id}
              onClick={() => selectAudit(audit)}
              className={`text-left border rounded-lg p-4 transition-colors ${
                selectedAudit?.id === audit.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/30'
              }`}
            >
              <h3 className="font-medium">{audit.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {tl?.name ?? 'Unknown list'} → {ct?.name ?? 'Unknown template'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {audit.config.mode === 'sequential' ? 'Sequential' : `Batch x${audit.config.batchSize}`}
                {' · '}{audit.config.timeoutSecs}s timeout
              </p>
            </button>
          )
        })}
        {audits.length === 0 && !showForm && (
          <p className="text-muted-foreground text-sm col-span-2">
            No audits yet. Create one to get started.
          </p>
        )}
      </div>

      {/* Detail panel */}
      {selectedAudit && (
        <div className="border border-border rounded-lg">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h3 className="text-lg font-semibold">{selectedAudit.name}</h3>
              <p className="text-sm text-muted-foreground">
                {selectedTargetList?.name ?? 'Unknown'} · {selectedTargetList?.urls.length ?? 0} URLs
                {' — '}
                {selectedCheckTemplate?.name ?? 'Unknown'} · {selectedCheckTemplate?.checks.length ?? 0} selectors
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={startEdit}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => deleteAudit(selectedAudit.id).then(() => setSelectedAudit(null))}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete
              </button>
            </div>
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

          <div className="p-4">
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {editingAudit ? (
                  <div className="space-y-4 border border-border rounded-lg p-4 bg-muted/20">
                    <input
                      type="text"
                      placeholder="Audit name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="grid grid-cols-3 gap-4">
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
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleUpdate}
                        disabled={!editName.trim()}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingAudit(false)}
                        className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {selectedTargetList && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">URLs ({selectedTargetList.urls.length})</h4>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {selectedTargetList.urls.map((url, i) => (
                            <div key={i} className="text-sm font-mono text-muted-foreground truncate">{url}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedCheckTemplate && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Selectors to check</h4>
                        <div className="space-y-1">
                          {selectedCheckTemplate.checks.map((c) => (
                            <div key={c.id} className="flex items-center gap-2 text-sm">
                              <code className="px-1.5 py-0.5 bg-muted rounded text-xs">{c.selector}</code>
                              <span className="text-muted-foreground">{c.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
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
                  </>
                )}
              </div>
            )}

            {activeTab === 'results' && (
              <div className="space-y-4">
                {runner.progress && (
                  <ProgressBar checked={runner.progress.checked} total={runner.progress.total} />
                )}

                {runner.running && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                    Running...
                  </div>
                )}

                {runner.run && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-4 text-sm">
                        <span className="text-success">✓ {runner.run.summary.passed} passed</span>
                        <span className="text-destructive">✗ {runner.run.summary.failed} failed</span>
                        <span className="text-muted-foreground">⚠ {runner.run.summary.errored} errored</span>
                        <span className="text-muted-foreground">
                          avg {Math.round(runner.run.summary.avgResponseTimeMs)}ms
                        </span>
                      </div>
                      <button
                        onClick={() => exportCsv(runner.run!, selectedCheckTemplate?.checks ?? [])}
                        className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
                      >
                        Export CSV
                      </button>
                    </div>
                    <ResultsTable
                      results={runner.run.results}
                      selectors={selectedCheckTemplate?.checks ?? []}
                    />
                  </div>
                )}

                {!runner.run && !runner.running && !runner.progress && (
                  <p className="text-sm text-muted-foreground">
                    Press "Run Audit" to start checking URLs.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
