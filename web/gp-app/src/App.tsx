import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { DeskPage } from '@/pages/DeskPage'
import { OptionsPage } from '@/pages/OptionsPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { api, type BuildInfo, type MeResponse } from '@/lib/api'
import {
  clearSession,
  getCachedUser,
  getToken,
  type GpUser,
} from '@/lib/auth'
import styles from './App.module.css'

function AuthBoot({ children }: { children: (user: GpUser, build?: string) => ReactNode }) {
  const [user, setUser] = useState<GpUser | null>(getCachedUser())
  const [build, setBuild] = useState<string>()
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading')

  useEffect(() => {
    const token = getToken()
    if (!token) {
      window.location.replace('/')
      return
    }
    let alive = true
    ;(async () => {
      try {
        const [me, b] = await Promise.all([
          api<MeResponse>('/api/auth/v2/me'),
          api<BuildInfo>('/api/build').catch(() => ({ build: undefined })),
        ])
        if (!alive) return
        if (me.role && me.role !== 'gp' && me.role !== 'admin') {
          window.location.replace(me.role === 'lp' ? '/lp' : '/')
          return
        }
        setUser(me)
        try {
          localStorage.setItem('dga_v2_user', JSON.stringify(me))
        } catch {
          /* ignore */
        }
        setBuild(b.build)
        setState('ok')
      } catch {
        if (!alive) return
        clearSession()
        setState('fail')
        window.location.replace('/')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (state === 'loading') {
    return (
      <div className={styles.boot}>
        <div className={styles.bootCard}>
          <div className={styles.mark}>DGA</div>
          <h1>Opening GP Terminal</h1>
          <p>Verifying session and loading market shell…</p>
          <div className={styles.bar} />
        </div>
      </div>
    )
  }

  if (state !== 'ok' || !user) return null
  return <>{children(user, build)}</>
}

export default function App() {
  return (
    <AuthBoot>
      {(user, build) => (
        <BrowserRouter basename="/gp">
          <Routes>
            <Route element={<Shell user={user} build={build} />}>
              <Route index element={<DeskPage />} />
              <Route path="options" element={<OptionsPage />} />
              <Route
                path="financials"
                element={
                  <PlaceholderPage
                    kicker="Research"
                    title="Financials"
                    sub="Company dashboards, store coverage, and peer comps — API-backed."
                    bullets={[
                      'Dashboard & sheet views',
                      'Nightly EDGAR store card',
                      'Peer comps (Tesla-class fixes apply here)',
                    ]}
                  />
                }
              />
              <Route
                path="builder"
                element={
                  <PlaceholderPage
                    kicker="Sectors"
                    title="Builder"
                    sub="Named sector boards with cost basis from first add and since-add tracking."
                    bullets={['Sector boards', 'Since-add % (ui419/ui422)', 'Basket constructor']}
                  />
                }
              />
              <Route
                path="podcasts"
                element={
                  <PlaceholderPage
                    kicker="Studio"
                    title="Podcasts"
                    sub="DGA HiTech podcast pipeline — script, TTS, and export."
                  />
                }
              />
              <Route
                path="transcripts"
                element={
                  <PlaceholderPage
                    kicker="Research"
                    title="Transcripts"
                    sub="YouTube ingest and earnings-call index with AI ask."
                  />
                }
              />
              <Route
                path="positions"
                element={
                  <PlaceholderPage
                    kicker="Brokerage"
                    title="Positions"
                    sub="SnapTrade multi-account holdings with day P&amp;L."
                  />
                }
              />
              <Route
                path="fund"
                element={
                  <PlaceholderPage
                    kicker="Firm ops"
                    title="Fund"
                    sub="Fund detail, rebalance, YTD, and LP-facing ops."
                  />
                }
              />
              <Route
                path="memos"
                element={
                  <PlaceholderPage
                    kicker="Firm ops"
                    title="Memos"
                    sub="Compose and archive investment memos."
                  />
                }
              />
              <Route
                path="settings"
                element={
                  <PlaceholderPage
                    kicker="Admin"
                    title="Settings"
                    sub="Models, security, support tickets, and continuity handoff."
                    bullets={[
                      'Model routing & volume LLM',
                      'Password change',
                      'Support inbox trail',
                    ]}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      )}
    </AuthBoot>
  )
}
