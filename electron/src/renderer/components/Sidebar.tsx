import React, { useEffect, useState, useCallback } from 'react'
import { Folder, Plus, FileText, ChevronRight, Activity, RefreshCw, Sun, Moon } from 'lucide-react'
import SessionAdd from './SessionAdd'
import AnalyzeButton from './AnalyzeButton'
import type { Theme } from './Layout'

interface Props {
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  onRefresh: () => void
  onCreateProject: () => void
  projectsRefreshKey: number
  theme: Theme
  setTheme: (theme: Theme) => void
}

export default function Sidebar({
  activeProjectId,
  setActiveProjectId,
  activeSessionId,
  setActiveSessionId,
  onRefresh,
  onCreateProject,
  projectsRefreshKey,
  theme,
  setTheme,
}: Props) {
  const [projects, setProjects] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [showAddSession, setShowAddSession] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  const loadProjects = useCallback(async () => {
    try {
      const ps = await window.api.project.list()
      setProjects(ps)
    } catch (e) {
      console.error('Failed to load projects', e)
    }
  }, [])

  const loadSessions = useCallback(async (projectId: string) => {
    try {
      const ss = await window.api.session.list(projectId)
      setSessions(ss)
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects, projectsRefreshKey])

  useEffect(() => {
    if (activeProjectId) loadSessions(activeProjectId)
  }, [activeProjectId, loadSessions])

  const handleProjectClick = (projectId: string) => {
    setActiveProjectId(projectId)
    setExpandedProjects(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const statusColor: Record<string, string> = {
    draft: 'text-slate-500',
    'awaiting-review': 'text-amber-400',
    finalized: 'text-emerald-400',
    failed: 'text-rose-400',
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header / Logo */}
        <div className="sidebar-header">
          <div className="brand-row">
            <div className="brand-mark">BA</div>
            <div className="sidebar-copy">
              <div className="brand-title">Story Agent</div>
              <div className="brand-subtitle">Workspace</div>
            </div>
          </div>
        </div>

        {/* Projects section */}
        <div className="flex-1 overflow-y-auto py-4 px-3">
          <div className="sidebar-section-header">
            <span className="sidebar-section-label">Projects</span>
            <button
              onClick={onCreateProject}
              className="icon-button no-drag"
              title="New project"
              aria-label="New project"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="space-y-0.5">
            {projects.length === 0 && (
              <div className="sidebar-empty">
                <p className="sidebar-empty-copy">No projects yet</p>
              </div>
            )}

            {projects.map(p => {
              const isActive = p.id === activeProjectId
              const isExpanded = expandedProjects.has(p.id)
              const projectSessions = isExpanded && isActive ? sessions : []

              return (
                <div key={p.id}>
                  <button
                    onClick={() => handleProjectClick(p.id)}
                    className={`sidebar-item no-drag ${isActive ? 'active' : ''}`}
                  >
                    <Folder size={14} className="flex-shrink-0" />
                    <span className="sidebar-project-copy flex-1 truncate text-xs">{p.name}</span>
                    <ChevronRight
                      size={12}
                      className={`sidebar-project-copy opacity-40 transition-transform duration-200 ${isExpanded && isActive ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {isActive && isExpanded && (
                    <div className="sidebar-copy ml-3 pl-3 border-l border-slate-700/60 mt-1 mb-1 space-y-0.5">
                      <div className="text-[10px] text-slate-500 px-2 py-1">
                        {p.domain}
                      </div>

                      {projectSessions.map((s: any) => (
                        <button
                          key={s.id}
                          onClick={() => setActiveSessionId(s.id === activeSessionId ? null : s.id)}
                          className={`sidebar-item no-drag ${activeSessionId === s.id ? 'active' : ''}`}
                          style={{ paddingLeft: 8 }}
                        >
                          <FileText size={12} className="flex-shrink-0" />
                          <div className="flex-1 text-left min-w-0">
                            <div className="truncate text-xs">{s.title}</div>
                            <div className={`text-[10px] ${statusColor[s.status] ?? 'text-slate-500'}`}>
                              {s.status}
                            </div>
                          </div>
                          {s.status === 'draft' && (
                            <Activity size={11} className="text-amber-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}

                      {/* Actions */}
                      <div className="pt-2 space-y-2 pb-1">
                        <button
                          onClick={() => setShowAddSession(true)}
                          className="btn btn-ghost no-drag"
                          style={{ width: '100%', fontSize: '12px', padding: '5px 10px' }}
                        >
                          <Plus size={12} /> Add session
                        </button>

                        {activeSessionId && sessions.find(s => s.id === activeSessionId && s.status === 'draft') && (
                          <AnalyzeButton
                            sessionId={activeSessionId}
                            sessionTitle={sessions.find(s => s.id === activeSessionId)?.title ?? ''}
                            onComplete={() => {
                              loadSessions(activeProjectId!)
                              onRefresh()
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <div className="theme-switch" role="group" aria-label="Appearance">
              <button
                className={`theme-option no-drag ${theme === 'light' ? 'active' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                <Sun size={13} /> <span>Light</span>
              </button>
              <button
                className={`theme-option no-drag ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <Moon size={13} /> <span>Dark</span>
              </button>
            </div>
            <button
              onClick={() => { loadProjects(); if (activeProjectId) loadSessions(activeProjectId); onRefresh() }}
              className="icon-button no-drag"
              title="Refresh workspace"
              aria-label="Refresh workspace"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddSession && activeProjectId && (
        <SessionAdd
          projectId={activeProjectId}
          onAdded={s => {
            setShowAddSession(false)
            loadSessions(activeProjectId)
            setActiveSessionId(s.id)
          }}
          onCancel={() => setShowAddSession(false)}
        />
      )}
    </>
  )
}
