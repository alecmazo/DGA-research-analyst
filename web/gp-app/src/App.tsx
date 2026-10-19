import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { DeskPage } from '@/pages/DeskPage'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { api, type BuildInfo, type MeResponse } from '@/lib/api'
import {
  clearSession,
  getCachedUser,
  getToken,
  type GpUser,
} from '@/lib/auth'
import styles from './App.module.css'

function lazyExport<T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  key: keyof T & string,
) {
  return lazy(async () => {
    const mod = await loader()
    return { default: mod[key] as ComponentType }
  })
}

function MergerArbMemoRedirect() {
  const { dealId = '' } = useParams()
  return <Navigate to={`/merger-arb?deal=${encodeURIComponent(dealId)}`} replace />
}

const OptionsPage = lazyExport(() => import('@/pages/OptionsPage'), 'OptionsPage')
const PositionsPage = lazyExport(() => import('@/pages/PositionsPage'), 'PositionsPage')
const FundPage = lazyExport(() => import('@/pages/FundPage'), 'FundPage')
const BuilderPage = lazyExport(() => import('@/pages/BuilderPage'), 'BuilderPage')
const FinancialsPage = lazyExport(() => import('@/pages/FinancialsPage'), 'FinancialsPage')
const MungerPage = lazyExport(() => import('@/pages/MungerPage'), 'MungerPage')
const LocalPage = lazyExport(() => import('@/pages/LocalPage'), 'LocalPage')
const PodcastsPage = lazyExport(() => import('@/pages/PodcastsPage'), 'PodcastsPage')
const TranscriptsPage = lazyExport(() => import('@/pages/TranscriptsPage'), 'TranscriptsPage')
const MemosPage = lazyExport(() => import('@/pages/MemosPage'), 'MemosPage')
const SettingsPage = lazyExport(() => import('@/pages/SettingsPage'), 'SettingsPage')
const ReportPage = lazyExport(() => import('@/pages/ReportPage'), 'ReportPage')
const LocalPortfolioPage = lazyExport(
  () => import('@/pages/LocalPortfolioPage'),
  'LocalPortfolioPage',
)
const ResearchAnswerPage = lazyExport(
  () => import('@/pages/ResearchAnswerPage'),
  'ResearchAnswerPage',
)
const ValuationBridgePage = lazyExport(
  () => import('@/pages/ValuationBridgePage'),
  'ValuationBridgePage',
)
const CompsPage = lazyExport(() => import('@/pages/CompsPage'), 'CompsPage')
const GurusPage = lazyExport(() => import('@/pages/GurusPage'), 'GurusPage')
const MergerArbPage = lazyExport(() => import('@/pages/MergerArbPage'), 'MergerArbPage')
const CreditPage = lazyExport(() => import('@/pages/CreditPage'), 'CreditPage')
const ShipPage = lazyExport(() => import('@/pages/ShipPage'), 'ShipPage')

function LazyPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ErrorBoundary label={label}>
      <Suspense
        fallback={
          <div className={styles.boot}>
            <div className={styles.bootCard}>
              <div className={styles.mark}>DGA</div>
              <h1>{label}</h1>
              <p>Loading…</p>
              <div className={styles.bar} />
            </div>
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

function AuthBoot({
  children,
}: {
  children: (user: GpUser, build?: string) => ReactNode
}) {
  const cached = getCachedUser()
  const cachedOk =
    !!cached && (cached.role === 'gp' || cached.role === 'admin')
  const [user, setUser] = useState<GpUser | null>(cachedOk ? cached : null)
  const [build, setBuild] = useState<string>()
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>(
    cachedOk ? 'ok' : 'loading',
  )

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
            <Route
              path="report"
              element={
                <LazyPage label="Report">
                  <ReportPage />
                </LazyPage>
              }
            />
            <Route
              path="local-report"
              element={
                <LazyPage label="Report">
                  <ReportPage />
                </LazyPage>
              }
            />
            <Route
              path="local-portfolio"
              element={
                <LazyPage label="Portfolio">
                  <LocalPortfolioPage />
                </LazyPage>
              }
            />
            <Route
              path="research"
              element={
                <LazyPage label="Research">
                  <ResearchAnswerPage />
                </LazyPage>
              }
            />
            <Route
              path="valuation"
              element={
                <LazyPage label="Valuation">
                  <ValuationBridgePage />
                </LazyPage>
              }
            />
            <Route
              path="comps"
              element={
                <LazyPage label="Comps">
                  <CompsPage />
                </LazyPage>
              }
            />
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
                path="munger"
                element={
                  <LazyPage label="Munger">
                    <MungerPage />
                  </LazyPage>
                }
              />
              <Route
                path="local"
                element={
                  <LazyPage label="Local">
                    <LocalPage />
                  </LazyPage>
                }
              />
              <Route
                path="financials"
                element={
                  <LazyPage label="Financials">
                    <FinancialsPage />
                  </LazyPage>
                }
              />
              <Route
                path="options"
                element={
                  <LazyPage label="Options">
                    <OptionsPage />
                  </LazyPage>
                }
              />
              <Route
                path="builder"
                element={
                  <LazyPage label="Watchlists">
                    <BuilderPage />
                  </LazyPage>
                }
              />
              <Route
                path="gurus"
                element={
                  <LazyPage label="Gurus">
                    <GurusPage />
                  </LazyPage>
                }
              />
              <Route
                path="podcasts"
                element={
                  <LazyPage label="Podcasts">
                    <PodcastsPage />
                  </LazyPage>
                }
              />
              <Route
                path="transcripts"
                element={
                  <LazyPage label="Transcripts">
                    <TranscriptsPage />
                  </LazyPage>
                }
              />
              <Route
                path="credit"
                element={
                  <LazyPage label="Credit">
                    <CreditPage />
                  </LazyPage>
                }
              />
              <Route
                path="credit/:issuer"
                element={
                  <LazyPage label="Credit">
                    <CreditPage />
                  </LazyPage>
                }
              />
              <Route
                path="merger-arb"
                element={
                  <LazyPage label="Merger arb">
                    <MergerArbPage />
                  </LazyPage>
                }
              />
              <Route
                path={['merger-arb', 'analysis', ':dealId'].join('/')}
                element={<MergerArbMemoRedirect />}
              />
              <Route
                path="ship"
                element={
                  <LazyPage label="City">
                    <ShipPage />
                  </LazyPage>
                }
              />
              <Route
                path="positions"
                element={
                  <LazyPage label="Positions">
                    <PositionsPage />
                  </LazyPage>
                }
              />
              <Route
                path="fund"
                element={
                  <LazyPage label="Accounts">
                    <FundPage />
                  </LazyPage>
                }
              />
              <Route
                path="memos"
                element={
                  <LazyPage label="Memos">
                    <MemosPage />
                  </LazyPage>
                }
              />
              <Route
                path="settings"
                element={
                  <LazyPage label="Settings">
                    <SettingsPage />
                  </LazyPage>
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
