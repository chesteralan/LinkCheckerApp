import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  listA11yAudits, createA11yAudit, updateA11yAudit, deleteA11yAudit,
  runA11yAudit, cancelA11yRun, listA11yReports,
} from '@/lib/tauri'
import type { A11yAudit, A11yReportInfo, A11yPageResult, A11yCheckConfig } from '@/types'

const A11Y_CATEGORIES: { value: string; label: string }[] = [
  { value: 'document', label: 'Document' },
  { value: 'headings', label: 'Headings' },
  { value: 'landmarks', label: 'Landmarks' },
  { value: 'aria', label: 'ARIA' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'media', label: 'Media' },
  { value: 'tables', label: 'Tables' },
  { value: 'forms', label: 'Forms' },
]

const A11Y_STANDARDS: { value: string; label: string }[] = [
  { value: 'wcag20', label: 'WCAG 2.0' },
  { value: 'wcag21', label: 'WCAG 2.1' },
  { value: 'wcag22', label: 'WCAG 2.2' },
  { value: 'section508', label: 'Section 508' },
  { value: 'en301549', label: 'EN 301 549' },
  { value: 'bestpractice', label: 'Best practices' },
]

const SEVERITY_OPTIONS: { value: A11yCheckConfig['minSeverity']; label: string }[] = [
  { value: 'minor', label: 'All issues' },
  { value: 'moderate', label: 'Moderate and above' },
  { value: 'serious', label: 'Serious and above' },
  { value: 'critical', label: 'Critical only' },
]

interface FormState {
  id: string | null
  name: string
  targetListId: string
  engine: string
  minSeverity: A11yCheckConfig['minSeverity']
  categories: string[]
  standards: string[]
  mode: 'sequential' | 'batch'
  batchSize: number
  timeoutSecs: number
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  targetListId: '',
  engine: 'static',
  minSeverity: 'minor',
  categories: [],
  standards: [],
  mode: 'batch',
  batchSize: 5,
  timeoutSecs: 10,
}

