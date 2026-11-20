export interface TargetList {
  id: string
  name: string
  urls: string[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  folder?: string
}

export type CheckType = 'selector' | 'status' | 'regex' | 'attribute' | 'accessibility' | 'javascript'

export interface SelectorCheck {
  id: string
  selector: string
  label: string
  checkType: CheckType
  expectedStatus?: number
  pattern?: string
  attributeName?: string
  attributeValue?: string
  a11yConfig?: A11yCheckConfig
}

export interface A11yCheckConfig {
  minSeverity: 'critical' | 'serious' | 'moderate' | 'minor'
  categories: string[]
}

export interface CheckTemplate {
  id: string
  name: string
  checks: SelectorCheck[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  folder?: string
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
  originOverride?: string
  urlPostfix?: string
  createdAt: string
  pinned: boolean
  folder?: string
  baselineRunId?: string
}

export interface A11yIssue {
  issueType: string
  element: string
  selector: string
  message: string
  severity?: 'critical' | 'serious' | 'moderate' | 'minor'
  wcag?: string
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
  originOverride?: string
  urlPostfix?: string
  createdAt: string
  pinned: boolean
  folder?: string
}

export interface A11yPageResult {
  url: string
  pageTitle: string | null
  status: number | null
  statusText: string
  responseTimeMs: number | null
  error: string | null
  issues: A11yIssue[]
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
