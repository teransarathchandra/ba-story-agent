import React, { useState, useCallback } from 'react'
import Sidebar from './Sidebar'
import ReviewWorkspace from './ReviewWorkspace'
import EvidencePanel from './EvidencePanel'
import { FileText, GitBranch } from 'lucide-react'

export default function Layout() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div
      className="flex h-full w-full"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Sidebar — project & session nav */}
      <div
        className="flex-shrink-0 border-r"
        style={{
          width: 220,
          borderColor: 'var(--border-subtle)',
          background: 'rgba(10, 15, 30, 0.95)',
        }}
      >
        <Sidebar
          activeProjectId={activeProjectId}
          setActiveProjectId={id => {
            setActiveProjectId(id)
            setActiveSessionId(null)
            setSelectedClaimId(null)
          }}
          activeSessionId={activeSessionId}
          setActiveSessionId={id => {
            setActiveSessionId(id)
            setSelectedClaimId(null)
          }}
          onRefresh={handleRefresh}
        />
      </div>

      {/* Main review area */}
      <div
        className="flex-1 min-w-0 flex flex-col"
        style={{ background: 'var(--bg-surface)' }}
      >
        {activeProjectId ? (
          <ReviewWorkspace
            key={`${activeProjectId}-${refreshKey}`}
            projectId={activeProjectId}
            onSelectClaim={setSelectedClaimId}
            selectedClaimId={selectedClaimId}
          />
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Evidence panel — always visible once something is selected */}
      <div
        className="flex-shrink-0 border-l transition-smooth"
        style={{
          width: selectedClaimId ? 320 : 0,
          borderColor: selectedClaimId ? 'var(--border-accent)' : 'transparent',
          overflow: 'hidden',
          background: 'rgba(10, 15, 30, 0.97)',
        }}
      >
        {selectedClaimId && (
          <EvidencePanel
            claimId={selectedClaimId}
            onClose={() => setSelectedClaimId(null)}
          />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6">
      {/* Abstract decorative background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(99,102,241,0.05) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}
        >
          <FileText size={28} className="text-indigo-400" />
        </div>

        <div>
          <h1 className="text-xl font-semibold text-white mb-2">BA Story Agent</h1>
          <p className="text-slate-400 text-sm max-w-xs leading-relaxed">
            Select a project from the sidebar to start reviewing requirements, or create a new one.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 mt-2">
          <GitBranch size={12} />
          <span>Every requirement traces to a verbatim client quote</span>
        </div>
      </div>
    </div>
  )
}
