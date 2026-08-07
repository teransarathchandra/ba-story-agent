import React, { useEffect, useState, useCallback } from 'react'
import { Check, X, Edit3, ChevronDown, ChevronUp, Quote } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  projectId: string
  onSelectClaim: (id: string | null) => void
  selectedClaimId: string | null
  onChanged: () => void
}

interface Requirement {
  id: string
  key: string
  statement: string
  status: string
  origin: string
  originClaimIds: string[]
}

interface RejectModalProps {
  onConfirm: (reason: string) => void
  onCancel: () => void
}

function RejectModal({ onConfirm, onCancel }: RejectModalProps) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <h3 className="font-semibold text-white mb-1">Reject requirement</h3>
        <p className="text-xs text-slate-400 mb-4">
          Enter a reason for rejecting this requirement.
        </p>
        <textarea
          className="input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Client confirmed in session 2 that this feature is out of scope."
          style={{ minHeight: 80 }}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-reject"
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
          >
            <X size={14} /> Confirm rejection
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RequirementsTab({ projectId, onSelectClaim, selectedClaimId, onChanged }: Props) {
  const [items, setItems] = useState<Requirement[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.requirement.list(projectId).then(setItems).catch(err => {
      showErrorToast(err, 'Failed to load requirements')
    })
  }, [projectId])

  useEffect(() => { load() }, [load])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleApprove = async (req: Requirement) => {
    try {
      await window.api.requirement.approve({ requirementId: req.id, projectId })
      showSuccessToast(`Approved ${req.key}`)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to approve requirement')
    }
  }

  const handleReject = async (req: Requirement, reason: string) => {
    try {
      await window.api.requirement.reject({ requirementId: req.id, projectId, reason })
      showSuccessToast(`Rejected ${req.key}`)
      setRejectingId(null)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to reject requirement')
    }
  }

  const handleSelectEvidence = (req: Requirement) => {
    const claimId = req.originClaimIds?.[0]
    if (claimId) onSelectClaim(selectedClaimId === claimId ? null : claimId)
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Check size={40} />
        <p className="text-sm">No requirements yet.</p>
        <p className="text-xs text-slate-600 max-w-xs">
          Add a meeting transcript and click Analyze to extract requirements.
        </p>
      </div>
    )
  }

  const proposed = items.filter(r => r.status === 'proposed')
  const finalized = items.filter(r => r.status === 'finalized')
  const rejected = items.filter(r => r.status === 'rejected')

  const statusMeta: Record<string, { badge: string; label: string }> = {
    proposed: { badge: 'badge-pending', label: 'Pending review' },
    finalized: { badge: 'badge-finalized', label: 'Finalized' },
    rejected: { badge: 'badge-rejected', label: 'Rejected' },
  }

  const renderGroup = (label: string, group: Requirement[]) => {
    if (group.length === 0) return null
    return (
      <div className="mb-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-slate-800" />
          {label} ({group.length})
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="space-y-2">
          {group.map(req => {
            const isExpanded = expanded.has(req.id)
            const hasEvidence = req.originClaimIds?.length > 0
            const firstClaimId = req.originClaimIds?.[0]
            const isSelected = firstClaimId && selectedClaimId === firstClaimId
            const meta = statusMeta[req.status]

            return (
              <div
                key={req.id}
                className={`card ${isSelected ? 'selected' : ''} cursor-pointer animate-fade-in`}
                style={{ padding: 0, overflow: 'hidden' }}
                onClick={() => handleSelectEvidence(req)}
              >
                {/* Main row */}
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 pt-0.5">
                      <span className="text-[10px] font-mono font-bold text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        {req.key}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 leading-relaxed">{req.statement}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {meta && <span className={`badge ${meta.badge}`}>{meta.label}</span>}
                        {req.origin === 'ba-authored' && (
                          <span className="badge badge-assumption">BA authored</span>
                        )}
                        {hasEvidence && (
                          <span className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Quote size={10} /> Evidence
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {req.status === 'proposed' && (
                      <div
                        className="flex items-center gap-1.5 flex-shrink-0 ml-2"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleApprove(req)}
                          className="btn btn-approve"
                          style={{ padding: '5px 10px', fontSize: '12px' }}
                          title="Approve requirement"
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          onClick={() => setRejectingId(req.id)}
                          className="btn btn-reject"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          title="Reject with reason"
                        >
                          <X size={12} />
                        </button>
                        <button
                          onClick={() => toggleExpand(req.id)}
                          className="btn btn-ghost"
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                          title="Details"
                        >
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div
                    className="border-t px-4 py-3 space-y-2"
                    style={{ borderColor: 'var(--border-subtle)', background: 'rgba(0,0,0,0.2)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="text-xs text-slate-500">
                      Claim IDs: {req.originClaimIds?.join(', ') || 'None'}
                    </div>
                    <p className="text-xs text-slate-400">
                      Click to view the client quote in the side panel.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {renderGroup('Pending review', proposed)}
      {renderGroup('Finalized', finalized)}
      {renderGroup('Rejected', rejected)}

      {rejectingId && (
        <RejectModal
          onConfirm={reason => {
            const req = items.find(r => r.id === rejectingId)
            if (req) handleReject(req, reason)
          }}
          onCancel={() => setRejectingId(null)}
        />
      )}
    </div>
  )
}
