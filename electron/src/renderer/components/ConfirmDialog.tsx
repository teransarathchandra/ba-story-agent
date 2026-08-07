import React, { useEffect, useId, useRef } from 'react'
import { Loader, Trash2 } from 'lucide-react'

interface Props {
  title: string
  description: string
  confirmLabel: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [loading, onCancel])

  return (
    <div
      className="modal-overlay"
      onClick={event => event.target === event.currentTarget && !loading && onCancel()}
    >
      <div
        className="modal-box confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <Trash2 className="confirm-dialog-icon" size={20} aria-hidden="true" />
        <h2 className="modal-title" id={titleId}>{title}</h2>
        <p className="modal-description" id={descriptionId}>{description}</p>

        <div className="modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {loading ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
