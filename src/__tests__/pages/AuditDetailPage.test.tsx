import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Audit } from '@/types'

const updateAudit = vi.fn()
const deleteAudit = vi.fn()

const audit: Audit = {
  id: 'au1',
  name: 'Alpha audit',
  targetListId: 'tl1',
  checkTemplateId: 'ct1',
  config: { mode: 'batch', batchSize: 5, timeoutSecs: 10, headers: {}, cookies: [{ key: 'session', value: 'abc' }] },
  originOverride: null,
  urlPostfix: null,
  createdAt: '2024-01-01T00:00:00Z',
  pinned: false,
  folder: null,
  baselineRunId: 'run-123',
} as Audit

const runner = {
  running: false,
  run: null as unknown,
  progress: null,
  runPagePath: null as string | null,
  ownerKey: null as string | null,
  runId: null,
  error: null,
  start: vi.fn(),
  startQuick: vi.fn(),
  cancel: vi.fn(),
  clearError: vi.fn(),
}

vi.mock('@/hooks/useStore', () => ({
  useStore: () => ({
    loading: false,
    audits: [audit],
    targetLists: [{ id: 'tl1', name: 'List', urls: ['https://a.test'], pinned: false }],
    checkTemplates: [{ id: 'ct1', name: 'Template', checks: [], pinned: false }],
    updateAudit,
    deleteAudit,
  }),
}))
vi.mock('@/hooks/useRun', () => ({ useRun: () => runner }))
vi.mock('@/components/TrendsChart', () => ({ TrendsChart: () => null }))
vi.mock('@/lib/tauri', () => ({ saveTextFile: vi.fn() }))

import { AuditDetailPage } from '@/pages/AuditDetailPage'

function Location() {
  return <div data-testid="loc">{useLocation().pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/audits/au1']}>
      <Routes>
        <Route path="/audits/:id" element={<AuditDetailPage />} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuditDetailPage', () => {
  beforeEach(() => {
    updateAudit.mockReset().mockResolvedValue(audit)
    deleteAudit.mockReset().mockResolvedValue(undefined)
    runner.run = null
    runner.runPagePath = null
    runner.ownerKey = null
    runner.running = false
  })

  it('Cmd+Enter saves the edit form, keeping the audit cookies (A-25, A-26)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed')
    fireEvent.keyDown(nameInput, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(updateAudit).toHaveBeenCalledTimes(1))
    const [id, data] = updateAudit.mock.calls[0]
    expect(id).toBe('au1')
    expect(data.name).toBe('Renamed')
    expect(data.config.cookies).toEqual([{ key: 'session', value: 'abc' }])
  })

  it('links the baseline run to the run detail route (A-28)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /run-123/ }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/history/run-123')
  })

  it('asks for confirmation before deleting (A-29)', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteAudit).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it("does not show another audit's run results (A-27)", async () => {
    runner.run = {
      id: 'r1',
      auditId: 'other',
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: null,
      status: 'completed',
      results: [],
      summary: { total: 0, passed: 0, failed: 0, errored: 0, avgResponseTimeMs: 0 },
    }
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Results' }))
    expect(screen.getByText(/Press "Run Audit" to start/)).toBeInTheDocument()
  })
})
