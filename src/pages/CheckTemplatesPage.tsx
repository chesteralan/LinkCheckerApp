import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { findDuplicateTemplates } from '@/utils/detectDuplicates'

export function CheckTemplatesPage() {
  const navigate = useNavigate()
  const { checkTemplates, loading, createCheckTemplate, updateCheckTemplate, deleteCheckTemplate } = useStore()
  const duplicateTemplates = useMemo(() => findDuplicateTemplates(checkTemplates), [checkTemplates])
  const [name, setName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingRename, setEditingRename] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [folderFilter, setFolderFilter] = useState('')

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

  async function handleSave() {
    if (!name.trim()) return
    if (editingRename) {
      await updateCheckTemplate(editingRename.id, { name: name.trim(), folder: folderName || null })
      resetForm()
    } else {
      const created = await createCheckTemplate(name.trim(), [], folderName || undefined)
      resetForm()
      navigate(`/check-templates/${created.id}`)
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmDeleteId) return
    await deleteCheckTemplate(confirmDeleteId)
    setConfirmDeleteId(null)
  }

  useHotkeys(
    {
      'Cmd+Enter': () => {
        if (showForm) handleSave()
      },
      'Ctrl+Enter': () => {
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

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md text-sm">
          <span className="text-muted-foreground">{selectedIds.size} selected</span>
          <button
            onClick={async () => {
              for (const id of selectedIds) await deleteCheckTemplate(id)
              setSelectedIds(new Set())
            }}
            className="ml-auto px-3 py-1 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Delete Selected
          </button>
          <button
            onClick={async () => {
              for (const id of selectedIds) {
                const t = checkTemplates.find((ct) => ct.id === id)
                if (t) await createCheckTemplate(t.name + ' (copy)', t.checks)
              }
              setSelectedIds(new Set())
            }}
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Folder</label>
            <input
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
              disabled={!name.trim()}
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
          <button onClick={() => setFolderFilter('')} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${!folderFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
            All
          </button>
          {folders.map((f) => (
            <button key={f} onClick={() => setFolderFilter(f)} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${folderFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
              {f}
            </button>
          ))}
        </div>
      )}

      {checkTemplates.length === 0 && (
        <p className="text-muted-foreground text-sm">No check templates yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {[...checkTemplates]
          .filter((t) => !folderFilter || t.folder === folderFilter)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned))
          .map((template) => (
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
                className="accent-primary"
              />
              <button
                onClick={() => updateCheckTemplate(template.id, { pinned: !template.pinned })}
                className="text-sm hover:scale-110 transition-transform"
                title={template.pinned ? 'Unpin' : 'Pin'}
              >
                {template.pinned ? '★' : '☆'}
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
                Edit
              </button>
              <button
                onClick={() => navigate(`/check-templates/${template.id}`)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Selectors
              </button>
              <button
                onClick={() => setConfirmDeleteId(template.id)}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteId}
        message="Delete this template? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}
