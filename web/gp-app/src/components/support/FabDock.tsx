import { GrokBot } from './GrokBot'
import { SupportFab } from './SupportFab'
import styles from './SupportFab.module.css'

/** Stacked desk FABs: GPT-oss above Support. */
export function FabDock() {
  return (
    <div className={styles.stack} data-fab-dock>
      <GrokBot />
      <SupportFab />
    </div>
  )
}
