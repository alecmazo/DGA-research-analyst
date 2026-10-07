import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { ACESFilmicToneMapping, CanvasTexture, SRGBColorSpace } from 'three'
import type { Metric } from './metrics'
import { shownHeight } from './metrics'
import type { CityCompany } from './schema'
import { Building } from './buildings/Building'
import { FillerCity } from './buildings/FillerCity'
import { Rig } from './camera/Rig'
import { DayNight, Ground, Post, Rain } from './fx/SceneFx'

type Props = {
  companies: CityCompany[]
  metric: Metric
  night: boolean
  motion: boolean
  mobile: boolean
  hidden: boolean
  reflect: boolean
  selectedId: string | null
  flyover: boolean
  resetNonce: number
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onFlyover: (on: boolean) => void
  onReflect: (on: boolean) => void
}

function Kick({ night, metric, motion }: { night: boolean; metric: Metric; motion: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    invalidate()
  }, [night, metric, motion, invalidate])
  return null
}

function Sign({ text, position }: { text: string; position: [number, number, number] }) {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, 512, 96)
    ctx.font = '700 40px "Inter Tight", Inter, sans-serif'
    ctx.fillStyle = '#ffb000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text.toUpperCase(), 256, 48)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
  }, [text])
  useEffect(() => () => tex?.dispose(), [tex])
  if (!tex) return null
  return (
    <sprite position={position} scale={[30, 5.6, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  )
}

function Signs({ companies, metric }: { companies: CityCompany[]; metric: Metric }) {
  const groups = new Map<string, { x: number; z: number; n: number; h: number }>()
  for (const company of companies) {
    const row = groups.get(company.sector) || { x: 0, z: 0, n: 0, h: 0 }
    row.x += company.position.x
    row.z += company.position.z
    row.n += 1
    row.h = Math.max(row.h, shownHeight(company, metric))
    groups.set(company.sector, row)
  }
  return (
    <group>
      {[...groups.entries()].map(([sector, row]) => (
        <Sign
          key={sector}
          text={sector}
          position={[row.x / row.n, row.h + 8, row.z / row.n]}
        />
      ))}
    </group>
  )
}

export function CityCanvas(props: Props) {
  const tallest = useMemo(() => {
    const best = new Map<string, { id: string; h: number }>()
    for (const company of props.companies) {
      const h = shownHeight(company, props.metric)
      const prev = best.get(company.sector)
      if (!prev || h > prev.h) best.set(company.sector, { id: company.id, h })
    }
    return new Set([...best.values()].map((row) => row.id))
  }, [props.companies, props.metric])

  return (
    <Canvas
      camera={{ position: [0, 78, 168], fov: 42, near: 0.1, far: 900 }}
      dpr={props.mobile ? [1, 1.5] : [1, 2]}
      frameloop={props.hidden ? 'never' : props.motion ? 'always' : 'demand'}
      gl={{
        antialias: !props.mobile,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: props.night ? 1.05 : 1.12,
      }}
      onCreated={({ gl }) => {
        gl.domElement.setAttribute('role', 'application')
        gl.domElement.setAttribute(
          'aria-label',
          'Portfolio City 3D view. Use the building list for a text alternative.',
        )
      }}
    >
      <color attach="background" args={[props.night ? '#070814' : '#d5e2f0']} />
      <fogExp2 attach="fog" args={[props.night ? '#070814' : '#c5d4e8', props.night ? 0.0085 : 0.004]} />
      <PerformanceMonitor
        onDecline={() => props.onReflect(false)}
        onIncline={() => props.onReflect(!props.mobile)}
      />
      <Kick night={props.night} metric={props.metric} motion={props.motion} />
      <DayNight night={props.night} motion={props.motion} />
      <Ground reflect={props.reflect && !props.mobile} />
      <FillerCity />
      {props.companies.map((company) => (
        <Building
          key={company.id}
          company={company}
          metric={props.metric}
          motion={props.motion}
          selected={company.id === props.selectedId}
          antenna={tallest.has(company.id)}
          onSelect={props.onSelect}
          onHover={props.onHover}
        />
      ))}
      <Signs companies={props.companies} metric={props.metric} />
      {props.motion && !props.mobile && props.night && <Rain />}
      <Rig
        companies={props.companies}
        metric={props.metric}
        selectedId={props.selectedId}
        flyover={props.flyover}
        motion={props.motion}
        resetNonce={props.resetNonce}
        onSelect={props.onSelect}
        onFlyover={props.onFlyover}
      />
      <Post night={props.night} mobile={props.mobile} />
    </Canvas>
  )
}