export function AccessibilityPage() {
  const navigate = useNavigate()
  const { targetLists, loading } = useStore()
  const [audits, setAudits] = useState<A11yAudit[]>([])
  const [reports, setReports] = useState<A11yReportInfo[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<A11yAudit | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null)
  const [liveResults, setLiveResults] = useState<A11yPageResult[]>([])
  const [runError, setRunError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [a, r] = await Promise.all([listA11yAudits(), listA11yReports()])
    setAudits(a)
    setReports(r)
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  useEffect(() => {
    if (!runningId) return
    const unlisteners: UnlistenFn[] = []
    let cancelled = false

    async function setup() {
      unlisteners.push(await listen<{ checked: number; total: number }>('a11y:progress', (e) => setProgress(e.payload)))
      unlisteners.push(await listen<A11yPageResult>('a11y:result', (e) => setLiveResults((prev) => [...prev, e.payload])))
      unlisteners.push(await listen('a11y:complete', () => finish()))
      unlisteners.push(await listen('a11y:cancelled', () => finish()))
      unlisteners.push(await listen<{ message: string }>('a11y:error', (e) => {
        setRunError(e.payload.message)
        finish()
      }))
    }

    function finish() {
      setRunningId(null)
      setProgress(null)
      setLiveResults([])
      refresh().catch(() => {})
    }

    setup().then(() => {
      if (cancelled) unlisteners.forEach((u) => u())
    })

    return () => {
      cancelled = true
      unlisteners.forEach((u) => u())
    }
  }, [runningId, refresh])

  async function handleSave() {
    if (!form.name.trim() || !form.targetListId) return
    const a11yConfig: A11yCheckConfig = {
      minSeverity: form.minSeverity,
      categories: form.categories,
      standards: form.standards,
    }
    const config = { mode: form.mode, batchSize: form.batchSize, timeoutSecs: form.timeoutSecs, headers: {}, cookies: [] }
    if (form.id) {
      await updateA11yAudit({
        id: form.id,
        name: form.name,
        targetListId: form.targetListId,
        engine: form.engine,
        a11yConfig,
        config,
      })
    } else {
      await createA11yAudit({
        name: form.name,
        targetListId: form.targetListId,
        engine: form.engine,
        a11yConfig,
        config,
      })
    }
    setShowForm(false)
    setForm(EMPTY_FORM)
    refresh().catch(() => {})
  }

  function openEdit(audit: A11yAudit) {
    setForm({
      id: audit.id,
      name: audit.name,
      targetListId: audit.targetListId,
      engine: audit.engine || 'static',
      minSeverity: audit.a11yConfig?.minSeverity ?? 'minor',
      categories: audit.a11yConfig?.categories ?? [],
      standards: audit.a11yConfig?.standards ?? [],
      mode: (audit.config.mode as 'sequential' | 'batch') ?? 'batch',
      batchSize: audit.config.batchSize,
      timeoutSecs: audit.config.timeoutSecs,
    })
    setShowForm(true)
  }

  async function handleRun(audit: A11yAudit) {
    setRunningId(audit.id)
    setProgress(null)
    setLiveResults([])
    setRunError(null)
    try {
      await runA11yAudit(audit.id)
    } catch (e) {
      console.error(e)
      setRunningId(null)
    }
  }

  if (loading) return <div className="text-muted-foreground">Loading...</div>

  const issuesSoFar = liveResults.reduce((n, r) => n + r.issues.length, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Accessibility Audits</h2>
          <p className="text-sm text-muted-foreground mt-1">
            WCAG scans across all URLs in a target list.
          </p>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setShowForm(true) }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Audit
        </button>
      </div>

      {runError && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive">
          {runError}
        </div>
      )}

      {runningId && (
        <div className="border border-primary/40 bg-primary/5 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Scanning{progress ? `: ${progress.checked}/${progress.total} pages` : '...'}
              {issuesSoFar > 0 && <span className="text-muted-foreground">· {issuesSoFar} issues so far</span>}
            </span>
            <button
              onClick={() => cancelA11yRun().catch(() => {})}
              className="text-xs px-2 py-0.5 bg-destructive text-destructive-foreground rounded font-medium hover:opacity-90"
            >
              Cancel
            </button>
          </div>
          {progress && (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(progress.checked / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {audits.map((audit) => {
          const tl = targetLists.find((t) => t.id === audit.targetListId)
          const auditReports = reports.filter((r) => r.auditId === audit.id)
          const isRunning = runningId === audit.id
          return (
            <div key={audit.id} className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{audit.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {tl?.name ?? 'Unknown list'} · {tl?.urls.length ?? 0} URLs
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Engine: {audit.engine} · {audit.a11yConfig?.minSeverity ?? 'minor'}+ severity
                    {audit.config.mode === 'batch' && ` · batch x${audit.config.batchSize}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(audit)}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(audit)}
                    className="text-xs px-2 py-1 border border-destructive text-destructive rounded hover:bg-destructive/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRun(audit)}
                  disabled={isRunning || runningId !== null}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isRunning ? 'Running...' : 'Run Audit'}
                </button>
                {auditReports.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/accessibility/reports/${r.id}`)}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    title={new Date(r.startedAt).toLocaleString()}
                  >
                    {new Date(r.startedAt).toLocaleDateString()}
                  </button>
                ))}
                {auditReports.length === 0 && (
                  <span className="text-xs text-muted-foreground">No reports yet</span>
                )}
              </div>
            </div>
          )
        })}
        {audits.length === 0 && (
          <p className="text-muted-foreground text-sm col-span-2">
            No accessibility audits yet. Create one to scan a target list for WCAG issues.
          </p>
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={form.id ? 'Edit Accessibility Audit' : 'New Accessibility Audit'}>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Audit name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Target List</label>
            <select
              value={form.targetListId}
              onChange={(e) => setForm({ ...form, targetListId: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a list...</option>
              {targetLists.map((tl) => (
                <option key={tl.id} value={tl.id}>{tl.name} ({tl.urls.length} URLs)</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Engine</label>
              <select
                value={form.engine}
                onChange={(e) => setForm({ ...form, engine: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="static">Static HTML (fast)</option>
                <option value="axe-core">axe-core (headless browser)</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Minimum severity</label>
              <select
                value={form.minSeverity}
                onChange={(e) => setForm({ ...form, minSeverity: e.target.value as A11yCheckConfig['minSeverity'] })}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as 'sequential' | 'batch' })}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="batch">Batch</option>
                <option value="sequential">Sequential</option>
              </select>
            </div>
          </div>
          {form.mode === 'batch' && (
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Batch Size</label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.batchSize}
                onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) })}
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
              value={form.timeoutSecs}
              onChange={(e) => setForm({ ...form, timeoutSecs: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Rule categories (none selected = all)</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {A11Y_CATEGORIES.map((cat) => (
                <label key={cat.value} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={form.categories.length === 0 || form.categories.includes(cat.value)}
                    onChange={(e) => {
                      const all = A11Y_CATEGORIES.map((c) => c.value)
                      const base = form.categories.length === 0 ? all : form.categories
                      const selected = e.target.checked
                        ? [...new Set([...base, cat.value])]
                        : base.filter((c) => c !== cat.value)
                      setForm({ ...form, categories: selected })
                    }}
                  />
                  {cat.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              Standards (none selected = all WCAG + best practices)
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {A11Y_STANDARDS.map((std) => (
                <label key={std.value} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={form.standards.includes(std.value)}
                    onChange={(e) => {
                      const selected = e.target.checked
                        ? [...form.standards, std.value]
                        : form.standards.filter((s) => s !== std.value)
                      setForm({ ...form, standards: selected })
                    }}
                  />
                  {std.label}
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              WCAG levels are cumulative; axe adds native EN 301 549 and Section 508 tags.
              Best practices only apply to the axe-core engine.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.targetListId}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {form.id ? 'Save' : 'Create'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteA11yAudit(deleteTarget.id)
            refresh().catch(() => {})
          }
          setDeleteTarget(null)
        }}
        message={`Delete "${deleteTarget?.name}" and all its reports?`}
      />
    </div>
  )
}
