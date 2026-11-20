import type { A11yIssue } from '@/types'
import { openUrl } from '@tauri-apps/plugin-opener'

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  serious: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  moderate: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  minor: 'bg-muted text-muted-foreground',
}

export function severityRank(severity?: string): number {
  return SEVERITY_ORDER[severity ?? ''] ?? 4
}

export function A11ySeverityBadge({ severity }: { severity?: string }) {
  const s = severity ?? 'minor'
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded uppercase ${SEVERITY_STYLES[s] ?? SEVERITY_STYLES.minor}`}>
      {s}
    </span>
  )
}

export function A11yIssuesList({ issues, maxHeight }: { issues: A11yIssue[]; maxHeight?: string }) {
  const sorted = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
  return (
    <div className="space-y-1.5 overflow-y-auto" style={maxHeight ? { maxHeight } : undefined}>
      {sorted.map((issue, i) => (
        <div key={i} className="flex items-start gap-2 text-xs border border-border/60 rounded p-2 bg-muted/30">
          <A11ySeverityBadge severity={issue.severity} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded">
                {issue.wcag}
              </span>
              {(issue.standards ?? []).filter((s) => s !== 'wcag').map((s) => (
                <span
                  key={s}
                  className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1 rounded"
                  title="Also applies to"
                >
                  {s}
                </span>
              ))}
              <code className="text-[10px] text-muted-foreground">{issue.selector}</code>
            </div>
            <p className="mt-0.5">{issue.message}</p>
          </div>
          {issue.helpUrl && (
            <button
              onClick={() => openUrl(issue.helpUrl!)}
              className="text-[10px] text-primary hover:underline shrink-0"
              title="WCAG guidance"
            >
              ↗
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
