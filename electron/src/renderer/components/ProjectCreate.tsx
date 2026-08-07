import React, { useState } from 'react'
import { FolderPlus, X, Loader } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  onCreated: (project: any) => void
  onCancel: () => void
}

export default function ProjectCreate({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !domain.trim()) return

    if (domain.trim().length < 10) {
      showErrorToast('Business domain must be at least 10 characters (e.g. B2B freight invoicing for logistics operators)')
      return
    }

    setLoading(true)
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
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Freight Logistics Platform"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label">Business Domain *</label>
            <input
              className="input"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="e.g. B2B freight invoicing for logistics operators"
              required
              minLength={10}
            />
            <p className="text-xs text-slate-500 mt-1">
              At least 10 characters describing the business area (e.g. B2B freight invoicing for logistics operators).
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !name.trim() || domain.trim().length < 10}
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
