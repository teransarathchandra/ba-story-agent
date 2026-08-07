import React, { useState } from 'react'
import { Download, Loader, Check, FolderOpen } from 'lucide-react'

interface Props {
  projectId: string
}

type ExportState = 'idle' | 'running' | 'done' | 'error'

export default function ExportButton({ projectId }: Props) {
  const [state, setState] = useState<ExportState>('idle')
  const [paths, setPaths] = useState<{ mdPath?: string; jsonPath?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setState('running')
    setError(null)
    try {
      // Use a sensible default output location: Desktop/BA-Export
      const result = await window.api.export.project({
        projectId,
        outDir: `${process.env.HOME ?? '~'}/Desktop/BA-Export-${Date.now()}`,
        includeProposed: false,
      })
      setPaths(result)
      setState('done')
    } catch (e: any) {
      setError(e.message ?? 'Export failed')
      setState('error')
    }
  }

  if (state === 'running') {
    return (
      <button className="btn btn-ghost" disabled>
        <Loader size={13} className="animate-spin" /> Exporting…
      </button>
    )
  }

  if (state === 'done' && paths) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
          <Check size={13} />
          Exported!
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', padding: '4px 8px' }}
          onClick={() => setState('idle')}
        >
          Export again
        </button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-rose-400">{error}</span>
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={() => setState('idle')}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleExport}
      className="btn btn-ghost"
      style={{ fontSize: '12px', padding: '5px 10px' }}
      title="Export finalized requirements to Markdown + JSON"
    >
      <Download size={13} /> Export
    </button>
  )
}
