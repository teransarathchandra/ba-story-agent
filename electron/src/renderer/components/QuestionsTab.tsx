import React, { useEffect, useState, useCallback } from 'react'
import { HelpCircle, ChevronRight, Copy, Check } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  projectId: string
  onSelectClaim: (id: string | null) => void
  onChanged: () => void
}

interface OpenQuestion {
  id: string
  key: string
  text: string
  category: string
  status: string
  answerText?: string | null
  raisedBySessionId: string
  createdAt: string
}

const STATUS_ORDER = ['open', 'asked', 'answered', 'closed']

const STATUS_META: Record<string, { badge: string; next?: string; nextLabel?: string }> = {
  open: { badge: 'badge-open', next: 'asked', nextLabel: 'Mark as Asked' },
  asked: { badge: 'badge-asked', next: 'answered', nextLabel: 'Mark Answered' },
  answered: { badge: 'badge-answered', next: 'closed', nextLabel: 'Close' },
  closed: { badge: 'badge-closed' },
}

export default function QuestionsTab({ projectId, onSelectClaim, onChanged }: Props) {
  const [items, setItems] = useState<OpenQuestion[]>([])
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    window.api.question.list(projectId).then(setItems).catch(err => {
      showErrorToast(err, 'Failed to load open questions')
    })
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleAdvanceStatus = async (q: OpenQuestion) => {
    const meta = STATUS_META[q.status]
    if (!meta?.next) return
    try {
      await window.api.question.updateStatus({ questionId: q.id, status: meta.next })
      showSuccessToast(`Updated ${q.key} status to ${meta.next}`)
      load()
      onChanged()
    } catch (e: any) {
      showErrorToast(e, 'Failed to update question status')
    }
  }

  const handleCopyForEmail = () => {
    const openAndAsked = items.filter(q => q.status === 'open' || q.status === 'asked')
    if (openAndAsked.length === 0) return

    const text = [
      'Open questions for client review:',
      '',
      ...openAndAsked.map((q, i) =>
        `${i + 1}. [${q.key}] ${q.text}\n   Category: ${q.category} | Status: ${q.status}`
      ),
    ].join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <HelpCircle size={40} />
        <p className="text-sm">No open questions yet.</p>
        <p className="text-xs text-slate-600 max-w-xs">
          Questions are raised when statements are ambiguous or conflicting.
        </p>
      </div>
    )
  }

  const openCount = items.filter(q => q.status === 'open' || q.status === 'asked').length

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    const group = items.filter(q => q.status === status)
    if (group.length > 0) acc[status] = group
    return acc
  }, {} as Record<string, OpenQuestion[]>)

  return (
    <div>
      {/* Export for client email */}
      {openCount > 0 && (
        <div className="flex items-center justify-between mb-5 bg-indigo-500/5 border border-indigo-500/15 rounded-lg px-4 py-3">
          <div className="text-sm text-slate-300">
            <span className="font-semibold text-indigo-300">{openCount}</span> open question{openCount > 1 ? 's' : ''} for client response
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '5px 10px' }}
            onClick={handleCopyForEmail}
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy for email'}
          </button>
        </div>
      )}

      {STATUS_ORDER.map(status => {
        const group = grouped[status]
        if (!group) return null
        const meta = STATUS_META[status]

        return (
          <div key={status} className="mb-6">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-slate-800" />
              {status} ({group.length})
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <div className="space-y-2">
              {group.map(q => (
                <div
                  key={q.id}
                  className="card animate-fade-in"
                  style={{ padding: 0 }}
                >
                  <div className="p-4 flex items-start gap-3">
                    <HelpCircle
                      size={15}
                      className={`flex-shrink-0 mt-0.5 ${
                        status === 'open' ? 'text-amber-400'
                        : status === 'asked' ? 'text-indigo-400'
                        : status === 'answered' ? 'text-emerald-400'
                        : 'text-slate-600'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 leading-relaxed">{q.text}</p>
                      {q.answerText && (
                        <div className="mt-2 text-xs text-slate-400 bg-slate-900/50 rounded p-2 border border-slate-700/30">
                          <span className="font-semibold text-emerald-400">Answer: </span>
                          {q.answerText}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-mono font-bold text-slate-500">{q.key}</span>
                        <span className={`badge ${meta.badge}`}>{status}</span>
                        <span className="text-[10px] text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">
                          {q.category}
                        </span>
                      </div>
                    </div>

                    {meta.next && (
                      <button
                        onClick={() => handleAdvanceStatus(q)}
                        className="btn btn-ghost flex-shrink-0"
                        style={{ fontSize: '11px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                      >
                        {meta.nextLabel} <ChevronRight size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
