import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CityCanvas } from '@/city/CityCanvas'
import { hasWebGL, useCityData } from '@/city/data/useCityData'
import { useCityState } from '@/city/state'
import { BuildingList } from '@/city/ui/BuildingList'
import { FallbackTable } from '@/city/ui/FallbackTable'
import { Footer } from '@/city/ui/Footer'
import { InfoPanel } from '@/city/ui/InfoPanel'
import { Toolbar } from '@/city/ui/Toolbar'
import { Empty } from '@/components/ui/Empty'
import styles from './CityPage.module.css'

export default function CityPage() {
  const { data, error, banner } = useCityData()
  const [params, setParams] = useSearchParams()
  const [webgl] = useState(hasWebGL)
  const [mobile, setMobile] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reflect, setReflect] = useState(true)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const state = useCityState()
  const motionOn = state.motion === 'off' ? false : state.motion === 'on' ? true : !reduced

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const narrow = window.matchMedia('(max-width: 760px)')
    const sync = () => {
      setReduced(motion.matches)
      setMobile(narrow.matches)
      if (narrow.matches) setReflect(false)
    }
    sync()
    motion.addEventListener('change', sync)
    narrow.addEventListener('change', sync)
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      motion.removeEventListener('change', sync)
      narrow.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    if (!data) return
    const sel = (params.get('sel') || '').toLowerCase()
    if (!sel) return
    const hit = data.companies.find((company) => company.id === sel || company.ticker.toLowerCase() === sel)
    if (hit && hit.id !== state.selectedId) state.setSelected(hit.id)
  }, [data, params, state.selectedId, state.setSelected])

  const selected = useMemo(
    () => data?.companies.find((company) => company.id === state.selectedId) || null,
    [data, state.selectedId],
  )
  const hover = data?.companies.find((company) => company.id === state.hoverId) || null

  const choose = (id: string | null) => {
    state.setSelected(id)
    const next = new URLSearchParams(params)
    if (!id || !data) next.delete('sel')
    else {
      const company = data.companies.find((item) => item.id === id)
      next.set('sel', (company?.ticker || id).toLowerCase())
    }
    setParams(next, { replace: true })
  }

  if (error) return <Empty title="City unavailable" sub={error} />
  if (!data && !banner) return <Empty title="Opening the city" sub="Loading the book." />

  return (
    <div className={styles.page} data-city>
      <div
        className={styles.stage}
        onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
        onPointerLeave={() => setPointer(null)}
      >
        {banner && <div className={styles.banner} role="status">{banner}</div>}
        {data && webgl && (
          <CityCanvas
            companies={data.companies}
            metric={state.metric}
            night={state.night}
            motion={motionOn}
            mobile={mobile}
            hidden={hidden}
            reflect={reflect && !mobile}
            selectedId={state.selectedId}
            flyover={state.flyover && motionOn}
            resetNonce={state.resetNonce}
            onSelect={choose}
            onHover={state.setHover}
            onFlyover={state.setFlyover}
            onReflect={setReflect}
          />
        )}
        {data && !webgl && <FallbackTable companies={data.companies} />}
        <Toolbar
          metric={state.metric}
          night={state.night}
          flyover={state.flyover}
          motionOn={motionOn}
          listOpen={state.listOpen}
          onMetric={state.setMetric}
          onNight={state.setNight}
          onFlyover={() => state.setFlyover(!state.flyover)}
          onReset={() => {
            state.bumpReset()
            choose(null)
          }}
          onMotion={() => state.setMotion(motionOn ? 'off' : 'on')}
          onList={() => state.setListOpen(!state.listOpen)}
        />
        {data && state.listOpen && (
          <BuildingList companies={data.companies} selectedId={state.selectedId} onSelect={choose} />
        )}
        <InfoPanel company={selected} onClose={() => choose(null)} />
        {hover && pointer && !selected && (
          <div className={styles.tip} style={{ left: pointer.x + 12, top: pointer.y + 12 }}>
            {hover.ticker} · {(hover.weight * 100).toFixed(1)}%
          </div>
        )}
        {data && <Footer portfolio={data.portfolio} />}
        <div className={styles.live} aria-live="polite">
          {selected ? `Selected ${selected.name}` : ''}
        </div>
      </div>
    </div>
  )
}
