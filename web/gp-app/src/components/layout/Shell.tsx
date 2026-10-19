import { Outlet } from 'react-router-dom'
import type { GpUser } from '@/lib/auth'
import { Topbar } from './Topbar'
import { MarketRibbon } from './MarketRibbon'
import { FabDock } from '@/components/support/FabDock'
import { AnalysisSceneHost } from '@/components/ui/AnalysisScene'
import styles from './Shell.module.css'

type Props = {
  user: GpUser | null
  build?: string
}

export function Shell({ user, build }: Props) {
  return (
    <div className={styles.shell}>
      {user?.demo_mode && (
        <div className={styles.demoRibbon} data-print="hide">
          SAMPLE WORKSPACE — fictitious books with live market prices. AI notes
          are pre-generated; imports and account linking are off.
        </div>
      )}
      <div data-print="hide">
        <Topbar user={user} build={build} />
      </div>
      <div data-print="hide">
        <MarketRibbon />
      </div>
      <main className={styles.main}>
        <div className={styles.inner}>
          <Outlet />
        </div>
      </main>
      <div data-print="hide">
        <FabDock />
      </div>
      <AnalysisSceneHost />
    </div>
  )
}
