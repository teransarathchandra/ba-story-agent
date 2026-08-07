import React, { useState, useEffect } from 'react'
import { Play, Loader, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'

interface Props {
  sessionId: string
  sessionTitle: string
  onComplete: () => void
}

interface ProgressEvent {
  stage: string
  status: string
}

const STAGE_LABELS: Record<string, string> = {
  'stage0': 'Chunking transcript',
  'stage1': 'Extracting claims',
  'stage2': 'Grounding validation',
  'stage3': 'Classifying claims',
  'stage4': 'Reconciling cross-session',
  'stage5': 'Synthesizing requirements',
  'stage6': 'Writing user stories',
  'stage7': 'Running AI reviewers',
  'stage8': 'Assembling results',
}

type AnalyzeState = 'idle' | 'running' | 'done' | 'error'

export default function AnalyzeButton({ sessionId, sessionTitle, onComplete }: Props) {
  const [state, setState] = useState<AnalyzeState>('idle')
  const [stages, setStages] = useState<ProgressEvent[]>([])
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  // Track progress events
  useEffect(() => {
    const cleanup = window.api.onProgress((progress: ProgressEvent) => {
      setCurrentStage(progress.stage)
      setStages(prev => {
        const existing = prev.findIndex(p => p.stage === progress.stage)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = progress
          return updated
        }
        return [...prev, progress]
      })
    })
    return cleanup
  }, [])

  const handleAnalyze = async () => {
    setState('running')
    setStages([])
    setCurrentStage(null)
    setError(null)
    try {
      const res = await window.api.session.analyze({ sessionId, resume: false })
      setResult(res)
      setState('done')
      onComplete()
    } catch (err: any) {
      setError(err.message ?? 'Analysis failed')
      setState('error')
    }
  }

  const doneCount = stages.filter(s => s.status === 'done' || s.status === 'complete').length
  const totalStages = 9
  const progress = state === 'done' ? 100 : Math.round((doneCount / totalStages) * 100)

  if (state === 'idle') {
    return (
      <button
        onClick={handleAnalyze}
        className="btn btn-primary glow-pulse"
        style={{ width: '100%' }}
      >
        <Play size={14} />
        Analyze transcript
      </button>
    )
  }

  if (state === 'running') {
    return (
      <div className="space-y-3 p-1">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Loader size={12} className="animate-spin text-indigo-400" />
            <span className="font-medium text-indigo-300">
              {currentStage ? (STAGE_LABELS[currentStage] ?? currentStage) : 'Starting...'}
            </span>
          </div>
          <span className="text-slate-500">{progress}%</span>
        </div>

        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {stages.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {s.status === 'done' || s.status === 'complete' ? (
                <CheckCircle size={11} className="text-emerald-400 flex-shrink-0" />
              ) : (
                <Loader size={11} className="animate-spin text-indigo-400 flex-shrink-0" />
              )}
              <span className={s.status === 'done' || s.status === 'complete' ? 'text-slate-400' : 'text-slate-200'}>
                {STAGE_LABELS[s.stage] ?? s.stage}
              </span>
              <span className={`ml-auto badge ${
                s.status === 'done' || s.status === 'complete' ? 'badge-finalized' : 'badge-asked'
              }`}>
                {s.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (state === 'done' && result) {
    return (
      <div className="space-y-2 p-1">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
          <CheckCircle size={14} />
          Analysis complete
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { label: 'Extracted', value: result.extracted },
            { label: 'Validated', value: result.validated },
            { label: 'Requirements', value: result.requirements },
            { label: 'Stories', value: result.stories },
            { label: 'Questions', value: result.questions },
            { label: 'Quarantined', value: result.quarantined },
          ].map(stat => (
            <div key={stat.label} className="bg-slate-900/50 rounded p-2 text-center">
              <div className="text-lg font-bold text-white">{stat.value ?? 0}</div>
              <div className="text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>
        {(result.quarantineRate ?? 0) > 0 && (
          <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
            Quarantine rate: {((result.quarantineRate ?? 0) * 100).toFixed(1)}%: check quarantine list.
          </div>
        )}
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-md px-3 py-2">
          <AlertCircle size={14} />
          <span className="flex-1 text-xs">{error}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            className="btn btn-primary flex-1"
          >
            <Play size={14} /> Retry
          </button>
          <button
            onClick={() => setState('idle')}
            className="btn btn-ghost"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return null
}
