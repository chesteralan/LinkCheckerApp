import { useState, useCallback } from 'react'

interface ConfirmState {
  message: string
  onConfirm: () => void
}

export function useConfirmDelete() {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const requestDelete = useCallback((message: string, action: () => void) => {
    setConfirm({ message, onConfirm: action })
  }, [])

  const cancelDelete = useCallback(() => setConfirm(null), [])

  const executeDelete = useCallback(() => {
    confirm?.onConfirm()
    setConfirm(null)
  }, [confirm])

  return { confirm, requestDelete, cancelDelete, executeDelete }
}
