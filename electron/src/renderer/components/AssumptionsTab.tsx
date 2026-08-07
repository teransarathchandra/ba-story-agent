import React, { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, ArrowUpCircle, MessageSquare, Quote } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  projectId: string
  onSelectClaim: (id: string | null) => void
  selectedClaimId: string | null
  onChanged: () => void
}

interface Claim {
  id: string
  quote: string
  statement: string
  kind: string
  status: string
  speakerRole: string
  sessionId?: string
}

interface PromoteModalProps {
  claim: Claim
  onConfirm: (note: string) => void
  onConvertToQuestion: () => void
  onCancel: () => void
}

function PromoteModal({ claim, onConfirm, onConvertToQuestion, onCancel }: PromoteModalProps) {
  const [note, setNote] = useState('')

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box">
        <h3 className="modal-title">Turn assumption into requirement</h3>
        <p className="modal-description mb-3">
          Enter a brief note explaining how this assumption was verified with the client.
        </p>

        <div className="quote-text text-xs mb-4">
          "{claim.quote}"
        </div>

        <div className="mb-4">
          <label className="label">Verification note *</label>
          <textarea
            className="input"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Confirmed with client by email on Aug 7: 'Yes, all invoices are in EUR.'"
            style={{ minHeight: 80 }}
            autoFocus
          />
          <p className="field-help">
            Who confirmed it and when?
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1"
              onClick={() => note.trim() && onConfirm(note.trim())}
              disabled={!note.trim()}
            >
              <ArrowUpCircle size={14} /> Promote to requirement
            </button>
            <button
              className="btn btn-ghost"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
          <button
            className="btn btn-ghost"
            style={{ width: '100%', fontSize: '12px' }}
            onClick={onConvertToQuestion}
          >
            <MessageSquare size={12} /> Convert to open question instead
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AssumptionsTab({ projectId, onSelectClaim, selectedClaimId, onChanged }: Props) {
  const [items, setItems] = useState<Claim[]>([])
  const [promotingClaim, setPromotingClaim] = useState<Claim | null>(null)

  const load = useCallback(() => {
    window.api.assumption.list(projectId).then(setItems).catch(err => {
      showErrorToast(err, 'Failed to load assumptions')
    })
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handlePromote = async (claim: Claim, note: string) => {
    try {
      await window.api.assumption.promote({
        claimId: claim.id,
        projectId,
        verificationNote: note,
      })
      showSuccessToast('Promoted assumption to requirement')
      setPromotingClaim(null)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to promote assumption')
    }
  }

  const handleConvertToQuestion = async (claim: Claim) => {
    setPromotingClaim(null)
    alert(`Open question created for: "${claim.quote.slice(0, 60)}..."`)
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <MessageSquare size={40} />
        <p className="text-sm">No assumptions found yet.</p>
        <p className="text-xs text-slate-600 max-w-xs">
          Assumptions are unconfirmed client statements (like "we'd probably" or "usually").
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="review-callout review-callout-warning">
        <AlertTriangle size={16} />
        <span>Assumptions are unconfirmed client statements. Promote only after verification with the client.</span>
      </div>

      <div className="review-list">
        {items.map(claim => {
          const isSelected = selectedClaimId === claim.id

          return (
            <div key={claim.id} className={`review-item animate-fade-in ${isSelected ? 'selected' : ''}`}>
              <div className="review-item-main">
                <Quote size={16} className="review-item-leading review-item-leading-assumption" />
                <div className="review-item-copy">
                  <blockquote className="review-quote">“{claim.quote}”</blockquote>
                  <p className="review-item-title">{claim.statement}</p>
                  <div className="review-meta">
                    <span className="badge badge-assumption">Assumption</span>
                    <span className={`badge ${
                      claim.status === 'validated' ? 'badge-answered'
                      : claim.status === 'quarantined' ? 'badge-rejected'
                      : 'badge-pending'
                    }`}>
                      {claim.status}
                    </span>
                    {claim.speakerRole && (
                      <span className="review-meta-text">{claim.speakerRole}</span>
                    )}
                    <button
                      type="button"
                      className="evidence-link"
                      onClick={() => onSelectClaim(isSelected ? null : claim.id)}
                      aria-pressed={isSelected}
                    >
                      <Quote size={13} /> {isSelected ? 'Hide evidence' : 'View evidence'}
                    </button>
                  </div>
                </div>

                <div className="review-actions review-actions-stacked">
                  <button
                    onClick={() => setPromotingClaim(claim)}
                    className="btn btn-warn"
                    title="Turn assumption into requirement"
                  >
                    <ArrowUpCircle size={15} /> Promote
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleConvertToQuestion(claim)}
                  >
                    <MessageSquare size={15} /> Turn into question
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {promotingClaim && (
        <PromoteModal
          claim={promotingClaim}
          onConfirm={note => handlePromote(promotingClaim, note)}
          onConvertToQuestion={() => handleConvertToQuestion(promotingClaim)}
          onCancel={() => setPromotingClaim(null)}
        />
      )}
    </div>
  )
}
