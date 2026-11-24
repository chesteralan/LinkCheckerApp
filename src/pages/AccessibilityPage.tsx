import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { A11yCategoryPicker } from '@/components/A11yCategoryPicker'
import { A11Y_SEVERITIES, A11Y_STANDARDS } from '@/utils/constants'
import {
  listA11yAudits,
  createA11yAudit,
  updateA11yAudit,
  deleteA11yAudit,
  runA11yAudit,
  cancelA11yRun,
  listA11yReports,
} from '@/lib/tauri'
import type {
  A11yAudit,
  A11yReportInfo,
  A11yPageResult,
  A11yCheckConfig,
  A11yProgressEvent,
  A11yResultEvent,
} from '@/types'

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fieldId = useId()

  const refresh = useCallback(
    () =>
      Promise.all([listA11yAudits(), listA11yReports()]).then(([a, r]) => {
        setAudits(a)
        setReports(r)
        setLoadError(null)
      }),
    [],
  )

  useEffect(() => {
    let active = true
    Promise.all([listA11yAudits(), listA11yReports()])
      .then(([a, r]) => {
        if (!active) return
        setAudits(a)
        setReports(r)
        setLoadError(null)
      })
      .catch((e) => {
        if (active) setLoadError(String(e))
      })
    return () => {
      active = false
    }
  }, [])

  // Listeners for the active run. Kept in a ref so they are removed on unmount
  // even while the run command is still pending.
  const unlistenRef = useRef<UnlistenFn[]>([])
  const stopListening = useCallback(() => {
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []
  }, [])
  useEffect(() => stopListening, [stopListening])

  async function handleSave() {
    if (!form.name.trim() || !form.targetListId) return
    setSaveError(null)
    const a11yConfig: A11yCheckConfig = {
      minSeverity: form.minSeverity,
      categories: form.categories,
      standards: form.standards,
    }
    const config = {
      mode: form.mode,
      batchSize: Math.max(1, Math.round(form.batchSize) || 1),
      timeoutSecs: Math.max(1, Math.round(form.timeoutSecs) || 1),
      headers: {},
      cookies: [],
    }
    try {
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
    } catch (e) {
      setSaveError(String(e))
      return
    }
    setShowForm(false)
    setForm(EMPTY_FORM)
    refresh().catch(() => {})
  }

  function openEdit(audit: A11yAudit) {
    setSaveError(null)
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
    if (runningId) return
    setRunningId(audit.id)
    setProgress(null)
    setLiveResults([])
    setRunError(null)

    // The backend assigns the report id; adopt it from the first event and
    // ignore anything from a different job (for example a re-run started from
    // a report page, which is flagged `rerun: true`).
    let reportId: string | null = null
    const accept = (p: { reportId: string; rerun: boolean }) => {
      if (p.rerun) return false
      if (reportId === null) reportId = p.reportId
      return p.reportId === reportId
    }

    // Register listeners before invoking so a fast run cannot slip past them.
    stopListening()
    try {
      unlistenRef.current.push(
        await listen<A11yProgressEvent>('a11y:progress', (e) => {
          if (accept(e.payload)) setProgress({ checked: e.payload.checked, total: e.payload.total })
        }),
      )
      unlistenRef.current.push(
        await listen<A11yResultEvent>('a11y:result', (e) => {
          if (!accept(e.payload)) return
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { reportId: _r, rerun: _x, ...result } = e.payload
          setLiveResults((prev) => [...prev, result])
        }),
      )
      // The command resolves only after the report is saved (and after
      // a11y:complete / a11y:cancelled have been emitted), and rejects with the
      // same message a11y:error carries, so the promise is the terminal signal.
      await runA11yAudit(audit.id)
    } catch (e) {
      setRunError(String(e))
    } finally {
      stopListening()
      setRunningId(null)
      setProgress(null)
      setLiveResults([])
      refresh().catch(() => {})
    }
  }

  async function handleCancel() {
    try {
      await cancelA11yRun()
    } catch (e) {
      setRunError(`Could not cancel: ${String(e)}`)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteA11yAudit(deleteTarget.id)
      setDeleteTarget(null)
      refresh().catch(() => {})
    } catch (e) {
      setDeleteTarget(null)
      setRunError(`Could not delete "${deleteTarget.name}": ${String(e)}`)
    }
  }

  if (loading) return <div className="text-muted-foreground">Loading...</div>

  const issuesSoFar = liveResults.reduce((n, r) => n + r.issues.length, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Accessibility Audits</h2>
          <p className="text-sm text-muted-foreground mt-1">WCAG scans across all URLs in a target list.</p>
        </div>
        <button
          onClick={() => {
            setSaveError(null)
            setForm(EMPTY_FORM)
            setShowForm(true)
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Audit
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive"
        >
          Could not load accessibility audits: {loadError}
        </div>
      )}

      {runError && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive flex items-start justify-between gap-3"
        >
          <span>{runError}</span>
          <button
            type="button"
            onClick={() => setRunError(null)}
            aria-label="Dismiss error"
            className="text-xs hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {runningId && (
        <div className="border border-primary/40 bg-primary/5 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2" role="status" aria-live="polite">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
              Scanning{progress ? `: ${progress.checked}/${progress.total} pages` : '...'}
              {issuesSoFar > 0 && <span className="text-muted-foreground">· {issuesSoFar} issues so far</span>}
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs px-2 py-0.5 bg-destructive text-destructive-foreground rounded font-medium hover:opacity-90"
            >
              Cancel
            </button>
          </div>
          {progress && (
            <div
              className="w-full h-1.5 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-label="Accessibility scan progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.checked}
            >
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progress.total > 0 ? (progress.checked / progress.total) * 100 : 0}%` }}
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
                    type="button"
                    onClick={() => openEdit(audit)}
                    aria-label={`Edit ${audit.name}`}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(audit)}
                    aria-label={`Delete ${audit.name}`}
                    className="text-xs px-2 py-1 border border-destructive text-destructive rounded hover:bg-destructive/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRun(audit)}
                  disabled={runningId !== null}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isRunning ? 'Running...' : 'Run Audit'}
                </button>
                {auditReports.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => navigate(`/accessibility/reports/${r.id}`)}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    title={new Date(r.startedAt).toLocaleString()}
                    aria-label={`Open ${audit.name} report from ${new Date(r.startedAt).toLocaleString()}`}
                  >
                    {new Date(r.startedAt).toLocaleDateString()}
                  </button>
                ))}
                {auditReports.length === 0 && <span className="text-xs text-muted-foreground">No reports yet</span>}
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

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={form.id ? 'Edit Accessibility Audit' : 'New Accessibility Audit'}
      >
        <div className="space-y-4">
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              Could not save: {saveError}
            </p>
          )}
          <input
            type="text"
            aria-label="Audit name"
            placeholder="Audit name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label htmlFor={`${fieldId}-tl`} className="text-sm text-muted-foreground block mb-1">
              Target List
            </label>
            <select
              id={`${fieldId}-tl`}
              value={form.targetListId}
              onChange={(e) => setForm({ ...form, targetListId: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a list...</option>
              {targetLists.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name} ({tl.urls.length} URLs)
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${fieldId}-engine`} className="text-sm text-muted-foreground block mb-1">
                Engine
              </label>
              <select
                id={`${fieldId}-engine`}
                value={form.engine}
                onChange={(e) => setForm({ ...form, engine: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="static">Static HTML (fast)</option>
                <option value="axe-core">axe-core (headless browser)</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-sev`} className="text-sm text-muted-foreground block mb-1">
                Minimum severity
              </label>
              <select
                id={`${fieldId}-sev`}
                value={form.minSeverity}
                onChange={(e) => setForm({ ...form, minSeverity: e.target.value as A11yCheckConfig['minSeverity'] })}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {A11Y_SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-mode`} className="text-sm text-muted-foreground block mb-1">
                Mode
              </label>
              <select
                id={`${fieldId}-mode`}
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
              <label htmlFor={`${fieldId}-batch`} className="text-sm text-muted-foreground block mb-1">
                Batch Size
              </label>
              <input
                id={`${fieldId}-batch`}
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
            <label htmlFor={`${fieldId}-timeout`} className="text-sm text-muted-foreground block mb-1">
              Timeout (seconds)
            </label>
            <input
              id={`${fieldId}-timeout`}
              type="number"
              min={1}
              max={120}
              value={form.timeoutSecs}
              onChange={(e) => setForm({ ...form, timeoutSecs: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <A11yCategoryPicker
            legend="Rule categories"
            value={form.categories}
            onChange={(categories) => setForm({ ...form, categories })}
          />
          <fieldset>
            <legend className="text-sm text-muted-foreground mb-1">
              Standards (none selected = all WCAG + best practices)
            </legend>
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
              WCAG levels are cumulative; axe adds native EN 301 549 and Section 508 tags. Best practices only apply to
              the axe-core engine.
            </p>
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
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
        onConfirm={handleDelete}
        message={`Delete "${deleteTarget?.name}" and all its reports?`}
      />
    </div>
  )
}
