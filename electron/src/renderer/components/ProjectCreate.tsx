import React, { useState } from 'react'
import { FolderPlus, X, Loader, AlertCircle } from 'lucide-react'
import { showErrorToast, showSuccessToast, formatErrorMessage } from '../utils/errors'

interface Props {
  onCreated: (project: any) => void
  onCancel: () => void
}

export default function ProjectCreate({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !domain.trim()) return

    setLoading(true)
    setFieldError(null)
    try {
      const project = await window.api.project.create({
        name: name.trim(),
        domain: domain.trim(),
        regulatory: 'none',
        systemName: undefined,
      })
      showSuccessToast(`Project "${project.name}" created`)
      onCreated(project)
    } catch (err: any) {
      const cleanMsg = formatErrorMessage(err) || 'Failed to create project'
      setFieldError(cleanMsg)
      showErrorToast(err, 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="modal-title">Create project</h2>
            <p className="modal-description">Set up your engagement context.</p>
          </div>
          <button onClick={onCancel} className="icon-button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Project Name *</label>
            <input
              className={`input ${fieldError ? 'border-red-500 focus:border-red-500' : ''}`}
              value={name}
              onChange={e => { setName(e.target.value); setFieldError(null); }}
              placeholder="e.g. Freight Logistics Platform"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label">Business Domain *</label>
            <input
              className={`input ${fieldError ? 'border-red-500 focus:border-red-500' : ''}`}
              value={domain}
              onChange={e => { setDomain(e.target.value); setFieldError(null); }}
              placeholder="e.g. Freight invoicing for logistics operators"
              required
            />
            <p className="text-xs text-slate-400 mt-1">
              Short summary of what this business does.
            </p>

            {fieldError && (
              <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5">
                <AlertCircle size={13} className="flex-shrink-0 text-red-500" />
                <span>{fieldError}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !name.trim() || !domain.trim()}
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <FolderPlus size={14} />}
              {loading ? 'Creating...' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
