import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function CheckTemplatesPage() {
  const navigate = useNavigate()
  const { checkTemplates, loading, createCheckTemplate, updateCheckTemplate, deleteCheckTemplate } = useStore()
  const [name, setName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingRename, setEditingRename] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function resetForm() {
    setName('')
    setShowForm(false)
    setEditingRename(null)
  }

  function openRename(template: { id: string; name: string }) {
    setEditingRename(template)
    setName(template.name)
    setShowForm(true)
  }

  async function handleSave() {
    if (!name.trim()) return
    if (editingRename) {
      await updateCheckTemplate(editingRename.id, { name: name.trim() })
      resetForm()
    } else {
      const created = await createCheckTemplate(name.trim(), [])
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

      {checkTemplates.length === 0 && (
        <p className="text-muted-foreground text-sm">No check templates yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {checkTemplates.map((template) => (
          <div key={template.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
            <div>
              <button
                onClick={() => navigate(`/check-templates/${template.id}`)}
                className="font-medium text-left hover:text-primary transition-colors"
              >
                {template.name}
              </button>
              <p className="text-sm text-muted-foreground">
                {template.checks.length} selector{template.checks.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {template.checks.map((c) => (
                  <span key={c.id} className="inline-block px-2 py-0.5 bg-muted text-xs rounded-md" title={c.selector}>
                    {c.label}
                  </span>
                ))}
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
