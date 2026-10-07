import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { EffectComposer, Bloom, SMAA, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { AmbientLight, Color, DirectionalLight, HemisphereLight, Vector2 } from 'three'
import type { Points } from 'three'
import { cityMotion, cityNight, cityTime } from '../materials'

const NIGHT = new Color('#070814')
const DAY = new Color('#c5d4e8')

export function DayNight({ night, motion }: { night: boolean; motion: boolean }) {
  const mix = useRef(night ? 1 : 0)
  const amb = useRef<AmbientLight>(null)
  const sun = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const fog = useThree((state) => state.scene.fog)
  useFrame((_, dt) => {
    cityTime.value += motion ? dt : 0
    cityMotion.value = motion ? 1 : 0
    const target = night ? 1 : 0
    mix.current = motion ? mix.current + (target - mix.current) * Math.min(1, dt / 0.8) : target
    cityNight.value = mix.current
    const n = mix.current
    if (amb.current) amb.current.intensity = 0.12 + (1 - n) * 0.38
    if (sun.current) sun.current.intensity = 0.28 + (1 - n) * 1.15
    if (hemi.current) hemi.current.intensity = 0.2 + (1 - n) * 0.65
    if (fog && 'color' in fog && fog.color) {
      fog.color.copy(NIGHT).lerp(DAY, 1 - n)
    }
    if (fog && 'density' in fog) fog.density = 0.0035 + n * 0.0055
  })
  return (
    <>
      <hemisphereLight ref={hemi} args={['#243056', '#070814', 0.25]} />
      <ambientLight ref={amb} intensity={0.15} />
      <directionalLight ref={sun} position={[70, 110, 40]} intensity={0.35} />
    </>
  )
}

export function Ground({ reflect }: { reflect: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <planeGeometry args={[560, 560]} />
      {reflect ? (
        <MeshReflectorMaterial
          mirror={0.26}
          mixBlur={1}
          mixStrength={0.4}
          roughness={0.92}
          color="#070910"
          blur={[256, 100]}
          resolution={512}
          metalness={0.55}
        />
      ) : (
        <meshStandardMaterial color="#090b12" roughness={0.96} metalness={0.15} />
      )}
    </mesh>
  )
}

const DROPS = 640

export function Rain() {
  const ref = useRef<Points>(null)
  const positions = useMemo(() => {
    const arr = new Float32Array(DROPS * 3)
    for (let i = 0; i < DROPS; i += 1) {
      arr[i * 3] = (Math.random() - 0.5) * 300
      arr[i * 3 + 1] = Math.random() * 110
      arr[i * 3 + 2] = (Math.random() - 0.5) * 300
    }
    return arr
  }, [])
  useFrame((_, dt) => {
    const attr = ref.current?.geometry.getAttribute('position')
    if (!attr) return
    for (let i = 0; i < DROPS; i += 1) {
      let y = attr.getY(i) - dt * 32
      if (y < 0) y = 90 + Math.random() * 30
      attr.setY(i, y)
    }
    attr.needsUpdate = true
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#9fd7ff" size={0.35} transparent opacity={0.45} depthWrite={false} />
    </points>
  )
}

export function Post({ night, mobile }: { night: boolean; mobile: boolean }) {
  const offset = useMemo(() => new Vector2(0.0006, 0.0008), [])
  return (
    <EffectComposer multisampling={mobile ? 0 : 2} enableNormalPass={false}>
      <Bloom
        intensity={mobile ? 0.4 : night ? 1.15 : 0.26}
        luminanceThreshold={0.2}
        mipmapBlur
        resolutionScale={mobile ? 0.5 : 1}
      />
      {!mobile && <SMAA />}
      <Vignette eskil={false} offset={0.16} darkness={night ? 0.72 : 0.32} />
      {!mobile && <ChromaticAberration offset={offset} />}
    </EffectComposer>
  )
}
