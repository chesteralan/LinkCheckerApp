import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listLinkCheckScans, deleteLinkCheckScan } from '@/lib/tauri'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { LinkCheckScanInfo } from '@/types'

export function LinkCheckHistoryPage() {
  const navigate = useNavigate()
  const [scans, setScans] = useState<LinkCheckScanInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<LinkCheckScanInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setScans(await listLinkCheckScans())
      setError(null)
    } catch (e) {
      setError(`Could not load scan history: ${String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    listLinkCheckScans()
      .then((s) => {
        if (active) setScans(s)
      })
      .catch((e) => {
        if (active) setError(`Could not load scan history: ${String(e)}`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleDelete() {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    try {
      await deleteLinkCheckScan(target.id)
    } catch (e) {
      setError(`Could not delete the scan for ${target.url}: ${String(e)}`)
      return
    }
    await refresh()
  }

  if (loading) {
    return (
      <div className="text-muted-foreground" role="status">
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/link-checker')} className="text-sm text-primary hover:underline">
            &larr; Link Checker
          </button>
          <h2 className="text-2xl font-bold">Link Check History</h2>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {scans.length === 0 ? (
        <p className="text-muted-foreground text-sm">No scans yet. Run a link check to see results here.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">URL</th>
                <th className="px-4 py-2 font-medium w-24">Links</th>
                <th className="px-4 py-2 font-medium w-24">Broken</th>
                <th className="px-4 py-2 font-medium w-24">A11y</th>
                <th className="px-4 py-2 font-medium w-28">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scans.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {new Date(s.timestampMs).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/link-checker/history/${s.id}`)}
                      className="text-primary hover:underline text-xs font-mono truncate max-w-[420px] block text-left"
                      title={s.url}
                    >
                      {s.url}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.totalLinks}</td>
                  <td className="px-4 py-2.5">
                    {s.broken > 0 ? (
                      <span className="text-destructive font-medium">{s.broken}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.a11yIssues > 0 ? (
                      <span className="text-orange-600 dark:text-orange-400">{s.a11yIssues}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => navigate(`/link-checker/history/${s.id}`)}
                      className="text-primary hover:underline text-xs font-medium mr-3"
                      aria-label={`View scan of ${s.url}`}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(s)}
                      className="text-destructive hover:underline text-xs"
                      aria-label={`Delete scan of ${s.url}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
        message={`Delete the saved scan for ${deleting?.url ?? ''}? This cannot be undone.`}
      />
    </div>
  )
}
