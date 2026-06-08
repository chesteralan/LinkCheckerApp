import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listRunFiles, clearHistory } from '@/lib/tauri'

export function RunHistoryPage() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<{ id: string; startedAt: string; timestampMs: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listRunFiles()
      .then(setFiles)
      .finally(() => setLoading(false))
  }, [])

  async function handleClear() {
    await clearHistory()
    setFiles([])
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Run History</h2>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
        >
          Clear History
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {files.map((f) => (
              <tr key={f.id} className="hover:bg-muted/30">
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
    </div>
  )
}
