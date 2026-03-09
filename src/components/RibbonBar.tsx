/**
 * src/components/RibbonBar.tsx
 * Top-of-screen navigation ribbon spanning the full application width.
 * Houses primary nav controls: application branding and top-level page tabs.
 */

import { BookOpenTextIcon, BugIcon, MountainSnowIcon, SettingsIcon, SparklesIcon, SwordsIcon, UsersRoundIcon } from './icons'
import '../styles/ribbon.css'

/** A single navigation tab entry. */
interface NavTab {
  /** Unique key used as React list key and active comparator. */
  id: string
  /** Label shown in the ribbon. */
  label: string
  /** Optional icon shown before the label. */
  icon?: React.ReactNode
}

const NAV_TABS: NavTab[] = [
  { id: 'campaign',  label: 'Campaign', icon: <SwordsIcon /> },
  { id: 'characters', label: 'Characters', icon: <UsersRoundIcon /> },
  { id: 'lore-book', label: 'Lore Book', icon: <BookOpenTextIcon /> },
  { id: 'scenes', label: 'Scenes', icon: <MountainSnowIcon /> },
  { id: 'settings',  label: 'Settings', icon: <SettingsIcon /> },
]

interface RibbonBarProps {
  /** Currently active tab id. */
  activeTab: string
  /** Called when the user clicks a nav tab. */
  onTabChange: (id: string) => void
  /** Called when the user opens the model loader modal. */
  onOpenModelLoader: () => void
  /** Whether the model loader action is currently available. */
  canLoadModel: boolean
  /** Called when the user opens the AI debug log. */
  onOpenAiDebug: () => void
}

/**
 * RibbonBar
 * Full-width top navigation bar containing the app logo and primary nav tabs.
 */
export function RibbonBar({
  activeTab,
  onTabChange,
  onOpenModelLoader,
  canLoadModel,
  onOpenAiDebug,
}: RibbonBarProps) {
  return (
    <header className="ribbon-bar">
      {/* Branding */}
      <div className="ribbon-brand">
        <span className="ribbon-brand__name">Aethra</span>
        <span className="ribbon-brand__tagline">AI Roleplay</span>
      </div>

      {/* Primary navigation tabs */}
      <nav className="ribbon-nav" aria-label="Primary navigation">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`ribbon-nav__tab${activeTab === tab.id ? ' ribbon-nav__tab--active' : ''}`}
            onClick={() => onTabChange(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.icon ? <span className="ribbon-nav__tab-icon" aria-hidden="true">{tab.icon}</span> : null}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Right-side slot (reserved for future actions) */}
      <div className="ribbon-actions">
        <button
          type="button"
          className="ribbon-nav__tab"
          onClick={onOpenModelLoader}
          disabled={!canLoadModel}
          title={canLoadModel ? 'Load a model into text-generation-webui' : 'Model loading is available for text-generation-webui only'}
        >
          <span className="ribbon-nav__tab-icon" aria-hidden="true"><SparklesIcon /></span>
          <span>Load Model</span>
        </button>
        <button type="button" className="ribbon-nav__tab" onClick={onOpenAiDebug}>
          <span className="ribbon-nav__tab-icon" aria-hidden="true"><BugIcon /></span>
          <span>AI Debug</span>
        </button>
      </div>
    </header>
  )
}
