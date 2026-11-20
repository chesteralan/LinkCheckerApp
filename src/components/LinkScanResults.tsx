import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@/lib/tauri'
import { A11yIssuesList } from '@/components/A11yIssuesList'
import { Modal } from '@/components/Modal'
import type { LinkCheckResult } from '@/types'

function csvEscape(v: string | number | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

export function LinkScanResults({
  results,
  showA11yColumn = false,
  exportName = 'link-check',
}: {
  results: LinkCheckResult[]
  showA11yColumn?: boolean
  exportName?: string
}) {
  const [a11yModal, setA11yModal] = useState<LinkCheckResult | null>(null)

  async function handleExport(format: 'json' | 'csv') {
    const path = await save({
      defaultPath: `${exportName}-${Date.now()}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    if (!path) return
    const content =
      format === 'json'
        ? JSON.stringify(results, null, 2)
        : [
            'URL,Source URL,Depth,Status,Status Text,Error,A11y Issues',
            ...results.map((r) =>
              [r.url, r.sourceUrl, r.depth, r.status ?? '', r.statusText, r.error ?? '', r.a11yIssues?.length ?? 0]
                .map(csvEscape)
                .join(',')
            ),
          ].join('\n')
    await writeFile(path, content)
  }

  const passed = results.filter((r) => r.status != null && r.status < 400 && !r.error)
  const broken = results.filter((r) => r.status != null && r.status >= 400)
  const errored = results.filter((r) => r.error)
  const totalA11y = results.reduce((n, r) => n + (r.a11yIssues?.length ?? 0), 0)
  const a11yCol = showA11yColumn || totalA11y > 0

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-muted-foreground">
          {results.length} link{results.length !== 1 ? 's' : ''}
        </span>
        <span className="text-success">{passed.length} ok</span>
        <span className="text-destructive">{broken.length} broken</span>
        <span className="text-muted-foreground">{errored.length} errored</span>
        {a11yCol && (
          <span className="text-muted-foreground">
            {totalA11y} a11y issue{totalA11y !== 1 ? 's' : ''}
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => handleExport('json')}
          className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
        >
          Export JSON
        </button>
        <button
          onClick={() => handleExport('csv')}
          className="text-xs px-3 py-1 border border-border rounded-md hover:bg-muted transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium">URL</th>
              <th className="px-3 py-2 font-medium w-20">Status</th>
              <th className="px-3 py-2 font-medium w-20">Depth</th>
              {a11yCol && <th className="px-3 py-2 font-medium w-20">A11y</th>}
              <th className="px-3 py-2 font-medium w-32">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {results.map((r) => (
              <tr key={r.url + r.depth} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <button
                    onClick={() => openUrl(r.url)}
                    className="text-primary hover:underline text-xs font-mono truncate max-w-[400px] block"
                    title={r.url}
                  >
                    {r.depth === 0 && <span className="text-muted-foreground mr-1">›</span>}
                    {r.url}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {r.error ? (
                    <span className="text-destructive text-xs" title={r.error}>
                      error
                    </span>
                  ) : r.status != null && r.status >= 400 ? (
                    <span className="text-destructive text-xs font-medium">
                      {r.status} {r.statusText}
                    </span>
                  ) : r.status != null ? (
                    <span className="text-success text-xs">
                      {r.status} {r.statusText}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.depth}</td>
                {a11yCol && (
                  <td className="px-3 py-2">
                    {(r.a11yIssues?.length ?? 0) > 0 ? (
                      <button
                        onClick={() => setA11yModal(r)}
                        className="text-xs px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium hover:opacity-80"
                      >
                        {r.a11yIssues.length} issues
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]" title={r.sourceUrl}>
                  {r.sourceUrl}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={a11yModal !== null}
        onClose={() => setA11yModal(null)}
        title={`Accessibility issues — ${a11yModal?.url ?? ''}`}
      >
        {a11yModal && <A11yIssuesList issues={a11yModal.a11yIssues ?? []} maxHeight="60vh" />}
      </Modal>
    </>
  )
}
