import type { A11yIssue, A11yReport } from '@/types'

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
}

export function issueWeight(severity?: string): number {
  return SEVERITY_WEIGHTS[severity ?? ''] ?? 1
}

export function pageScore(issues: A11yIssue[]): number {
  const penalty = issues.reduce((n, i) => n + issueWeight(i.severity), 0)
  return Math.max(0, 100 - penalty)
}

export function scoreColor(score: number): string {
  if (score >= 90) return 'text-success'
  if (score >= 70) return 'text-yellow-600 dark:text-yellow-400'
  if (score >= 40) return 'text-orange-600 dark:text-orange-400'
  return 'text-destructive'
}

export function reportScore(report: A11yReport): number | null {
  const scored = report.results.filter((r) => !r.error && r.status !== null)
  if (scored.length === 0) return null
  const avg = scored.reduce((n, r) => n + pageScore(r.issues), 0) / scored.length
  return Math.round(avg)
}
