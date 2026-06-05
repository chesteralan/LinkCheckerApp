import { useState, useCallback } from 'react'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import type { CheckTemplate } from '@/types'

interface Props {
  onQuickAudit?: (templateId: string) => void
}

interface SelectorInput {
  selector: string
  label: string
}

export function CheckTemplatesPage({ onQuickAudit }: Props) {
  const { checkTemplates, loading, createCheckTemplate, updateCheckTemplate, deleteCheckTemplate } = useStore()
  const [editing, setEditing] = useState<CheckTemplate | null>(null)
  const [name, setName] = useState('')
  const [checks, setChecks] = useState<SelectorInput[]>([])
  const [showForm, setShowForm] = useState(false)

  function resetForm() {
    setName('')
    setChecks([])
    setEditing(null)
    setShowForm(false)
  }

  function openEdit(template: CheckTemplate) {
    setEditing(template)
    setName(template.name)
    setChecks(template.checks.map((c) => ({ selector: c.selector, label: c.label })))
    setShowForm(true)
  }

  function addCheck() {
    setChecks([...checks, { selector: '', label: '' }])
  }

  function removeCheck(index: number) {
    setChecks(checks.filter((_, i) => i !== index))
  }

  function updateCheck(index: number, field: keyof SelectorInput, value: string) {
    const updated = [...checks]
    updated[index] = { ...updated[index], [field]: value }
    setChecks(updated)
  }

  async function handleSave() {
    const validChecks = checks.filter((c) => c.selector.trim() && c.label.trim())
    if (!name.trim() || validChecks.length === 0) return

    if (editing) {
      await updateCheckTemplate(editing.id, { name, checks: validChecks })
    } else {
      await createCheckTemplate(name, validChecks)
    }
    resetForm()
  }

  async function handleDelete(id: string) {
    await deleteCheckTemplate(id)
  }

  const handleSaveCb = useCallback(() => { if (showForm) handleSave() }, [showForm, name, checks, editing])

  useHotkeys({
    'Cmd+Enter': handleSaveCb,
    'Ctrl+Enter': handleSaveCb,
  }, showForm)

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Check Templates</h2>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Template
        </button>
      </div>

      <Modal open={showForm} onClose={resetForm} title={editing ? 'Edit Check Template' : 'New Check Template'}>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Selectors</label>
              <button
                onClick={addCheck}
                className="text-sm text-primary hover:underline"
              >
                + Add selector
              </button>
            </div>
            {checks.map((check, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
                <input
                  type="text"
                  placeholder="CSS selector, e.g. .login-form"
                  value={check.selector}
                  onChange={(e) => updateCheck(i, 'selector', e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <input
                  type="text"
                  placeholder="Label, e.g. Login form exists"
                  value={check.label}
                  onChange={(e) => updateCheck(i, 'label', e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={() => removeCheck(i)}
                  className="p-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  title="Remove selector"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || checks.filter((c) => c.selector.trim() && c.label.trim()).length === 0}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {editing ? 'Update' : 'Create'}
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
          <div
            key={template.id}
            className="border border-border rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <h3 className="font-medium">{template.name}</h3>
              <p className="text-sm text-muted-foreground">
                {template.checks.length} selector{template.checks.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {template.checks.map((c) => (
                  <span
                    key={c.id}
                    className="inline-block px-2 py-0.5 bg-muted text-xs rounded-md"
                    title={c.selector}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {onQuickAudit && (
                <button
                  onClick={() => onQuickAudit(template.id)}
                  className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                >
                  Quick Audit
                </button>
              )}
              <button
                onClick={() => openEdit(template)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(template.id)}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
