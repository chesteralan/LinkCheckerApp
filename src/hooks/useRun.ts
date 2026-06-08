import { useContext } from 'react'
import { RunContext, type RunContextValue } from './RunContext'

export function useRun(): RunContextValue {
  const ctx = useContext(RunContext)
  if (!ctx) throw new Error('useRun must be used within a RunProvider')
  return ctx
}
