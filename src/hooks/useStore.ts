import { useState, useEffect, useCallback } from 'react'
import type { TargetList, CheckTemplate, Audit } from '@/types'
import * as api from '@/lib/tauri'

interface Store {
  targetLists: TargetList[]
  checkTemplates: CheckTemplate[]
  audits: Audit[]
  loading: boolean
}

export function useStore() {
  const [state, setState] = useState<Store>({
    targetLists: [],
    checkTemplates: [],
    audits: [],
    loading: true,
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const [targetLists, checkTemplates, audits] = await Promise.all([
        api.listTargetLists(),
        api.listCheckTemplates(),
        api.listAudits(),
      ])
      setState({ targetLists, checkTemplates, audits, loading: false })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createTargetList = useCallback(async (name: string, urls: string[]) => {
    const created = await api.createTargetList({ name, urls })
    setState((s) => ({
      ...s,
      targetLists: [...s.targetLists, created],
    }))
    return created
  }, [])

  const updateTargetList = useCallback(async (id: string, data: { name?: string; urls?: string[] }) => {
    const updated = await api.updateTargetList({ id, ...data })
    setState((s) => ({
      ...s,
      targetLists: s.targetLists.map((tl) => (tl.id === id ? updated : tl)),
    }))
    return updated
  }, [])

  const deleteTargetList = useCallback(async (id: string) => {
    await api.deleteTargetList(id)
    setState((s) => ({
      ...s,
      targetLists: s.targetLists.filter((tl) => tl.id !== id),
    }))
  }, [])

  const createCheckTemplate = useCallback(async (name: string, checks: { selector: string; label: string }[]) => {
    const created = await api.createCheckTemplate({ name, checks })
    setState((s) => ({
      ...s,
      checkTemplates: [...s.checkTemplates, created],
    }))
    return created
  }, [])

  const updateCheckTemplate = useCallback(async (id: string, data: { name?: string; checks?: { selector: string; label: string }[] }) => {
    const updated = await api.updateCheckTemplate({ id, ...data })
    setState((s) => ({
      ...s,
      checkTemplates: s.checkTemplates.map((ct) => (ct.id === id ? updated : ct)),
    }))
    return updated
  }, [])

  const deleteCheckTemplate = useCallback(async (id: string) => {
    await api.deleteCheckTemplate(id)
    setState((s) => ({
      ...s,
      checkTemplates: s.checkTemplates.filter((ct) => ct.id !== id),
    }))
  }, [])

  const createAudit = useCallback(async (name: string, targetListId: string, checkTemplateId: string, config: Audit['config']) => {
    const created = await api.createAudit({ name, targetListId, checkTemplateId, config })
    setState((s) => ({
      ...s,
      audits: [...s.audits, created],
    }))
    return created
  }, [])

  const deleteAudit = useCallback(async (id: string) => {
    await api.deleteAudit(id)
    setState((s) => ({
      ...s,
      audits: s.audits.filter((a) => a.id !== id),
    }))
  }, [])

  return {
    ...state,
    createTargetList,
    updateTargetList,
    deleteTargetList,
    createCheckTemplate,
    updateCheckTemplate,
    deleteCheckTemplate,
    createAudit,
    deleteAudit,
    reload: load,
  }
}
