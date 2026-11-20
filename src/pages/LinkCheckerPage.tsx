import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { checkLinks } from '@/lib/tauri'
import { LinkScanResults } from '@/components/LinkScanResults'
import type { LinkCheckResult } from '@/types'

interface CheckingItem {
  url: string
  depth: number
  sourceUrl: string
}

export function LinkCheckerPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [maxDepth, setMaxDepth] = useState(1)
  const [sameOriginOnly, setSameOriginOnly] = useState(true)
  const [includeAccessibility, setIncludeAccessibility] = useState(false)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [results, setResults] = useState<LinkCheckResult[]>([])
  const [checking, setChecking] = useState<CheckingItem[]>([])
  const [queued, setQueued] = useState<CheckingItem[]>([])

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
    setChecking([])
    setQueued([])

    const unlisteners: UnlistenFn[] = []
    unlisteners.push(
      await listen<LinkCheckResult>('linkcheck:result', (e) => {
        const r = e.payload
        setResults((prev) => (prev.some((p) => p.url === r.url && p.depth === r.depth) ? prev : [...prev, r]))
        setChecking((prev) => prev.filter((c) => c.url !== r.url))
      }),
    )
    unlisteners.push(
      await listen<CheckingItem>('linkcheck:checking', (e) => {
        setQueued((prev) => prev.filter((c) => c.url !== e.payload.url))
        setChecking((prev) => (prev.some((c) => c.url === e.payload.url) ? prev : [...prev, e.payload]))
      }),
    )
    unlisteners.push(
      await listen<CheckingItem>('linkcheck:discovered', (e) => {
        setQueued((prev) => (prev.some((c) => c.url === e.payload.url) ? prev : [...prev, e.payload]))
      }),
    )

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
      unlisteners.forEach((u) => u())
      setChecking([])
      setQueued([])
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
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            Crawling links{includeAccessibility ? ' with accessibility scans' : ''} — {results.length} checked
            {checking.length > 0 && `, ${checking.length} in flight`}
            {queued.length > 0 && `, ${queued.length} queued`} ({elapsed}s)
          </div>
          {checking.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Checking now</div>
              {checking.slice(0, 50).map((c) => (
                <div key={c.url} className="flex items-center gap-2 text-xs font-mono">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary/60 animate-pulse shrink-0" />
                  <span className="truncate text-muted-foreground">{c.url}</span>
                  <span className="text-muted-foreground/60 shrink-0">d{c.depth}</span>
                </div>
              ))}
              {checking.length > 50 && (
                <div className="text-xs text-muted-foreground">…and {checking.length - 50} more</div>
              )}
            </div>
          )}
          {queued.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Found, queued</div>
              {queued.slice(0, 50).map((c) => (
                <div key={c.url} className="flex items-center gap-2 text-xs font-mono">
                  <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span className="truncate text-muted-foreground/70">{c.url}</span>
                  <span className="text-muted-foreground/50 shrink-0">d{c.depth}</span>
                </div>
              ))}
              {queued.length > 50 && (
                <div className="text-xs text-muted-foreground">…and {queued.length - 50} more</div>
              )}
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <LinkScanResults results={results} showA11yColumn={includeAccessibility} exportName="link-check" />
      )}
    </div>
  )
}
