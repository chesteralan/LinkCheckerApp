import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRunFiles, clearHistory, pruneHistory } from '@/lib/tauri'
import { Modal } from '@/components/Modal'

const PAGE_SIZE = 20

export function RunHistoryPage() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<{ id: string; startedAt: string; timestampMs: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [showPrune, setShowPrune] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    listRunFiles()
      .then(setFiles)
      .finally(() => setLoading(false))
  }, [])

  async function handleClear() {
    await clearHistory()
    setFiles([])
  }

  async function handlePrune() {
    setPruning(true)
    try {
      await pruneHistory()
      const updated = await listRunFiles()
      setFiles(updated)
      setShowPrune(false)
    } finally {
      setPruning(false)
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
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
              onClick={() => {
                const [a, b] = Array.from(selected)
                navigate(`/history/diff/${a}/${b}`)
              }}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 transition-opacity"
            >
              Compare Selected
            </button>
          )}
          <button
            onClick={() => setShowPrune(true)}
            className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
          >
            Prune Old
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

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
                  className="cursor-pointer"
                />
              </th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium"></th>
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

      <Modal open={showPrune} onClose={() => setShowPrune(false)} title="Prune Old Runs">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Delete runs older than the configured retention period (90 days by default). This frees disk space.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handlePrune}
              disabled={pruning}
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
