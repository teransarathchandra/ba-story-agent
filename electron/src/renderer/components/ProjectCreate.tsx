import React, { useState } from 'react'
import { FolderPlus, X, Loader } from 'lucide-react'

interface Props {
  onCreated: (project: any) => void
  onCancel: () => void
}

export default function ProjectCreate({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !domain.trim()) return
    setLoading(true)
    setError(null)
    try {
      const project = await window.api.project.create({
        name: name.trim(),
        domain: domain.trim(),
        regulatory: 'none',
        systemName: undefined,
      })
      onCreated(project)
    } catch (err: any) {
      setError(err.message ?? 'Failed to create project')
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
            />
            <p className="text-xs text-slate-500 mt-1">
              Short summary of what this business does. Used by AI to extract domain concepts.
            </p>
          </div>

          {error && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

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
