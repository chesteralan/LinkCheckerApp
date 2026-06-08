import { openUrl } from '@tauri-apps/plugin-opener'
import type { PageResult, SelectorCheck } from '@/types'

interface Props {
  results: PageResult[]
  selectors: SelectorCheck[]
}

export function ResultsTable({ results, selectors }: Props) {
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">No results yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 font-medium">URL</th>
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-right py-2 px-3 font-medium">Time</th>
            <th className="text-left py-2 px-3 font-medium">Page Title</th>
            {selectors.map((sel) => (
              <th key={sel.id} className="text-left py-2 px-3 font-medium" title={sel.selector}>
                {sel.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((result, i) => (
            <tr key={i} className="border-b border-border hover:bg-muted/30">
              <td className="py-2 px-3 max-w-[200px] truncate font-mono text-xs" title={result.url}>
                <button
                  onClick={() => openUrl(result.url)}
                  className="hover:text-primary hover:underline text-left w-full truncate"
                >
                  {result.url}
                </button>
              </td>
              <td className="py-2 px-3">
                {result.error ? (
                  <span className="text-destructive text-xs">{result.error}</span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 ${(result.status ?? 0) >= 400 ? 'text-destructive' : 'text-success'}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${(result.status ?? 0) >= 400 ? 'bg-destructive' : 'bg-success'}`}
                    />
                    {result.status}
                  </span>
                )}
              </td>
              <td className="py-2 px-3 text-right text-muted-foreground">
                {result.responseTimeMs != null ? `${result.responseTimeMs}ms` : '—'}
              </td>
              <td className="py-2 px-3 max-w-[150px] truncate text-muted-foreground" title={result.pageTitle ?? ''}>
                {result.pageTitle ?? '—'}
              </td>
              {selectors.map((sel) => {
                const cr = result.checks.find((c) => c.selectorCheckId === sel.id)
                return (
                  <td key={sel.id} className="py-2 px-3">
                    {cr ? (
                      <span className={cr.found ? 'text-success' : 'text-destructive'}>
                        {cr.found ? '✓' : '✗'}
                        {cr.found && cr.textContent && (
                          <span className="ml-1 text-xs text-muted-foreground" title={cr.textContent}>
                            ({cr.count})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
