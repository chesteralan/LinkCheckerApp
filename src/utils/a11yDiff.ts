import type { A11yIssue, A11yPageResult, A11yReport } from '@/types'
import { pageScore } from '@/utils/a11yScore'

/**
 * How one page changed between report A (older) and report B (newer).
 *
 * - `errored`: the page exists in both reports but at least one side errored
 *   (fetch failure, HTTP 4xx/5xx, timeout, cancelled…), so its issues cannot be
 *   compared. It is never counted as a regression or an improvement.
 */
export type PageDiffKind = 'regression' | 'improvement' | 'errored' | 'added' | 'removed' | 'unchanged'

export interface PageDiff {
  url: string
  kind: PageDiffKind
  addedIssues: A11yIssue[]
  resolvedIssues: A11yIssue[]
  /** Page score in A; null when the page is absent from A or errored there. */
  scoreA: number | null
  /** Page score in B; null when the page is absent from B or errored there. */
  scoreB: number | null
  /** Error text in A, if the page errored there. */
  errorA: string | null
  /** Error text in B, if the page errored there. */
  errorB: string | null
}

export const DIFF_KIND_ORDER: Record<PageDiffKind, number> = {
  regression: 0,
  improvement: 1,
  errored: 2,
  added: 3,
  removed: 4,
  unchanged: 5,
}

/**
 * True when a page result has a meaningful issue list. Mirrors `reportScore`,
 * which excludes errored pages and pages with no HTTP status.
 */
export function isScorable(r: A11yPageResult): boolean {
  return !r.error && r.status !== null
}

/** Text describing why a page is not scorable, or null if it is. */
function errorText(r: A11yPageResult): string | null {
  if (isScorable(r)) return null
  return r.error || 'no response'
}

function typeCounts(issues: A11yIssue[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of issues) m.set(i.issueType, (m.get(i.issueType) ?? 0) + 1)
  return m
}

/**
 * Issues present in `to` beyond what `from` had, per issue type, so a type
 * going 3→1 yields 2 resolved issues, not all 3.
 */
function excessIssues(from: A11yIssue[], to: A11yIssue[]): A11yIssue[] {
  const countsFrom = typeCounts(from)
  const excess = new Map<string, number>()
  for (const [t, n] of typeCounts(to)) {
    const d = n - (countsFrom.get(t) ?? 0)
    if (d > 0) excess.set(t, d)
  }
  return to.filter((i) => {
    const take = excess.get(i.issueType) ?? 0
    if (take <= 0) return false
    excess.set(i.issueType, take - 1)
    return true
  })
}

/**
 * Compare two reports page by page. A is treated as "before" and B as
 * "after"; use {@link orderReportsByTime} first so the direction follows time.
 */
export function diffReports(a: A11yReport, b: A11yReport): PageDiff[] {
  const mapA = new Map(a.results.map((r) => [r.url, r]))
  const mapB = new Map(b.results.map((r) => [r.url, r]))
  const allUrls = new Set([...mapA.keys(), ...mapB.keys()])
  const diffs: PageDiff[] = []

  for (const url of allUrls) {
    const ra = mapA.get(url)
    const rb = mapB.get(url)
    if (!ra && rb) {
      const ok = isScorable(rb)
      diffs.push({
        url,
        kind: 'added',
        addedIssues: ok ? rb.issues : [],
        resolvedIssues: [],
        scoreA: null,
        scoreB: ok ? pageScore(rb.issues) : null,
        errorA: null,
        errorB: errorText(rb),
      })
      continue
    }
    if (ra && !rb) {
      const ok = isScorable(ra)
      diffs.push({
        url,
        kind: 'removed',
        addedIssues: [],
        resolvedIssues: ok ? ra.issues : [],
        scoreA: ok ? pageScore(ra.issues) : null,
        scoreB: null,
        errorA: errorText(ra),
        errorB: null,
      })
      continue
    }
    if (!ra || !rb) continue

    const okA = isScorable(ra)
    const okB = isScorable(rb)
    if (!okA || !okB) {
      diffs.push({
        url,
        kind: 'errored',
        addedIssues: [],
        resolvedIssues: [],
        scoreA: okA ? pageScore(ra.issues) : null,
        scoreB: okB ? pageScore(rb.issues) : null,
        errorA: errorText(ra),
        errorB: errorText(rb),
      })
      continue
    }

    const newIssues = excessIssues(ra.issues, rb.issues)
    const goneIssues = excessIssues(rb.issues, ra.issues)
    const kind: PageDiffKind = newIssues.length > 0 ? 'regression' : goneIssues.length > 0 ? 'improvement' : 'unchanged'
    diffs.push({
      url,
      kind,
      addedIssues: newIssues,
      resolvedIssues: goneIssues,
      scoreA: pageScore(ra.issues),
      scoreB: pageScore(rb.issues),
      errorA: null,
      errorB: null,
    })
  }

  // Array.prototype.sort is stable, so pages keep report order within a kind.
  return diffs.sort((x, y) => DIFF_KIND_ORDER[x.kind] - DIFF_KIND_ORDER[y.kind])
}

/** Counts of each diff kind. */
export function countDiffKinds(diffs: PageDiff[]): Record<PageDiffKind, number> {
  const counts: Record<PageDiffKind, number> = {
    regression: 0,
    improvement: 0,
    errored: 0,
    added: 0,
    removed: 0,
    unchanged: 0,
  }
  for (const d of diffs) counts[d.kind]++
  return counts
}

function startedMs(r: { startedAt: string }): number {
  const t = Date.parse(r.startedAt)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Return the two reports as [older, newer] by `startedAt`, so "regression" and
 * "improvement" follow time rather than the order the user picked them in.
 * `swapped` is true when the inputs were reversed.
 */
export function orderReportsByTime<T extends { startedAt: string }>(
  a: T,
  b: T,
): { older: T; newer: T; swapped: boolean } {
  if (startedMs(b) < startedMs(a)) return { older: b, newer: a, swapped: true }
  return { older: a, newer: b, swapped: false }
}
