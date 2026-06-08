export interface TargetList {
  id: string
  name: string
  urls: string[]
  createdAt: string
  updatedAt: string
  pinned: boolean
  folder?: string
}

export type CheckType = 'selector' | 'status' | 'regex' | 'attribute'

export interface SelectorCheck {
  id: string
  selector: string
  label: string
  checkType: CheckType
  expectedStatus?: number
  pattern?: string
  attributeName?: string
  attributeValue?: string
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
  mode: 'sequential' | 'batch'
  batchSize: number
  timeoutSecs: number
  headers: Record<string, string>
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
}

export interface SelectorResult {
  selectorCheckId: string
  selector: string
  label: string
  found: boolean
  count: number
  textContent: string | null
  checkType: CheckType
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
