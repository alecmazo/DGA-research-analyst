import { useLayoutEffect, useRef } from 'react'
import { Object3D } from 'three'
import type { InstancedMesh } from 'three'

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COUNT = 140

/** Distant blocks. One instanced draw. Seeded so the skyline does not reshuffle. */
export function FillerCity() {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const rand = mulberry32(7919)
    const dummy = new Object3D()
    for (let i = 0; i < COUNT; i += 1) {
      const ang = rand() * Math.PI * 2
      const radius = 150 + rand() * 90
      const h = 4 + rand() * 16
      dummy.position.set(Math.cos(ang) * radius, h / 2, Math.sin(ang) * radius)
      dummy.scale.set(2 + rand() * 4, h, 2 + rand() * 4)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#12141c" emissive="#1c3a4a" emissiveIntensity={0.35} roughness={0.8} metalness={0.4} />
    </instancedMesh>
  )
}
