import { useState } from 'react'
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

  function persist(updated: SelectorInput[]) {
    updateCheckTemplate(template.id, { checks: updated.filter((c) => c.selector.trim() && c.label.trim()) })
  }

  function moveUp(index: number) {
    if (index === 0) return
    const updated = [...checks]
    const tmp = updated[index - 1]
    updated[index - 1] = updated[index]
    updated[index] = tmp
    setChecks(updated)
    persist(updated)
  }

  function moveDown(index: number) {
    if (index === checks.length - 1) return
    const updated = [...checks]
    const tmp = updated[index + 1]
    updated[index + 1] = updated[index]
    updated[index] = tmp
    setChecks(updated)
    persist(updated)
  }

  function addCheck() {
    const updated = [...checks, { selector: '', label: '' }]
    setChecks(updated)
    persist(updated)
  }

  function removeCheck(index: number) {
    const updated = checks.filter((_, i) => i !== index)
    setChecks(updated)
    if (updated.length > 0) persist(updated)
  }

  function updateCheck(index: number, field: keyof SelectorInput, value: string) {
    const updated = [...checks]
    updated[index] = { ...updated[index], [field]: value }
    setChecks(updated)
  }

  function saveCheck(index: number) {
    const updated = [...checks]
    if (!updated[index].selector.trim() || !updated[index].label.trim()) return
    persist(updated)
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
            <div key={i} className="flex items-center gap-2 p-3 border border-border rounded-lg">
              <div className="flex flex-col shrink-0">
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default"
                  title="Move up"
                >▲</button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === checks.length - 1}
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-default"
                  title="Move down"
                >▼</button>
              </div>
              <div className="flex-1 grid grid-cols-[1fr_1fr] gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-0.5 block">CSS Selector</label>
                  <input
                    type="text"
                    placeholder="e.g. .login-form"
                    value={check.selector}
                    onChange={(e) => updateCheck(i, 'selector', e.target.value)}
                    onBlur={() => saveCheck(i)}
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
                    onBlur={() => saveCheck(i)}
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
      </div>
    </div>
  )
}
