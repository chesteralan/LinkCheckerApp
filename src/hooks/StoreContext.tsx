import { createContext, useContext } from 'react'
import type { TargetList, CheckTemplate, Audit, SelectorCheck } from '@/types'

export interface StoreState {
  targetLists: TargetList[]
  checkTemplates: CheckTemplate[]
  audits: Audit[]
  loading: boolean
  /** Error from the initial load or reload, if any. */
  loadError: string | null
  /**
   * Last failed background save (e.g. a debounced check-template edit). The
   * local change has already been rolled back when this is set.
   */
  saveError: string | null
  /** Problems found while loading data.json at startup (from the backend). */
  storageWarnings: string[]
}

export interface StoreActions {
  createTargetList: (name: string, urls: string[], folder?: string) => Promise<TargetList>
  updateTargetList: (
    id: string,
    data: { name?: string; urls?: string[]; pinned?: boolean; folder?: string | null },
  ) => Promise<TargetList>
  deleteTargetList: (id: string) => Promise<void>
  createCheckTemplate: (name: string, checks: SelectorCheck[], folder?: string) => Promise<CheckTemplate>
  updateCheckTemplate: (
    id: string,
    data: { name?: string; checks?: SelectorCheck[]; pinned?: boolean; folder?: string | null },
  ) => Promise<CheckTemplate>
  /**
   * Optimistically applies an edit and saves it in the background (debounced).
   * On success the store adopts the template returned by the backend; on
   * failure the edit is rolled back and `saveError` is set.
   */
  patchCheckTemplate: (id: string, data: { name?: string; checks?: SelectorCheck[] }) => void
  deleteCheckTemplate: (id: string) => Promise<void>
  createAudit: (
    name: string,
    targetListId: string,
    checkTemplateId: string,
    config: Audit['config'],
    originOverride?: string,
    urlPostfix?: string,
    folder?: string,
  ) => Promise<Audit>
  updateAudit: (
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
  ) => Promise<Audit>
  deleteAudit: (id: string) => Promise<void>
  reload: () => Promise<void>
  clearSaveError: () => void
  dismissStorageWarnings: () => void
}

export type StoreContextValue = StoreState & StoreActions

export const StoreContext = createContext<StoreContextValue | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within a StoreProvider')
  return ctx
}
