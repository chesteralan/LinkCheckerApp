import { useState, useCallback } from 'react'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import type { Audit } from '@/types'

const modes = [
  { value: 'sequential', label: 'Sequential (1 at a time)' },
  { value: 'batch', label: 'Batch (configurable concurrency)' },
] as const

interface Props {
  onViewAudit: (auditId: string) => void
}

export function AuditsPage({ onViewAudit }: Props) {
  const { audits, targetLists, checkTemplates, loading, createAudit } = useStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [targetListId, setTargetListId] = useState('')
  const [checkTemplateId, setCheckTemplateId] = useState('')
  const [mode, setMode] = useState<'sequential' | 'batch'>('batch')
  const [batchSize, setBatchSize] = useState(5)
  const [timeoutSecs, setTimeoutSecs] = useState(10)
  const [originOverride, setOriginOverride] = useState('')
  const [urlPostfix, setUrlPostfix] = useState('')

  function resetForm() {
    setName('')
    setTargetListId('')
    setCheckTemplateId('')
    setMode('batch')
    setBatchSize(5)
    setTimeoutSecs(10)
    setOriginOverride('')
    setUrlPostfix('')
    setShowForm(false)
  }

  async function handleCreate() {
    if (!name.trim() || !targetListId || !checkTemplateId) return
    await createAudit(name, targetListId, checkTemplateId, {
      mode,
      batchSize,
      timeoutSecs,
    }, originOverride || undefined, urlPostfix || undefined)
    resetForm()
  }

  const handleCreateCb = useCallback(() => { if (showForm) handleCreate() }, [showForm, name, targetListId, checkTemplateId, mode, batchSize, timeoutSecs])

  useHotkeys({
    'Cmd+Enter': handleCreateCb,
    'Ctrl+Enter': handleCreateCb,
  }, showForm)

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

      <Modal open={showForm} onClose={resetForm} title="New Audit">
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Audit name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
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

          <div className="grid grid-cols-2 gap-4">
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
      </Modal>

      {/* Audit list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {audits.map((audit) => {
          const tl = targetLists.find((t) => t.id === audit.targetListId)
          const ct = checkTemplates.find((c) => c.id === audit.checkTemplateId)
          return (
            <button
              key={audit.id}
              onClick={() => onViewAudit(audit.id)}
              className="text-left border border-border rounded-lg p-4 hover:border-primary transition-colors"
            >
              <h3 className="font-medium">{audit.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {tl?.name ?? 'Unknown list'} → {ct?.name ?? 'Unknown template'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {audit.config.mode === 'sequential' ? 'Sequential' : `Batch x${audit.config.batchSize}`}
                {' · '}{audit.config.timeoutSecs}s timeout
                {audit.originOverride && ` · ${audit.originOverride}`}
                {audit.urlPostfix && ` · +${audit.urlPostfix}`}
              </p>
            </button>
          )
        })}
        {audits.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-2">
            No audits yet. Create one to get started.
          </p>
        )}
      </div>
    </div>
  )
}
