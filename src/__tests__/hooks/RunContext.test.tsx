import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Set<Handler>>()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: Handler) => {
    if (!handlers.has(name)) handlers.set(name, new Set())
    handlers.get(name)!.add(cb)
    return () => handlers.get(name)?.delete(cb)
  }),
}))

vi.mock('@/lib/tauri', () => ({
  runAudit: vi.fn(),
  runQuickAudit: vi.fn(),
  cancelRun: vi.fn(),
  getRunResults: vi.fn(),
}))

import * as api from '@/lib/tauri'
import { RunProvider } from '@/hooks/RunContext'
import { useRun } from '@/hooks/useRun'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

function emit(name: string, payload: unknown) {
  for (const cb of [...(handlers.get(name) ?? [])]) cb({ payload })
}

const wrapper = ({ children }: { children: ReactNode }) => <RunProvider>{children}</RunProvider>

const pageResult = (url: string) => ({
  url,
  pageTitle: null,
  status: 200,
  statusText: 'OK',
  responseTimeMs: 10,
  error: null,
  checks: [],
})

describe('RunProvider', () => {
  beforeEach(() => {
    handlers.clear()
    for (const fn of Object.values(mocked)) fn.mockReset()
    mocked.cancelRun.mockResolvedValue(undefined)
  })

  it('resets state and exposes the error when runAudit rejects (A-16)', async () => {
    mocked.runAudit.mockRejectedValue('Target list not found')
    const { result } = renderHook(() => useRun(), { wrapper })

    await act(async () => {
      await result.current.start('audit-1')
    })

    expect(result.current.running).toBe(false)
    expect(result.current.runPagePath).toBeNull()
    expect(result.current.error).toBe('Target list not found')
    // Listeners were removed.
    expect(handlers.get('run:result')?.size ?? 0).toBe(0)

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it('passes a generated run id and ignores events from other runs (A-15)', async () => {
    let resolveRun: (id: string) => void = () => {}
    mocked.runAudit.mockImplementation(() => new Promise<string>((r) => (resolveRun = r)))
    const { result } = renderHook(() => useRun(), { wrapper })

    act(() => {
      void result.current.start('audit-1')
    })
    await waitFor(() => expect(mocked.runAudit).toHaveBeenCalled())
    const runId = mocked.runAudit.mock.calls[0][3] as string
    expect(runId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.current.runId).toBe(runId)

    act(() => {
      emit('run:result', { ...pageResult('https://stale.example'), runId: 'other-run' })
      emit('run:progress', { runId: 'other-run', checked: 9, total: 9 })
      emit('run:result', { ...pageResult('https://a.example'), runId })
      emit('run:progress', { runId, checked: 1, total: 2 })
    })

    expect(result.current.run?.results.map((r) => r.url)).toEqual(['https://a.example'])
    expect(result.current.run?.results[0]).not.toHaveProperty('runId')
    expect(result.current.progress).toEqual({ checked: 1, total: 2 })

    const finalRun = {
      id: runId,
      runId,
      auditId: 'audit-1',
      startedAt: 'x',
      completedAt: 'y',
      status: 'completed',
      results: [pageResult('https://a.example')],
      summary: { total: 1, passed: 1, failed: 0, errored: 0, avgResponseTimeMs: 10 },
    }
    await act(async () => {
      emit('run:complete', finalRun)
      resolveRun(runId)
    })
    expect(result.current.running).toBe(false)
    expect(result.current.run?.status).toBe('completed')
    expect(result.current.run).not.toHaveProperty('runId')
  })

  it('cancels only the current run by id', async () => {
    mocked.runAudit.mockImplementation(() => new Promise<string>(() => {}))
    const { result } = renderHook(() => useRun(), { wrapper })
    act(() => {
      void result.current.start('audit-1')
    })
    await waitFor(() => expect(mocked.runAudit).toHaveBeenCalled())
    const runId = mocked.runAudit.mock.calls[0][3] as string

    await act(async () => {
      await result.current.cancel()
    })
    expect(mocked.cancelRun).toHaveBeenCalledWith(runId)
    expect(result.current.running).toBe(false)
  })

  it('handles run:error for the current run', async () => {
    mocked.runAudit.mockImplementation(() => new Promise<string>(() => {}))
    const { result } = renderHook(() => useRun(), { wrapper })
    act(() => {
      void result.current.start('audit-1')
    })
    await waitFor(() => expect(mocked.runAudit).toHaveBeenCalled())
    const runId = mocked.runAudit.mock.calls[0][3] as string

    act(() => emit('run:error', { runId: 'someone-else', message: 'nope' }))
    expect(result.current.running).toBe(true)
    act(() => emit('run:error', { runId, message: 'Failed to save run' }))
    expect(result.current.running).toBe(false)
    expect(result.current.error).toBe('Failed to save run')
  })
})
