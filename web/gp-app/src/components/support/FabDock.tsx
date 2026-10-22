import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { thisMacHasLocalModel } from '@/lib/localOllama'
import { GrokBot } from './GrokBot'
import { SupportFab } from './SupportFab'
import styles from './SupportFab.module.css'

/** Stacked desk FABs: GPT-oss above Support.

The node is portaled to document.body so a page layer (the merger-arb
drawer, the scan card) cannot sit on top of Support.
*/
export function FabDock() {
  const [onMac, setOnMac] = useState(false)
  useEffect(() => {
    let alive = true
    void thisMacHasLocalModel().then((ok) => {
      if (alive) setOnMac(ok)
    })
    return () => {
      alive = false
    }
  }, [])
  const dock = (
    <div className={styles.stack} data-fab-dock>
      {onMac && <GrokBot />}
      <SupportFab />
    </div>
  )
  if (typeof document === 'undefined') return dock
  return createPortal(dock, document.body)
}
