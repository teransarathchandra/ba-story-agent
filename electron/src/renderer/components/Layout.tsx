import React, { useState, useCallback, useEffect } from 'react'
import Sidebar from './Sidebar'
import ReviewWorkspace from './ReviewWorkspace'
import EvidencePanel from './EvidencePanel'
import ProjectCreate from './ProjectCreate'
import { ArrowRight, GitBranch } from 'lucide-react'

export type Theme = 'light' | 'dark'

export default function Layout() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('ba-story-theme')
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ba-story-theme', theme)
  }, [theme])

  const handleRefresh = useCallback(() => {
    setSelectedClaimId(null)
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div className="app-shell">
      {/* Sidebar — project & session nav */}
      <aside className="sidebar-shell">
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
          onGoHome={() => {
            setActiveProjectId(null)
            setActiveSessionId(null)
            setSelectedClaimId(null)
          }}
          onCreateProject={() => setShowCreateProject(true)}
          projectsRefreshKey={sidebarRefreshKey}
          theme={theme}
          setTheme={setTheme}
        />
      </aside>

      {/* Main review area */}
      <main className="workspace-shell">
        {activeProjectId ? (
          <ReviewWorkspace
            key={`${activeProjectId}-${refreshKey}`}
            projectId={activeProjectId}
            onSelectClaim={setSelectedClaimId}
            selectedClaimId={selectedClaimId}
          />
        ) : (
          <EmptyState onCreateProject={() => setShowCreateProject(true)} />
        )}
      </main>

      {/* Evidence panel — visible when an item is selected */}
      <aside
        className="evidence-shell"
        style={{
          width: selectedClaimId ? 360 : 0,
          borderColor: selectedClaimId ? 'var(--border)' : 'transparent',
        }}
      >
        {selectedClaimId && (
          <EvidencePanel
            claimId={selectedClaimId}
            onClose={() => setSelectedClaimId(null)}
          />
        )}
      </aside>

      {showCreateProject && (
        <ProjectCreate
          onCreated={project => {
            setShowCreateProject(false)
            setActiveProjectId(project.id)
            setActiveSessionId(null)
            setSelectedClaimId(null)
            setSidebarRefreshKey(key => key + 1)
            handleRefresh()
          }}
          onCancel={() => setShowCreateProject(false)}
        />
      )}
    </div>
  )
}

function EmptyState({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="workspace-empty">
      <div className="empty-content">
        <div className="empty-kicker">Requirements workspace</div>
        <h1 className="empty-title">Turn client meeting notes into software requirements.</h1>
        <p className="empty-copy">
          Add your meeting transcripts to extract requirements backed by exact client quotes.
        </p>
        <div className="empty-actions">
          <button className="btn btn-primary no-drag" onClick={onCreateProject}>
            Create project <ArrowRight size={15} />
          </button>
        </div>
        <div className="principle-row">
          <GitBranch size={12} />
          <span>All requirements link directly to what the client said in transcripts.</span>
        </div>
      </div>
    </div>
  )
}
