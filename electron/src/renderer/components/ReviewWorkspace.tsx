import React, { useState, useEffect } from 'react'
import RequirementsTab from './RequirementsTab'
import AssumptionsTab from './AssumptionsTab'
import QuestionsTab from './QuestionsTab'
import RecommendationsTab from './RecommendationsTab'
import ExportButton from './ExportButton'
import { CheckSquare, Lightbulb, HelpCircle, Sparkles } from 'lucide-react'

interface Props {
  projectId: string
  onSelectClaim: (claimId: string | null) => void
  selectedClaimId: string | null
}

interface Counts {
  requirements: number
  assumptions: number
  questions: number
  recommendations: number
}

export default function ReviewWorkspace({ projectId, onSelectClaim, selectedClaimId }: Props) {
  const [activeTab, setActiveTab] = useState('requirements')
  const [counts, setCounts] = useState<Counts>({ requirements: 0, assumptions: 0, questions: 0, recommendations: 0 })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const load = async () => {
      try {
        const [reqs, assumptions, questions, recs] = await Promise.all([
          window.api.requirement.list(projectId),
          window.api.assumption.list(projectId),
          window.api.question.list(projectId),
          window.api.recommendation.list(projectId),
        ])
        setCounts({
          requirements: reqs.length,
          assumptions: assumptions.length,
          questions: questions.length,
          recommendations: recs.length,
        })
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [projectId, refreshKey])

  const onItemChanged = () => setRefreshKey(k => k + 1)

  const tabs = [
    { id: 'requirements', label: 'Requirements', icon: CheckSquare, count: counts.requirements },
    { id: 'assumptions', label: 'Assumptions', icon: Lightbulb, count: counts.assumptions },
    { id: 'questions', label: 'Open Questions', icon: HelpCircle, count: counts.questions },
    { id: 'recommendations', label: 'Recommendations', icon: Sparkles, count: counts.recommendations },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="tab-bar" style={{ justifyContent: 'space-between' }}>
        <div className="flex">
          {tabs.map(t => {
            const Icon = t.icon
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`tab-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={14} />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className="tab-count">{t.count}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex items-center pb-1">
          <ExportButton projectId={projectId} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl mx-auto">
          {activeTab === 'requirements' && (
            <RequirementsTab
              projectId={projectId}
              onSelectClaim={onSelectClaim}
              selectedClaimId={selectedClaimId}
              onChanged={onItemChanged}
            />
          )}
          {activeTab === 'assumptions' && (
            <AssumptionsTab
              projectId={projectId}
              onSelectClaim={onSelectClaim}
              selectedClaimId={selectedClaimId}
              onChanged={onItemChanged}
            />
          )}
          {activeTab === 'questions' && (
            <QuestionsTab
              projectId={projectId}
              onSelectClaim={onSelectClaim}
              onChanged={onItemChanged}
            />
          )}
          {activeTab === 'recommendations' && (
            <RecommendationsTab
              projectId={projectId}
              onSelectClaim={onSelectClaim}
              onChanged={onItemChanged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
