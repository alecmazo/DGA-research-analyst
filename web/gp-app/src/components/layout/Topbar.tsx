import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import type { GpUser } from '@/lib/auth'
import { logout } from '@/lib/auth'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { thisMacHasLocalModel } from '@/lib/localOllama'
import { StockPeek } from './StockPeek'
import styles from './Topbar.module.css'

// Paths are relative to BrowserRouter basename="/gp")
const RESEARCH: { to: string; label: string }[] = [
  { to: '/', label: 'Desk' },
  { to: '/financials', label: 'Financials' },
  { to: '/builder', label: 'Boards' },
  { to: '/gurus', label: 'Gurus' },
  { to: '/podcasts', label: 'Podcasts' },
  { to: '/transcripts', label: 'Transcripts' },
]

const BOOK: { to: string; label: string }[] = [
  { to: '/fund', label: 'Accounts' },
  { to: '/positions', label: 'Positions' },
  { to: '/memos', label: 'Memos' },
  { to: '/ship', label: 'Book map' },
]

const MORE: { to: string; label: string }[] = [
  { to: '/options', label: 'Options' },
  { to: '/credit', label: 'Credit' },
  { to: '/merger-arb', label: 'Merger arb' },
  { to: '/munger', label: 'Munger' },
]

/** Sliw Agent — Edyta corporate desk. Same allowlist as pre-React topbar
 *  and apps/sliw-agent/server.py (override via SLIW_ALLOWED_EMAILS on API). */
const SLIW_ALLOWED = new Set([
  'alecmazo1@gmail.com',
  'edytasliw@gmail.com',
])

const TOP_LINKS = [...RESEARCH, ...MORE]

function pathActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavMenu({
  label,
  items,
}: {
  label: string
  items: { to: string; label: string }[]
}) {
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const active = items.some((it) => pathActive(loc.pathname, it.to))
  const menuId = useRef(`nav-${label}`)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: Math.round(r.bottom + 4), left: Math.round(r.left) })
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [])

  return (
    <div className={styles.menuWrap} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.link} ${styles.menuBtn} ${active ? styles.linkActive : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation()
          place()
          setOpen((o) => !o)
        }}
      >
        {label} <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.menuPanel}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                role="menuitem"
                className={({ isActive }) =>
                  `${styles.menuItem} ${isActive ? styles.menuItemOn : ''}`
                }
                onClick={() => setOpen(false)}
              >
                {it.label}
              </NavLink>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

function UserMenu({
  user,
  build,
  theme,
  onToggleTheme,
}: {
  user: GpUser | null
  build?: string
  theme: string
  onToggleTheme: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const initial = (user?.name || user?.email || 'GP').slice(0, 1).toUpperCase()
  const menuId = useRef('nav-account')

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      top: Math.round(r.bottom + 4),
      right: Math.max(8, Math.round(window.innerWidth - r.right)),
    })
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== menuId.current) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('dga-nav-menu', onOther)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('dga-nav-menu', onOther)
    }
  }, [])

  return (
    <div className={styles.menuWrap} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={styles.userBtn}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        title={[user?.email, build].filter(Boolean).join(' · ') || 'Account'}
        onClick={(e) => {
          e.stopPropagation()
          place()
          window.dispatchEvent(new CustomEvent('dga-nav-menu', { detail: menuId.current }))
          setOpen((o) => !o)
        }}
      >
        <span className={styles.avatar}>{initial}</span>
        <span className={styles.userMeta}>
          <span className={styles.userName}>{user?.name || 'GP'}</span>
          <span className={styles.userRole}>{(user?.role || 'gp').toUpperCase()}</span>
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`${styles.menuPanel} ${styles.menuPanelRight}`}
            role="menu"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className={styles.menuWho}>
              <strong>{user?.name || 'GP'}</strong>
              {user?.email ? <span>{user.email}</span> : null}
            </div>
            <NavLink
              to="/settings"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => setOpen(false)}
            >
              Settings
            </NavLink>
            {canAccessSliw(user) && (
              <a className={styles.menuItem} role="menuitem" href="/sliw/">
                Sliw
              </a>
            )}
            <button
              type="button"
              role="menuitem"
              className={styles.menuItemBtn}
              onClick={onToggleTheme}
            >
              {theme === 'light' ? 'Dark theme' : 'Light theme'}
            </button>
            <button type="button" role="menuitem" className={styles.menuItemBtn} onClick={logout}>
              Log out
            </button>
            {build ? <div className={styles.menuBuild}>{build}</div> : null}
          </div>,
          document.body,
        )}
    </div>
  )
}

function canAccessSliw(user: GpUser | null): boolean {
  const email = String(user?.email || '')
    .toLowerCase()
    .trim()
  return !!email && SLIW_ALLOWED.has(email)
}

type SearchHit = {
  ticker?: string
  name?: string
  exchange?: string
}

function isTickerLike(q: string) {
  return /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test((q || '').trim())
}

function normalizeTicker(q: string) {
  return String(q || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, '')
}

type Props = {
  user: GpUser | null
  build?: string
}

