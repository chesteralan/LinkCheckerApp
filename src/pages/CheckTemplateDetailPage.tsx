import { useId, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { A11yCategoryPicker } from '@/components/A11yCategoryPicker'
import { A11Y_SEVERITIES, A11Y_STANDARDS } from '@/utils/constants'
import { scrapeSelectors } from '@/lib/tauri'
import type { SelectorCheck, CheckType, A11yCheckConfig } from '@/types'
import { defaultCheck } from '@/types'

const CHECK_TYPE_OPTIONS: { value: CheckType; label: string }[] = [
  { value: 'selector', label: 'CSS Selector' },
  { value: 'status', label: 'HTTP Status' },
  { value: 'regex', label: 'Regex Match' },
  { value: 'attribute', label: 'Attribute Check' },
  { value: 'accessibility', label: 'Accessibility (WCAG)' },
  { value: 'javascript', label: 'JavaScript' },
]

export function CheckTemplateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { checkTemplates, patchCheckTemplate, loading, saveError, clearSaveError } = useStore()
  const uid = useId()
  const template = checkTemplates.find((ct) => ct.id === id)
  const checks = template?.checks ?? []

  const [showScanModal, setShowScanModal] = useState(false)
  const [scanUrls, setScanUrls] = useState('')
  const [scanIds, setScanIds] = useState(true)
  const [scanClasses, setScanClasses] = useState(true)
  const [scanTestids, setScanTestids] = useState(true)
  const [scanCustom, setScanCustom] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<{ selector: string; typeName: string }[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!template) {
    return <div className="text-muted-foreground">Template not found.</div>
  }
  const t = template
  const existingSelectors = new Set(checks.map((c) => c.selector))
  const filteredScanResults = scanResults.filter((sr) => !existingSelectors.has(sr.selector))

  // Saves are debounced by the store, which keeps each check's id and adopts the
  // template the backend returns (A-03). Failures roll back and set saveError.
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

  function updateA11yConfig(index: number, patch: Partial<A11yCheckConfig>) {
    const updated = [...checks]
    const current = updated[index].a11yConfig ?? { minSeverity: 'minor' as const, categories: [] }
    updated[index] = { ...updated[index], a11yConfig: { ...current, ...patch } }
    persist(updated)
  }

  async function handleScan() {
    const urls = scanUrls.split('\n').map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) return
    setScanning(true)
    setScanResults([])
    setScanError(null)
    try {
      const results = await scrapeSelectors(urls, {
        selectIds: scanIds,
        selectClasses: scanClasses,
        selectTestids: scanTestids,
        customSelector: scanCustom,
      })
      setScanResults(results)
    } catch (e) {
      console.error(e)
      setScanError(`Scan failed: ${String(e)}`)
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

      {saveError && (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
          <span>Your last change could not be saved and was undone: {saveError}</span>
          <button onClick={clearSaveError} className="text-xs underline hover:no-underline">
            Dismiss
          </button>
        </div>
      )}

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
                aria-label={`Check ${index + 1} type`}
                value={check.checkType}
                onChange={(e) => {
                  const ct = e.target.value as CheckType
                  const updated = [...checks]
                  updated[index] = {
                    ...defaultCheck(),
                    id: check.id,
                    label: check.label,
                    checkType: ct,
                    a11yConfig: ct === 'accessibility' ? { minSeverity: 'minor', categories: [] } : undefined,
                  }
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
                  <label htmlFor={`${uid}-${check.id}-label`} className="text-xs text-muted-foreground block mb-1">Label</label>
                  <input
                    id={`${uid}-${check.id}-label`}
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
                    aria-label={`Move check ${index + 1} up`}
                  ><span aria-hidden="true">↑</span></button>
                  <button
                    onClick={() => moveDown(index)}
                    disabled={index === checks.length - 1}
                    className="px-2 py-1.5 text-xs border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    title="Move down"
                    aria-label={`Move check ${index + 1} down`}
                  ><span aria-hidden="true">↓</span></button>
                  <button
                    onClick={() => removeCheck(index)}
                    className="px-2 py-1.5 text-xs border border-destructive text-destructive rounded hover:bg-destructive/10 transition-colors"
                    title="Remove"
                    aria-label={`Remove check ${index + 1}${check.label ? ` (${check.label})` : ''}`}
                  ><span aria-hidden="true">✕</span></button>
                </div>
              </div>

              {check.checkType === 'selector' && (
                <div>
                  <label htmlFor={`${uid}-${check.id}-selector`} className="text-xs text-muted-foreground block mb-1">CSS Selector</label>
                  <input
                    id={`${uid}-${check.id}-selector`}
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
                  <label htmlFor={`${uid}-${check.id}-status`} className="text-xs text-muted-foreground block mb-1">Expected HTTP Status</label>
                  <input
                    id={`${uid}-${check.id}-status`}
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
                  <label htmlFor={`${uid}-${check.id}-pattern`} className="text-xs text-muted-foreground block mb-1">Regex Pattern</label>
                  <input
                    id={`${uid}-${check.id}-pattern`}
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
                    <label htmlFor={`${uid}-${check.id}-selector`} className="text-xs text-muted-foreground block mb-1">CSS Selector</label>
                    <input
                      id={`${uid}-${check.id}-selector`}
                      type="text"
                      value={check.selector}
                      onChange={(e) => updateCheck(index, 'selector', e.target.value)}
                      placeholder="e.g. img"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${uid}-${check.id}-attr-name`} className="text-xs text-muted-foreground block mb-1">Attribute Name</label>
                    <input
                      id={`${uid}-${check.id}-attr-name`}
                      type="text"
                      value={check.attributeName ?? ''}
                      onChange={(e) => updateCheck(index, 'attributeName', e.target.value)}
                      placeholder="e.g. src"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${uid}-${check.id}-attr-value`} className="text-xs text-muted-foreground block mb-1">Expected Value (optional)</label>
                    <input
                      id={`${uid}-${check.id}-attr-value`}
                      type="text"
                      value={check.attributeValue ?? ''}
                      onChange={(e) => updateCheck(index, 'attributeValue', e.target.value)}
                      placeholder="e.g. /logo.png"
                      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {check.checkType === 'accessibility' && (
                <div className="space-y-3 border border-border/60 rounded-md p-3 bg-muted/20">
                  <p className="text-xs text-muted-foreground">
                    Scans each page for WCAG issues. The check passes when no issues are found at or above the selected severity.
                  </p>
                  <div>
                    <label htmlFor={`${uid}-${check.id}-severity`} className="text-xs text-muted-foreground block mb-1">Minimum severity</label>
                    <select
                      id={`${uid}-${check.id}-severity`}
                      value={check.a11yConfig?.minSeverity ?? 'minor'}
                      onChange={(e) => updateA11yConfig(index, { minSeverity: e.target.value as A11yCheckConfig['minSeverity'] })}
                      className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {A11Y_SEVERITIES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <A11yCategoryPicker
                    legend="Rule categories"
                    legendClassName="text-xs text-muted-foreground mb-1"
                    value={check.a11yConfig?.categories ?? []}
                    onChange={(categories) => updateA11yConfig(index, { categories })}
                  />
                  <div>
                    <p id={`${uid}-${check.id}-stds`} className="text-xs text-muted-foreground block mb-1">
                      Standards (none selected = all)
                    </p>
                    <div role="group" aria-labelledby={`${uid}-${check.id}-stds`} className="flex flex-wrap gap-x-4 gap-y-1">
                      {A11Y_STANDARDS.map((std) => {
                        const stds = check.a11yConfig?.standards ?? []
                        return (
                          <label key={std.value} className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={stds.includes(std.value)}
                              onChange={(e) => {
                                const selected = e.target.checked
                                  ? [...stds, std.value]
                                  : stds.filter((s) => s !== std.value)
                                updateA11yConfig(index, { standards: selected })
                              }}
                            />
                            {std.label}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {check.checkType === 'javascript' && (
                <div>
                  <label htmlFor={`${uid}-${check.id}-js`} className="text-xs text-muted-foreground block mb-1">JS Snippet (must evaluate to true/false)</label>
                  <textarea
                    id={`${uid}-${check.id}-js`}
                    value={check.pattern ?? ''}
                    onChange={(e) => updateCheck(index, 'pattern', e.target.value)}
                    placeholder={'pageText.includes("Welcome");'}
                    rows={3}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Available globals: <code>pageText</code>, <code>pageUrl</code>, <code>pageTitle</code>
                  </p>
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
            <label htmlFor={`${uid}-scan-urls`} className="text-sm text-muted-foreground block mb-1">Page URLs (one per line)</label>
            <textarea
              id={`${uid}-scan-urls`}
              placeholder="https://example.com&#10;https://example.org"
              value={scanUrls}
              onChange={(e) => setScanUrls(e.target.value)}
              rows={3}
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
            <label htmlFor={`${uid}-scan-custom`} className="text-sm text-muted-foreground block mb-1">Custom selector (optional)</label>
            <input
              id={`${uid}-scan-custom`}
              type="text"
              placeholder="e.g. [data-cy]"
              value={scanCustom}
              onChange={(e) => setScanCustom(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={handleScan}
            disabled={!scanUrls.trim() || scanning}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Scan'}
          </button>

          {scanError && (
            <p role="alert" className="text-sm text-destructive">
              {scanError}
            </p>
          )}

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
                          Add<span className="sr-only"> {sr.selector}</span>
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
