import { createContext, useContext } from 'react'
import type { TargetList, CheckTemplate, Audit, SelectorCheck } from '@/types'

export interface StoreState {
  targetLists: TargetList[]
  checkTemplates: CheckTemplate[]
  audits: Audit[]
  loading: boolean
}

export interface StoreActions {
  createTargetList: (name: string, urls: string[]) => Promise<TargetList>
  updateTargetList: (id: string, data: { name?: string; urls?: string[] }) => Promise<TargetList>
  deleteTargetList: (id: string) => Promise<void>
  createCheckTemplate: (name: string, checks: SelectorCheck[]) => Promise<CheckTemplate>
  updateCheckTemplate: (
    id: string,
    data: { name?: string; checks?: SelectorCheck[] },
  ) => Promise<CheckTemplate>
  patchCheckTemplate: (id: string, data: { name?: string; checks?: SelectorCheck[] }) => void
  deleteCheckTemplate: (id: string) => Promise<void>
  createAudit: (
    name: string,
    targetListId: string,
    checkTemplateId: string,
    config: Audit['config'],
    originOverride?: string,
    urlPostfix?: string,
  ) => Promise<Audit>
  updateAudit: (
    id: string,
    data: { name?: string; config?: Audit['config']; originOverride?: string; urlPostfix?: string },
  ) => Promise<Audit>
  deleteAudit: (id: string) => Promise<void>
  reload: () => Promise<void>
}

export type StoreContextValue = StoreState & StoreActions

export const StoreContext = createContext<StoreContextValue | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within a StoreProvider')
  return ctx
}
