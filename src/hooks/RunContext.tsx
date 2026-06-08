import { createContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { runAudit, runQuickAudit, cancelRun } from '@/lib/tauri'
import type { PageResult, AuditRun, SelectorCheck } from '@/types'

export interface RunnerState {
  running: boolean
  run: AuditRun | null
  progress: { checked: number; total: number } | null
  runPagePath: string | null
}

export interface RunContextValue extends RunnerState {
  start: (auditId: string, originOverride?: string, urlPostfix?: string) => Promise<void>
  startQuick: (
    urls: string[],
    checks: SelectorCheck[],
    config: { mode: string; batchSize: number; timeoutSecs: number },
    originOverride?: string,
    urlPostfix?: string,
    returnPath?: string,
  ) => Promise<void>
  cancel: () => Promise<void>
}

export const RunContext = createContext<RunContextValue | null>(null)

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RunnerState>({
    running: false,
    run: null,
    progress: null,
    runPagePath: null,
  })
  const unlisteners = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)

  useEffect(() => {
    runningRef.current = state.running
  }, [state.running])

  const cleanup = useCallback(async () => {
    for (const unlisten of unlisteners.current) {
      unlisten()
    }
    unlisteners.current = []
  }, [])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  const setupListeners = useCallback(
    async (auditId: string) => {
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
          runPagePath: null,
        })
        cleanup()
      })

      const unlistenCancelled = await listen('run:cancelled', () => {
        setState((s) => ({ ...s, running: false, progress: null, runPagePath: null }))
        cleanup()
      })

      const unlistenError = await listen<{ message: string }>('run:error', () => {
        setState((s) => ({ ...s, running: false, runPagePath: null }))
        cleanup()
      })

      unlisteners.current = [unlistenResult, unlistenProgress, unlistenComplete, unlistenCancelled, unlistenError]
    },
    [cleanup],
  )

  const start = useCallback(
    async (auditId: string, originOverride?: string, urlPostfix?: string) => {
      if (runningRef.current) {
        await cancelRun()
        await cleanup()
      }

      setState({ running: true, run: null, progress: null, runPagePath: `/audits/${auditId}` })
      await setupListeners(auditId)
      await runAudit(auditId, originOverride, urlPostfix)
    },
    [cleanup, setupListeners],
  )

  const startQuick = useCallback(
    async (
      urls: string[],
      checks: SelectorCheck[],
      config: { mode: string; batchSize: number; timeoutSecs: number },
      originOverride?: string,
      urlPostfix?: string,
      returnPath?: string,
    ) => {
      if (runningRef.current) {
        await cancelRun()
        await cleanup()
      }

      setState({ running: true, run: null, progress: null, runPagePath: returnPath ?? null })
      await setupListeners('')
      await runQuickAudit({ urls, checks, config, originOverride, urlPostfix })
    },
    [cleanup, setupListeners],
  )

  const cancel = useCallback(async () => {
    await cancelRun()
    setState((s) => ({ ...s, running: false }))
    cleanup()
  }, [cleanup])

  return (
    <RunContext.Provider value={{ ...state, start, startQuick, cancel }}>
      {children}
    </RunContext.Provider>
  )
}

// useRun is re-exported from ./useRun to avoid react-refresh warnings
