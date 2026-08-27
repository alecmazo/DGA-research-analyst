import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { GpUser } from '@/lib/auth'
import { logout } from '@/lib/auth'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { StockPeek } from './StockPeek'
import styles from './Topbar.module.css'

// Paths are relative to BrowserRouter basename="/gp")
const WORK: { to: string; label: string }[] = [
  { to: '/', label: 'Desk' },
  { to: '/financials', label: 'Financials' },
  { to: '/builder', label: 'Builder' },
  { to: '/podcasts', label: 'Podcasts' },
  { to: '/transcripts', label: 'Transcripts' },
  { to: '/positions', label: 'Positions' },
  { to: '/options', label: 'Options' },
]

const OPS: { to: string; label: string }[] = [
  { to: '/fund', label: 'Fund' },
  { to: '/memos', label: 'Memos' },
  { to: '/settings', label: 'Settings' },
]

/** Sliw Agent — Edyta corporate desk. Same allowlist as pre-React topbar
 *  and apps/sliw-agent/server.py (override via SLIW_ALLOWED_EMAILS on API). */
const SLIW_ALLOWED = new Set([
  'alecmazo1@gmail.com',
  'edytasliw@gmail.com',
])

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
  const initial = (user?.name || user?.email || 'GP').slice(0, 1).toUpperCase()

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [peekTk, setPeekTk] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<number | null>(null)
  const seqRef = useRef(0)

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
          {canAccessSliw(user) && (
            <a
              className={styles.link}
              href="/sliw/"
              title="Sliw Agent — Edyta corporate desk"
            >
              Sliw
            </a>
          )}
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

      {peekTk && <StockPeek ticker={peekTk} onClose={() => setPeekTk(null)} />}
    </>
  )
}
