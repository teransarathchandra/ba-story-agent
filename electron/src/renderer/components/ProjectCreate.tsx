import React, { useState } from 'react'
import { FolderPlus, X, Loader } from 'lucide-react'

interface Props {
  onCreated: (project: any) => void
  onCancel: () => void
}

const REGULATORY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'GDPR', label: 'GDPR' },
  { value: 'HIPAA', label: 'HIPAA' },
  { value: 'PCI-DSS', label: 'PCI-DSS' },
  { value: 'SOC2', label: 'SOC 2' },
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <FolderPlus size={18} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="font-semibold text-base text-white">New Project</h2>
              <p className="text-xs text-slate-400">Set up your BA engagement</p>
            </div>
          </div>
          <button onClick={onCancel} className="btn btn-ghost w-8 h-8 p-0 rounded-full">
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
              placeholder="e.g. Nordic Freight Platform"
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
              placeholder="e.g. B2B freight invoicing for EU logistics operators"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              One line describing the domain — critical for accurate extraction.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Regulatory Context</label>
              <select className="input" value={regulatory} onChange={e => setRegulatory(e.target.value)}>
                {REGULATORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">System / Product Name</label>
              <input
                className="input"
                value={systemName}
                onChange={e => setSystemName(e.target.value)}
                placeholder="Optional"
              />
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
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
