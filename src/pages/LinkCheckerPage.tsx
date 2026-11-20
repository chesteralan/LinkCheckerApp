import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { checkLinks } from '@/lib/tauri'
import { LinkScanResults } from '@/components/LinkScanResults'
import type { LinkCheckResult } from '@/types'

export function LinkCheckerPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [maxDepth, setMaxDepth] = useState(1)
  const [sameOriginOnly, setSameOriginOnly] = useState(true)
  const [includeAccessibility, setIncludeAccessibility] = useState(false)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState<LinkCheckResult[]>([])

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
        includeAccessibility,
      })
      setResults(res)
    } catch (e) {
      console.error(e)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Link Checker</h2>
        <button
          onClick={() => navigate('/link-checker/history')}
          className="text-sm text-primary hover:underline"
        >
          History &rarr;
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Crawl a page, check all outgoing links, and report broken ones.
      </p>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
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
        <label className="flex items-center gap-2 text-sm pb-2" title="Run the static WCAG rule engine on each fetched page (slower — downloads full HTML)">
          <input
            type="checkbox"
            checked={includeAccessibility}
            onChange={(e) => setIncludeAccessibility(e.target.checked)}
            disabled={running}
          />
          Include accessibility
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
          Crawling links{includeAccessibility ? ' with accessibility scans' : ''} — this can take a while on large sites (up to 500 pages checked).
        </div>
      )}

      {results.length > 0 && (
        <LinkScanResults results={results} showA11yColumn={includeAccessibility} exportName="link-check" />
      )}
    </div>
  )
}
