import React, { useEffect, useState, useCallback } from 'react'
import { CheckCircle, Quote, XCircle } from 'lucide-react'
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
        <h3 className="modal-title">Decline requirement</h3>
        <p className="modal-description mb-4">
          Record why this requirement should not move forward.
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
            <XCircle size={14} /> Decline requirement
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RequirementsTab({ projectId, onSelectClaim, selectedClaimId, onChanged }: Props) {
  const [items, setItems] = useState<Requirement[]>([])
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.requirement.list(projectId).then(setItems).catch(err => {
      showErrorToast(err, 'Failed to load requirements')
    })
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleApprove = async (req: Requirement) => {
    try {
      await window.api.requirement.approve({ requirementId: req.id, projectId })
      showSuccessToast(`Accepted ${req.key}`)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to approve requirement')
    }
  }

  const handleReject = async (req: Requirement, reason: string) => {
    try {
      await window.api.requirement.reject({ requirementId: req.id, projectId, reason })
      showSuccessToast(`Declined ${req.key}`)
      setRejectingId(null)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to decline requirement')
    }
  }

  const handleSelectEvidence = (req: Requirement) => {
    const claimId = req.originClaimIds?.[0]
    if (claimId) onSelectClaim(selectedClaimId === claimId ? null : claimId)
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <CheckCircle size={40} />
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
    rejected: { badge: 'badge-rejected', label: 'Declined' },
  }

  const renderGroup = (label: string, group: Requirement[]) => {
    if (group.length === 0) return null
    return (
      <section className="review-group">
        <div className="review-group-heading">
          <span>{label}</span>
          <span className="review-group-count">{group.length}</span>
        </div>
        <div className="review-list">
          {group.map(req => {
            const hasEvidence = req.originClaimIds?.length > 0
            const firstClaimId = req.originClaimIds?.[0]
            const isSelected = firstClaimId && selectedClaimId === firstClaimId
            const meta = statusMeta[req.status]

            return (
              <div
                key={req.id}
                className={`review-item ${isSelected ? 'selected' : ''} animate-fade-in`}
              >
                <div className="review-item-main">
                  <div className="review-item-copy">
                    <span className="review-key">{req.key}</span>
                    <p className="review-item-title">{req.statement}</p>
                    <div className="review-meta">
                      {meta && <span className={`badge ${meta.badge}`}>{meta.label}</span>}
                      {req.origin === 'ba-authored' && (
                        <span className="badge badge-assumption">BA authored</span>
                      )}
                      {hasEvidence && (
                        <button
                          type="button"
                          className="evidence-link"
                          onClick={() => handleSelectEvidence(req)}
                          aria-pressed={Boolean(isSelected)}
                        >
                          <Quote size={13} /> {isSelected ? 'Hide evidence' : 'View evidence'}
                        </button>
                      )}
                    </div>
                  </div>
                  {req.status === 'proposed' && (
                    <div className="review-actions">
                      <button
                        onClick={() => handleApprove(req)}
                        className="btn btn-approve"
                        title="Accept requirement"
                      >
                        <CheckCircle size={15} /> Accept
                      </button>
                      <button
                        onClick={() => setRejectingId(req.id)}
                        className="btn btn-reject"
                        title="Decline requirement with a reason"
                      >
                        <XCircle size={15} /> Decline
                      </button>
                    </div>
                  )}
                  </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div>
      {renderGroup('Pending review', proposed)}
      {renderGroup('Finalized', finalized)}
      {renderGroup('Declined', rejected)}

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
