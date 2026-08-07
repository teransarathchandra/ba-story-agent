import React, { useState } from 'react'
import { FolderPlus, X, Loader } from 'lucide-react'

interface Props {
  onCreated: (project: any) => void
  onCancel: () => void
}

const REGULATORY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'GDPR', label: 'GDPR (EU Privacy)' },
  { value: 'HIPAA', label: 'HIPAA (US Healthcare)' },
  { value: 'PCI-DSS', label: 'PCI-DSS (Payments)' },
  { value: 'SOC2', label: 'SOC 2 (Security)' },
]

export default function ProjectCreate({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [regulatory, setRegulatory] = useState('none')
  const [systemName, setSystemName] = useState('')
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
        regulatory,
        systemName: systemName.trim() || undefined,
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Regulatory Context (Optional)</label>
              <select className="input" value={regulatory} onChange={e => setRegulatory(e.target.value)}>
                {REGULATORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Applies specific compliance checks like privacy or healthcare rules.
              </p>
            </div>
            <div>
              <label className="label">System or Product Name (Optional)</label>
              <input
                className="input"
                value={systemName}
                onChange={e => setSystemName(e.target.value)}
                placeholder="e.g. Invoicing API"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Name of the software system, if applicable.
              </p>
            </div>
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
