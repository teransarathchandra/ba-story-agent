import React, { useState, useRef } from 'react'
import { Upload, FileText, X, Loader, AlertCircle } from 'lucide-react'
import { showErrorToast, showSuccessToast, formatErrorMessage } from '../utils/errors'

interface Props {
  projectId: string
  onAdded: (session: any) => void
  onCancel: () => void
}

export default function SessionAdd({ projectId, onAdded, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [transcriptText, setTranscriptText] = useState('')
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MIN_WORDS = 200

  const countWords = (text: string) =>
    text.trim() ? text.trim().split(/\s+/).length : 0

  const handleTextChange = (text: string) => {
    setTranscriptText(text)
    setWordCount(countWords(text))
    setFieldError(null)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      handleTextChange(text)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !transcriptText.trim()) return

    if (wordCount < MIN_WORDS) {
      const msg = `Transcript must be at least ${MIN_WORDS} words (currently ${wordCount} words)`
      setFieldError(msg)
      showErrorToast(msg)
      return
    }

    setLoading(true)
    setFieldError(null)
    try {
      const session = await window.api.session.add({
        projectId,
        title: title.trim(),
        transcriptText,
        occurredAt: new Date(occurredAt).toISOString(),
      })
      showSuccessToast(`Session "${session.title}" added`)
      onAdded(session)
    } catch (err: any) {
      const cleanMsg = formatErrorMessage(err) || 'Failed to add session'
      setFieldError(cleanMsg)
      showErrorToast(err, 'Failed to add session')
    } finally {
      setLoading(false)
    }
  }

  const wordCountColor = wordCount === 0
    ? 'text-slate-500'
    : wordCount < MIN_WORDS
      ? 'text-red-500 font-semibold'
      : 'text-emerald-400 font-medium'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="modal-title">Add session</h2>
            <p className="modal-description">Upload or paste a meeting transcript.</p>
          </div>
          <button onClick={onCancel} className="icon-button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Session Title *</label>
              <input
                className="input"
                value={title}
                onChange={e => { setTitle(e.target.value); setFieldError(null); }}
                placeholder="e.g. Kick-off Meeting"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="label">Meeting Date</label>
              <input
                className="input"
                type="date"
                value={occurredAt}
                onChange={e => setOccurredAt(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label" style={{ margin: 0 }}>Transcript *</label>
              <div className="flex items-center gap-3">
                <span className={`text-xs ${wordCountColor}`}>
                  {wordCount} words {wordCount > 0 && wordCount < MIN_WORDS && `(min ${MIN_WORDS})`}
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: '12px', height: 'auto' }}
                >
                  <Upload size={12} /> Load file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.vtt,.srt"
                  className="hidden"
                  onChange={handleFileLoad}
                />
              </div>
            </div>
            <textarea
              className={`input ${fieldError ? 'border-red-500 focus:border-red-500' : ''}`}
              value={transcriptText}
              onChange={e => handleTextChange(e.target.value)}
              placeholder="Paste the meeting transcript here, or load from a .txt file..."
              style={{ minHeight: 180, fontFamily: 'inherit', fontSize: 13 }}
              required
            />
            {fieldError && (
              <div className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5">
                <AlertCircle size={13} className="flex-shrink-0 text-red-500" />
                <span>{fieldError}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !title.trim() || wordCount < MIN_WORDS}
            >
              {loading ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
              {loading ? 'Adding...' : 'Add session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
