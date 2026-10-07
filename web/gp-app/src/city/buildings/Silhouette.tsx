import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, MeshStandardMaterial } from 'three'
import { cityTime, makeNeonMaterial, makeWindowMaterial } from '../materials'

type Props = {
  kind: string
  height: number
  foot: number
  base: string
  primary: string
  accent: string
  motion: boolean
  spin: boolean
  flicker: number
}

function useMats(base: string, primary: string, accent: string) {
  const body = useRef<MeshStandardMaterial>(null)
  const neon = useRef<MeshStandardMaterial>(null)
  if (!body.current) body.current = makeWindowMaterial(base, primary, 0.4)
  if (!neon.current) neon.current = makeNeonMaterial(accent)
  useLayoutEffect(() => {
    const b = body.current
    const n = neon.current
    return () => {
      b?.dispose()
      n?.dispose()
    }
  }, [])
  return { body: body.current, neon: neon.current }
}

/** Procedural silhouettes. Local +y is up. The base sits on y = 0. */
const BODY_GLOW = 0.4
const NEON_GLOW = 2.4

export function Silhouette(props: Props) {
  const { kind, height: h, foot: f, motion, spin, flicker } = props
  const mats = useMats(props.base, props.primary, props.accent)
  const halo = useRef<Group>(null)
  const rotor = useRef<Group>(null)
  if (!motion || flicker <= 0) {
    if (mats.neon.emissiveIntensity !== NEON_GLOW) {
      mats.neon.emissiveIntensity = NEON_GLOW
      mats.body.emissiveIntensity = BODY_GLOW
    }
  }
  useFrame((_, dt) => {
    if (motion && spin) {
      if (halo.current) halo.current.rotation.y += dt * 0.3
      if (rotor.current) rotor.current.rotation.y += dt * 0.5
    }
    if (!motion || flicker <= 0) return
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(cityTime.value * 11))
    mats.neon.emissiveIntensity = NEON_GLOW * pulse
    mats.body.emissiveIntensity = BODY_GLOW * (0.4 + 0.6 * pulse)
  })

  if (kind === 'cash_plaza') {
    const crystal = Math.max(h, 18)
    return (
      <group>
        <mesh position={[0, 0.45, 0]} material={mats.body}>
          <cylinderGeometry args={[f * 0.62, f * 0.7, 0.9, 6]} />
        </mesh>
        <mesh position={[0, crystal * 0.5 + 0.8, 0]} material={mats.neon}>
          <octahedronGeometry args={[Math.min(f * 0.22, 4), 0]} />
        </mesh>
        <mesh position={[0, 1.05, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.neon}>
          <torusGeometry args={[f * 0.5, 0.12, 8, 6]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'financial_monolith') {
    const steps = [1, 0.78, 0.56, 0.36]
    let y = 0
    return (
      <group>
        {steps.map((scale, i) => {
          const bh = h * (i === 0 ? 0.42 : 0.16)
          const w = f * scale
          const mid = y + bh / 2
          y += bh
          return (
            <group key={scale}>
              <mesh position={[0, mid, 0]} material={mats.body}>
                <boxGeometry args={[w, bh, w * 0.82]} />
              </mesh>
              <mesh position={[0, y, 0]} material={mats.neon}>
                <boxGeometry args={[w * 1.04, 0.35, w * 0.86]} />
              </mesh>
            </group>
          )
        })}
      </group>
    )
  }

  if (kind === 'comm_spire') {
    return (
      <group>
        <mesh position={[0, h * 0.38, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.42, h * 0.76, f * 0.42]} />
        </mesh>
        <mesh position={[0, h * 0.9, 0]} material={mats.neon}>
          <cylinderGeometry args={[0.15, f * 0.16, h * 0.28, 6]} />
        </mesh>
        <mesh position={[f * 0.28, h * 0.72, 0]} rotation={[0.4, 0, 0]} material={mats.neon}>
          <sphereGeometry args={[f * 0.1, 10, 8]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'energy_reactor') {
    return (
      <group>
        <mesh position={[0, h * 0.36, 0]} material={mats.body}>
          <cylinderGeometry args={[f * 0.28, f * 0.34, h * 0.7, 8]} />
        </mesh>
        <mesh position={[0, h * 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.neon}>
          <torusGeometry args={[f * 0.42, 0.16, 8, 10]} />
        </mesh>
        <group ref={rotor} position={[0, h * 0.78, 0]}>
          <mesh material={mats.neon}>
            <boxGeometry args={[f * 0.9, 0.2, 0.2]} />
          </mesh>
          <mesh material={mats.neon}>
            <boxGeometry args={[0.2, 0.2, f * 0.9]} />
          </mesh>
        </group>
      </group>
    )
  }

  if (kind === 'aero_gantry') {
    return (
      <group>
        <mesh position={[0, h * 0.22, 0]} material={mats.body}>
          <boxGeometry args={[f, h * 0.42, f * 0.7]} />
        </mesh>
        <mesh position={[-f * 0.42, h * 0.5, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.14, h, f * 0.14]} />
        </mesh>
        <mesh position={[f * 0.42, h * 0.5, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.14, h, f * 0.14]} />
        </mesh>
        <mesh position={[0, h * 0.96, 0]} material={mats.neon}>
          <boxGeometry args={[f * 1.05, 0.4, f * 0.2]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'health_biomorph') {
    return (
      <group>
        {[0.22, 0.5, 0.78].map((t, i) => (
          <mesh key={t} position={[(i - 1) * f * 0.08, h * t, 0]} material={mats.body}>
            <sphereGeometry args={[f * (0.34 - i * 0.04), 16, 12]} />
          </mesh>
        ))}
        <mesh position={[0, h * 0.5, 0]} material={mats.neon}>
          <torusGeometry args={[f * 0.4, 0.08, 8, 12]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'consumer_flagship') {
    return (
      <group>
        <mesh position={[0, h * 0.08, 0]} material={mats.body}>
          <boxGeometry args={[f * 1.15, h * 0.16, f * 0.9]} />
        </mesh>
        <mesh position={[0, h * 0.48, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.62, h * 0.62, f * 0.62]} />
        </mesh>
        <mesh position={[0, h * 0.2, f * 0.46]} material={mats.neon}>
          <boxGeometry args={[f * 0.7, h * 0.06, 0.2]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'industrial_steel') {
    return (
      <group>
        <mesh position={[0, h * 0.4, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.9, h * 0.8, f * 0.7]} />
        </mesh>
        <mesh position={[0, h * 0.86, 0]} rotation={[0, 0, 0.4]} material={mats.neon}>
          <boxGeometry args={[f * 0.95, 0.16, 0.16]} />
        </mesh>
        <mesh position={[0, h * 0.86, 0]} rotation={[0, 0, -0.4]} material={mats.neon}>
          <boxGeometry args={[f * 0.95, 0.16, 0.16]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'speculative_beacon') {
    return (
      <group>
        <mesh position={[0, h * 0.42, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.32, h * 0.84, f * 0.32]} />
        </mesh>
        <mesh position={[f * 0.36, h * 0.78, 0]} material={mats.neon}>
          <boxGeometry args={[f * 0.7, 0.18, 0.18]} />
        </mesh>
        <mesh position={[0, h * 0.96, 0]} material={mats.neon}>
          <sphereGeometry args={[0.55, 10, 8]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'consumer_staples_market') {
    return (
      <group>
        <mesh position={[0, h * 0.22, 0]} material={mats.body}>
          <boxGeometry args={[f * 1.2, h * 0.4, f * 0.8]} />
        </mesh>
        {[ -0.28, 0, 0.28 ].map((x) => (
          <mesh key={x} position={[f * x, h * 0.46, 0]} material={mats.neon}>
            <boxGeometry args={[f * 0.08, h * 0.16, f * 0.82]} />
          </mesh>
        ))}
      </group>
    )
  }

  if (kind === 'utility_grid') {
    return (
      <group>
        <mesh position={[0, h * 0.16, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.9, h * 0.28, f * 0.7]} />
        </mesh>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[f * x, h * 0.55, 0]} material={mats.neon}>
            <cylinderGeometry args={[0.12, 0.12, h * 0.7, 5]} />
          </mesh>
        ))}
        <mesh position={[0, h * 0.84, 0]} material={mats.neon}>
          <boxGeometry args={[f * 0.85, 0.12, 0.12]} />
        </mesh>
      </group>
    )
  }

  if (kind === 'tech_neon') {
    const slabs = [
      { y: h * 0.28, w: f, bh: h * 0.5 },
      { y: h * 0.66, w: f * 0.72, bh: h * 0.26 },
      { y: h * 0.86, w: f * 0.46, bh: h * 0.14 },
    ]
    return (
      <group>
        {slabs.map((slab) => (
          <mesh key={slab.y} position={[0, slab.y, 0]} material={mats.body}>
            <boxGeometry args={[slab.w, slab.bh, slab.w * 0.78]} />
          </mesh>
        ))}
        <group ref={halo} position={[0, h * 0.93, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.neon}>
            <torusGeometry args={[f * 0.34, 0.1, 8, 16]} />
          </mesh>
        </group>
      </group>
    )
  }

  const stepped = kind === 'realestate_terrace'
  return (
    <group>
      <mesh position={[0, h * 0.32, 0]} material={mats.body}>
        <boxGeometry args={[f, h * 0.64, f * 0.8]} />
      </mesh>
      {stepped && (
        <mesh position={[0, h * 0.7, 0]} material={mats.body}>
          <boxGeometry args={[f * 0.7, h * 0.16, f * 0.55]} />
        </mesh>
      )}
      <mesh position={[f * 0.22, h * 0.78, 0]} material={mats.neon}>
        <boxGeometry args={[f * 0.16, h * 0.22, f * 0.16]} />
      </mesh>
    </group>
  )
}
