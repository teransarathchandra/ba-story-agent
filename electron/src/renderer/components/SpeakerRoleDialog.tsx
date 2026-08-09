import React, { useEffect, useId, useState } from 'react'
import { Users, X, Loader, AlertCircle } from 'lucide-react'
import { showErrorToast, showSuccessToast, formatErrorMessage } from '../utils/errors'
import type { DetectedSpeaker } from '../types/api'

interface Props {
  sessionId: string
  sessionTitle: string
  speakers: DetectedSpeaker[]
  onSet: () => void
  onCancel: () => void
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ba', label: 'Analyst (BA)' },
  { value: 'client', label: 'Client' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
]

export default function SpeakerRoleDialog({ sessionId, sessionTitle, speakers, onSet, onCancel }: Props) {
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [loading, onCancel])

  // Every role starts unselected — no silent default (including "unknown")
  // that a user could satisfy without an active choice per speaker.
  const allChosen = speakers.every(sp => roles[sp.label])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!allChosen) return

    setLoading(true)
    setFieldError(null)
    try {
      await window.api.speaker.setRoles({ sessionId, roles })
      showSuccessToast(`Speaker roles confirmed for "${sessionTitle}"`)
      onSet()
    } catch (err: any) {
      const cleanMsg = formatErrorMessage(err) || 'Failed to save speaker roles'
      setFieldError(cleanMsg)
      showErrorToast(err, 'Failed to save speaker roles')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="modal-title" id={titleId}>Confirm speaker roles</h2>
            <p className="modal-description" id={descriptionId}>
              Required before you can analyze &ldquo;{sessionTitle}&rdquo;. Automatic detection can be wrong — confirm each speaker.
            </p>
          </div>
          <button onClick={onCancel} className="icon-button" aria-label="Close dialog" disabled={loading}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {speakers.map(sp => (
            <div key={sp.label}>
              <label className="label" htmlFor={`${titleId}-${sp.label}`}>{sp.label}</label>
              <select
                id={`${titleId}-${sp.label}`}
                className="input"
                value={roles[sp.label] ?? ''}
                onChange={e => { setRoles(prev => ({ ...prev, [sp.label]: e.target.value })); setFieldError(null); }}
                required
                disabled={loading}
              >
                <option value="" disabled>Select a role&hellip;</option>
                {ROLE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}

          {fieldError && (
            <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5">
              <AlertCircle size={13} className="flex-shrink-0 text-red-500" />
              <span>{fieldError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !allChosen}
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <Users size={14} />}
              {loading ? 'Saving...' : 'Save roles'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
