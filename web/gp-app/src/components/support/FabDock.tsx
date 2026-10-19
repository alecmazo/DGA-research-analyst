import { createPortal } from 'react-dom'
import { GrokBot } from './GrokBot'
import { SupportFab } from './SupportFab'
import styles from './SupportFab.module.css'

/** Stacked desk FABs: GPT-oss above Support.

The node is portaled to document.body so a page layer (the merger-arb
drawer, the scan card) cannot sit on top of Support.
*/
export function FabDock() {
  const dock = (
    <div className={styles.stack} data-fab-dock>
      <GrokBot />
      <SupportFab />
    </div>
  )
  if (typeof document === 'undefined') return dock
  return createPortal(dock, document.body)
}
