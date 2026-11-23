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

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

vi.mock('@/hooks/useStore', () => ({
  useStore: () => ({ createTargetList: vi.fn() }),
}))

vi.mock('@/lib/tauri', () => ({
  checkLinks: vi.fn(),
  cancelLinkCheck: vi.fn(),
  saveTextFile: vi.fn(),
}))

import * as api from '@/lib/tauri'
import { LinkCheckerPage } from '@/pages/LinkCheckerPage'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

function emit(name: string, payload: unknown) {
  for (const cb of [...(handlers.get(name) ?? [])]) cb({ payload })
}

function result(url: string) {
  return { url, sourceUrl: 'https://example.com', status: 200, statusText: 'OK', error: null, depth: 1, a11yIssues: [] }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LinkCheckerPage />
    </MemoryRouter>,
  )
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('LinkCheckerPage', () => {
  beforeEach(() => {
    handlers.clear()
    for (const fn of Object.values(mocked)) fn.mockReset()
    mocked.cancelLinkCheck.mockResolvedValue(undefined)
  })

  it('passes a scanId, ignores events from other scans, and cancels that scan (A-44)', async () => {
    const pending = deferred<unknown[]>()
    mocked.checkLinks.mockReturnValue(pending.promise)
    renderPage()

    fireEvent.change(screen.getByLabelText('Page URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check Links' }))

    await waitFor(() => expect(mocked.checkLinks).toHaveBeenCalled())
    const scanId = mocked.checkLinks.mock.calls[0][2] as string
    expect(scanId).toEqual(expect.any(String))

    act(() => {
      emit('linkcheck:checking', { scanId: 'other-scan', url: 'https://other.test/x', depth: 1, sourceUrl: '' })
      emit('linkcheck:checking', { scanId, url: 'https://example.com/a', depth: 1, sourceUrl: '' })
    })
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument()
    expect(screen.queryByText('https://other.test/x')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(mocked.cancelLinkCheck).toHaveBeenCalledWith(scanId))

    act(() => emit('linkcheck:cancelled', { scanId }))
    await act(async () => {
      pending.resolve([result('https://example.com/a')])
      await pending.promise
    })

    expect(screen.getByRole('button', { name: 'Check Links' })).toBeEnabled()
    expect(screen.getByText(/Scan cancelled/)).toBeInTheDocument()
  })

  it('shows the error and stops running when checkLinks rejects (A-63)', async () => {
    mocked.checkLinks.mockRejectedValue('Only http(s) URLs can be checked')
    renderPage()

    fireEvent.change(screen.getByLabelText('Page URL'), { target: { value: 'ftp://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check Links' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only http(s) URLs can be checked')
    expect(screen.getByRole('button', { name: 'Check Links' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })
})
