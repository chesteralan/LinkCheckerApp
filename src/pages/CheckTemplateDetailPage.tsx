import { useState } from 'react'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { scrapeSelectors } from '@/lib/tauri'
import type { CheckTemplate } from '@/types'

interface Props {
  template: CheckTemplate
  onBack: () => void
}

export function CheckTemplateDetailPage({ template, onBack }: Props) {
  const { checkTemplates, patchCheckTemplate } = useStore()
  const live = checkTemplates.find((ct) => ct.id === template.id) ?? template
  const checks = live.checks

  const [showScanModal, setShowScanModal] = useState(false)
  const [scanUrl, setScanUrl] = useState('')
  const [scanIds, setScanIds] = useState(true)
  const [scanClasses, setScanClasses] = useState(true)
  const [scanTestids, setScanTestids] = useState(true)
  const [scanCustom, setScanCustom] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<{ selector: string; typeName: string }[]>([])

  function persist(updated: { selector: string; label: string }[]) {
    patchCheckTemplate(template.id, { checks: updated })
  }

  function moveUp(index: number) {
    if (index === 0) return
    const updated = [...checks]
    const tmp = updated[index - 1]
    updated[index - 1] = updated[index]
    updated[index] = tmp
    persist(updated)
  }

  function moveDown(index: number) {
    if (index === checks.length - 1) return
    const updated = [...checks]
    const tmp = updated[index + 1]
    updated[index + 1] = updated[index]
    updated[index] = tmp
    persist(updated)
  }

  function addCheck() {
    persist([...checks, { selector: '', label: '' }])
  }

  function removeCheck(index: number) {
    const updated = checks.filter((_, i) => i !== index)
    persist(updated)
  }

  function updateCheck(index: number, field: 'selector' | 'label', value: string) {
    const updated = [...checks]
    updated[index] = { ...updated[index], [field]: value }
    persist(updated)
  }

  async function handleScan() {
    if (!scanUrl.trim()) return
    setScanning(true)
    setScanResults([])
    try {
      const results = await scrapeSelectors(scanUrl, {
        selectIds: scanIds,
        selectClasses: scanClasses,
        selectTestids: scanTestids,
        customSelector: scanCustom,
      })
      setScanResults(results)
    } catch (e) {
      console.error(e)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-primary hover:underline">&larr; Templates</button>
          <h2 className="text-2xl font-bold">{live.name}</h2>
        </div>
        <button
          onClick={() => setShowScanModal(true)}
          className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
        >
          Scan URL
        </button>
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
            <div key={check.id ?? i} className="flex items-center gap-2 p-3 border border-border rounded-lg">
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
      </div>

        <Modal title="Scan URL for Selectors" open={showScanModal} onClose={() => setShowScanModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">URL</label>
              <input
                type="text"
                value={scanUrl}
                onChange={(e) => setScanUrl(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://example.com"
                autoFocus
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Selector Types</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scanIds} onChange={(e) => setScanIds(e.target.checked)} className="accent-primary" />
                IDs (<code className="text-xs text-muted-foreground">#my-id</code>)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scanClasses} onChange={(e) => setScanClasses(e.target.checked)} className="accent-primary" />
                Classes (<code className="text-xs text-muted-foreground">.my-class</code>)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scanTestids} onChange={(e) => setScanTestids(e.target.checked)} className="accent-primary" />
                data-testid (<code className="text-xs text-muted-foreground">[data-testid="x"]</code>)
              </label>
            </fieldset>
            <div>
              <label className="text-sm font-medium block mb-1">Custom Selector (verify it exists)</label>
              <input
                type="text"
                value={scanCustom}
                onChange={(e) => setScanCustom(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. .header .nav-link"
              />
            </div>
            <button
              onClick={handleScan}
              disabled={!scanUrl.trim() || scanning}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Scan'}
            </button>
            {scanResults.length > 0 && (
              <div>
                <label className="text-sm font-medium block mb-1">
                  Found {scanResults.length} selector{scanResults.length !== 1 ? 's' : ''}
                </label>
                <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
                  {scanResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        persist([...checks, { selector: r.selector, label: r.selector }])
                        setScanResults((prev) => prev.filter((_, j) => j !== i))
                      }}
                      className="w-full text-left px-3 py-2 text-sm font-mono hover:bg-muted transition-colors flex items-center justify-between"
                    >
                      <span>{r.selector}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{r.typeName}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Click a selector to add it to the template</p>
              </div>
            )}
            {!scanning && scanResults.length === 0 && scanUrl.trim() && (
              <p className="text-sm text-muted-foreground">No selectors found for the selected types.</p>
            )}
          </div>
        </Modal>
    </div>
  )
}
