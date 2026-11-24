import { useState, useMemo, useId } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'

const modes = [
  { value: 'sequential', label: 'Sequential (1 at a time)' },
  { value: 'batch', label: 'Batch (configurable concurrency)' },
] as const

export function AuditsPage() {
  const formId = useId()
  const { audits, targetLists, checkTemplates, loading, createAudit, updateAudit, deleteAudit } = useStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [targetListId, setTargetListId] = useState('')
  const [checkTemplateId, setCheckTemplateId] = useState('')
  const [mode, setMode] = useState<'sequential' | 'batch'>('batch')
  const [batchSize, setBatchSize] = useState(5)
  const [timeoutSecs, setTimeoutSecs] = useState(10)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [folderFilter, setFolderFilter] = useState('')
  const [folderName, setFolderName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [creating, setCreating] = useState(false)

  const folders = useMemo(() => {
    const f = new Set<string>()
    for (const a of audits) if (a.folder) f.add(a.folder)
    return [...f].sort()
  }, [audits])

  function resetForm() {
    setName('')
    setFolderName('')
    setTargetListId('')
    setCheckTemplateId('')
    setMode('batch')
    setBatchSize(5)
    setTimeoutSecs(10)
    setShowForm(false)
  }

  const visibleAudits = useMemo(
    () =>
      [...audits]
        .filter((a) => !folderFilter || a.folder === folderFilter)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [audits, folderFilter],
  )
  // Only act on selected items the user can still see (A-29).
  const selectedVisible = visibleAudits.filter((a) => selectedIds.has(a.id))

  function changeFolderFilter(f: string) {
    setFolderFilter(f)
    setSelectedIds(new Set())
  }

  async function handleCreate() {
    if (!name.trim() || !targetListId || !checkTemplateId || creating) return
    setCreating(true)
    setError(null)
    try {
      await createAudit(
        name.trim(),
        targetListId,
        checkTemplateId,
        {
          mode,
          batchSize: Math.max(1, batchSize || 1),
          timeoutSecs: Math.max(1, timeoutSecs || 1),
          headers: {},
          cookies: [],
        },
        undefined,
        undefined,
        folderName.trim() || undefined,
      )
      resetForm()
    } catch (e) {
      setError(`Could not create the audit: ${String(e)}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleBulkDelete() {
    setConfirmBulkDelete(false)
    setError(null)
    const failures: string[] = []
    for (const a of selectedVisible) {
      try {
        await deleteAudit(a.id)
      } catch (e) {
        failures.push(`${a.name}: ${String(e)}`)
      }
    }
    setSelectedIds(new Set())
    if (failures.length > 0) setError(`Some audits could not be deleted. ${failures.join('; ')}`)
  }

  async function togglePin(id: string, pinned: boolean) {
    setError(null)
    try {
      await updateAudit(id, { pinned: !pinned })
    } catch (e) {
      setError(`Could not update the audit: ${String(e)}`)
    }
  }

  useHotkeys(
    {
      'Mod+Enter': () => {
        if (showForm) handleCreate()
      },
    },
    showForm,
  )

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Audits</h2>
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Audit
        </button>
      </div>

      <Modal open={showForm} onClose={resetForm} title="New Audit">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Audit name"
            aria-label="Audit name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${formId}-tl`} className="text-sm text-muted-foreground block mb-1">Target List</label>
              <select
                id={`${formId}-tl`}
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
              <label htmlFor={`${formId}-ct`} className="text-sm text-muted-foreground block mb-1">Check Template</label>
              <select
                id={`${formId}-ct`}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${formId}-mode`} className="text-sm text-muted-foreground block mb-1">Mode</label>
              <select
                id={`${formId}-mode`}
                value={mode}
                onChange={(e) => setMode(e.target.value as 'sequential' | 'batch')}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {modes.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {mode === 'batch' && (
              <div>
                <label htmlFor={`${formId}-batch`} className="text-sm text-muted-foreground block mb-1">Batch Size</label>
                <input
                  id={`${formId}-batch`}
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
              <label htmlFor={`${formId}-timeout`} className="text-sm text-muted-foreground block mb-1">Timeout (seconds)</label>
              <input
                id={`${formId}-timeout`}
                type="number"
                min={1}
                max={120}
                value={timeoutSecs}
                onChange={(e) => setTimeoutSecs(Number(e.target.value))}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${formId}-folder`} className="text-sm text-muted-foreground block mb-1">Folder</label>
            <input
              id={`${formId}-folder`}
              type="text"
              placeholder="e.g. Production, Staging"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              list="folder-suggestions-a"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <datalist id="folder-suggestions-a">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || !targetListId || !checkTemplateId || creating}
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
      </Modal>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {selectedVisible.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md text-sm">
          <span className="text-muted-foreground">{selectedVisible.length} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="ml-auto px-3 py-1 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Delete Selected
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors">
            Clear
          </button>
        </div>
      )}

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button onClick={() => changeFolderFilter('')} aria-pressed={!folderFilter} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${!folderFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
            All
          </button>
          {folders.map((f) => (
            <button key={f} onClick={() => changeFolderFilter(f)} aria-pressed={folderFilter === f} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${folderFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
              {f}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleAudits.map((audit) => {
          const tl = targetLists.find((t) => t.id === audit.targetListId)
          const ct = checkTemplates.find((c) => c.id === audit.checkTemplateId)
          return (
            <div key={audit.id} className="border border-border rounded-lg p-4 hover:border-primary focus-within:border-primary transition-colors relative">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(audit.id)}
                  onChange={() => {
                    const next = new Set(selectedIds)
                    if (next.has(audit.id)) next.delete(audit.id)
                    else next.add(audit.id)
                    setSelectedIds(next)
                  }}
                  aria-label={`Select ${audit.name}`}
                  className="accent-primary mt-0.5 shrink-0 relative z-10"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">
                      {/* Stretched link: the whole card is clickable, and it is a real link for keyboard and screen readers (A-31). */}
                      <Link
                        to={`/audits/${audit.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:underline"
                      >
                        {audit.name}
                      </Link>
                      {audit.folder && <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{audit.folder}</span>}
                    </h3>
                    <button
                      onClick={() => togglePin(audit.id, audit.pinned)}
                      className="text-sm hover:scale-110 transition-transform relative z-10"
                      title={audit.pinned ? 'Unpin' : 'Pin'}
                      aria-label={audit.pinned ? `Unpin ${audit.name}` : `Pin ${audit.name}`}
                      aria-pressed={audit.pinned}
                    >
                      <span aria-hidden="true">{audit.pinned ? '★' : '☆'}</span>
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {tl?.name ?? 'Unknown list'} → {ct?.name ?? 'Unknown template'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {audit.config.mode === 'sequential' ? 'Sequential' : `Batch x${audit.config.batchSize}`}
                    {' · '}
                    {audit.config.timeoutSecs}s timeout
                    {audit.originOverride && ` · ${audit.originOverride}`}
                    {audit.urlPostfix && ` · +${audit.urlPostfix}`}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        {audits.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-2">No audits yet. Create one to get started.</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Audits"
        message={`Delete ${selectedVisible.length} audit${selectedVisible.length === 1 ? '' : 's'} and their saved runs? ${selectedVisible
          .map((a) => a.name)
          .join(', ')}`}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
