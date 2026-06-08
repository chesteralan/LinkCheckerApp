import { invoke } from '@tauri-apps/api/core'
import type {
  TargetList,
  CheckTemplate,
  Audit,
  AuditRun,
  SelectorCheck,
} from '@/types'

export function normalizeUrl(raw: string): string {
  let url = raw.trim()
  if (!url) return url
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  return url
}

// Target Lists
export const listTargetLists = () => invoke<TargetList[]>('list_target_lists')
export const createTargetList = (data: { name: string; urls: string[] }) =>
  invoke<TargetList>('create_target_list', data)
export const updateTargetList = (data: { id: string; name?: string; urls?: string[] }) =>
  invoke<TargetList>('update_target_list', data)
export const deleteTargetList = (id: string) =>
  invoke<void>('delete_target_list', { id })

// Check Templates
export const listCheckTemplates = () => invoke<CheckTemplate[]>('list_check_templates')
export const createCheckTemplate = (data: { name: string; checks: { selector: string; label: string }[] }) =>
  invoke<CheckTemplate>('create_check_template', data)
export const updateCheckTemplate = (data: { id: string; name?: string; checks?: { selector: string; label: string }[] }) =>
  invoke<CheckTemplate>('update_check_template', data)
export const deleteCheckTemplate = (id: string) =>
  invoke<void>('delete_check_template', { id })

// Audits
export const listAudits = () => invoke<Audit[]>('list_audits')
export const createAudit = (data: { name: string; targetListId: string; checkTemplateId: string; config: { mode: string; batchSize: number; timeoutSecs: number }; originOverride?: string; urlPostfix?: string }) =>
  invoke<Audit>('create_audit', data)
export const updateAudit = (data: { id: string; name?: string; config?: { mode: string; batchSize: number; timeoutSecs: number }; originOverride?: string; urlPostfix?: string }) =>
  invoke<Audit>('update_audit', data)
export const deleteAudit = (id: string) =>
  invoke<void>('delete_audit', { id })

// Link scraping
export const scrapeLinks = (url: string) =>
  invoke<string[]>('scrape_links', { url })

export const scrapeSelectors = (url: string, options: { selectIds: boolean; selectClasses: boolean; selectTestids: boolean; customSelector: string }) =>
  invoke<{ selector: string; typeName: string }[]>('scrape_selectors', { url, options })

// File I/O
export const writeFile = (path: string, content: string) =>
  invoke<void>('write_file', { path, content })
export const readFile = (path: string) =>
  invoke<string>('read_file', { path })

// Runs
export const runQuickAudit = (data: { urls: string[]; checks: SelectorCheck[]; config: { mode: string; batchSize: number; timeoutSecs: number }; originOverride?: string; urlPostfix?: string }) =>
  invoke<void>('quick_run', data)

export const listAllRuns = () => invoke<AuditRun[]>('list_all_runs')
export const listRunFiles = () => invoke<{ id: string; startedAt: string; timestampMs: number }[]>('list_run_files')
export const runAudit = (auditId: string, originOverride?: string, urlPostfix?: string) =>
  invoke<void>('run_audit', { auditId, originOverride, urlPostfix })
export const cancelRun = () =>
  invoke<void>('cancel_run')
export const listAuditRuns = (auditId: string) =>
  invoke<AuditRun[]>('list_audit_runs', { auditId })
export const getRunResults = (runId: string) =>
  invoke<AuditRun>('get_run_results', { runId })
export const getDataPath = () =>
  invoke<string>('get_data_path')
export const openDataFolder = () =>
  invoke<void>('open_data_folder')
export const clearHistory = () =>
  invoke<void>('clear_history')
