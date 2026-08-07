import React, { useEffect, useState, useCallback } from 'react'
import { Folder, Plus, FileText, ChevronRight, Activity, RefreshCw, Sun, Moon, BookOpen, Trash2 } from 'lucide-react'
import SessionAdd from './SessionAdd'
import AnalyzeButton from './AnalyzeButton'
import type { Theme } from './Layout'
import type { Project, Session } from '../types/api'
import ConfirmDialog from './ConfirmDialog'
import TranscriptDialog from './TranscriptDialog'
import { showErrorToast, showSuccessToast } from '../utils/errors'

interface Props {
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  onRefresh: () => void
  onGoHome: () => void
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
  onGoHome,
  onCreateProject,
  projectsRefreshKey,
  theme,
  setTheme,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [showAddSession, setShowAddSession] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [transcriptSession, setTranscriptSession] = useState<Session | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'project'; id: string; name: string }
    | { kind: 'session'; id: string; name: string; projectId: string }
    | null
  >(null)
  const [deleting, setDeleting] = useState(false)

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

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.kind === 'project') {
        const result = await window.api.project.delete(deleteTarget.id)
        if (!result.deleted) throw new Error('Project no longer exists')
        if (activeProjectId === deleteTarget.id) {
          setActiveProjectId(null)
          setActiveSessionId(null)
          setSessions([])
        }
        setExpandedProjects(previous => {
          const next = new Set(previous)
          next.delete(deleteTarget.id)
          return next
        })
        await loadProjects()
        showSuccessToast(`Deleted project "${deleteTarget.name}"`)
      } else {
        const result = await window.api.session.delete(deleteTarget.id)
        if (!result.deleted) throw new Error('Session no longer exists')
        if (activeSessionId === deleteTarget.id) setActiveSessionId(null)
        await loadSessions(deleteTarget.projectId)
        showSuccessToast(`Deleted session "${deleteTarget.name}"`)
      }
      setDeleteTarget(null)
      onRefresh()
    } catch (error) {
      showErrorToast(error, `Failed to delete ${deleteTarget.kind}`)
    } finally {
      setDeleting(false)
    }
  }

  const statusColor: Record<string, string> = {
    draft: 'text-slate-500',
    'awaiting-review': 'text-amber-400',
    finalized: 'text-emerald-400',
    failed: 'text-rose-400',
  }

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header / Logo */}
        <div className="sidebar-header">
          <button
            type="button"
            className="brand-row brand-home no-drag"
            onClick={onGoHome}
            aria-label="Go to home"
            title="Go to home"
          >
            <div className="brand-mark">BA</div>
            <div className="sidebar-copy">
              <div className="brand-title">Story Agent</div>
              <div className="brand-subtitle">Workspace</div>
            </div>
          </button>
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
                  <div className={`sidebar-entry ${isActive ? 'active' : ''}`}>
                    <button
                      onClick={() => handleProjectClick(p.id)}
                      className="sidebar-item sidebar-entry-main no-drag"
                      title={p.name}
                    >
                      <Folder size={14} className="flex-shrink-0" />
                      <span className="sidebar-project-copy flex-1 truncate text-xs">{p.name}</span>
                      <ChevronRight
                        size={12}
                        className={`sidebar-project-copy opacity-40 transition-transform duration-200 ${isExpanded && isActive ? 'rotate-90' : ''}`}
                      />
                    </button>
                    <button
                      type="button"
                      className="sidebar-entry-action no-drag"
                      onClick={() => setDeleteTarget({ kind: 'project', id: p.id, name: p.name })}
                      aria-label={`Delete project ${p.name}`}
                      title={`Delete ${p.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {isActive && isExpanded && (
                    <div className="sidebar-copy ml-3 pl-3 border-l border-slate-700/60 mt-1 mb-1 space-y-0.5">
                      <div className="text-[10px] text-slate-500 px-2 py-1">
                        {p.domain}
                      </div>

                      {projectSessions.map(s => (
                        <div
                          key={s.id}
                          className={`sidebar-entry session-entry ${activeSessionId === s.id ? 'active' : ''}`}
                        >
                          <button
                            onClick={() => setActiveSessionId(s.id === activeSessionId ? null : s.id)}
                            className="sidebar-item sidebar-entry-main no-drag"
                            style={{ paddingLeft: 8 }}
                            title={s.title}
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
                          <button
                            type="button"
                            className="sidebar-entry-action no-drag"
                            onClick={() => setDeleteTarget({
                              kind: 'session',
                              id: s.id,
                              name: s.title,
                              projectId: s.projectId,
                            })}
                            aria-label={`Delete session ${s.title}`}
                            title={`Delete ${s.title}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
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

                        {activeSession && (
                          <button
                            type="button"
                            onClick={() => setTranscriptSession(activeSession)}
                            className="btn btn-ghost no-drag"
                            style={{ width: '100%', fontSize: '12px', padding: '5px 10px' }}
                          >
                            <BookOpen size={12} /> View transcript
                          </button>
                        )}

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

      {transcriptSession && (
        <TranscriptDialog
          session={transcriptSession}
          onAmended={async () => {
            if (activeProjectId) await loadSessions(activeProjectId)
            onRefresh()
          }}
          onClose={() => setTranscriptSession(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.kind}?`}
          description={deleteTarget.kind === 'project'
            ? `“${deleteTarget.name}” and all of its sessions, transcripts, and review output will be permanently deleted.`
            : `“${deleteTarget.name}” and its transcript will be permanently deleted. The rest of the project will remain.`}
          confirmLabel={`Delete ${deleteTarget.kind}`}
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
