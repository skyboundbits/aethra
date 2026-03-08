/**
 * src/components/RibbonBar.tsx
 * Top-of-screen navigation ribbon spanning the full application width.
 * Houses primary nav controls: application branding and top-level page tabs.
 */

import '../styles/ribbon.css'

/** A single navigation tab entry. */
interface NavTab {
  /** Unique key used as React list key and active comparator. */
  id: string
  /** Label shown in the ribbon. */
  label: string
}

const NAV_TABS: NavTab[] = [
  { id: 'chat',      label: 'Chat'      },
  { id: 'personas',  label: 'Personas'  },
  { id: 'world',     label: 'World'     },
  { id: 'settings',  label: 'Settings'  },
]

interface RibbonBarProps {
  /** Currently active tab id. */
  activeTab: string
  /** Called when the user clicks a nav tab. */
  onTabChange: (id: string) => void
}

/**
 * RibbonBar
 * Full-width top navigation bar containing the app logo and primary nav tabs.
 */
export function RibbonBar({ activeTab, onTabChange }: RibbonBarProps) {
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
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Right-side slot (reserved for future actions) */}
      <div className="ribbon-actions" />
    </header>
  )
}
