import React, { useState, useRef } from 'react'
import { Upload, FileText, X, Loader, AlertCircle } from 'lucide-react'

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
  const [error, setError] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const MIN_WORDS = 200

  const countWords = (text: string) =>
    text.trim() ? text.trim().split(/\s+/).length : 0

  const handleTextChange = (text: string) => {
    setTranscriptText(text)
    setWordCount(countWords(text))
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
    setLoading(true)
    setError(null)
    try {
      const session = await window.api.session.add({
        projectId,
        title: title.trim(),
        transcriptText,
        occurredAt: new Date(occurredAt).toISOString(),
      })
      onAdded(session)
    } catch (err: any) {
      setError(err.message ?? 'Failed to add session')
    } finally {
      setLoading(false)
    }
  }

  const wordCountColor = wordCount === 0
    ? 'text-slate-500'
    : wordCount < MIN_WORDS
      ? 'text-amber-400'
      : 'text-emerald-400'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="modal-title">Add session</h2>
            <p className="modal-description">Upload or paste a meeting transcript.</p>
          </div>
          <button onClick={onCancel} className="icon-button" aria-label="Close add session dialog">
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
                onChange={e => setTitle(e.target.value)}
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
                <span className={`text-xs font-medium ${wordCountColor}`}>
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
              className="input"
              value={transcriptText}
              onChange={e => handleTextChange(e.target.value)}
              placeholder="Paste the meeting transcript here, or load from a .txt file…"
              style={{ minHeight: 180, fontFamily: 'inherit', fontSize: 13 }}
              required
            />
            {wordCount > 0 && wordCount < MIN_WORDS && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-400">
                <AlertCircle size={12} />
                Transcripts under {MIN_WORDS} words produce noise rather than requirements.
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

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
              {loading ? 'Adding…' : 'Add session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
