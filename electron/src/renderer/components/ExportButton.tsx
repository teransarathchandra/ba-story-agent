import React, { useState } from 'react'
import { Download, Loader, Check } from 'lucide-react'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  projectId: string
}

type ExportState = 'idle' | 'running' | 'done' | 'error'

export default function ExportButton({ projectId }: Props) {
  const [state, setState] = useState<ExportState>('idle')

  const handleExport = async () => {
    setState('running')
    try {
      const result = await window.api.export.project({
        projectId,
        outDir: `${process.env.HOME ?? '~'}/Desktop/BA-Export-${Date.now()}`,
        includeProposed: false,
      })
      showSuccessToast('Exported requirements to Markdown and JSON on Desktop')
      setState('done')
    } catch (e: any) {
      showErrorToast(e, 'Export failed')
      setState('error')
    }
  }

  if (state === 'running') {
    return (
      <button className="btn btn-ghost" disabled>
        <Loader size={13} className="animate-spin" /> Exporting...
      </button>
    )
  }

  if (state === 'done') {
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
        <button className="btn btn-ghost" style={{ fontSize: '11px' }} onClick={handleExport}>
          Retry Export
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleExport}
      className="btn btn-ghost"
      style={{ fontSize: '12px', padding: '5px 10px' }}
      title="Export finalized requirements to Markdown and JSON"
    >
      <Download size={13} /> Export
    </button>
  )
}
