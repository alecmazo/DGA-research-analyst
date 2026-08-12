import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { DeskPage } from '@/pages/DeskPage'
import { OptionsPage } from '@/pages/OptionsPage'
import { PositionsPage } from '@/pages/PositionsPage'
import { FundPage } from '@/pages/FundPage'
import { BuilderPage } from '@/pages/BuilderPage'
import { FinancialsPage } from '@/pages/FinancialsPage'
import { PodcastsPage } from '@/pages/PodcastsPage'
import { TranscriptsPage } from '@/pages/TranscriptsPage'
import { MemosPage } from '@/pages/MemosPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ReportPage } from '@/pages/ReportPage'
import { ResearchAnswerPage } from '@/pages/ResearchAnswerPage'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { api, type BuildInfo, type MeResponse } from '@/lib/api'
import {
  clearSession,
  getCachedUser,
  getToken,
  type GpUser,
} from '@/lib/auth'
import styles from './App.module.css'

function AuthBoot({
  children,
}: {
  children: (user: GpUser, build?: string) => ReactNode
}) {
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
            {/* Standalone report / research windows (no chrome) */}
            <Route path="report" element={<ReportPage />} />
            <Route path="research" element={<ResearchAnswerPage />} />
            <Route element={<Shell user={user} build={build} />}>
              <Route
                index
                element={
                  <ErrorBoundary label="Desk">
                    <DeskPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="financials"
                element={
                  <ErrorBoundary label="Financials">
                    <FinancialsPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="options"
                element={
                  <ErrorBoundary label="Options">
                    <OptionsPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="builder"
                element={
                  <ErrorBoundary label="Builder">
                    <BuilderPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="podcasts"
                element={
                  <ErrorBoundary label="Podcasts">
                    <PodcastsPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="transcripts"
                element={
                  <ErrorBoundary label="Transcripts">
                    <TranscriptsPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="positions"
                element={
                  <ErrorBoundary label="Positions">
                    <PositionsPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="fund"
                element={
                  <ErrorBoundary label="Fund">
                    <FundPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="memos"
                element={
                  <ErrorBoundary label="Memos">
                    <MemosPage />
                  </ErrorBoundary>
                }
              />
              <Route
                path="settings"
                element={
                  <ErrorBoundary label="Settings">
                    <SettingsPage />
                  </ErrorBoundary>
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
