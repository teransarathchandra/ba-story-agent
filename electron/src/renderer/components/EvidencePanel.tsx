import React, { useEffect, useState, useMemo } from 'react'
import { X, Quote, AlertCircle, MapPin } from 'lucide-react'

interface Props {
  claimId: string
  onClose: () => void
}

interface ClaimDetail {
  id: string
  quote: string
  statement: string
  kind: string
  status: string
  speakerRole: string
  charStart: number | null
  charEnd: number | null
  context: string | null
}

function highlightQuoteInContext(context: string, quote: string): React.ReactNode[] {
  // Find the quote within the context and wrap it in a highlight span
  const normalizedContext = context
  const normalizedQuote = quote.trim()

  const idx = normalizedContext.indexOf(normalizedQuote)
  if (idx < 0) {
    // Quote not found in context (e.g. fuzzy-matched), show context with quote separately
    return [<span key="full">{context}</span>]
  }

  const before = normalizedContext.slice(0, idx)
  const match = normalizedContext.slice(idx, idx + normalizedQuote.length)
  const after = normalizedContext.slice(idx + normalizedQuote.length)

  return [
    before && <span key="before" className="text-slate-500">{before}</span>,
    <mark
      key="match"
      style={{
        background: 'rgba(99,102,241,0.25)',
        color: '#c7d2fe',
        borderRadius: 3,
        padding: '1px 2px',
      }}
    >
      {match}
    </mark>,
    after && <span key="after" className="text-slate-500">{after}</span>,
  ].filter(Boolean) as React.ReactNode[]
}

const KIND_META: Record<string, { label: string; color: string }> = {
  requirement: { label: 'Requirement', color: 'text-indigo-400' },
  assumption: { label: 'Assumption', color: 'text-violet-400' },
  ambiguity: { label: 'Ambiguity', color: 'text-amber-400' },
}

const STATUS_META: Record<string, { badge: string }> = {
  validated: { badge: 'badge-answered' },
  'validated (fuzzy)': { badge: 'badge-asked' },
  'validated (segmentCorrected)': { badge: 'badge-asked' },
  quarantined: { badge: 'badge-rejected' },
  candidate: { badge: 'badge-pending' },
}

export default function EvidencePanel({ claimId, onClose }: Props) {
  const [claim, setClaim] = useState<ClaimDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setClaim(null)
    window.api.claim.get(claimId)
      .then(c => { setClaim(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [claimId])

  const contextNodes = useMemo(() => {
    if (!claim?.context || !claim?.quote) return null
    return highlightQuoteInContext(claim.context, claim.quote)
  }, [claim?.context, claim?.quote])

  const kindMeta = claim ? (KIND_META[claim.kind] ?? { label: claim.kind, color: 'text-slate-400' }) : null
  const statusMeta = claim ? (STATUS_META[claim.status] ?? { badge: 'badge-pending' }) : null

  return (
    <div className="h-full flex flex-col animate-slide-in-right">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--border-subtle)', background: 'rgba(99,102,241,0.05)' }}
      >
        <div className="flex items-center gap-2">
          <Quote size={15} className="text-indigo-400" />
          <span className="text-sm font-semibold text-indigo-300">Evidence</span>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700/50 transition-smooth"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-slate-700/40 rounded w-3/4" />
            <div className="h-20 bg-slate-700/30 rounded" />
            <div className="h-4 bg-slate-700/40 rounded w-1/2" />
            <div className="h-32 bg-slate-700/20 rounded" />
          </div>
        )}

        {!loading && !claim && (
          <div className="flex flex-col items-center gap-3 py-8 text-slate-500 text-center">
            <AlertCircle size={20} className="opacity-40" />
            <p className="text-xs">Claim not found</p>
          </div>
        )}

        {!loading && claim && (
          <>
            {/* Claim metadata */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold ${kindMeta?.color}`}>
                {kindMeta?.label}
              </span>
              <span className={`badge ${statusMeta?.badge}`}>{claim.status}</span>
              {claim.speakerRole && (
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <MapPin size={9} /> {claim.speakerRole}
                </span>
              )}
            </div>

            {/* Normalized statement */}
            <div>
              <div className="label mb-1.5">Normalized statement</div>
              <p className="text-sm text-slate-200 leading-relaxed">{claim.statement}</p>
            </div>

            <div className="divider" />

            {/* Verbatim quote */}
            <div>
              <div className="label mb-2">Verbatim quote</div>
              <blockquote className="quote-text text-sm">
                "{claim.quote}"
              </blockquote>
            </div>

            {/* Transcript context with inline highlight */}
            {claim.context && (
              <div>
                <div className="label mb-2">In context</div>
                <div
                  className="text-xs leading-relaxed p-3 rounded-lg"
                  style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)' }}
                >
                  {contextNodes || (
                    <span className="text-slate-500">Context unavailable</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-600 mt-1.5 flex items-center gap-1">
                  <span
                    style={{ width: 10, height: 10, display: 'inline-block', background: 'rgba(99,102,241,0.25)', borderRadius: 2 }}
                  />
                  Highlighted: the exact quote from transcript
                </p>
              </div>
            )}

            {/* Position info */}
            {claim.charStart != null && (
              <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-3">
                Position in transcript: chars {claim.charStart}–{claim.charEnd}
              </div>
            )}

            {/* Warning if quarantined */}
            {claim.status === 'quarantined' && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>This claim was quarantined — its quote could not be matched to the transcript with ≥90% similarity. It is excluded from all output.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
