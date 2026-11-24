import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { A11yPageResult, A11yReport } from '@/types'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('@/lib/tauri', () => ({
  getA11yReport: vi.fn(),
  listA11yAudits: vi.fn(),
}))

import * as api from '@/lib/tauri'
import { A11yReportDiffPage } from '@/pages/A11yReportDiffPage'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const page = (url: string, n: number, extra: Partial<A11yPageResult> = {}): A11yPageResult => ({
  url,
  pageTitle: null,
  status: 200,
  statusText: 'OK',
  responseTimeMs: 1,
  error: null,
  issues: Array.from({ length: n }, (_, i) => ({
    issueType: `t${i}`,
    element: '',
    selector: '',
    message: `m${i}`,
    severity: 'serious' as const,
  })),
  ...extra,
})

const report = (id: string, startedAt: string, results: A11yPageResult[]): A11yReport => ({
  id,
  auditId: 'a',
  startedAt,
  completedAt: startedAt,
  status: 'completed',
  results,
  summary: { totalPages: 0, pagesWithIssues: 0, errored: 0, critical: 0, serious: 0, moderate: 0, minor: 0 },
})

function renderDiff(idA: string, idB: string) {
  return render(
    <MemoryRouter initialEntries={[`/accessibility/reports/diff/${idA}/${idB}`]}>
      <Routes>
        <Route path="/accessibility/reports/diff/:idA/:idB" element={<A11yReportDiffPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('A11yReportDiffPage', () => {
  beforeEach(() => {
    mocked.getA11yReport.mockReset()
    mocked.listA11yAudits.mockReset().mockResolvedValue([])
  })

  it('orders by time and does not count errored pages as resolved (A-22, A-23)', async () => {
    const older = report('old', '2026-01-01T00:00:00Z', [page('/p', 0), page('/e', 3)])
    const newer = report('new', '2026-02-01T00:00:00Z', [
      page('/p', 2),
      page('/e', 0, { error: 'HTTP 503 Service Unavailable', status: 503 }),
    ])
    mocked.getA11yReport.mockImplementation(async (id: string) => (id === 'old' ? older : newer))

    // Started from the newer report, as the "Compare" button does.
    renderDiff('new', 'old')

    expect(await screen.findByText('Regressions (1)')).toBeInTheDocument()
    expect(screen.queryByText(/Improvements/)).not.toBeInTheDocument()
    expect(screen.getByText('Not comparable (errored) (1)')).toBeInTheDocument()
    expect(screen.getByText(/errored in B: HTTP 503/)).toBeInTheDocument()
    expect(screen.queryByText(/resolved/)).not.toBeInTheDocument()
  })

  it('shows an error instead of loading forever when a report fails to load (A-65)', async () => {
    mocked.getA11yReport.mockRejectedValue('Report not found')
    renderDiff('x', 'y')
    expect(await screen.findByText('Report not found')).toBeInTheDocument()
  })
})
