import React, { useEffect, useState, useCallback } from 'react'
import { Folder, Plus, FileText, ChevronRight, Activity, RefreshCw } from 'lucide-react'
import ProjectCreate from './ProjectCreate'
import SessionAdd from './SessionAdd'
import AnalyzeButton from './AnalyzeButton'

interface Props {
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  onRefresh: () => void
}

export default function Sidebar({
  activeProjectId,
  setActiveProjectId,
  activeSessionId,
  setActiveSessionId,
  onRefresh,
}: Props) {
  const [projects, setProjects] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [showCreateProject, setShowCreateProject] = useState(false)
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

  useEffect(() => { loadProjects() }, [loadProjects])

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
        <div className="px-4 py-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              BA
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Story Agent</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Review Workspace</div>
            </div>
          </div>
        </div>

        {/* Projects section */}
        <div className="flex-1 overflow-y-auto py-3 px-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Projects
            </span>
            <button
              onClick={() => setShowCreateProject(true)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-smooth no-drag"
              title="New project"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="space-y-0.5">
            {projects.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-slate-600">
                No projects yet.
                <br />
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="text-indigo-400 hover:underline mt-1 block mx-auto no-drag"
                >
                  Create one
                </button>
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
                    <span className="flex-1 truncate text-xs">{p.name}</span>
                    <ChevronRight
                      size={12}
                      className={`opacity-40 transition-transform duration-200 ${isExpanded && isActive ? 'rotate-90' : ''}`}
                    />
                  </button>

                  {isActive && isExpanded && (
                    <div className="ml-3 pl-3 border-l border-slate-700/60 mt-1 mb-1 space-y-0.5">
                      <div className="text-[10px] text-slate-500 px-2 py-1 uppercase tracking-wider">
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
        <div className="px-3 py-3 border-t border-white/5">
          <button
            onClick={() => { loadProjects(); if (activeProjectId) loadSessions(activeProjectId); onRefresh() }}
            className="btn btn-ghost no-drag"
            style={{ width: '100%', fontSize: '12px', padding: '5px 10px' }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {/* Modals */}
      {showCreateProject && (
        <ProjectCreate
          onCreated={p => {
            setShowCreateProject(false)
            loadProjects()
            setActiveProjectId(p.id)
            setExpandedProjects(prev => new Set(prev).add(p.id))
          }}
          onCancel={() => setShowCreateProject(false)}
        />
      )}

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
