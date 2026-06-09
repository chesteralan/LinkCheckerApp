import { useState, useEffect, useCallback, type ReactNode } from 'react'
import * as api from '@/lib/tauri'
import type { TargetList, CheckTemplate, Audit, SelectorCheck } from '@/types'
import { StoreContext } from './StoreContext'

export function StoreProvider({ children }: { children: ReactNode }) {
  const [targetLists, setTargetLists] = useState<TargetList[]>([])
  const [checkTemplates, setCheckTemplates] = useState<CheckTemplate[]>([])
  const [audits, setAudits] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tl, ct, a] = await Promise.all([api.listTargetLists(), api.listCheckTemplates(), api.listAudits()])
      setTargetLists(tl)
      setCheckTemplates(ct)
      setAudits(a)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([api.listTargetLists(), api.listCheckTemplates(), api.listAudits()])
      .then(([tl, ct, a]) => {
        setTargetLists(tl)
        setCheckTemplates(ct)
        setAudits(a)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const createTargetList = useCallback(async (name: string, urls: string[], folder?: string) => {
    const created = await api.createTargetList({ name, urls, folder: folder ?? null })
    setTargetLists((prev) => [...prev, created])
    return created
  }, [])

  const updateTargetList = useCallback(async (id: string, data: { name?: string; urls?: string[]; pinned?: boolean; folder?: string | null }) => {
    const updated = await api.updateTargetList({ id, ...data })
    setTargetLists((prev) => prev.map((tl) => (tl.id === id ? updated : tl)))
    return updated
  }, [])

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
      setCheckTemplates((prev) => prev.map((ct) => (ct.id === id ? updated : ct)))
      return updated
    },
    [],
  )

  const patchCheckTemplate = useCallback(
    (id: string, data: { name?: string; checks?: SelectorCheck[] }) => {
      setCheckTemplates((prev) =>
        prev.map((ct) => {
          if (ct.id !== id) return ct
          const checks =
            data.checks?.map((c, i) => ({
              ...c,
              id: ct.checks[i]?.id ?? c.id,
            })) ?? ct.checks
          return { ...ct, checks, updatedAt: new Date().toISOString() }
        }),
      )
      api.updateCheckTemplate({ id, ...data }).catch(() => {})
    },
    [],
  )

  const deleteCheckTemplate = useCallback(async (id: string) => {
    await api.deleteCheckTemplate(id)
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
      const created = await api.createAudit({ name, targetListId, checkTemplateId, config, originOverride, urlPostfix, folder: folder ?? null })
      setAudits((prev) => [...prev, created])
      return created
    },
    [],
  )

  const updateAudit = useCallback(
    async (
      id: string,
      data: { name?: string; config?: Audit['config']; originOverride?: string; urlPostfix?: string; pinned?: boolean; folder?: string | null; baselineRunId?: string | null },
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

  return (
    <StoreContext.Provider
      value={{
        targetLists,
        checkTemplates,
        audits,
        loading,
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
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}
