import React, { useEffect, useId, useState } from 'react'
import { Target, X, Loader, AlertCircle } from 'lucide-react'
import { showErrorToast, showSuccessToast, formatErrorMessage } from '../utils/errors'
import type { Project } from '../types/api'

interface Props {
  projectId: string
  projectName: string
  onSet: (project: Project) => void
  onCancel: () => void
}

export default function SetDomainDialog({ projectId, projectName, onSet, onCancel }: Props) {
  const [domain, setDomain] = useState('')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!domain.trim()) return

    setLoading(true)
    setFieldError(null)
    try {
      const project = await window.api.project.setDomain({ projectId, domain: domain.trim() })
      showSuccessToast(`Domain set for "${projectName}"`)
      onSet(project)
    } catch (err: any) {
      const cleanMsg = formatErrorMessage(err) || 'Failed to set domain'
      setFieldError(cleanMsg)
      showErrorToast(err, 'Failed to set domain')
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
            <h2 className="modal-title" id={titleId}>Set business domain</h2>
            <p className="modal-description" id={descriptionId}>Required before you can analyze sessions in &ldquo;{projectName}&rdquo;.</p>
          </div>
          <button onClick={onCancel} className="icon-button" aria-label="Close dialog" disabled={loading}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor={`${titleId}-domain`}>Business Domain *</label>
            <input
              id={`${titleId}-domain`}
              className={`input ${fieldError ? 'border-red-500 focus:border-red-500' : ''}`}
              value={domain}
              onChange={e => { setDomain(e.target.value); setFieldError(null); }}
              placeholder="e.g. Freight invoicing for logistics operators"
              autoFocus
              required
            />
          </div>

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
              disabled={loading || !domain.trim()}
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <Target size={14} />}
              {loading ? 'Saving...' : 'Save domain'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
