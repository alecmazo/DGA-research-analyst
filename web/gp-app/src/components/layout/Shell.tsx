import { Outlet } from 'react-router-dom'
import type { GpUser } from '@/lib/auth'
import { Topbar } from './Topbar'
import { MarketRibbon } from './MarketRibbon'
import styles from './Shell.module.css'

type Props = {
  user: GpUser | null
  build?: string
}

export function Shell({ user, build }: Props) {
  return (
    <div className={styles.shell}>
      <Topbar user={user} build={build} />
      <MarketRibbon />
      <main className={styles.main}>
        <div className={styles.inner}>
          <Outlet />
        </div>
      </main>
      <footer className={styles.footer}>
        <span>DGA Capital · GP Terminal (React)</span>
        {build && <span className={styles.build}>{build}</span>}
      </footer>
    </div>
  )
}
