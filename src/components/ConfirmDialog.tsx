import { Modal } from './Modal'

interface Props {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title="Confirm">
      <div className="space-y-4">
        <p className="text-sm">{message}</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
