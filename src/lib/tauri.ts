import { invoke } from '@tauri-apps/api/core'
import type {
  TargetList,
  CheckTemplate,
  Audit,
  AuditRun,
  SelectorCheck,
  A11yAudit,
  A11yCheckConfig,
  A11yReport,
  A11yReportInfo,
  AuditConfig,
  LinkCheckResult,
  LinkCheckScan,
  LinkCheckScanInfo,
} from '@/types'

export function normalizeUrl(raw: string): string {
  let url = raw.trim()
  if (!url) return url
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  return url
}

/**
 * Tauri reads a JSON `null` argument exactly like a missing one ("leave unchanged"), so clearing an
 * optional field on update is sent as an empty string, which the backend treats as "clear".
 */
function clearNulls<T extends object>(data: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...data }
  for (const k of keys) if (out[k] === null) out[k] = ''
  return out as T
}

// Target Lists
export const listTargetLists = () => invoke<TargetList[]>('list_target_lists')
export const createTargetList = (data: { name: string; urls: string[]; pinned?: boolean; folder?: string | null }) =>
  invoke<TargetList>('create_target_list', { ...data, pinned: data.pinned ?? false })
export const updateTargetList = (data: {
  id: string
  name?: string
  urls?: string[]
  pinned?: boolean
  folder?: string | null
}) => invoke<TargetList>('update_target_list', clearNulls(data, ['folder']))
export const deleteTargetList = (id: string) => invoke<void>('delete_target_list', { id })

// Check Templates
export const listCheckTemplates = () => invoke<CheckTemplate[]>('list_check_templates')
export const createCheckTemplate = (data: {
  name: string
  checks: SelectorCheck[]
  pinned?: boolean
  folder?: string | null
}) => invoke<CheckTemplate>('create_check_template', { ...data, pinned: data.pinned ?? false })
export const updateCheckTemplate = (data: {
  id: string
  name?: string
  checks?: SelectorCheck[]
  pinned?: boolean
  folder?: string | null
}) => invoke<CheckTemplate>('update_check_template', clearNulls(data, ['folder']))
export const deleteCheckTemplate = (id: string) => invoke<void>('delete_check_template', { id })

// Audits
export const listAudits = () => invoke<Audit[]>('list_audits')
export const createAudit = (data: {
  name: string
  targetListId: string
  checkTemplateId: string
  config: {
    mode: string
    batchSize: number
    timeoutSecs: number
    headers?: Record<string, string>
    cookies?: { key: string; value: string }[]
  }
  originOverride?: string
  urlPostfix?: string
  pinned?: boolean
  folder?: string | null
}) => invoke<Audit>('create_audit', { ...data, pinned: data.pinned ?? false })
export const updateAudit = (data: {
  id: string
  name?: string
  config?: {
    mode: string
    batchSize: number
    timeoutSecs: number
    headers?: Record<string, string>
    cookies?: { key: string; value: string }[]
  }
  originOverride?: string | null
  urlPostfix?: string | null
  pinned?: boolean
  folder?: string | null
  baselineRunId?: string | null
}) =>
  invoke<Audit>('update_audit', clearNulls(data, ['folder', 'baselineRunId', 'originOverride', 'urlPostfix']))
export const deleteAudit = (id: string) => invoke<void>('delete_audit', { id })

// Link scraping
export const scrapeLinks = (url: string) => invoke<string[]>('scrape_links', { url })

export const scrapeSelectors = (
  urls: string[],
  options: { selectIds: boolean; selectClasses: boolean; selectTestids: boolean; customSelector: string },
) => invoke<{ selector: string; typeName: string }[]>('scrape_selectors', { urls, options })

// File I/O
// The native Save/Open dialogs run on the Rust side; the webview never sees or
// chooses arbitrary filesystem paths (A-08).

/** Opens a native Save dialog and writes `content` to the chosen file. Resolves to the path, or null if cancelled. */
export const saveTextFile = (args: {
  defaultName: string
  content: string
  filterName?: string
  extensions?: string[]
}) => invoke<string | null>('save_text_file', args)

/** Opens a native Open dialog and resolves to the chosen file's text content, or null if cancelled. */
export const openTextFile = (args: { filterName?: string; extensions?: string[] } = {}) =>
  invoke<string | null>('open_text_file', args)

