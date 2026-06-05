import { useEffect, useCallback, useRef } from 'react'

type HotkeyMap = Record<string, () => void>

export function useHotkeys(map: HotkeyMap, enabled = true) {
  const mapRef = useRef(map)
  mapRef.current = map

  const handler = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable

    const key = [
      e.metaKey ? 'Cmd' : '',
      e.ctrlKey ? 'Ctrl' : '',
      e.shiftKey ? 'Shift' : '',
      e.altKey ? 'Alt' : '',
      e.key,
    ]
      .filter(Boolean)
      .join('+')

    const action = mapRef.current[key] ?? mapRef.current[e.key]
    if (action) {
      if (isInput && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      action()
    }
  }, [enabled])

  useEffect(() => {
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handler])
}
