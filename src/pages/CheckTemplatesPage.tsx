import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { findDuplicateTemplates } from '@/utils/detectDuplicates'

export function CheckTemplatesPage() {
  const navigate = useNavigate()
  const { checkTemplates, audits, loading, createCheckTemplate, updateCheckTemplate, deleteCheckTemplate } = useStore()
  const duplicateTemplates = useMemo(() => findDuplicateTemplates(checkTemplates), [checkTemplates])
  const [name, setName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingRename, setEditingRename] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [folderFilter, setFolderFilter] = useState('')
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const folders = useMemo(() => {
    const f = new Set<string>()
    for (const t of checkTemplates) if (t.folder) f.add(t.folder)
    return [...f].sort()
  }, [checkTemplates])

  function resetForm() {
    setName('')
    setFolderName('')
    setShowForm(false)
    setEditingRename(null)
  }

  function openRename(template: typeof checkTemplates[number]) {
    setEditingRename(template)
    setName(template.name)
    setFolderName(template.folder ?? '')
    setShowForm(true)
  }

  const visibleTemplates = useMemo(
    () =>
      [...checkTemplates]
        .filter((t) => !folderFilter || t.folder === folderFilter)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [checkTemplates, folderFilter],
  )
  // Bulk actions only touch selected templates that are still visible (A-29).
  const selectedVisible = visibleTemplates.filter((t) => selectedIds.has(t.id))

  function changeFolderFilter(f: string) {
    setFolderFilter(f)
    setSelectedIds(new Set())
  }

  /** Names of audits that use any of the given templates. */
  function auditsUsing(ids: string[]): string[] {
    return audits.filter((a) => ids.includes(a.checkTemplateId)).map((a) => a.name)
  }

  function deleteMessage(ids: string[], what: string): string {
    const using = auditsUsing(ids)
    const base = `Delete ${what}? This action cannot be undone.`
    return using.length > 0
      ? `${base} It is used by ${using.length} audit${using.length === 1 ? '' : 's'} (${using.join(', ')}); delete or change those audits first.`
      : base
  }

  async function handleSave() {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      if (editingRename) {
        await updateCheckTemplate(editingRename.id, { name: name.trim(), folder: folderName.trim() || null })
        resetForm()
      } else {
        const created = await createCheckTemplate(name.trim(), [], folderName.trim() || undefined)
        resetForm()
        navigate(`/check-templates/${created.id}`)
      }
    } catch (e) {
      setError(`Could not save the template: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmDeleteId) return
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    setError(null)
    try {
      await deleteCheckTemplate(id)
    } catch (e) {
      // e.g. "This check template is used by N audit(s): ..."
      setError(String(e))
    }
  }

  async function handleBulkDelete() {
    setConfirmBulkDelete(false)
    setError(null)
    const failures: string[] = []
    for (const t of selectedVisible) {
      try {
        await deleteCheckTemplate(t.id)
      } catch (e) {
        failures.push(`${t.name}: ${String(e)}`)
      }
    }
    setSelectedIds(new Set())
    if (failures.length > 0) setError(`Some templates could not be deleted. ${failures.join(' ')}`)
  }

  async function handleBulkDuplicate() {
    setError(null)
    try {
      for (const t of selectedVisible) {
        await createCheckTemplate(t.name + ' (copy)', t.checks, t.folder ?? undefined)
      }
      setSelectedIds(new Set())
    } catch (e) {
      setError(`Could not duplicate templates: ${String(e)}`)
    }
  }

  async function togglePin(id: string, pinned: boolean) {
    setError(null)
    try {
      await updateCheckTemplate(id, { pinned: !pinned })
    } catch (e) {
      setError(`Could not update the template: ${String(e)}`)
    }
  }

  useHotkeys(
    {
      'Mod+Enter': () => {
        if (showForm) handleSave()
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
        <h2 className="text-2xl font-bold">Check Templates</h2>
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Template
        </button>
      </div>

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
          <button
            onClick={handleBulkDuplicate}
            className="px-3 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors"
          >
            Duplicate Selected
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors">
            Clear
          </button>
        </div>
      )}

      <Modal open={showForm} onClose={resetForm} title={editingRename ? 'Rename Template' : 'New Check Template'}>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Template name"
            aria-label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label htmlFor="ct-folder-input" className="text-sm text-muted-foreground block mb-1">Folder</label>
            <input
              id="ct-folder-input"
              type="text"
              placeholder="e.g. Production, Staging"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              list="folder-suggestions-ct"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <datalist id="folder-suggestions-ct">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {editingRename ? 'Save' : 'Create'}
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

      {checkTemplates.length === 0 && (
        <p className="text-muted-foreground text-sm">No check templates yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {visibleTemplates.map((template) => (
          <div key={template.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(template.id)}
                onChange={() => {
                  const next = new Set(selectedIds)
                  if (next.has(template.id)) next.delete(template.id)
                  else next.add(template.id)
                  setSelectedIds(next)
                }}
                aria-label={`Select ${template.name}`}
                className="accent-primary"
              />
              <button
                onClick={() => togglePin(template.id, template.pinned)}
                className="text-sm hover:scale-110 transition-transform"
                title={template.pinned ? 'Unpin' : 'Pin'}
                aria-label={template.pinned ? `Unpin ${template.name}` : `Pin ${template.name}`}
                aria-pressed={template.pinned}
              >
                <span aria-hidden="true">{template.pinned ? '★' : '☆'}</span>
              </button>
              <div>
                <button
                  onClick={() => navigate(`/check-templates/${template.id}`)}
                  className="font-medium text-left hover:text-primary transition-colors"
                >
                  {template.name}
                  {template.folder && (
                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{template.folder}</span>
                  )}
                </button>
                <p className="text-sm text-muted-foreground">
                  {template.checks.length} check{template.checks.length !== 1 ? 's' : ''}
                  {duplicateTemplates.has(template.id) && (
                    <span className="ml-2 text-xs text-warning" title={`Duplicate of ${duplicateTemplates.get(template.id)?.length} other template${duplicateTemplates.get(template.id)?.length !== 1 ? 's' : ''}`}>
                      ⚠ Duplicate
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {template.checks.map((c) => (
                    <span key={c.id} className="inline-block px-2 py-0.5 bg-muted text-xs rounded-md" title={`${c.checkType}: ${c.selector}`}>
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => navigate(`/check-templates/${template.id}/quick-audit`)}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
              >
                Quick Audit
              </button>
              <button
                onClick={() => openRename(template)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit<span className="sr-only"> {template.name}</span>
              </button>
              <button
                onClick={() => navigate(`/check-templates/${template.id}`)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Selectors<span className="sr-only"> of {template.name}</span>
              </button>
              <button
                onClick={() => setConfirmDeleteId(template.id)}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete<span className="sr-only"> {template.name}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message={confirmDeleteId ? deleteMessage([confirmDeleteId], 'this template') : ''}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete Templates"
        message={deleteMessage(
          selectedVisible.map((t) => t.id),
          `${selectedVisible.length} template${selectedVisible.length === 1 ? '' : 's'} (${selectedVisible.map((t) => t.name).join(', ')})`,
        )}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
