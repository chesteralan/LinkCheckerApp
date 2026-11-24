import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRunFiles, clearHistory, pruneHistory, getHistoryRetention, setHistoryRetention } from '@/lib/tauri'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'

const PAGE_SIZE = 20

export function RunHistoryPage() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<{ id: string; startedAt: string; timestampMs: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [showPrune, setShowPrune] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // Retention as typed in the prune dialog; null until it has been loaded.
  const [retention, setRetention] = useState<{ saved: number; input: string } | null>(null)
  const retentionId = useId()

  function openPrune() {
    setShowPrune(true)
    getHistoryRetention()
      .then((days) => setRetention({ saved: days, input: String(days) }))
      .catch(() => setRetention(null))
  }

  const retentionDays = retention ? Number(retention.input) : NaN
  const retentionValid = retention == null || (Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 36500)

  function load() {
    setLoading(true)
    setLoadError(null)
    listRunFiles()
      .then(setFiles)
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    listRunFiles()
      .then(setFiles)
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  async function handleClear() {
    setConfirmClear(false)
    setActionError(null)
    try {
      await clearHistory()
      setFiles([])
      setSelected(new Set())
      setPage(0)
    } catch (e) {
      setActionError(`Could not clear history: ${String(e)}`)
    }
  }

  async function handlePrune() {
    setPruning(true)
    setActionError(null)
    try {
      // Saving a new retention prunes with it; otherwise prune with the saved one.
      if (retention && retentionDays !== retention.saved) {
        await setHistoryRetention(retentionDays)
        setRetention({ saved: retentionDays, input: String(retentionDays) })
      } else {
        await pruneHistory()
      }
      const updated = await listRunFiles()
      setFiles(updated)
      setSelected((prev) => new Set([...prev].filter((id) => updated.some((f) => f.id === id))))
      setPage(0)
      setShowPrune(false)
    } catch (e) {
      setActionError(`Could not prune history: ${String(e)}`)
    } finally {
      setPruning(false)
    }
  }

  function compareSelected() {
    // Diff older -> newer regardless of click order (A-23).
    const picked = files.filter((f) => selected.has(f.id)).sort((x, y) => x.timestampMs - y.timestampMs)
    if (picked.length !== 2) return
    navigate(`/history/diff/${picked[0].id}/${picked[1].id}`)
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Run History</h2>
        <p role="alert" className="text-sm text-destructive">
          Could not load run history: {loadError}
        </p>
        <button
          onClick={load}
          className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Run History</h2>
        <p className="text-muted-foreground text-sm">No runs yet. Run an audit to see results here.</p>
      </div>
    )
  }

  const totalPages = Math.ceil(files.length / PAGE_SIZE)
  const pageFiles = files.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Run History</h2>
        <div className="flex gap-2">
          {selected.size === 2 && (
            <button
              onClick={compareSelected}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              Compare Selected
            </button>
          )}
          <button
            onClick={openPrune}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
          >
            Prune Old
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-4 py-2 font-medium w-10">
                <input
                  type="checkbox"
                  onChange={() => {
                    if (pageFiles.every((f) => selected.has(f.id))) {
                      setSelected(new Set())
                    } else {
                      setSelected(new Set(pageFiles.map((f) => f.id)))
                    }
                  }}
                  checked={pageFiles.length > 0 && pageFiles.every((f) => selected.has(f.id))}
                  aria-label="Select all runs on this page"
                  className="cursor-pointer"
                />
              </th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageFiles.map((f) => (
              <tr key={f.id} className={`hover:bg-muted/30 ${selected.has(f.id) ? 'bg-primary/5' : ''}`}>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) {
                        if (next.size >= 2) {
                          const [first] = next
                          next.delete(first)
                        }
                        next.add(f.id)
                      } else {
                        next.delete(f.id)
                      }
                      setSelected(next)
                    }}
                    aria-label={`Select run from ${new Date(f.timestampMs).toLocaleString()}`}
                    className="cursor-pointer"
                  />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{new Date(f.timestampMs).toLocaleString()}</td>
                <td className="px-4 py-2.5">Quick Audit</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => navigate(`/history/${f.id}`)}
                    className="text-primary hover:underline text-xs font-medium"
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
          >
            ← Prev
          </button>
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
          >
            Next →
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear All History"
        message={`Delete all ${files.length} saved run${files.length === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />

      <Modal open={showPrune} onClose={() => setShowPrune(false)} title="Prune Old Runs">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Delete audit runs, accessibility reports and link-check scans older than the retention period. Old history
            is also pruned automatically at startup and after each run.
          </p>
          {retention && (
            <div className="space-y-1">
              <label htmlFor={retentionId} className="text-sm font-medium">
                Keep history for (days)
              </label>
              <input
                id={retentionId}
                type="number"
                min={1}
                max={36500}
                value={retention.input}
                onChange={(e) => setRetention({ ...retention, input: e.target.value })}
                aria-invalid={!retentionValid}
                className="w-32 px-3 py-1.5 border border-border rounded-md bg-background text-sm"
              />
              {!retentionValid && (
                <p role="alert" className="text-xs text-destructive">
                  Enter a whole number of days between 1 and 36500.
                </p>
              )}
            </div>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handlePrune}
              disabled={pruning || !retentionValid}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pruning ? 'Pruning...' : 'Prune Now'}
            </button>
            <button
              onClick={() => setShowPrune(false)}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
