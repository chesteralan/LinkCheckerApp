import { useState } from 'react'
import { useStore } from '@/hooks/useStore'
import type { TargetList } from '@/types'
import { normalizeUrl } from '@/lib/tauri'

export function TargetListsPage() {
  const { targetLists, loading, createTargetList, updateTargetList, deleteTargetList } = useStore()
  const [editing, setEditing] = useState<TargetList | null>(null)
  const [name, setName] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [showForm, setShowForm] = useState(false)

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

  async function handleDelete(id: string) {
    await deleteTargetList(id)
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Target Lists</h2>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New List
        </button>
      </div>

      {showForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/20">
          <input
            type="text"
            placeholder="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              URLs (one per line)
            </label>
            <textarea
              placeholder="https://example.com&#10;https://example.org"
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim()}
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
      )}

      {targetLists.length === 0 && !showForm && (
        <p className="text-muted-foreground text-sm">No target lists yet. Create one to get started.</p>
      )}

      <div className="space-y-2">
        {targetLists.map((list) => (
          <div
            key={list.id}
            className="border border-border rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <h3 className="font-medium">{list.name}</h3>
              <p className="text-sm text-muted-foreground">{list.urls.length} URL{list.urls.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openEdit(list)}
                className="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(list.id)}
                className="px-3 py-1.5 text-sm border border-destructive text-destructive rounded-md hover:bg-destructive/10 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
