import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import { CatmullRomCurve3, Vector3 } from 'three'
import { panVector } from './frame'
import type { CityCompany } from '../schema'
import { shownHeight, type Metric } from '../metrics'

type Props = {
  companies: CityCompany[]
  metric: Metric
  selectedId: string | null
  flyover: boolean
  motion: boolean
  resetNonce: number
  onSelect: (id: string | null) => void
  onFlyover: (on: boolean) => void
}

type OrbitLike = {
  target: Vector3
  enabled: boolean
  update: () => void
  rotateLeft: (angle: number) => void
}

const _dir = new Vector3()
const _pan = new Vector3()
const _focusFrom = new Vector3()
const _focusTo = new Vector3()
const _camFrom = new Vector3()
const _camTo = new Vector3()
const _offset = new Vector3()

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function Rig({ companies, metric, selectedId, flyover, motion, resetNonce, onSelect, onFlyover }: Props) {
  const camera = useThree((state) => state.camera)
  const controls = useRef<OrbitLike>(null)
  const keys = useRef(new Set<string>())
  const focus = useRef<{ t0: number; dur: number } | null>(null)
  const flyU = useRef(0)
  const curve = useRef<CatmullRomCurve3 | null>(null)
  if (!curve.current) {
    curve.current = new CatmullRomCurve3([
      new Vector3(150, 72, 20),
      new Vector3(20, 96, 150),
      new Vector3(-150, 64, 10),
      new Vector3(-10, 88, -150),
    ], true)
  }

  useEffect(() => {
    const ctrl = controls.current
    if (!ctrl || resetNonce === 0) return
    ctrl.target.set(0, 12, 0)
    camera.position.set(0, 78, 168)
    focus.current = null
  }, [resetNonce, camera])

  useEffect(() => {
    const company = companies.find((item) => item.id === selectedId)
    const ctrl = controls.current
    if (!company || !ctrl) {
      focus.current = null
      return
    }
    const height = shownHeight(company, metric)
    _focusFrom.copy(ctrl.target)
    _focusTo.set(company.position.x, height * 0.35, company.position.z)
    _offset.copy(camera.position).sub(ctrl.target)
    const dist = Math.max(26, Math.min(_offset.length(), 78))
    if (_offset.lengthSq() < 1e-6) _offset.set(0, 40, 70)
    _offset.normalize()
    _camFrom.copy(camera.position)
    _camTo.copy(_focusTo).addScaledVector(_offset, dist)
    focus.current = { t0: performance.now(), dur: motion ? 1200 : 300 }
  }, [selectedId, companies, metric, camera, motion])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return
      keys.current.add(event.code)
      const ctrl = controls.current
      if (!ctrl) return
      if (event.code === 'KeyF') {
        onFlyover(!flyover)
        return
      }
      if (event.code !== 'KeyF') onFlyover(false)
      if (event.code === 'KeyR') {
        ctrl.target.set(0, 12, 0)
        camera.position.set(0, 78, 168)
        onSelect(null)
      } else if (event.code === 'Escape') {
        onSelect(null)
      } else if (event.code === 'KeyQ') {
        ctrl.rotateLeft(0.08)
      } else if (event.code === 'KeyE') {
        ctrl.rotateLeft(-0.08)
      } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        _offset.copy(camera.position).sub(ctrl.target).multiplyScalar(0.88)
        camera.position.copy(ctrl.target).add(_offset)
      } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        _offset.copy(camera.position).sub(ctrl.target).multiplyScalar(1.12)
        camera.position.copy(ctrl.target).add(_offset)
      } else if (event.code === 'BracketRight' || event.code === 'BracketLeft') {
        if (!companies.length) return
        const index = companies.findIndex((item) => item.id === selectedId)
        const step = event.code === 'BracketRight' ? 1 : -1
        const next = companies[(index + step + companies.length) % companies.length]
        onSelect(next.id)
      }
    }
    const up = (event: KeyboardEvent) => keys.current.delete(event.code)
    const stopFly = () => onFlyover(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('pointerdown', stopFly)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('pointerdown', stopFly)
    }
  }, [camera, companies, flyover, onFlyover, onSelect, selectedId])

  useFrame((_, dt) => {
    const ctrl = controls.current
    if (!ctrl) return
    const now = performance.now()
    const tween = focus.current
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.dur)
      const e = ease(t)
      ctrl.target.lerpVectors(_focusFrom, _focusTo, e)
      camera.position.lerpVectors(_camFrom, _camTo, e)
      if (t >= 1) focus.current = null
    }
    let forward = 0
    let strafe = 0
    const held = keys.current
    if (held.has('KeyW') || held.has('ArrowUp')) forward += 1
    if (held.has('KeyS') || held.has('ArrowDown')) forward -= 1
    if (held.has('KeyD') || held.has('ArrowRight')) strafe += 1
    if (held.has('KeyA') || held.has('ArrowLeft')) strafe -= 1
    if (forward || strafe) {
      camera.getWorldDirection(_dir)
      panVector(_dir.x, _dir.y, _dir.z, forward, strafe, _pan)
      const speed = (held.has('ShiftLeft') || held.has('ShiftRight') ? 52 : 20) * dt
      ctrl.target.addScaledVector(_pan, speed)
      camera.position.addScaledVector(_pan, speed)
    } else if (flyover && motion && !tween) {
      ctrl.enabled = false
      flyU.current = (flyU.current + dt / 48) % 1
      curve.current?.getPointAt(flyU.current, camera.position)
      camera.lookAt(0, 16, 0)
    } else {
      ctrl.enabled = true
    }
  })

  return (
    <MapControls
      ref={controls as never}
      makeDefault
      maxPolarAngle={Math.PI * 0.47}
      minPolarAngle={0.18}
      minDistance={16}
      maxDistance={380}
      enableDamping
      dampingFactor={0.08}
      target={[0, 12, 0]}
    />
  )
}
