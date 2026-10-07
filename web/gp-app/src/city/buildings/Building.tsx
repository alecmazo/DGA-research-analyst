import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { equityGlass, shownFootprint, shownHeight, type Metric } from '../metrics'
import type { CityCompany } from '../schema'
import { Silhouette } from './Silhouette'

const MANAGED = '#3ee0ff'
const LP = '#f0c14a'
const BOOK = '#8dffc0'
const NEGATIVE = '#ff6b7a'

function applyScale(group: Group, visH: number, visF: number, drawn: number, foot: number) {
  group.scale.set(
    Math.max(0.05, visF / foot),
    Math.max(0.05, visH / drawn),
    Math.max(0.05, visF / foot),
  )
}

type Props = {
  company: CityCompany
  metric: Metric
  motion: boolean
  selected: boolean
  antenna: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

export function Building({ company, metric, motion, selected, antenna, onSelect, onHover }: Props) {
  const height = shownHeight(company, metric)
  const foot = Math.max(4, shownFootprint(company, metric))
  const drawn = company.archetype === 'cash_plaza' ? Math.max(height, 18) : height
  const glass = equityGlass(drawn, company.equity_band ?? null)
  const skirt = Math.min(8, drawn * 0.14)
  const bands = company.bands
  const spin = company.archetype === 'tech_neon' || company.archetype === 'energy_reactor'
  const grow = useRef<Group>(null)
  const visH = useRef(drawn)
  const visF = useRef(foot)
  const down = useRef({ x: 0, y: 0 })

  // Apply the previous size before paint so a metric change does not flash the new mesh.
  if (!motion) {
    visH.current = drawn
    visF.current = foot
    if (grow.current) grow.current.scale.set(1, 1, 1)
  } else if (grow.current) {
    applyScale(grow.current, visH.current, visF.current, drawn, foot)
  }

  useFrame((_, dt) => {
    const group = grow.current
    if (!group || !motion) return
    if (visH.current === drawn && visF.current === foot) return
    const step = Math.min(1, dt / 0.6)
    visH.current += (drawn - visH.current) * step
    visF.current += (foot - visF.current) * step
    if (Math.abs(visH.current - drawn) < 0.05) visH.current = drawn
    if (Math.abs(visF.current - foot) < 0.05) visF.current = foot
    applyScale(group, visH.current, visF.current, drawn, foot)
  })

  const edge = useMemo(() => {
    let y = 0
    return (bands ?? []).map((band) => {
      const h = Math.max(0.4, skirt * band.share)
      const mid = y + h / 2
      y += h
      return { ...band, h, y: mid }
    })
  }, [bands, skirt])

  return (
    <group position={[company.position.x, 0, company.position.z]}>
      <group ref={grow}>
      <Silhouette
        kind={company.archetype}
        height={drawn}
        foot={foot}
        base={company.colors.base}
        primary={company.colors.primary}
        accent={company.colors.accent}
        motion={motion}
        spin={spin}
        flicker={company.animation?.flicker ?? 0}
      />
      {edge.map((band) => (
        <mesh key={`${band.account_name}-${band.source_type}`} position={[0, band.y, foot * 0.48]}>
          <boxGeometry args={[foot * 1.06, band.h, 0.28]} />
          <meshStandardMaterial
            color={band.source_type === 'lp_fund' ? LP : MANAGED}
            emissive={band.source_type === 'lp_fund' ? LP : MANAGED}
            emissiveIntensity={selected ? 1.6 : 0.8}
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>
      ))}
      {glass && (
        <group position={[0, glass.y, 0]}>
          <mesh>
            <boxGeometry args={[foot * 0.62, glass.h, foot * 0.5]} />
            <meshStandardMaterial
              color={glass.below ? NEGATIVE : BOOK}
              emissive={glass.below ? NEGATIVE : BOOK}
              emissiveIntensity={0.45}
              transparent
              opacity={0.3}
              roughness={0.05}
              metalness={0}
              depthWrite={false}
            />
          </mesh>
          {glass.below && [0.2, 0.5, 0.8].map((t) => (
            <mesh key={t} position={[0, -glass.h / 2 + glass.h * t, 0]}>
              <boxGeometry args={[foot * 0.7, 0.08, foot * 0.56]} />
              <meshStandardMaterial color={NEGATIVE} emissive={NEGATIVE} emissiveIntensity={0.3} transparent opacity={0.45} />
            </mesh>
          ))}
        </group>
      )}
      {antenna && (
        <mesh position={[0, drawn + 3, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 6, 5]} />
          <meshStandardMaterial color={company.colors.accent} emissive={company.colors.accent} emissiveIntensity={2} />
        </mesh>
      )}
      <mesh
        position={[0, drawn / 2, 0]}
        onClick={(event) => {
          event.stopPropagation()
          const native = event.nativeEvent
          const moved = Math.hypot(native.clientX - down.current.x, native.clientY - down.current.y)
          if (moved < 5) onSelect(company.id)
        }}
        onPointerDown={(event) => {
          down.current.x = event.nativeEvent.clientX
          down.current.y = event.nativeEvent.clientY
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(company.id)
        }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[foot, drawn, foot]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      </group>
    </group>
  )
}
