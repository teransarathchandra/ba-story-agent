import React, { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, ArrowUpCircle, MessageSquare, Quote } from 'lucide-react'

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
        <h3 className="font-semibold text-white mb-1">Promote assumption to requirement</h3>
        <p className="text-xs text-slate-400 mb-3">
          An assumption cannot become a requirement in one click. Record how it was confirmed.
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
            placeholder="e.g. Confirmed with client via email on 2026-08-07. Reply: 'Yes, all invoices are in EUR.' (see thread attached to OQ-003)"
            style={{ minHeight: 80 }}
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-1">
            How was this verified? Who confirmed it, and when? This note is recorded in the audit trail.
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
            <MessageSquare size={12} /> Convert to open question instead (default)
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
    window.api.assumption.list(projectId).then(setItems).catch(console.error)
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handlePromote = async (claim: Claim, note: string) => {
    try {
      await window.api.assumption.promote({
        claimId: claim.id,
        projectId,
        verificationNote: note,
      })
      setPromotingClaim(null)
      load()
      onChanged()
    } catch (e: any) {
      console.error(e.message)
    }
  }

  const handleConvertToQuestion = async (claim: Claim) => {
    // Record it as a question-conversion event (implementation can be enhanced)
    setPromotingClaim(null)
    alert(`OQ created for: "${claim.quote.slice(0, 60)}…"\n\nThis would raise an open question in a full implementation.`)
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <MessageSquare size={40} />
        <p className="text-sm">No assumptions found yet.</p>
        <p className="text-xs text-slate-600 max-w-xs">
          Assumptions are hedged client statements ("we'd probably", "usually", "I think") — they get classified separately from confirmed requirements.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500 mb-4 flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2">
        <AlertTriangle size={14} className="flex-shrink-0 text-amber-400" />
        <span>Assumptions are hedged client statements. They are <strong>not client requirements</strong>. Promote only with documented verification.</span>
      </div>

      {items.map(claim => {
        const isSelected = selectedClaimId === claim.id

        return (
          <div
            key={claim.id}
            className={`card cursor-pointer animate-fade-in ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelectClaim(isSelected ? null : claim.id)}
          >
            <div className="p-4">
              <div className="flex items-start gap-3">
                <Quote size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 italic mb-2 leading-relaxed">
                    "{claim.quote}"
                  </p>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {claim.statement}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="badge badge-assumption">Assumption</span>
                    <span className={`badge ${
                      claim.status === 'validated' ? 'badge-answered'
                      : claim.status === 'quarantined' ? 'badge-rejected'
                      : 'badge-pending'
                    }`}>
                      {claim.status}
                    </span>
                    {claim.speakerRole && (
                      <span className="text-[10px] text-slate-500">{claim.speakerRole}</span>
                    )}
                  </div>
                </div>

                <div
                  className="flex-shrink-0 flex flex-col gap-1.5"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => setPromotingClaim(claim)}
                    className="btn btn-warn"
                    style={{ padding: '5px 10px', fontSize: '12px' }}
                    title="Promote to requirement (requires verification note)"
                  >
                    <ArrowUpCircle size={12} /> Promote
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 8px', fontSize: '11px' }}
                    onClick={() => handleConvertToQuestion(claim)}
                  >
                    <MessageSquare size={11} /> → Question
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })}

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
