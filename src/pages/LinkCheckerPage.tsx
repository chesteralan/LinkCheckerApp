import { useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { checkLinks, writeFile } from '@/lib/tauri'

interface LinkResult {
  url: string
  sourceUrl: string
  status: number | null
  statusText: string
  error: string | null
  depth: number
}

function csvEscape(v: string | number | null | undefined): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

export function LinkCheckerPage() {
  const [url, setUrl] = useState('')
  const [maxDepth, setMaxDepth] = useState(1)
  const [sameOriginOnly, setSameOriginOnly] = useState(true)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState<LinkResult[]>([])

  useEffect(() => {
    if (!running) return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  async function handleCheck() {
    if (!url.trim()) return
    setRunning(true)
    setResults([])
    try {
      const res = await checkLinks(url.trim(), {
        maxDepth,
        timeoutSecs: 10,
        sameOriginOnly,
      })
      setResults(res)
    } catch (e) {
      console.error(e)
    } finally {
      setRunning(false)
    }
  }

  async function handleExport(format: 'json' | 'csv') {
    const path = await save({
      defaultPath: `link-check-${Date.now()}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    })
    if (!path) return
    const content =
      format === 'json'
        ? JSON.stringify(results, null, 2)
        : [
            'URL,Source URL,Depth,Status,Status Text,Error',
            ...results.map((r) =>
              [r.url, r.sourceUrl, r.depth, r.status ?? '', r.statusText, r.error ?? '']
                .map(csvEscape)
                .join(',')
            ),
          ].join('\n')
    await writeFile(path, content)
  }

  const passed = results.filter((r) => r.status != null && r.status < 400 && !r.error)
  const broken = results.filter((r) => r.status != null && r.status >= 400)
  const errored = results.filter((r) => r.error)

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Link Checker</h2>
      <p className="text-sm text-muted-foreground">
        Crawl a page, check all outgoing links, and report broken ones.
      </p>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground block mb-1">Page URL</label>
          <input
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Max Depth</label>
          <select
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            disabled={running}
            className="px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            <option value={0}>Page only</option>
            <option value={1}>1 level</option>
            <option value={2}>2 levels</option>
            <option value={3}>3 levels</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={sameOriginOnly} onChange={(e) => setSameOriginOnly(e.target.checked)} disabled={running} />
          Same origin only
        </label>
        <button
          onClick={handleCheck}
          disabled={!url.trim() || running}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          {running && (
            <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          )}
          {running ? `Checking… ${elapsed}s` : 'Check Links'}
        </button>
      </div>

      {running && (
        <div className="border border-border rounded-lg p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Crawling links — this can take a while on large sites (up to 500 pages checked).
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {results.length} link{results.length !== 1 ? 's' : ''}
            </span>
            <span className="text-success">{passed.length} ok</span>
            <span className="text-destructive">{broken.length} broken</span>
            <span className="text-muted-foreground">{errored.length} errored</span>
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
                    <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]" title={r.sourceUrl}>
                      {r.sourceUrl}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
