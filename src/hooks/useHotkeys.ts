import { useEffect, useCallback, useRef } from 'react'

type HotkeyMap = Record<string, () => void>

export function useHotkeys(map: HotkeyMap, enabled = true) {
  const mapRef = useRef(map)

  useEffect(() => {
    mapRef.current = map
  }, [map])

  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return
      // Ignore IME composition and events a component already handled.
      if (e.isComposing || e.defaultPrevented) return
      // A modal dialog owns the keyboard while it is open (A-18).
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      const target = e.target as HTMLElement | null
      const isInput =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      const hasCommandModifier = e.metaKey || e.ctrlKey || e.altKey

      const key = [
        e.metaKey ? 'Cmd' : '',
        e.ctrlKey ? 'Ctrl' : '',
        e.shiftKey ? 'Shift' : '',
        e.altKey ? 'Alt' : '',
        e.key,
      ]
        .filter(Boolean)
        .join('+')

      // The bare-key fallback (e.g. '?' typed with Shift) only applies when no
      // modifier other than Shift is held, so Cmd/Ctrl+1 does not trigger the
      // binding for '1' (A-61).
      // 'Mod' matches Cmd or Ctrl (one of them, not both), so callers can bind
      // 'Mod+Enter' once instead of both 'Cmd+Enter' and 'Ctrl+Enter'.
      const modPressed = e.metaKey !== e.ctrlKey
      const modKey = modPressed
        ? ['Mod', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.key].filter(Boolean).join('+')
        : undefined

      const action =
        mapRef.current[key] ??
        (modKey ? mapRef.current[modKey] : undefined) ??
        (hasCommandModifier ? undefined : mapRef.current[e.key])
      if (!action) return
      // Bare-key shortcuts never fire while typing; explicit modifier combos
      // (Cmd+Enter etc.) do.
      if (isInput && !hasCommandModifier) return
      e.preventDefault()
      action()
    },
    [enabled],
  )

  useEffect(() => {
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handler])
}
