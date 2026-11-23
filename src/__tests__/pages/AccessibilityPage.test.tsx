import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Set<Handler>>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: Handler) => {
    if (!handlers.has(name)) handlers.set(name, new Set())
    handlers.get(name)!.add(cb)
    return () => handlers.get(name)?.delete(cb)
  }),
}))

const targetLists = [{ id: 'tl1', name: 'Main', urls: ['https://a.test', 'https://b.test'] }]
vi.mock('@/hooks/useStore', () => ({
  useStore: () => ({ targetLists, loading: false }),
}))

vi.mock('@/lib/tauri', () => ({
  listA11yAudits: vi.fn(),
  listA11yReports: vi.fn(),
  createA11yAudit: vi.fn(),
  updateA11yAudit: vi.fn(),
  deleteA11yAudit: vi.fn(),
  runA11yAudit: vi.fn(),
  cancelA11yRun: vi.fn(),
}))

import * as api from '@/lib/tauri'
import { AccessibilityPage } from '@/pages/AccessibilityPage'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

function emit(name: string, payload: unknown) {
  for (const cb of [...(handlers.get(name) ?? [])]) cb({ payload })
}

const audit = {
  id: 'audit-1',
  name: 'Site audit',
  targetListId: 'tl1',
  engine: 'static',
  a11yConfig: { minSeverity: 'minor', categories: [], standards: [] },
  config: { mode: 'batch', batchSize: 5, timeoutSecs: 10, headers: {}, cookies: [] },
  createdAt: '2026-01-01T00:00:00Z',
  pinned: false,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccessibilityPage />
    </MemoryRouter>,
  )
}

describe('AccessibilityPage', () => {
  beforeEach(() => {
    handlers.clear()
    for (const fn of Object.values(mocked)) fn.mockReset()
    mocked.listA11yAudits.mockResolvedValue([audit])
    mocked.listA11yReports.mockResolvedValue([])
    mocked.cancelA11yRun.mockResolvedValue(undefined)
  })

  it('registers listeners before invoking and clears the running state when the run resolves (A-63)', async () => {
    let resolveRun!: () => void
    mocked.runA11yAudit.mockImplementation(() => {
      // Listeners must already be in place when the command starts.
      expect(handlers.get('a11y:progress')?.size).toBe(1)
      return new Promise<void>((r) => (resolveRun = r))
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Run Audit' }))
    await waitFor(() => expect(mocked.runA11yAudit).toHaveBeenCalledWith('audit-1'))

    act(() => {
      // A re-run from a report page must not drive this page's progress.
      emit('a11y:progress', { reportId: 'other', checked: 9, total: 9, rerun: true })
      emit('a11y:progress', { reportId: 'r1', checked: 1, total: 2, rerun: false })
      emit('a11y:progress', { reportId: 'r-stale', checked: 7, total: 8, rerun: false })
    })
    expect(screen.getByText(/Scanning: 1\/2 pages/)).toBeInTheDocument()

    await act(async () => resolveRun())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run Audit' })).toBeEnabled())
    expect(screen.queryByText(/Scanning/)).not.toBeInTheDocument()
  })

  it('shows the rejection message and does not stay stuck in Scanning (A-63)', async () => {
    mocked.runA11yAudit.mockRejectedValue('An accessibility run is already in progress')
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Run Audit' }))

    expect(await screen.findByText('An accessibility run is already in progress')).toBeInTheDocument()
    expect(screen.queryByText(/Scanning/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Audit' })).toBeEnabled()
  })

  it('does not let the last rule category be unchecked (A-64)', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Site audit' }))

    const all = screen.getByLabelText('All categories')
    expect(all).toBeChecked()
    fireEvent.click(all) // explicit selection of every category
    expect(all).not.toBeChecked()

    for (const name of ['Document', 'Headings', 'Landmarks', 'ARIA', 'Interactive', 'Media', 'Tables']) {
      fireEvent.click(screen.getByLabelText(name))
    }
    const forms = screen.getByLabelText('Forms')
    expect(forms).toBeChecked()
    expect(forms).toBeDisabled()
    expect(screen.getByLabelText('Document')).not.toBeChecked()
  })
})
