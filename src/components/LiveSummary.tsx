import type { PageResult } from '@/types'

function countResults(results: PageResult[]) {
  const passed = results.filter((r) => !r.error && r.checks.every((c) => c.found)).length
  const failed = results.filter((r) => !r.error && r.checks.some((c) => !c.found)).length
  const errored = results.filter((r) => r.error).length
  // Matches the backend summary: errored pages are excluded from the average response time.
  const timed = results.filter((r) => !r.error && r.responseTimeMs != null)
  const totalMs = timed.reduce((s, r) => s + (r.responseTimeMs ?? 0), 0)
  const avg = timed.length > 0 ? Math.round(totalMs / timed.length) : 0
  return { passed, failed, errored, avg }
}

interface LiveSummaryProps {
  results: PageResult[]
  filter?: 'all' | 'passed' | 'failed' | 'errored'
  onFilterChange?: (filter: 'all' | 'passed' | 'failed' | 'errored') => void
}

export function LiveSummary({ results, filter = 'all', onFilterChange }: LiveSummaryProps) {
  const { passed, failed, errored, avg } = countResults(results)

  return (
    <div className="flex gap-4 text-sm items-center" role="group" aria-label="Result summary filters">
      {onFilterChange ? (
        <>
          <button
            type="button"
            aria-pressed={filter === 'passed'}
            onClick={() => onFilterChange(filter === 'passed' ? 'all' : 'passed')}
            className={`text-success ${filter === 'passed' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
          >
            ✓ passed {passed}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'failed'}
            onClick={() => onFilterChange(filter === 'failed' ? 'all' : 'failed')}
            className={`text-destructive ${filter === 'failed' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
          >
            ✗ failed {failed}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'errored'}
            onClick={() => onFilterChange(filter === 'errored' ? 'all' : 'errored')}
            className={`text-muted-foreground ${filter === 'errored' ? 'underline font-medium' : ''} hover:underline cursor-pointer`}
          >
            ⚠ errored {errored}
          </button>
        </>
      ) : (
        <>
          <span className="text-success">✓ passed {passed}</span>
          <span className="text-destructive">✗ failed {failed}</span>
          <span className="text-muted-foreground">⚠ errored {errored}</span>
        </>
      )}
      <span className="text-muted-foreground">avg {avg}ms</span>
      {filter !== 'all' && onFilterChange && (
        <button
          type="button"
          onClick={() => onFilterChange('all')}
          className="text-xs text-primary hover:underline cursor-pointer"
        >
          clear filter
        </button>
      )}
    </div>
  )
}
