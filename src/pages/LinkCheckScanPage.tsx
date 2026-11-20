import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getLinkCheckScan, deleteLinkCheckScan } from '@/lib/tauri'
import { LinkScanResults } from '@/components/LinkScanResults'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { LinkCheckScan } from '@/types'

export function LinkCheckScanPage() {
  const { scanId } = useParams<{ scanId: string }>()
  const navigate = useNavigate()
  const [scan, setScan] = useState<LinkCheckScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!scanId) return
    getLinkCheckScan(scanId)
      .then(setScan)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [scanId])

  async function handleDelete() {
    if (!scan) return
    await deleteLinkCheckScan(scan.id)
    navigate('/link-checker/history')
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  if (!scan) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Scan not found.</p>
        <button onClick={() => navigate('/link-checker/history')} className="text-sm text-primary hover:underline">
          &larr; Back to history
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/link-checker/history')} className="text-sm text-primary hover:underline shrink-0">
            &larr; History
          </button>
          <h2 className="text-2xl font-bold truncate">{scan.url}</h2>
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="text-sm text-destructive hover:underline shrink-0"
        >
          Delete scan
        </button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>Scanned {new Date(scan.startedAt).toLocaleString()}</span>
        <span>Depth: {scan.maxDepth === 0 ? 'page only' : `${scan.maxDepth} level${scan.maxDepth !== 1 ? 's' : ''}`}</span>
        <span>{scan.sameOriginOnly ? 'Same origin' : 'All origins'}</span>
        {scan.includeAccessibility && <span>Accessibility: on</span>}
      </div>

      <LinkScanResults
        results={scan.results}
        showA11yColumn={scan.includeAccessibility}
        exportName={`link-check-${scan.url.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`}
      />

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        message={`Delete the saved scan for ${scan.url}? This cannot be undone.`}
      />
    </div>
  )
}
