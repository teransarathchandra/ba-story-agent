import React, { useEffect, useState, useCallback } from 'react'
import { Sparkles, CheckCircle, XCircle } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  projectId: string
  onSelectClaim: (id: string | null) => void
  onChanged: () => void
}

interface Recommendation {
  id: string
  key: string
  text: string
  rationale: string
  category: string
  status: string
  dispositionNote?: string | null
}

interface DeclineModalProps {
  rec: Recommendation
  onConfirm: (reason: string) => void
  onCancel: () => void
}

function DeclineModal({ rec, onConfirm, onCancel }: DeclineModalProps) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <h3 className="modal-title">Decline recommendation</h3>
        <p className="modal-description mb-3">Record why this recommendation should not move forward.</p>
        <div className="modal-preview">
          {rec.text}
        </div>
        <textarea
          className="input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Out of scope for current project phase."
          style={{ minHeight: 72 }}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-reject"
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
          >
            <XCircle size={14} /> Decline recommendation
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RecommendationsTab({ projectId, onSelectClaim, onChanged }: Props) {
  const [items, setItems] = useState<Recommendation[]>([])
  const [decliningId, setDecliningId] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.recommendation.list(projectId).then(setItems).catch(err => {
      showErrorToast(err, 'Failed to load recommendations')
    })
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleAccept = async (rec: Recommendation) => {
    try {
      await window.api.recommendation.accept({ recommendationId: rec.id, asRequirement: false })
      showSuccessToast(`Accepted recommendation ${rec.key}`)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to accept recommendation')
    }
  }

  const handleDecline = async (rec: Recommendation, reason: string) => {
    try {
      await window.api.recommendation.decline({ recommendationId: rec.id, reason })
      showSuccessToast(`Declined recommendation ${rec.key}`)
      setDecliningId(null)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to decline recommendation')
    }
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Sparkles size={40} />
        <p className="text-sm">No recommendations yet.</p>
        <p className="text-xs text-slate-600 max-w-xs">
          Recommendations appear when AI reviewers spot gaps or missing rules.
        </p>
      </div>
    )
  }

  const pending = items.filter(r => r.status === 'open')
  const accepted = items.filter(r => r.status === 'accepted')
  const declined = items.filter(r => r.status === 'declined')

  const renderGroup = (label: string, group: Recommendation[], showActions: boolean) => {
    if (group.length === 0) return null
    return (
      <section className="review-group">
        <div className="review-group-heading">
          <span>{label}</span>
          <span className="review-group-count">{group.length}</span>
        </div>
        <div className="review-list">
          {group.map(rec => {
            return (
              <div key={rec.id} className="review-item animate-fade-in">
                <div className="review-item-main">
                    <Sparkles size={16} className="review-item-leading text-amber-400" />
                    <div className="review-item-copy">
                      <p className="review-item-title">{rec.text}</p>
                      {rec.rationale && (
                        <p className="review-rationale">
                          <strong>Rationale:</strong> {rec.rationale}
                        </p>
                      )}
                      {rec.dispositionNote && (
                        <p className="review-disposition">
                          “{rec.dispositionNote}”
                        </p>
                      )}
                      <div className="review-meta">
                        <span className="review-key">{rec.key}</span>
                        <span className="review-category">
                          {rec.category}
                        </span>
                        {rec.status !== 'pending' && (
                          <span className={`badge ${rec.status === 'declined' ? 'badge-declined' : 'badge-accepted'}`}>
                            {rec.status}
                          </span>
                        )}
                      </div>
                    </div>

                    {showActions && (
                      <div className="review-actions review-actions-stacked">
                        <button
                          onClick={() => handleAccept(rec)}
                          className="btn btn-approve"
                          title="Accept recommendation"
                        >
                          <CheckCircle size={15} /> Accept
                        </button>
                        <button
                          onClick={() => setDecliningId(rec.id)}
                          className="btn btn-reject"
                          title="Decline with reason"
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
      <div className="review-callout review-callout-info">
        Recommendations are suggested by AI. Accept or decline each one to record your review decision;
        requirements are never changed automatically.
      </div>

      {renderGroup('Open', pending, true)}
      {renderGroup('Accepted', accepted, false)}
      {renderGroup('Declined', declined, false)}

      {decliningId && (
        <DeclineModal
          rec={items.find(r => r.id === decliningId)!}
          onConfirm={reason => {
            const rec = items.find(r => r.id === decliningId)
            if (rec) handleDecline(rec, reason)
          }}
          onCancel={() => setDecliningId(null)}
        />
      )}
    </div>
  )
}
