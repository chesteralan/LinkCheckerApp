import { useState, useCallback } from 'react'
import { useAuditRunner } from '@/hooks/useAuditRunner'
import { useStore } from '@/hooks/useStore'
import { Modal } from '@/components/Modal'
import { ProgressBar } from '@/components/ProgressBar'
import { ResultsTable } from '@/components/ResultsTable'
import { scrapeLinks, normalizeUrl } from '@/lib/tauri'
import type { CheckTemplate, PageResult } from '@/types'

interface Props {
  template: CheckTemplate
  onBack: () => void
}

function resolveUrl(href: string, source: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href
  try {
    const origin = new URL(source).origin
    const joined = href.startsWith('/') ? `${origin}${href}` : `${origin}/${href}`
    return joined
  } catch {
    return href
  }
}

function LiveSummary({ results }: { results: PageResult[] }) {
  const passed = results.filter((r) => !r.error && r.checks.every((c) => c.found)).length
  const failed = results.filter((r) => !r.error && r.checks.some((c) => !c.found)).length
  const errored = results.filter((r) => r.error).length
  const totalMs = results.reduce((s, r) => s + (r.responseTimeMs ?? 0), 0)
  const avg = results.length > 0 ? Math.round(totalMs / results.length) : 0

  return (
    <div className="flex gap-4 text-sm">
      <span className="text-success">✓ {passed} passed</span>
      <span className="text-destructive">✗ {failed} failed</span>
      <span className="text-muted-foreground">⚠ {errored} errored</span>
      <span className="text-muted-foreground">avg {avg}ms</span>
    </div>
  )
}

export function QuickAuditPage({ template, onBack }: Props) {
  const runner = useAuditRunner()
  const { createTargetList, createAudit } = useStore()
  const [urlsText, setUrlsText] = useState('')
  const [showScraper, setShowScraper] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [mode, setMode] = useState<'sequential' | 'batch'>('batch')
  const [batchSize, setBatchSize] = useState(5)
  const [timeoutSecs, setTimeoutSecs] = useState(10)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveAuditName, setSaveAuditName] = useState('')
  const [saveTargetListName, setSaveTargetListName] = useState('')

  async function handleSaveAudit() {
    const name = saveAuditName.trim()
    const tlName = saveTargetListName.trim() || name
    if (!name) return
    const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) return
    const tl = await createTargetList(tlName, urls)
    await createAudit(name, tl.id, template.id, { mode, batchSize, timeoutSecs })
    setShowSaveModal(false)
    setSaveAuditName('')
    setSaveTargetListName('')
  }

  async function handleRun() {
    const urls = urlsText.split('\n').map((u) => normalizeUrl(u)).filter(Boolean)
    if (urls.length === 0) return
    await runner.startQuick(urls, template.checks, { mode, batchSize, timeoutSecs })
  }

  const handleRunCb = useCallback(() => {
    if (!runner.running) handleRun()
  }, [urlsText, template, runner.running])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-primary hover:underline">&larr; Back</button>
          <h2 className="text-2xl font-bold">Quick Audit</h2>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-4">
        <div>
          <h3 className="font-medium">{template.name}</h3>
          <p className="text-sm text-muted-foreground">{template.checks.length} selector{template.checks.length !== 1 ? 's' : ''}</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {template.checks.map((c) => (
              <span key={c.id} className="inline-block px-2 py-0.5 bg-muted text-xs rounded-md" title={c.selector}>
                {c.label}: <code>{c.selector}</code>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm text-muted-foreground">URLs (one per line)</label>
          <button
            type="button"
            onClick={() => setShowScraper(!showScraper)}
            className="text-xs text-primary hover:underline"
          >
            {showScraper ? 'Hide scraper' : 'Scrape links'}
          </button>
        </div>
        {showScraper && (
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder="https://example.com/page"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              className="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              onClick={async () => {
                if (!scrapeUrl.trim()) return
                setScraping(true)
                try {
                  const sourceUrl = normalizeUrl(scrapeUrl)
                  const links = await scrapeLinks(sourceUrl)
                  const resolved = links.map((l) => resolveUrl(l, sourceUrl))
                  setUrlsText((prev) => {
                    const existing = prev.trim() ? prev + '\n' : ''
                    return existing + resolved.join('\n')
                  })
                } catch (e) {
                  console.error(e)
                } finally {
                  setScraping(false)
                }
              }}
              disabled={!scrapeUrl.trim() || scraping}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
            >
              {scraping ? 'Scanning...' : 'Scan'}
            </button>
          </div>
        )}
        <textarea
          placeholder="https://example.com&#10;https://example.org"
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'sequential' | 'batch')}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="sequential">Sequential</option>
            <option value="batch">Batch</option>
          </select>
        </div>
        {mode === 'batch' && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Batch Size</label>
            <input
              type="number"
              min={1}
              max={20}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Timeout (seconds)</label>
          <input
            type="number"
            min={1}
            max={120}
            value={timeoutSecs}
            onChange={(e) => setTimeoutSecs(Number(e.target.value))}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="flex gap-2">
        {runner.running ? (
          <button
            onClick={runner.cancel}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Cancel Run
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleRunCb}
              disabled={!urlsText.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Run Audit
            </button>
            <button
              onClick={() => setShowSaveModal(true)}
              disabled={!urlsText.trim()}
              className="px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted transition-opacity disabled:opacity-50"
            >
              Save to Audits
            </button>
          </div>
        )}
      </div>

      {runner.progress && (
        <ProgressBar checked={runner.progress.checked} total={runner.progress.total} />
      )}

      {(runner.run || runner.running) && (
        <div className="space-y-3">
          <LiveSummary results={runner.run?.results ?? []} />
          <ResultsTable results={runner.run?.results ?? []} selectors={template.checks} />
        </div>
      )}

      {!runner.run && !runner.running && !runner.progress && urlsText.trim() && (
        <p className="text-sm text-muted-foreground">Press "Run Audit" to start checking URLs.</p>
      )}

      <Modal title="Save to Audits" open={showSaveModal} onClose={() => setShowSaveModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">Audit Name</label>
              <input
                type="text"
                value={saveAuditName}
                onChange={(e) => setSaveAuditName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Login Page Check"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Target List Name</label>
              <input
                type="text"
                value={saveTargetListName}
                onChange={(e) => setSaveTargetListName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Defaults to audit name"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAudit}
                disabled={!saveAuditName.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Create Audit
              </button>
            </div>
          </div>
        </Modal>
    </div>
  )
}
