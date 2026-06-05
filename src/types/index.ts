export interface TargetList {
  id: string
  name: string
  urls: string[]
  createdAt: string
  updatedAt: string
}

export interface SelectorCheck {
  id: string
  selector: string
  label: string
}

export interface CheckTemplate {
  id: string
  name: string
  checks: SelectorCheck[]
  createdAt: string
  updatedAt: string
}

export interface AuditConfig {
  mode: 'sequential' | 'batch'
  batchSize: number
  timeoutSecs: number
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
}

export interface SelectorResult {
  selectorCheckId: string
  selector: string
  label: string
  found: boolean
  count: number
  textContent: string | null
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
