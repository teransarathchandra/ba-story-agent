import React, { useEffect, useState, useCallback } from 'react'
import { HelpCircle, ArrowRight, Copy, Check } from 'lucide-react'
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
  open: { badge: 'badge-open', next: 'asked', nextLabel: 'Mark as asked' },
  asked: { badge: 'badge-asked', next: 'answered', nextLabel: 'Mark as answered' },
  answered: { badge: 'badge-answered', next: 'closed', nextLabel: 'Close question' },
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
        <div className="review-callout review-callout-info review-callout-with-action">
          <div>
            <strong>{openCount}</strong> open question{openCount > 1 ? 's' : ''} for client response
          </div>
          <button
            className="btn btn-ghost"
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
          <section key={status} className="review-group">
            <div className="review-group-heading">
              <span>{status}</span>
              <span className="review-group-count">{group.length}</span>
            </div>

            <div className="review-list">
              {group.map(q => (
                <div key={q.id} className="review-item animate-fade-in">
                  <div className="review-item-main">
                    <HelpCircle
                      size={16}
                      className={`review-item-leading ${
                        status === 'open' ? 'text-amber-400'
                        : status === 'asked' ? 'text-indigo-400'
                        : status === 'answered' ? 'text-emerald-400'
                        : 'text-slate-600'
                      }`}
                    />
                    <div className="review-item-copy">
                      <p className="review-item-title">{q.text}</p>
                      {q.answerText && (
                        <div className="review-answer">
                          <strong>Answer:</strong>{' '}
                          {q.answerText}
                        </div>
                      )}
                      <div className="review-meta">
                        <span className="review-key">{q.key}</span>
                        <span className={`badge ${meta.badge}`}>{status}</span>
                        <span className="review-category">
                          {q.category}
                        </span>
                      </div>
                    </div>

                    {meta.next && (
                      <button
                        onClick={() => handleAdvanceStatus(q)}
                        className="btn btn-ghost"
                      >
                        {meta.nextLabel} <ArrowRight size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
