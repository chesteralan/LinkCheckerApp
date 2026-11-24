import type { AuditRun, PageResult } from '@/types'

/** Outcome of one page in one run. */
export type PageOutcome = 'passed' | 'failed' | 'errored'

export interface DiffPair {
  key: string
  url: string
  from: PageResult
  to: PageResult
}

export interface DiffSingle {
  key: string
  url: string
  result: PageResult
}

export interface RunDiff {
  /** Pages only in the newer run. */
  added: DiffSingle[]
  /** Pages only in the older run. */
  removed: DiffSingle[]
  /** Passed before, failed or errored now. */
  regressions: DiffPair[]
  /** Failed or errored before, passed now. */
  improvements: DiffPair[]
  /** Same pass/fail state, but the error or the check outcomes differ. */
  changed: DiffPair[]
  unchanged: DiffSingle[]
  /** True when pages were matched on path only because the runs used different origins. */
  matchedByPath: boolean
}

export function pageOutcome(r: PageResult): PageOutcome {
  if (r.error != null && r.error !== '') return 'errored'
  return r.checks.every((c) => c.found) ? 'passed' : 'failed'
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function originOf(url: string): string | null {
  return parseUrl(url)?.origin ?? null
}

function pathKey(url: string): string {
  const u = parseUrl(url)
  return u ? u.pathname + u.search + u.hash : url
}

function fullKey(url: string): string {
  return parseUrl(url)?.href ?? url
}

function originsOf(run: AuditRun): Set<string> {
  const s = new Set<string>()
  for (const r of run.results) {
    const o = originOf(r.url)
    if (o) s.add(o)
  }
  return s
}

/**
 * Pages are matched on the full URL. Only when each run hit exactly one origin
 * and those origins differ (e.g. one run used an origin override) are pages
 * matched on path + query + fragment instead.
 */
export function shouldMatchByPath(a: AuditRun, b: AuditRun): boolean {
  const oa = originsOf(a)
  const ob = originsOf(b)
  if (oa.size !== 1 || ob.size !== 1) return false
  const [x] = oa
  const [y] = ob
  return x !== y
}

/** A stable description of what a page looked like, used to spot changes within the same outcome. */
function signature(r: PageResult): string {
  const checks = r.checks
    .map((c) => `${c.label}\u0000${c.selector}\u0000${c.found ? 1 : 0}`)
    .sort()
    .join('\u0001')
  return `${pageOutcome(r)}|${r.error ?? ''}|${r.status ?? ''}|${checks}`
}

/** Returns the two runs as [older, newer] by `startedAt`, whatever order they were given in. */
export function orderRunsByTime<T extends { startedAt: string }>(a: T, b: T): [T, T] {
  const ta = Date.parse(a.startedAt)
  const tb = Date.parse(b.startedAt)
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && tb < ta) return [b, a]
  return [a, b]
}

/**
 * Compares two runs. `before` is the baseline; call `orderRunsByTime` first so
 * "regression" always means "got worse over time".
 */
export function compareRuns(before: AuditRun, after: AuditRun): RunDiff {
  const byPath = shouldMatchByPath(before, after)
  const keyOf = byPath ? pathKey : fullKey

  const mapA = new Map<string, PageResult>()
  for (const r of before.results) mapA.set(keyOf(r.url), r)
  const mapB = new Map<string, PageResult>()
  for (const r of after.results) mapB.set(keyOf(r.url), r)

  const diff: RunDiff = {
    added: [],
    removed: [],
    regressions: [],
    improvements: [],
    changed: [],
    unchanged: [],
    matchedByPath: byPath,
  }

  // Newer run's order first, then pages that disappeared.
  const keys = [...mapB.keys(), ...[...mapA.keys()].filter((k) => !mapB.has(k))]
  for (const key of keys) {
    const from = mapA.get(key)
    const to = mapB.get(key)
    if (!from && to) {
      diff.added.push({ key, url: to.url, result: to })
    } else if (from && !to) {
      diff.removed.push({ key, url: from.url, result: from })
    } else if (from && to) {
      const oa = pageOutcome(from)
      const ob = pageOutcome(to)
      const pair = { key, url: to.url, from, to }
      if (oa === 'passed' && ob !== 'passed') diff.regressions.push(pair)
      else if (oa !== 'passed' && ob === 'passed') diff.improvements.push(pair)
      else if (signature(from) !== signature(to)) diff.changed.push(pair)
      else diff.unchanged.push({ key, url: to.url, result: to })
    }
  }
  return diff
}
