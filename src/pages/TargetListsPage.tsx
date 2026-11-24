import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/hooks/useStore'
import { useHotkeys } from '@/hooks/useHotkeys'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { TargetList } from '@/types'
import { normalizeUrl, openTextFile, saveTextFile, scrapeLinks } from '@/lib/tauri'
import { resolveUrl } from '@/utils/resolveUrl'
import { findDuplicateLists } from '@/utils/detectDuplicates'

export function TargetListsPage() {
  const navigate = useNavigate()
  const { targetLists, audits, checkTemplates, loading, createTargetList, updateTargetList, deleteTargetList } =
    useStore()
  const duplicateLists = useMemo(() => findDuplicateLists(targetLists), [targetLists])
  const [editing, setEditing] = useState<TargetList | null>(null)
  const [name, setName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showScraper, setShowScraper] = useState(false)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [auditModalList, setAuditModalList] = useState<TargetList | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [folderFilter, setFolderFilter] = useState('')
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const uid = useId()

  const folders = useMemo(() => {
    const f = new Set<string>()
    for (const tl of targetLists) if (tl.folder) f.add(tl.folder)
    return [...f].sort()
  }, [targetLists])

  // Validate what will actually be saved: scheme-less lines get https:// (as the backend does).
  const urlLines = urlsText.split('\n').map((u) => normalizeUrl(u)).filter(Boolean)
  const invalidUrls = urlLines.filter((u) => !/^https?:\/\/[^\s]+$/i.test(u))
  const urlCounts = urlLines.reduce<Record<string, number>>((acc, u) => {
    acc[u] = (acc[u] || 0) + 1
    return acc
  }, {})
  const duplicateUrls = urlLines.filter((u) => urlCounts[u] > 1)

  function resetForm() {
    setName('')
    setFolderName('')
    setUrlsText('')
    setEditing(null)
    setShowForm(false)
  }

  function openEdit(list: TargetList) {
    setEditing(list)
    setName(list.name)
    setFolderName(list.folder ?? '')
    setUrlsText(list.urls.join('\n'))
    setShowForm(true)
  }

  const canSave = !!name.trim() && invalidUrls.length === 0 && !saving

  async function handleSave() {
    // The guard lives here so the Cmd/Ctrl+Enter shortcut is validated too (A-68).
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await updateTargetList(editing.id, { name: name.trim(), urls: urlLines, folder: folderName.trim() || null })
      } else {
        await createTargetList(name.trim(), urlLines, folderName.trim() || undefined)
      }
      resetForm()
    } catch (e) {
      setError(`Could not save the target list: ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const visibleLists = useMemo(
    () =>
      [...targetLists]
        .filter((l) => !folderFilter || l.folder === folderFilter)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [targetLists, folderFilter],
  )
  // Bulk actions only touch selected lists that are still visible (A-29).
  const selectedVisible = visibleLists.filter((l) => selectedIds.has(l.id))
  const affectedAudits = audits.filter((a) => selectedVisible.some((l) => l.id === a.targetListId))

  function changeFolderFilter(f: string) {
    setFolderFilter(f)
    setSelectedIds(new Set())
  }

  async function handleBulkDelete() {
    setConfirmBulkDelete(false)
    setError(null)
    const failures: string[] = []
    for (const l of selectedVisible) {
      try {
        await deleteTargetList(l.id)
      } catch (e) {
        // e.g. "This target list is used by N audit(s): ..."
        failures.push(`${l.name}: ${String(e)}`)
      }
    }
    setSelectedIds(new Set())
    if (failures.length > 0) setError(`Some lists could not be deleted. ${failures.join(' ')}`)
  }

  async function handleExport() {
    setError(null)
    try {
      const content = selectedVisible.flatMap((l) => l.urls).join('\n')
      const path = await saveTextFile({
        defaultName: 'exported-urls.txt',
        content,
        filterName: 'Text',
        extensions: ['txt'],
      })
      if (path != null) setSelectedIds(new Set())
    } catch (e) {
      setError(`Export failed: ${String(e)}`)
    }
  }

  async function handleImport() {
    setError(null)
    try {
      const content = await openTextFile({ filterName: 'Text/CSV', extensions: ['txt', 'csv'] })
      if (content == null) return
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !l.startsWith(','))
        .map((l) => l.split(',')[0].trim().replace(/^"(.*)"$/, '$1'))
        .filter(Boolean)
      setUrlsText((prev) => {
        const existing = prev.trim() ? prev + '\n' : ''
        return existing + lines.join('\n')
      })
    } catch (e) {
      setError(`Could not import the file: ${String(e)}`)
    }
  }

  async function handleScrape() {
    if (!scrapeUrl.trim()) return
    setScraping(true)
    setError(null)
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
      setError(`Could not scrape links: ${String(e)}`)
    } finally {
      setScraping(false)
    }
  }

  async function togglePin(list: TargetList) {
    setError(null)
    try {
      await updateTargetList(list.id, { pinned: !list.pinned })
    } catch (e) {
      setError(`Could not update the list: ${String(e)}`)
    }
  }

  useHotkeys(
    {
      'Mod+Enter': () => {
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

      {error && !showForm && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {selectedVisible.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md text-sm">
          <span className="text-muted-foreground">{selectedVisible.length} selected</span>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="ml-auto px-3 py-1 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
          >
            Delete Selected
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors"
          >
            Export URLs
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors">
            Clear
          </button>
        </div>
      )}

      <Modal open={showForm} onClose={resetForm} title={editing ? 'Edit Target List' : 'New Target List'}>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="List name"
            aria-label="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label htmlFor={`${uid}-folder`} className="text-sm text-muted-foreground block mb-1">Folder</label>
            <div className="flex gap-2">
              <input
                id={`${uid}-folder`}
                type="text"
                placeholder="e.g. Production, Staging"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                list="folder-suggestions-tl"
                className="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {folderName && (
                <button onClick={() => setFolderName('')} aria-label="Clear folder" className="px-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Clear
                </button>
              )}
            </div>
            <datalist id="folder-suggestions-tl">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`${uid}-urls`} className="text-sm text-muted-foreground">
                URLs (one per line)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowScraper(!showScraper)}
                  aria-expanded={showScraper}
                  className="text-xs text-primary hover:underline"
                >
                  {showScraper ? 'Hide scraper' : 'Scrape links'}
                </button>
                <button
                  type="button"
                  onClick={handleImport}
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
                  aria-label="Page to scrape links from"
                  value={scrapeUrl}
                  onChange={(e) => setScrapeUrl(e.target.value)}
                  className="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleScrape}
                  disabled={!scrapeUrl.trim() || scraping}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
                >
                  {scraping ? 'Scanning...' : 'Scan'}
                </button>
              </div>
            )}
            <textarea
              id={`${uid}-urls`}
              placeholder="https://example.com&#10;https://example.org"
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {invalidUrls.length > 0 && (
              <p className="text-xs text-destructive mt-1">
                {invalidUrls.length} invalid URL{invalidUrls.length !== 1 ? 's' : ''} (must be http:// or https:// with no spaces)
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
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!canSave}
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

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button onClick={() => changeFolderFilter('')} aria-pressed={!folderFilter} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${!folderFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
            All
          </button>
          {folders.map((f) => (
            <button key={f} onClick={() => changeFolderFilter(f)} aria-pressed={folderFilter === f} className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${folderFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
              {f}
            </button>
          ))}
        </div>
      )}

      {targetLists.length === 0 && (
        <p className="text-muted-foreground text-sm">No target lists yet. Create one to get started.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {visibleLists.map((list) => (
          <div key={list.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(list.id)}
                onChange={() => {
                  const next = new Set(selectedIds)
                  if (next.has(list.id)) next.delete(list.id)
                  else next.add(list.id)
                  setSelectedIds(next)
                }}
                aria-label={`Select ${list.name}`}
                className="accent-primary"
              />
              <button
                onClick={() => togglePin(list)}
                className="text-sm hover:scale-110 transition-transform"
                title={list.pinned ? 'Unpin' : 'Pin'}
                aria-label={list.pinned ? `Unpin ${list.name}` : `Pin ${list.name}`}
                aria-pressed={list.pinned}
              >
                <span aria-hidden="true">{list.pinned ? '★' : '☆'}</span>
              </button>
              <div>
                <h3 className="font-medium">
                  {list.name}
                  {list.folder && (
                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{list.folder}</span>
                  )}
                </h3>
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
                Audit<span className="sr-only">s using {list.name}</span>
              </button>
              <button
                onClick={() => openEdit(list)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit<span className="sr-only"> {list.name}</span>
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
        open={confirmBulkDelete}
        title="Delete Target Lists"
        message={
          `Delete ${selectedVisible.length} target list${selectedVisible.length === 1 ? '' : 's'} (${selectedVisible
            .map((l) => l.name)
            .join(', ')})? This cannot be undone.` +
          (affectedAudits.length > 0
            ? ` Lists used by audits cannot be deleted until those audits are removed or changed: ${affectedAudits
                .map((a) => a.name)
                .join(', ')}.`
            : '')
        }
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
