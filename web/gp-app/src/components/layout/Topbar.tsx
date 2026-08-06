import { NavLink } from 'react-router-dom'
import type { GpUser } from '@/lib/auth'
import { logout } from '@/lib/auth'
import { useTheme } from '@/hooks/useTheme'
import styles from './Topbar.module.css'

// Paths are relative to BrowserRouter basename="/gp")
const WORK: { to: string; label: string }[] = [
  { to: '/', label: 'Desk' },
  { to: '/financials', label: 'Financials' },
  { to: '/options', label: 'Options' },
  { to: '/builder', label: 'Builder' },
  { to: '/podcasts', label: 'Podcasts' },
  { to: '/transcripts', label: 'Transcripts' },
  { to: '/positions', label: 'Positions' },
]

const OPS: { to: string; label: string }[] = [
  { to: '/fund', label: 'Fund' },
  { to: '/memos', label: 'Memos' },
  { to: '/settings', label: 'Settings' },
]

type Props = {
  user: GpUser | null
  build?: string
}

export function Topbar({ user, build }: Props) {
  const { theme, toggle } = useTheme()
  const initial = (user?.name || user?.email || 'GP').slice(0, 1).toUpperCase()

  return (
    <header className={styles.topbar}>
      <NavLink className={styles.brand} to="/" aria-label="DGA Capital GP" end>
        <img src="/branding/dga_logo_small.png" alt="" className={styles.logo} />
        <div className={styles.brandText}>
          <span className={styles.brandName}>DGA Capital</span>
          <span className={styles.brandSub}>GP Terminal</span>
        </div>
      </NavLink>

      <div className={styles.search}>
        <span className={styles.searchIcon} aria-hidden>
          ⌕
        </span>
        <input
          className={styles.searchInput}
          placeholder="Ticker or company…"
          autoComplete="off"
          spellCheck={false}
          title="Search (coming to React shell)"
        />
        <kbd className={styles.kbd}>⌘K</kbd>
      </div>

      <nav className={styles.nav} aria-label="Primary">
        {WORK.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.linkActive : ''}`
            }
          >
            {l.label}
          </NavLink>
        ))}
        <span className={styles.divider} role="separator" />
        {OPS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.linkActive : ''}`
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={toggle}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
        <span className={styles.dot} title={build || 'API online'} />
        <div className={styles.user} title={user?.email || ''}>
          <span className={styles.avatar}>{initial}</span>
          <span className={styles.userMeta}>
            <span className={styles.userName}>{user?.name || 'GP'}</span>
            <span className={styles.userRole}>{(user?.role || 'gp').toUpperCase()}</span>
          </span>
        </div>
        <button type="button" className={styles.logout} onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  )
}
