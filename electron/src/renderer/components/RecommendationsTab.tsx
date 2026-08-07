import React, { useEffect, useState, useCallback } from 'react'
import { Sparkles, CheckCircle, X, AlertCircle } from 'lucide-react'
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
        <h3 className="font-semibold text-white mb-1">Decline recommendation</h3>
        <p className="text-xs text-slate-400 mb-3">Provide a reason for declining this recommendation.</p>
        <div className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 mb-3 border border-slate-700/30">
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
            <X size={14} /> Decline
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

  const pending = items.filter(r => r.status === 'pending')
  const accepted = items.filter(r => r.status === 'accepted' || r.status === 'accepted-as-req')
  const declined = items.filter(r => r.status === 'declined')

  const CATEGORY_COLORS: Record<string, string> = {
    domain: 'bg-blue-500/15 text-blue-300',
    security: 'bg-rose-500/15 text-rose-300',
    compliance: 'bg-orange-500/15 text-orange-300',
    testability: 'bg-emerald-500/15 text-emerald-300',
    default: 'bg-slate-700/50 text-slate-300',
  }

  const renderGroup = (label: string, group: Recommendation[], showActions: boolean) => {
    if (group.length === 0) return null
    return (
      <div className="mb-6">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-slate-800" />
          {label} ({group.length})
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="space-y-2">
          {group.map(rec => {
            const catColor = CATEGORY_COLORS[rec.category] ?? CATEGORY_COLORS.default
            return (
              <div key={rec.id} className="card animate-fade-in" style={{ padding: 0 }}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles size={14} className="flex-shrink-0 mt-0.5 text-amber-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 leading-relaxed">{rec.text}</p>
                      {rec.rationale && (
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                          <span className="font-medium text-slate-500">Rationale:</span> {rec.rationale}
                        </p>
                      )}
                      {rec.dispositionNote && (
                        <p className="text-xs text-slate-500 mt-1.5 italic">
                          "{rec.dispositionNote}"
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-mono font-bold text-slate-500">{rec.key}</span>
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${catColor}`}>
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
                      <div
                        className="flex flex-col gap-1.5 flex-shrink-0"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleAccept(rec)}
                          className="btn btn-approve"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          title="Accept and add as open question"
                        >
                          <CheckCircle size={12} /> Accept
                        </button>
                        <button
                          onClick={() => setDecliningId(rec.id)}
                          className="btn btn-reject"
                          style={{ padding: '4px 8px', fontSize: '12px' }}
                          title="Decline with reason"
                        >
                          <X size={12} /> Decline
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs text-slate-500 mb-4 bg-slate-800/40 border border-slate-700/30 rounded-lg px-3 py-2">
        Recommendations are suggested by AI. Accepting adds them to open questions for client verification.
      </div>

      {renderGroup('Pending', pending, true)}
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
