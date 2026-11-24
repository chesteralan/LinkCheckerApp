import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  /** Accessible name used when no visible `title` is given. */
  ariaLabel?: string
  children: ReactNode
}

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Stack of open modal ids; the last one is the topmost. */
const modalStack: string[] = []

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  )
}

export function Modal({ open, onClose, title, ariaLabel, children }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const id = useId()
  const titleId = `${id}-title`

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Register in the modal stack, move focus in, and restore focus on close.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modalStack.push(id)

    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      // Prefer an element the caller marked with autoFocus (already focused by React), else the
      // first focusable control, else the dialog itself.
      const first = focusableIn(dialog).find((el) => !el.dataset.modalClose) ?? focusableIn(dialog)[0]
      ;(first ?? dialog).focus()
    }

    // Escape closes only the topmost modal. Listening on document (capture) also covers the case
    // where focus has somehow left the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('keydown', onKey, true)
      const idx = modalStack.lastIndexOf(id)
      if (idx !== -1) modalStack.splice(idx, 1)
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [open, id])

  if (!open) return null

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Keep global shortcuts (page hotkeys, ⌘K search) from acting on the page underneath.
    e.stopPropagation()
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = focusableIn(dialogRef.current)
    if (items.length === 0) {
      e.preventDefault()
      dialogRef.current.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="bg-background border border-border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto focus:outline-none"
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 id={titleId} className="font-semibold text-base">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-modal-close="true"
              className="text-muted-foreground hover:text-foreground text-lg leading-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
