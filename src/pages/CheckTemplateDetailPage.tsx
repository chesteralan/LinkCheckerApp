import { useState, useRef } from 'react'
import { useStore } from '@/hooks/useStore'
import type { CheckTemplate } from '@/types'

interface Props {
  template: CheckTemplate
  onBack: () => void
}

interface SelectorInput {
  selector: string
  label: string
}

export function CheckTemplateDetailPage({ template, onBack }: Props) {
  const { updateCheckTemplate } = useStore()
  const [checks, setChecks] = useState<SelectorInput[]>(
    template.checks.map((c) => ({ selector: c.selector, label: c.label }))
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)

  function addCheck() {
    setChecks([...checks, { selector: '', label: '' }])
    setDirty(true)
  }

  function removeCheck(index: number) {
    setChecks(checks.filter((_, i) => i !== index))
    setDirty(true)
  }

  function updateCheck(index: number, field: keyof SelectorInput, value: string) {
    const updated = [...checks]
    updated[index] = { ...updated[index], [field]: value }
    setChecks(updated)
    setDirty(true)
  }

  function handleDragStart(index: number) {
    setDragIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    dragOverIndex.current = index
  }

  function handleDrop() {
    if (dragIndex === null || dragOverIndex.current === null || dragIndex === dragOverIndex.current) {
      setDragIndex(null)
      dragOverIndex.current = null
      return
    }
    const updated = [...checks]
    const [removed] = updated.splice(dragIndex, 1)
    updated.splice(dragOverIndex.current, 0, removed)
    setChecks(updated)
    setDirty(true)
    setDragIndex(null)
    dragOverIndex.current = null
  }

  function handleDragEnd() {
    setDragIndex(null)
    dragOverIndex.current = null
  }

  async function handleSave() {
    const validChecks = checks.filter((c) => c.selector.trim() && c.label.trim())
    if (validChecks.length === 0) return
    setSaving(true)
    await updateCheckTemplate(template.id, { checks: validChecks })
    setSaving(false)
    setDirty(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-primary hover:underline">&larr; Templates</button>
          <h2 className="text-2xl font-bold">{template.name}</h2>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Selectors</label>
          <button
            onClick={addCheck}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            + Add Selector
          </button>
        </div>

        {checks.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No selectors yet. Add one to define what to check on each page.
          </p>
        )}

        <div className="space-y-2">
          {checks.map((check, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 p-3 border rounded-lg transition-colors ${
                dragIndex === i ? 'opacity-50 border-primary' : 'border-border'
              } ${dragOverIndex.current === i && dragIndex !== i ? 'border-t-2 border-t-primary' : ''}`}
            >
              <button
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 p-1"
                title="Drag to reorder"
                onMouseDown={(e) => e.currentTarget.parentElement?.setAttribute('draggable', 'true')}
              >
                ⠿
              </button>
              <div className="flex-1 grid grid-cols-[1fr_1fr] gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-0.5 block">CSS Selector</label>
                  <input
                    type="text"
                    placeholder="e.g. .login-form"
                    value={check.selector}
                    onChange={(e) => updateCheck(i, 'selector', e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-0.5 block">Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Login form exists"
                    value={check.label}
                    onChange={(e) => updateCheck(i, 'label', e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <button
                onClick={() => removeCheck(i)}
                className="p-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors shrink-0"
                title="Remove selector"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {dirty && (
          <div className="flex gap-2 pt-2 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving || checks.filter((c) => c.selector.trim() && c.label.trim()).length === 0}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => {
                setChecks(template.checks.map((c) => ({ selector: c.selector, label: c.label })))
                setDirty(false)
              }}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
