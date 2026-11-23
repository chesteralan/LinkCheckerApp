import { Modal } from './Modal'

interface Props {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
  /** Dialog heading. Defaults to "Confirm". */
  title?: string
  /** Label of the destructive action button. Defaults to "Delete". */
  confirmLabel?: string
}

export function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  title = 'Confirm',
  confirmLabel = 'Delete',
}: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm">{message}</p>
        <div className="flex gap-2">
          {/* The safe choice (Cancel) gets initial focus, so Enter never deletes by accident. */}
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