export function Topbar({ user, build }: Props) {
  const { theme, toggle } = useTheme()

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [peekTk, setPeekTk] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [onThisMac, setOnThisMac] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    let alive = true
    void thisMacHasLocalModel().then((ok) => {
      if (alive) setOnThisMac(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  const openPeek = useCallback((ticker: string) => {
    const tk = normalizeTicker(ticker)
    if (!tk) return
    setPeekTk(tk)
    setQ('')
    setHits([])
    setOpen(false)
    inputRef.current?.blur()
  }, [])

  const runSearch = useCallback(async (query: string) => {
    const my = ++seqRef.current
    const tickerLike = isTickerLike(query)
    setSearching(true)
    try {
      const data = await api<{ results?: SearchHit[] }>(
        `/api/search/resolve?q=${encodeURIComponent(query)}`,
      )
      if (my !== seqRef.current) return
      let results = data.results || []
      if (!results.length && tickerLike) {
        const tk = normalizeTicker(query)
        results = [{ ticker: tk, name: 'Open free snapshot', exchange: 'LIVE' }]
      }
      setHits(results)
      setActiveIdx(0)
      setOpen(true)
    } catch {
      if (my !== seqRef.current) return
      if (tickerLike) {
        const tk = normalizeTicker(query)
        setHits([{ ticker: tk, name: 'Open free snapshot', exchange: 'LIVE' }])
        setActiveIdx(0)
        setOpen(true)
      } else {
        setHits([])
        setOpen(true)
      }
    } finally {
      if (my === seqRef.current) setSearching(false)
    }
  }, [])

  const onChange = (value: string) => {
    setQ(value)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    const trimmed = value.trim()
    if (!trimmed || (trimmed.length < 2 && !isTickerLike(trimmed))) {
      setHits([])
      setOpen(false)
      return
    }
    debounceRef.current = window.setTimeout(() => void runSearch(trimmed), 220)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!hits.length) return
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1))
      setOpen(true)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!hits.length) return
      setActiveIdx((i) => Math.max(0, i - 1))
      setOpen(true)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = q.trim()
      const hit = hits[activeIdx]
      if (open && hit?.ticker) {
        openPeek(hit.ticker)
        return
      }
      if (isTickerLike(trimmed)) {
        openPeek(normalizeTicker(trimmed))
      }
    }
  }

  // ⌘K / Ctrl+K focuses search (like pre-React)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 'k' && e.key !== 'K')) return
      const tag = (e.target as HTMLElement | null)?.tagName || ''
      const editable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement | null)?.isContentEditable
      if (editable && e.target !== inputRef.current) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click outside closes dropdown
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <>
      <header className={styles.topbar}>
        <NavLink className={styles.brand} to="/" aria-label="DGA Capital GP" end>
          <img src="/branding/dga_logo_small.png" alt="" className={styles.logo} />
          <div className={styles.brandText}>
            <span className={styles.brandName}>DGA Capital</span>
            <span className={styles.brandSub}>GP Terminal</span>
          </div>
        </NavLink>

        <div className={styles.search} ref={wrapRef}>
          <span className={styles.searchIcon} aria-hidden>
            ⌕
          </span>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Ticker or company…"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (hits.length) setOpen(true)
            }}
            title="Search ticker → free snapshot (⌘K)"
            aria-label="Search ticker or company"
            aria-autocomplete="list"
            aria-expanded={open}
          />
          <kbd className={styles.kbd}>⌘K</kbd>

          {open && (
            <div className={styles.results} role="listbox">
              {searching && !hits.length && (
                <div className={styles.srItemMuted}>Searching…</div>
              )}
              {!searching && !hits.length && (
                <div className={styles.srItemMuted}>No matches — try a ticker like AAPL</div>
              )}
              {hits.map((h, i) => (
                <button
                  key={`${h.ticker}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`${styles.srItem} ${i === activeIdx ? styles.srActive : ''}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => h.ticker && openPeek(h.ticker)}
                >
                  <span className={styles.srTk}>{h.ticker || '—'}</span>
                  <span className={styles.srName}>{h.name || ''}</span>
                  {h.exchange ? (
                    <span className={styles.srEx}>{h.exchange}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className={styles.nav} aria-label="Primary">
          {RESEARCH.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                `${styles.link} ${isActive ? styles.linkActive : ''}`
              }
            >
              {it.label}
            </NavLink>
          ))}
          <NavMenu label="Book" items={BOOK} />
          {TOP_LINKS.slice(RESEARCH.length).map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `${styles.link} ${isActive ? styles.linkActive : ''}`
              }
            >
              {it.label}
            </NavLink>
          ))}
          {onThisMac && (
            <NavLink
              to="/local"
              className={({ isActive }) =>
                `${styles.link} ${isActive ? styles.linkActive : ''}`
              }
            >
              On this Mac
            </NavLink>
          )}
        </nav>

        <div className={styles.right}>
          <span className={styles.dot} title="API online" />
          <UserMenu user={user} build={build} theme={theme} onToggleTheme={toggle} />
        </div>
      </header>

      {peekTk && <StockPeek ticker={peekTk} onClose={() => setPeekTk(null)} />}
    </>
  )
}
