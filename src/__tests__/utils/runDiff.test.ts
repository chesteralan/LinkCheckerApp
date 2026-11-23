import { describe, it, expect } from 'vitest'
import { compareRuns, orderRunsByTime, pageOutcome, shouldMatchByPath } from '@/utils/runDiff'
import type { AuditRun, PageResult } from '@/types'

function page(url: string, opts: { error?: string | null; found?: boolean[]; status?: number } = {}): PageResult {
  const found = opts.found ?? [true]
  return {
    url,
    pageTitle: null,
    status: opts.status ?? 200,
    statusText: 'OK',
    responseTimeMs: 10,
    error: opts.error ?? null,
    checks: found.map((f, i) => ({
      selectorCheckId: `c${i}`,
      selector: `#s${i}`,
      label: `Check ${i}`,
      found: f,
      count: f ? 1 : 0,
      textContent: null,
      checkType: 'selector',
      a11yIssues: [],
    })),
  }
}

function run(id: string, startedAt: string, results: PageResult[]): AuditRun {
  return {
    id,
    auditId: 'a',
    startedAt,
    completedAt: null,
    status: 'completed',
    results,
    summary: { total: results.length, passed: 0, failed: 0, errored: 0, avgResponseTimeMs: 0 },
  }
}

describe('pageOutcome', () => {
  it('classifies passed, failed and errored pages', () => {
    expect(pageOutcome(page('https://a.test/'))).toBe('passed')
    expect(pageOutcome(page('https://a.test/', { found: [true, false] }))).toBe('failed')
    expect(pageOutcome(page('https://a.test/', { error: 'HTTP 500' }))).toBe('errored')
  })
})

describe('orderRunsByTime', () => {
  it('returns [older, newer] regardless of argument order', () => {
    const older = run('1', '2024-01-01T00:00:00Z', [])
    const newer = run('2', '2024-02-01T00:00:00Z', [])
    expect(orderRunsByTime(newer, older)).toEqual([older, newer])
    expect(orderRunsByTime(older, newer)).toEqual([older, newer])
  })
})

describe('compareRuns', () => {
  it('buckets regressions, improvements, added, removed and unchanged pages', () => {
    const a = run('a', '2024-01-01T00:00:00Z', [
      page('https://x.test/ok'),
      page('https://x.test/regress'),
      page('https://x.test/improve', { found: [false] }),
      page('https://x.test/gone'),
    ])
    const b = run('b', '2024-01-02T00:00:00Z', [
      page('https://x.test/ok'),
      page('https://x.test/regress', { error: 'timeout' }),
      page('https://x.test/improve'),
      page('https://x.test/new'),
    ])
    const d = compareRuns(a, b)
    expect(d.unchanged.map((e) => e.url)).toEqual(['https://x.test/ok'])
    expect(d.regressions.map((e) => e.url)).toEqual(['https://x.test/regress'])
    expect(d.improvements.map((e) => e.url)).toEqual(['https://x.test/improve'])
    expect(d.added.map((e) => e.url)).toEqual(['https://x.test/new'])
    expect(d.removed.map((e) => e.url)).toEqual(['https://x.test/gone'])
    expect(d.changed).toEqual([])
  })

  it('reports pages failing in both runs for different reasons as changed', () => {
    const a = run('a', '2024-01-01T00:00:00Z', [page('https://x.test/p', { found: [false, true] })])
    const b = run('b', '2024-01-02T00:00:00Z', [page('https://x.test/p', { found: [true, false] })])
    const d = compareRuns(a, b)
    expect(d.changed).toHaveLength(1)
    expect(d.unchanged).toHaveLength(0)
  })

  it('reports a different error message as changed', () => {
    const a = run('a', '2024-01-01T00:00:00Z', [page('https://x.test/p', { error: 'HTTP 404' })])
    const b = run('b', '2024-01-02T00:00:00Z', [page('https://x.test/p', { error: 'HTTP 500' })])
    expect(compareRuns(a, b).changed).toHaveLength(1)
  })

  it('does not merge the same path on different hosts when runs span several origins', () => {
    const a = run('a', '2024-01-01T00:00:00Z', [page('https://one.test/p'), page('https://two.test/p')])
    const b = run('b', '2024-01-02T00:00:00Z', [
      page('https://one.test/p'),
      page('https://two.test/p', { found: [false] }),
    ])
    expect(shouldMatchByPath(a, b)).toBe(false)
    const d = compareRuns(a, b)
    expect(d.unchanged.map((e) => e.url)).toEqual(['https://one.test/p'])
    expect(d.regressions.map((e) => e.url)).toEqual(['https://two.test/p'])
  })

  it('matches on path when each run used a single, different origin', () => {
    const a = run('a', '2024-01-01T00:00:00Z', [page('https://prod.test/p')])
    const b = run('b', '2024-01-02T00:00:00Z', [page('https://staging.test/p')])
    const d = compareRuns(a, b)
    expect(d.matchedByPath).toBe(true)
    expect(d.unchanged).toHaveLength(1)
    expect(d.added).toHaveLength(0)
  })
})
