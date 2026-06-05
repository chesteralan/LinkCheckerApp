import { useState, useCallback, useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { runAudit, cancelRun } from '@/lib/tauri'
import type { PageResult, AuditRun } from '@/types'

interface RunnerState {
  running: boolean
  run: AuditRun | null
  progress: { checked: number; total: number } | null
}

export function useAuditRunner() {
  const [state, setState] = useState<RunnerState>({
    running: false,
    run: null,
    progress: null,
  })
  const unlisteners = useRef<UnlistenFn[]>([])

  const cleanup = useCallback(async () => {
    for (const unlisten of unlisteners.current) {
      unlisten()
    }
    unlisteners.current = []
  }, [])

  useEffect(() => {
    return () => { cleanup() }
  }, [cleanup])

  const start = useCallback(async (auditId: string, originOverride?: string, urlPostfix?: string) => {
    setState({ running: true, run: null, progress: null })

    const unlistenResult = await listen<PageResult>('run:result', (event) => {
      setState((s) => ({
        ...s,
        run: s.run
          ? { ...s.run, results: [...s.run.results, event.payload] }
          : {
              id: '',
              auditId,
              startedAt: new Date().toISOString(),
              completedAt: null,
              status: 'running',
              results: [event.payload],
              summary: { total: 0, passed: 0, failed: 0, errored: 0, avgResponseTimeMs: 0 },
            },
      }))
    })

    const unlistenProgress = await listen<{ checked: number; total: number }>('run:progress', (event) => {
      setState((s) => ({ ...s, progress: event.payload }))
    })

    const unlistenComplete = await listen<AuditRun>('run:complete', (event) => {
      setState({
        running: false,
        run: event.payload,
        progress: null,
      })
      cleanup()
    })

    const unlistenCancelled = await listen('run:cancelled', () => {
      setState((s) => ({ ...s, running: false, progress: null }))
      cleanup()
    })

    const unlistenError = await listen<{ message: string }>('run:error', () => {
      setState((s) => ({ ...s, running: false }))
      cleanup()
    })

    unlisteners.current = [
      unlistenResult,
      unlistenProgress,
      unlistenComplete,
      unlistenCancelled,
      unlistenError,
    ]

    await runAudit(auditId, originOverride, urlPostfix)
  }, [cleanup])

  const cancel = useCallback(async () => {
    await cancelRun()
    setState((s) => ({ ...s, running: false }))
    cleanup()
  }, [cleanup])

  return { ...state, start, cancel }
}
