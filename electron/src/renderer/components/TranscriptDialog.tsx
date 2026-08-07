import React, { useEffect, useId, useState } from 'react'
import { AlertCircle, Check, Copy, FileText, Loader, Pencil, Save, X } from 'lucide-react'
import type { Session, Transcript } from '../types/api'
import { showErrorToast, showSuccessToast } from '../utils/errors'

const MIN_TRANSCRIPT_WORDS = 200

interface Props {
  session: Session
  onAmended: () => void | Promise<void>
  onClose: () => void
}

export default function TranscriptDialog({ session, onAmended, onClose }: Props) {
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const titleId = useId()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    window.api.session.transcript(session.id)
      .then(result => {
        if (!active) return
        if (!result) setError('No transcript is available for this session.')
        else setTranscript(result)
      })
      .catch(() => active && setError('The transcript could not be loaded.'))
      .finally(() => active && setLoading(false))

    return () => { active = false }
  }, [session.id])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editing) {
          setEditing(false)
          setDraft(transcript?.text ?? '')
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [editing, onClose, session.id, transcript?.text])

  const copyTranscript = async () => {
    if (!transcript) return
    await navigator.clipboard.writeText(transcript.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const wordCount = transcript?.text.trim().split(/\s+/).filter(Boolean).length ?? 0
  const draftWordCount = draft.trim().split(/\s+/).filter(Boolean).length
  const isChanged = Boolean(transcript && draft !== transcript.text)

  const beginEditing = () => {
    if (!transcript) return
    setDraft(transcript.text)
    setEditing(true)
  }

  const cancelEditing = () => {
    setDraft(transcript?.text ?? '')
    setEditing(false)
  }

  const saveAmendment = async () => {
    if (!transcript || draftWordCount < MIN_TRANSCRIPT_WORDS || !isChanged) return
    setSaving(true)
    try {
      const result = await window.api.session.amendTranscript({
        sessionId: session.id,
        transcriptText: draft,
      })
      setTranscript(result.transcript)
      setEditing(false)
      await onAmended()
      showSuccessToast(`Saved transcript version ${result.transcript.version}. Analysis was reset to Draft.`)
    } catch (cause) {
      showErrorToast(cause, 'Failed to amend transcript')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={event => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-box transcript-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="transcript-header">
          <div>
            <div className="transcript-kicker"><FileText size={13} /> Session transcript</div>
            <h2 className="modal-title" id={titleId}>{session.title}</h2>
            <p className="modal-description">
              {new Date(session.occurredAt).toLocaleDateString()}
              {transcript ? ` · ${wordCount.toLocaleString()} words` : ''}
              {transcript ? ` · Version ${transcript.version}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close transcript">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="transcript-status" role="status">
            <Loader size={18} className="animate-spin" /> Loading transcript…
          </div>
        )}

        {error && (
          <div className="transcript-status transcript-error" role="alert">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {transcript && !loading && !editing && (
          <pre className="transcript-content">{transcript.text}</pre>
        )}

        {transcript && !loading && editing && (
          <div className="transcript-editor">
            <div className="transcript-amendment-note" role="note">
              <AlertCircle size={16} />
              <span>
                Saving creates a new transcript version and resets this session to Draft.
                Existing analysis from this session will be cleared so it can be run again against the amended text.
              </span>
            </div>
            <label className="label" htmlFor="transcript-amendment">Transcript text</label>
            <textarea
              id="transcript-amendment"
              className="input transcript-editor-field"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              autoFocus
            />
            <div className={`transcript-word-count ${draftWordCount < MIN_TRANSCRIPT_WORDS ? 'invalid' : ''}`}>
              {draftWordCount.toLocaleString()} words · minimum {MIN_TRANSCRIPT_WORDS}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <div className="transcript-actions-secondary">
            {transcript && !editing && (
              <>
                <button type="button" className="btn btn-ghost" onClick={copyTranscript}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy transcript'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={beginEditing}>
                  <Pencil size={14} /> Edit transcript
                </button>
              </>
            )}
          </div>
          {editing ? (
            <div className="transcript-actions-primary">
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={saving}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveAmendment}
                disabled={saving || draftWordCount < MIN_TRANSCRIPT_WORDS || !isChanged}
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save amendment'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