/** Human-readable problems found while loading data.json at startup (empty when everything is fine). */
export const getStorageWarnings = () => invoke<string[]>('get_storage_warnings')

// Runs
export const runQuickAudit = (data: {
  urls: string[]
  checks: SelectorCheck[]
  config: {
    mode: string
    batchSize: number
    timeoutSecs: number
    headers?: Record<string, string>
    cookies?: { key: string; value: string }[]
  }
  originOverride?: string
  urlPostfix?: string
  runId?: string
}) => invoke<string>('quick_run', data)

export const listAllRuns = () => invoke<AuditRun[]>('list_all_runs')
export const listRunFiles = () => invoke<{ id: string; startedAt: string; timestampMs: number }[]>('list_run_files')
/** Runs an audit and resolves with its run id once the final record is saved. */
export const runAudit = (auditId: string, originOverride?: string, urlPostfix?: string, runId?: string) =>
  invoke<string>('run_audit', { auditId, originOverride, urlPostfix, runId })
/** Cancels the given run, or every active run when runId is omitted. */
export const cancelRun = (runId?: string) => invoke<void>('cancel_run', { runId })
export const listAuditRuns = (auditId: string) => invoke<AuditRun[]>('list_audit_runs', { auditId })
export const getRunResults = (runId: string) => invoke<AuditRun>('get_run_results', { runId })
export const getDataPath = () => invoke<string>('get_data_path')
export const openDataFolder = () => invoke<void>('reveal_data_folder')
export const clearHistory = () => invoke<void>('clear_history')
export const pruneHistory = () => invoke<void>('prune_history')
export const getHistoryRetention = () => invoke<number>('get_history_retention')
/** Days to keep run, accessibility and link-check history (1..36500). Prunes immediately. */
export const setHistoryRetention = (days: number) => invoke<void>('set_history_retention', { days })

export const checkLinks = (
  url: string,
  options: { maxDepth: number; timeoutSecs: number; sameOriginOnly: boolean; includeAccessibility?: boolean },
  scanId?: string,
) => invoke<LinkCheckResult[]>('check_links', { url, options, scanId })

/** Cancels the given link scan, or every active scan when scanId is omitted. */
export const cancelLinkCheck = (scanId?: string) => invoke<void>('cancel_link_check', { scanId })

export const listLinkCheckScans = () => invoke<LinkCheckScanInfo[]>('list_link_check_scans')
export const getLinkCheckScan = (scanId: string) => invoke<LinkCheckScan>('get_link_check_scan', { scanId })
export const deleteLinkCheckScan = (scanId: string) => invoke<void>('delete_link_check_scan', { scanId })

// Accessibility Audits
export const listA11yAudits = () => invoke<A11yAudit[]>('list_a11y_audits')
export const createA11yAudit = (data: {
  name: string
  targetListId: string
  engine?: string
  a11yConfig?: A11yCheckConfig
  config: AuditConfig
  originOverride?: string
  urlPostfix?: string
  pinned?: boolean
  folder?: string | null
}) => invoke<A11yAudit>('create_a11y_audit', { input: data })
export const updateA11yAudit = (data: {
  id: string
  name?: string
  targetListId?: string
  engine?: string
  a11yConfig?: A11yCheckConfig
  config?: AuditConfig
  originOverride?: string | null
  urlPostfix?: string | null
  pinned?: boolean
  folder?: string | null
}) => invoke<A11yAudit>('update_a11y_audit', clearNulls(data, ['folder', 'originOverride', 'urlPostfix']))
export const deleteA11yAudit = (id: string) => invoke<void>('delete_a11y_audit', { id })
export const runA11yAudit = (auditId: string) => invoke<void>('run_a11y_audit', { auditId })
export const cancelA11yRun = () => invoke<void>('cancel_a11y_run')
export const listA11yReports = () => invoke<A11yReportInfo[]>('list_a11y_reports')
export const getA11yReport = (reportId: string) => invoke<A11yReport>('get_a11y_report', { reportId })
export const deleteA11yReport = (reportId: string) => invoke<void>('delete_a11y_report', { reportId })
export const rerunA11yPages = (reportId: string, urls?: string[]) =>
  invoke<A11yReport>('rerun_a11y_pages', { reportId, urls: urls ?? null })
