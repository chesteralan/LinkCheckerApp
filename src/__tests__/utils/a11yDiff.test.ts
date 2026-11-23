import { describe, it, expect } from 'vitest'
import { diffReports, countDiffKinds, orderReportsByTime, isScorable } from '@/utils/a11yDiff'
import type { A11yIssue, A11yPageResult, A11yReport } from '@/types'

function issue(issueType: string, severity: A11yIssue['severity'] = 'serious'): A11yIssue {
  return { issueType, element: '<x>', selector: 'x', message: issueType, severity }
}

function page(url: string, issues: A11yIssue[], extra: Partial<A11yPageResult> = {}): A11yPageResult {
  return {
    url,
    pageTitle: null,
    status: 200,
    statusText: 'OK',
    responseTimeMs: 10,
    error: null,
    issues,
    ...extra,
  }
}

function report(id: string, startedAt: string, results: A11yPageResult[]): A11yReport {
  return {
    id,
    auditId: 'audit',
    startedAt,
    completedAt: startedAt,
    status: 'completed',
    results,
    summary: {
      totalPages: results.length,
      pagesWithIssues: 0,
      errored: 0,
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
    },
  }
}

describe('isScorable', () => {
  it('rejects errored pages and pages without a status', () => {
    expect(isScorable(page('a', []))).toBe(true)
    expect(isScorable(page('a', [], { error: 'HTTP 404 Not Found', status: 404 }))).toBe(false)
    expect(isScorable(page('a', [], { status: null }))).toBe(false)
  })
})

describe('diffReports', () => {
  it('classifies regressions, improvements and unchanged pages', () => {
    const a = report('a', '2026-01-01T00:00:00Z', [
      page('/reg', [issue('alt')]),
      page('/imp', [issue('alt'), issue('alt'), issue('alt')]),
      page('/same', [issue('label')]),
    ])
    const b = report('b', '2026-01-02T00:00:00Z', [
      page('/reg', [issue('alt'), issue('contrast')]),
      page('/imp', [issue('alt')]),
      page('/same', [issue('label')]),
    ])
    const diffs = diffReports(a, b)
    const byUrl = Object.fromEntries(diffs.map((d) => [d.url, d]))
    expect(byUrl['/reg'].kind).toBe('regression')
    expect(byUrl['/reg'].addedIssues.map((i) => i.issueType)).toEqual(['contrast'])
    expect(byUrl['/imp'].kind).toBe('improvement')
    expect(byUrl['/imp'].resolvedIssues).toHaveLength(2)
    expect(byUrl['/same'].kind).toBe('unchanged')
    expect(diffs.map((d) => d.kind)).toEqual(['regression', 'improvement', 'unchanged'])
  })

  it('does not count a page that errored in B as resolved', () => {
    const a = report('a', '2026-01-01T00:00:00Z', [page('/p', [issue('alt'), issue('label')])])
    const b = report('b', '2026-01-02T00:00:00Z', [
      page('/p', [], { error: 'HTTP 500 Internal Server Error', status: 500 }),
    ])
    const [d] = diffReports(a, b)
    expect(d.kind).toBe('errored')
    expect(d.resolvedIssues).toEqual([])
    expect(d.addedIssues).toEqual([])
    expect(d.scoreA).toBe(90)
    expect(d.scoreB).toBeNull()
    expect(d.errorB).toBe('HTTP 500 Internal Server Error')
  })

  it('does not count a page that errored in A as all new', () => {
    const a = report('a', '2026-01-01T00:00:00Z', [page('/p', [], { error: 'timeout', status: null })])
    const b = report('b', '2026-01-02T00:00:00Z', [page('/p', [issue('alt')])])
    const [d] = diffReports(a, b)
    expect(d.kind).toBe('errored')
    expect(d.addedIssues).toEqual([])
    expect(d.scoreA).toBeNull()
    expect(d.scoreB).toBe(95)
    expect(d.errorA).toBe('timeout')
  })

  it('handles added and removed pages, with null scores when errored', () => {
    const a = report('a', '2026-01-01T00:00:00Z', [page('/old', [issue('alt')]), page('/olderr', [], { error: 'x' })])
    const b = report('b', '2026-01-02T00:00:00Z', [
      page('/new', [issue('alt')]),
      page('/newerr', [issue('alt')], { error: 'y' }),
    ])
    const byUrl = Object.fromEntries(diffReports(a, b).map((d) => [d.url, d]))
    expect(byUrl['/new']).toMatchObject({ kind: 'added', scoreA: null, scoreB: 95 })
    expect(byUrl['/new'].addedIssues).toHaveLength(1)
    expect(byUrl['/newerr']).toMatchObject({ kind: 'added', scoreB: null, errorB: 'y', addedIssues: [] })
    expect(byUrl['/old']).toMatchObject({ kind: 'removed', scoreA: 95, scoreB: null })
    expect(byUrl['/olderr']).toMatchObject({ kind: 'removed', scoreA: null, resolvedIssues: [] })
  })

  it('counts kinds', () => {
    const a = report('a', '2026-01-01T00:00:00Z', [page('/p', [], { error: 'x' }), page('/q', [])])
    const b = report('b', '2026-01-02T00:00:00Z', [page('/p', []), page('/q', [])])
    expect(countDiffKinds(diffReports(a, b))).toEqual({
      regression: 0,
      improvement: 0,
      errored: 1,
      added: 0,
      removed: 0,
      unchanged: 1,
    })
  })
})

describe('orderReportsByTime', () => {
  const older = { id: 'o', startedAt: '2026-01-01T00:00:00Z' }
  const newer = { id: 'n', startedAt: '2026-02-01T00:00:00+02:00' }

  it('keeps chronological input as is', () => {
    expect(orderReportsByTime(older, newer)).toEqual({ older, newer, swapped: false })
  })

  it('swaps when the newer report comes first', () => {
    expect(orderReportsByTime(newer, older)).toEqual({ older, newer, swapped: true })
  })

  it('compares instants, not strings, across time zones', () => {
    const x = { id: 'x', startedAt: '2026-01-01T10:00:00+05:00' } // 05:00Z
    const y = { id: 'y', startedAt: '2026-01-01T06:00:00Z' }
    expect(orderReportsByTime(y, x)).toEqual({ older: x, newer: y, swapped: true })
  })
})
