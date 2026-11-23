// These types mirror the Rust models in src-tauri/src/models.rs. Rust
// `Option<T>` fields serialize as `null` (not `undefined`), so they are typed
// `T | null` here; they stay optional (`?`) because the frontend also builds
// partial objects locally and older saved JSON may omit them (A-62).

export interface TargetList {
  id: string
  name: string
  urls: string[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  folder?: string | null
}

export type CheckType = 'selector' | 'status' | 'regex' | 'attribute' | 'accessibility' | 'javascript'

export interface SelectorCheck {
  id: string
  selector: string
  label: string
  checkType: CheckType
  expectedStatus?: number | null
  pattern?: string | null
  attributeName?: string | null
  attributeValue?: string | null
  a11yConfig?: A11yCheckConfig
}

export type A11ySeverity = 'critical' | 'serious' | 'moderate' | 'minor'

export interface A11yCheckConfig {
  minSeverity: A11ySeverity
  categories: string[]
  standards?: string[]
}

export interface CheckTemplate {
  id: string
  name: string
  checks: SelectorCheck[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  folder?: string | null
}

export function defaultCheck(): SelectorCheck {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
    selector: '',
    label: '',
    checkType: 'selector',
  }
}

export interface AuditConfig {
  mode: string
  batchSize: number
  timeoutSecs: number
  headers: Record<string, string>
  cookies: { key: string; value: string }[]
}

export interface Audit {
  id: string
  name: string
  targetListId: string
  checkTemplateId: string
  config: AuditConfig
  originOverride?: string | null
  urlPostfix?: string | null
  createdAt: string
  pinned: boolean
  folder?: string | null
  baselineRunId?: string | null
}

export interface A11yIssue {
  issueType: string
  element: string
  selector: string
  message: string
  /** Empty string when the engine did not assign a severity. */
  severity?: A11ySeverity | ''
  /** Empty string for best-practice rules that map to no WCAG criterion. */
  wcag?: string
  standards?: string[]
  helpUrl?: string | null
}

export interface SelectorResult {
  selectorCheckId: string
  selector: string
  label: string
  found: boolean
  count: number
  textContent: string | null
  checkType: CheckType
  a11yIssues: A11yIssue[]
}

export interface PageResult {
  url: string
  pageTitle: string | null
  status: number | null
  statusText: string
  responseTimeMs: number | null
  error: string | null
  checks: SelectorResult[]
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  errored: number
  avgResponseTimeMs: number
}

export interface AuditRun {
  id: string
  auditId: string
  startedAt: string
  completedAt: string | null
  status: 'running' | 'completed' | 'cancelled' | 'error'
  results: PageResult[]
  summary: RunSummary
}

export interface A11yAudit {
  id: string
  name: string
  targetListId: string
  engine: string
  a11yConfig: A11yCheckConfig
  config: AuditConfig
  originOverride?: string | null
  urlPostfix?: string | null
  createdAt: string
  pinned: boolean
  folder?: string | null
}

export interface A11yPageResult {
  url: string
  pageTitle: string | null
  status: number | null
  statusText: string
  responseTimeMs: number | null
  error: string | null
  issues: A11yIssue[]
  /** True when the engine capped the number of issues recorded for this page. */
  truncated?: boolean
}

export interface A11ySummary {
  totalPages: number
  pagesWithIssues: number
  errored: number
  critical: number
  serious: number
  moderate: number
  minor: number
}

export interface A11yReport {
  id: string
  auditId: string
  startedAt: string
  completedAt: string | null
  status: string
  results: A11yPageResult[]
  summary: A11ySummary
  standards?: string[]
  /** Engine used for the scan ('static' | 'axe-core'); null on legacy reports. */
  engine?: string | null
  minSeverity?: string | null
  categories?: string[] | null
}

export interface A11yReportInfo {
  id: string
  auditId: string
  startedAt: string
  timestampMs: number
}

export interface LinkCheckResult {
  url: string
  sourceUrl: string
  status: number | null
  statusText: string
  error: string | null
  depth: number
  a11yIssues: A11yIssue[]
}

export interface LinkCheckScan {
  id: string
  url: string
  maxDepth: number
  sameOriginOnly: boolean
  includeAccessibility: boolean
  startedAt: string
  completedAt: string | null
  results: LinkCheckResult[]
}

export interface LinkCheckScanInfo {
  id: string
  url: string
  startedAt: string
  timestampMs: number
  totalLinks: number
  broken: number
  a11yIssues: number
}

/** Payload of `run:progress`. */
export interface RunProgressEvent {
  runId: string
  checked: number
  total: number
}

/** Payload of `run:result`: a PageResult with the run it belongs to. */
export type RunResultEvent = PageResult & { runId: string }

/** Payload of `run:complete`: the saved AuditRun (runId === id). */
export type RunCompleteEvent = AuditRun & { runId: string }

/** Payload of `run:cancelled`. */
export interface RunCancelledEvent {
  runId: string
}

/** Payload of `run:error`. */
export interface RunErrorEvent {
  runId: string
  message: string
}

/** Payload of `a11y:progress`. */
export interface A11yProgressEvent {
  reportId: string
  checked: number
  total: number
  rerun: boolean
}

/** Payload of `a11y:result`. */
export type A11yResultEvent = A11yPageResult & { reportId: string; rerun: boolean }

/** Payload of `a11y:error`. */
export interface A11yErrorEvent {
  reportId: string | null
  message: string
}

/** Payload of `linkcheck:result`. */
export type LinkCheckResultEvent = LinkCheckResult & { scanId: string }

/** Payload of `linkcheck:checking` and `linkcheck:discovered`. */
export interface LinkCheckProgressEvent {
  scanId: string
  url: string
  depth: number
  sourceUrl: string
}

/** Payload of `linkcheck:cancelled`. */
export interface LinkCheckCancelledEvent {
  scanId: string
}
