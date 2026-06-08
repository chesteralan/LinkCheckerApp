import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { scrapeSelectors } from '@/lib/tauri'
import type { SelectorCheck, CheckType } from '@/types'
import { defaultCheck } from '@/types'

const CHECK_TYPE_OPTIONS: { value: CheckType; label: string }[] = [
  { value: 'selector', label: 'CSS Selector' },
  { value: 'status', label: 'HTTP Status' },
  { value: 'regex', label: 'Regex Match' },
  { value: 'attribute', label: 'Attribute Check' },
]

export function CheckTemplateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { checkTemplates, patchCheckTemplate } = useStore()
  const template = checkTemplates.find((ct) => ct.id === id)
  const checks = template?.checks ?? []

  const [showScanModal, setShowScanModal] = useState(false)
  const [scanUrl, setScanUrl] = useState('')
  const [scanIds, setScanIds] = useState(true)
  const [scanClasses, setScanClasses] = useState(true)
  const [scanTestids, setScanTestids] = useState(true)
  const [scanCustom, setScanCustom] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<{ selector: string; typeName: string }[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  if (!template) {
    return <div className="text-muted-foreground">Template not found.</div>
  }
  const t = template
  const existingSelectors = new Set(checks.map((c) => c.selector))
  const filteredScanResults = scanResults.filter((sr) => !existingSelectors.has(sr.selector))

  function persist(updated: SelectorCheck[]) {
    patchCheckTemplate(t.id, { checks: updated })
  }

  function moveCheck(from: number, to: number) {
    if (to < 0 || to >= checks.length) return
    const updated = [...checks]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    persist(updated)
  }

  function moveUp(index: number) {
    if (index === 0) return
    moveCheck(index, index - 1)
  }

  function moveDown(index: number) {
    if (index === checks.length - 1) return
    moveCheck(index, index + 1)
  }

  function addCheck() {
    persist([...checks, defaultCheck()])
  }

  function removeCheck(index: number) {
    const updated = checks.filter((_, i) => i !== index)
    persist(updated)
  }

  function updateCheck(index: number, field: string, value: string | number | undefined) {
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
          <button onClick={() => navigate('/check-templates')} className="text-sm text-primary hover:underline">
            &larr; Templates
          </button>
          <h2 className="text-2xl font-bold">{t.name}</h2>
        </div>
        <button
          onClick={() => setShowScanModal(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Scan Selectors
        </button>
      </div>

      <div className="space-y-2">
        {checks.length === 0 && (
          <p className="text-muted-foreground text-sm">No selectors yet. Add one or scan a page.</p>
        )}
        {checks.map((check, index) => (
          <div
            key={check.id}
            className={`border rounded-lg p-4 cursor-grab active:cursor-grabbing ${dragIndex === index ? 'border-primary' : 'border-border'}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDragEnter={() => {
              if (dragIndex !== null && dragIndex !== index) {
                setDragIndex(index)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null && dragIndex !== index) {
                moveCheck(dragIndex, index)
              }
              setDragIndex(null)
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                {index + 1}
              </span>
              <select
                value={check.checkType}
                onChange={(e) => {
                  const ct = e.target.value as CheckType
                  const updated = [...checks]
                  updated[index] = { ...defaultCheck(), id: check.id, label: check.label, checkType: ct }
                  persist(updated)
                }}
                className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CHECK_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Label</label>
                  <input
                    type="text"
                    value={check.label}
                    onChange={(e) => updateCheck(index, 'label', e.target.value)}
                    placeholder="e.g. Logo Exists"
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex gap-1 pt-5">
                  <button
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    className="px-2 py-1.5 text-xs border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={() => moveDown(index)}
                    disabled={index === checks.length - 1}
                    className="px-2 py-1.5 text-xs border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    title="Move down"
                  >↓</button>
                  <button
                    onClick={() => removeCheck(index)}
                    className="px-2 py-1.5 text-xs border border-destructive text-destructive rounded hover:bg-destructive/10 transition-colors"
                    title="Remove"
                  >✕</button>
                </div>
              </div>

              {check.checkType === 'selector' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">CSS Selector</label>
                  <input
                    type="text"
                    value={check.selector}
                    onChange={(e) => updateCheck(index, 'selector', e.target.value)}
                    placeholder="e.g. .logo img"
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {check.checkType === 'status' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Expected HTTP Status</label>
                  <input
                    type="number"
                    value={check.expectedStatus ?? 200}
                    onChange={(e) => updateCheck(index, 'expectedStatus', parseInt(e.target.value, 10) || 200)}
                    placeholder="200"
                    min={100}
                    max={599}
                    className="w-32 px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {check.checkType === 'regex' && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Regex Pattern</label>
                  <input
                    type="text"
                    value={check.pattern ?? ''}
                    onChange={(e) => updateCheck(index, 'pattern', e.target.value)}
                    placeholder="e.g. (cancelled|refunded)"
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {check.checkType === 'attribute' && (
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">CSS Selector</label>
                    <input
                      type="text"
                      value={check.selector}
                      onChange={(e) => updateCheck(index, 'selector', e.target.value)}
                      placeholder="e.g. img"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Attribute Name</label>
                    <input
                      type="text"
                      value={check.attributeName ?? ''}
                      onChange={(e) => updateCheck(index, 'attributeName', e.target.value)}
                      placeholder="e.g. src"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Expected Value (optional)</label>
                    <input
                      type="text"
                      value={check.attributeValue ?? ''}
                      onChange={(e) => updateCheck(index, 'attributeValue', e.target.value)}
                      placeholder="e.g. /logo.png"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addCheck}
        className="px-4 py-2 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full"
      >
        + Add Check
      </button>

      <Modal
        open={showScanModal}
        onClose={() => {
          setShowScanModal(false)
          setScanResults([])
        }}
        title="Scan Page for Selectors"
      >
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Page URL</label>
            <input
              type="text"
              placeholder="https://example.com"
              value={scanUrl}
              onChange={(e) => setScanUrl(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scanIds} onChange={(e) => setScanIds(e.target.checked)} />
              IDs
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scanClasses} onChange={(e) => setScanClasses(e.target.checked)} />
              Classes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scanTestids} onChange={(e) => setScanTestids(e.target.checked)} />
              data-testid
            </label>
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Custom selector (optional)</label>
            <input
              type="text"
              placeholder="e.g. [data-cy]"
              value={scanCustom}
              onChange={(e) => setScanCustom(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={handleScan}
            disabled={!scanUrl.trim() || scanning}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>

          {scanResults.length > 0 && (
            <div>
              {filteredScanResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">All selectors already in list.</p>
              ) : (
                <>
                  <h4 className="text-sm font-medium mb-2">
                    Found {scanResults.length} selectors
                    {filteredScanResults.length < scanResults.length && (
                      <span className="text-muted-foreground font-normal">
                        {' '}({scanResults.length - filteredScanResults.length} already in list)
                      </span>
                    )}
                  </h4>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {filteredScanResults.map((sr) => (
                      <div
                        key={sr.selector}
                        className="flex items-center justify-between gap-2 text-sm border border-border rounded p-2"
                      >
                        <div className="truncate">
                          <code className="text-xs bg-muted px-1 rounded">{sr.selector}</code>
                          <span className="text-muted-foreground ml-2 text-xs">{sr.typeName}</span>
                        </div>
                        <button
                          onClick={() => {
                            persist([...checks, { ...defaultCheck(), selector: sr.selector, label: sr.selector }])
                            setScanResults((prev) => prev.filter((p) => p.selector !== sr.selector))
                          }}
                          className="text-xs text-primary hover:underline shrink-0"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {scanning && scanResults.length === 0 && <p className="text-sm text-muted-foreground">Scanning...</p>}
        </div>
      </Modal>
    </div>
  )
}
