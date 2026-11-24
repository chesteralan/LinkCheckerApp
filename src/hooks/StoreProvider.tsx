import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import * as api from '@/lib/tauri'
import type { TargetList, CheckTemplate, Audit, SelectorCheck } from '@/types'
import { StoreContext } from './StoreContext'

/** Delay before a burst of check-template edits (e.g. typing) is saved. */
const PATCH_SAVE_DEBOUNCE_MS = 300

type TemplatePatch = { name?: string; checks?: SelectorCheck[] }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : JSON.stringify(e)
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [targetLists, setTargetLists] = useState<TargetList[]>([])
  const [checkTemplates, setCheckTemplates] = useState<CheckTemplate[]>([])
  const [audits, setAudits] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [storageWarnings, setStorageWarnings] = useState<string[]>([])

  // Mirror of checkTemplates for use inside callbacks without stale closures.
  const templatesRef = useRef<CheckTemplate[]>([])
  useEffect(() => {
    templatesRef.current = checkTemplates
  }, [checkTemplates])

  // Debounced background saves for patchCheckTemplate (A-03).
  // confirmed: last version the backend accepted, used for rollback.
  // pending: edits not yet sent. seq: id of the newest request per template.
  const confirmedRef = useRef(new Map<string, CheckTemplate>())
  const pendingRef = useRef(new Map<string, { data: TemplatePatch; timer: ReturnType<typeof setTimeout> }>())
  const seqRef = useRef(new Map<string, number>())

  const applyLoaded = useCallback(([tl, ct, a]: [TargetList[], CheckTemplate[], Audit[]]) => {
    setTargetLists(tl)
    setCheckTemplates(ct)
    setAudits(a)
    confirmedRef.current.clear()
    setLoadError(null)
  }, [])

  const applyLoadError = useCallback((e: unknown) => {
    console.error('Failed to load data', e)
    setLoadError(`Failed to load data: ${errorMessage(e)}`)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      applyLoaded(await Promise.all([api.listTargetLists(), api.listCheckTemplates(), api.listAudits()]))
    } catch (e) {
      applyLoadError(e)
    } finally {
      setLoading(false)
    }
  }, [applyLoaded, applyLoadError])

  useEffect(() => {
    Promise.all([api.listTargetLists(), api.listCheckTemplates(), api.listAudits()])
      .then(applyLoaded)
      .catch(applyLoadError)
      .finally(() => setLoading(false))
    api
      .getStorageWarnings()
      .then(setStorageWarnings)
      .catch((e) => console.error('Failed to read storage warnings', e))
  }, [applyLoaded, applyLoadError])

  const flushPatch = useCallback((id: string) => {
    const pending = pendingRef.current.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingRef.current.delete(id)
    const seq = (seqRef.current.get(id) ?? 0) + 1
    seqRef.current.set(id, seq)
    const isLatest = () => seqRef.current.get(id) === seq && !pendingRef.current.has(id)

    api
      .updateCheckTemplate({ id, ...pending.data })
      .then((saved) => {
        confirmedRef.current.set(id, saved)
        // Adopt the server's copy (canonical check ids, timestamps) unless the
        // user has made further edits since this request was sent.
        if (isLatest()) {
          setCheckTemplates((prev) => prev.map((ct) => (ct.id === id ? saved : ct)))
        }
      })
      .catch((e) => {
        console.error('Failed to save check template', e)
        setSaveError(`Could not save check template: ${errorMessage(e)}`)
        if (isLatest()) {
          const confirmed = confirmedRef.current.get(id)
          if (confirmed) {
            setCheckTemplates((prev) => prev.map((ct) => (ct.id === id ? confirmed : ct)))
          }
        }
      })
  }, [])

  // Send outstanding edits immediately when the provider unmounts.
  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      for (const id of [...pending.keys()]) flushPatch(id)
    }
  }, [flushPatch])

  const createTargetList = useCallback(async (name: string, urls: string[], folder?: string) => {
    const created = await api.createTargetList({ name, urls, folder: folder ?? null })
    setTargetLists((prev) => [...prev, created])
    return created
  }, [])

  const updateTargetList = useCallback(
    async (id: string, data: { name?: string; urls?: string[]; pinned?: boolean; folder?: string | null }) => {
      const updated = await api.updateTargetList({ id, ...data })
      setTargetLists((prev) => prev.map((tl) => (tl.id === id ? updated : tl)))
      return updated
    },
    [],
  )

  const deleteTargetList = useCallback(async (id: string) => {
    await api.deleteTargetList(id)
    setTargetLists((prev) => prev.filter((tl) => tl.id !== id))
  }, [])

  const createCheckTemplate = useCallback(async (name: string, checks: SelectorCheck[], folder?: string) => {
    const created = await api.createCheckTemplate({ name, checks, folder: folder ?? null })
    setCheckTemplates((prev) => [...prev, created])
    return created
  }, [])

  const updateCheckTemplate = useCallback(
    async (id: string, data: { name?: string; checks?: SelectorCheck[]; pinned?: boolean; folder?: string | null }) => {
      const updated = await api.updateCheckTemplate({ id, ...data })
      confirmedRef.current.set(id, updated)
      setCheckTemplates((prev) => prev.map((ct) => (ct.id === id ? updated : ct)))
      return updated
    },
    [],
  )

  const patchCheckTemplate = useCallback(
    (id: string, data: TemplatePatch) => {
      const current = templatesRef.current.find((ct) => ct.id === id)
      if (!current) return
      if (!confirmedRef.current.has(id) && !pendingRef.current.has(id)) {
        confirmedRef.current.set(id, current)
      }

      // Optimistic local update. Check ids are kept as-is: the backend keeps
      // ids it is sent, so results keep matching the template's checks.
      const optimistic: CheckTemplate = {
        ...current,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.checks !== undefined ? { checks: data.checks } : {}),
        updatedAt: new Date().toISOString(),
      }
      templatesRef.current = templatesRef.current.map((ct) => (ct.id === id ? optimistic : ct))
      setCheckTemplates((prev) => prev.map((ct) => (ct.id === id ? optimistic : ct)))

      const prevPending = pendingRef.current.get(id)
      if (prevPending) clearTimeout(prevPending.timer)
      const timer = setTimeout(() => flushPatch(id), PATCH_SAVE_DEBOUNCE_MS)
      pendingRef.current.set(id, { data: { ...prevPending?.data, ...data }, timer })
    },
    [flushPatch],
  )

  const deleteCheckTemplate = useCallback(async (id: string) => {
    await api.deleteCheckTemplate(id)
    const pending = pendingRef.current.get(id)
    if (pending) clearTimeout(pending.timer)
    pendingRef.current.delete(id)
    confirmedRef.current.delete(id)
    setCheckTemplates((prev) => prev.filter((ct) => ct.id !== id))
  }, [])

  const createAudit = useCallback(
    async (
      name: string,
      targetListId: string,
      checkTemplateId: string,
      config: Audit['config'],
      originOverride?: string,
      urlPostfix?: string,
      folder?: string,
    ) => {
      const created = await api.createAudit({
        name,
        targetListId,
        checkTemplateId,
        config,
        originOverride,
        urlPostfix,
        folder: folder ?? null,
      })
      setAudits((prev) => [...prev, created])
      return created
    },
    [],
  )

  const updateAudit = useCallback(
    async (
      id: string,
      data: {
        name?: string
        config?: Audit['config']
        originOverride?: string | null
        urlPostfix?: string | null
        pinned?: boolean
        folder?: string | null
        baselineRunId?: string | null
      },
    ) => {
      const updated = await api.updateAudit({ id, ...data })
      setAudits((prev) => prev.map((a) => (a.id === id ? updated : a)))
      return updated
    },
    [],
  )

  const deleteAudit = useCallback(async (id: string) => {
    await api.deleteAudit(id)
    setAudits((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const clearSaveError = useCallback(() => setSaveError(null), [])
  const dismissStorageWarnings = useCallback(() => setStorageWarnings([]), [])

  return (
    <StoreContext.Provider
      value={{
        targetLists,
        checkTemplates,
        audits,
        loading,
        loadError,
        saveError,
        storageWarnings,
        createTargetList,
        updateTargetList,
        deleteTargetList,
        createCheckTemplate,
        updateCheckTemplate,
        patchCheckTemplate,
        deleteCheckTemplate,
        createAudit,
        updateAudit,
        deleteAudit,
        reload: load,
        clearSaveError,
        dismissStorageWarnings,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}
