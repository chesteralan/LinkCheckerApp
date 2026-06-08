import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { TargetList } from '@/types'
import { normalizeUrl, readFile, scrapeLinks } from '@/lib/tauri'
import { resolveUrl } from '@/utils/resolveUrl'
import { findDuplicateLists } from '@/utils/detectDuplicates'

export function TargetListsPage() {
  const navigate = useNavigate()
  const { targetLists, audits, checkTemplates, loading, createTargetList, updateTargetList, deleteTargetList } =
    useStore()
  const duplicateLists = useMemo(() => findDuplicateLists(targetLists), [targetLists])
  const [editing, setEditing] = useState<TargetList | null>(null)
  const [name, setName] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showScraper, setShowScraper] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [auditModalList, setAuditModalList] = useState<TargetList | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TargetList | null>(null)

  const urlLines = urlsText.split('\n').map((u) => u.trim()).filter(Boolean)
  const invalidUrls = urlLines.filter((u) => u && !/^https?:\/\/[^\s]+/.test(u))
  const urlCounts = urlLines.reduce<Record<string, number>>((acc, u) => {
    acc[u] = (acc[u] || 0) + 1
    return acc
  }, {})
  const duplicateUrls = urlLines.filter((u) => urlCounts[u] > 1)

  function resetForm() {
    setName('')
    setUrlsText('')
    setEditing(null)
    setShowForm(false)
  }

  function openEdit(list: TargetList) {
    setEditing(list)
    setName(list.name)
    setUrlsText(list.urls.join('\n'))
    setShowForm(true)
  }

  async function handleSave() {
    const urls = urlsText
      .split('\n')
      .map((u) => normalizeUrl(u))
      .filter(Boolean)

    if (editing) {
      await updateTargetList(editing.id, { name, urls })
    } else {
      await createTargetList(name, urls)
    }
    resetForm()
  }

  async function handleDeleteConfirm() {
    if (!confirmDelete) return
    await deleteTargetList(confirmDelete.id)
    setConfirmDelete(null)
  }

  useHotkeys(
    {
      'Cmd+Enter': () => {
        if (showForm) handleSave()
      },
      'Ctrl+Enter': () => {
        if (showForm) handleSave()
      },
    },
    showForm,
  )

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Target Lists</h2>
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New List
        </button>
      </div>

      <Modal open={showForm} onClose={resetForm} title={editing ? 'Edit Target List' : 'New Target List'}>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-muted-foreground">URLs (one per line)</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowScraper(!showScraper)}
                  className="text-xs text-primary hover:underline"
                >
                  {showScraper ? 'Hide scraper' : 'Scrape links'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const path = await open({
                      multiple: false,
                      filters: [{ name: 'Text/CSV', extensions: ['txt', 'csv'] }],
                    })
                    if (!path) return
                    const content = await readFile(path)
                    const lines = content
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .filter((l) => !l.startsWith(','))
                      .map((l) => l.split(',')[0])
                    setUrlsText((prev) => {
                      const existing = prev.trim() ? prev + '\n' : ''
                      return existing + lines.join('\n')
                    })
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Import file
                </button>
              </div>
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
            {invalidUrls.length > 0 && (
              <p className="text-xs text-destructive mt-1">
                {invalidUrls.length} invalid URL{invalidUrls.length !== 1 ? 's' : ''} (must start with http:// or https://)
              </p>
            )}
            {duplicateUrls.length > 0 && (
              <p className="text-xs text-warning mt-1">
                {duplicateUrls.length} duplicate{duplicateUrls.length !== 1 ? 's' : ''} found
              </p>
            )}
            {urlLines.length > 0 && invalidUrls.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">{urlLines.length} URL{urlLines.length !== 1 ? 's' : ''}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || (urlLines.length > 0 && invalidUrls.length > 0)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {editing ? 'Update' : 'Create'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {targetLists.length === 0 && (
        <p className="text-muted-foreground text-sm">No target lists yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {[...targetLists].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((list) => (
          <div key={list.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => updateTargetList(list.id, { pinned: !list.pinned })}
                className="text-sm hover:scale-110 transition-transform"
                title={list.pinned ? 'Unpin' : 'Pin'}
              >
                {list.pinned ? '★' : '☆'}
              </button>
              <div>
                <h3 className="font-medium">{list.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {list.urls.length} URL{list.urls.length !== 1 ? 's' : ''}
                  {duplicateLists.has(list.id) && (
                    <span className="ml-2 text-xs text-warning" title={`Duplicate of ${duplicateLists.get(list.id)?.length} other list${duplicateLists.get(list.id)?.length !== 1 ? 's' : ''}`}>
                      ⚠ Duplicate
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAuditModalList(list)}
                className="px-3 py-1.5 text-sm border border-primary text-primary rounded-md hover:bg-primary/10 transition-colors"
              >
                Audit
              </button>
              <button
                onClick={() => openEdit(list)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmDelete(list)}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={!!auditModalList}
        onClose={() => setAuditModalList(null)}
        title={`Audits · ${auditModalList?.name ?? ''}`}
      >
        {auditModalList &&
          (() => {
            const related = audits.filter((a) => a.targetListId === auditModalList.id)
            if (related.length === 0) {
              return <p className="text-sm text-muted-foreground">No audits use this target list.</p>
            }
            return (
              <div className="space-y-2">
                {related.map((audit) => {
                  const ct = checkTemplates.find((t) => t.id === audit.checkTemplateId)
                  return (
                    <button
                      key={audit.id}
                      onClick={() => {
                        setAuditModalList(null)
                        navigate(`/audits/${audit.id}`)
                      }}
                      className="w-full text-left border border-border rounded-lg p-3 hover:border-primary transition-colors cursor-pointer"
                    >
                      <div className="font-medium">{audit.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {ct?.name ?? 'Unknown template'}
                        {' · '}
                        {audit.config.mode === 'sequential' ? 'Sequential' : `Batch x${audit.config.batchSize}`}
                        {' · '}
                        {audit.config.timeoutSecs}s timeout
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })()}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        message={`Delete target list "${confirmDelete?.name ?? ''}"? This action cannot be undone.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
