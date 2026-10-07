/** Sea color and wave shape. t = 1 is perfect weather, t = 0 is the worst. */

export type Rgb = [number, number, number]

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0.6
  return Math.min(1, Math.max(0, t))
}

export function mix(from: Rgb, to: Rgb, t: number): string {
  const u = clamp01(t)
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * u))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export type SeaPaint = {
  t: number
  chop: number
  skyTop: string
  skyHigh: string
  skyHorizon: string
  deep: string
  mid: string
  lit: string
  cloud: string
  sun: string
  sunY: number
  sunOpacity: number
  sunR: number
  rain: number
  amp: number
  freq: number
  glitter: number
  bob: number
  roll: number
  whitecap: number
  shade: number
  displace: number
  turbulence: number
  spray: number
  reflection: number
}

export function seaPaint(t: number): SeaPaint {
  const u = clamp01(t)
  const chop = 1 - u
  return {
    t: u,
    chop,
    skyTop: mix([16, 22, 34], [92, 176, 232], u),
    skyHigh: mix([28, 38, 54], [142, 206, 240], u),
    skyHorizon: mix([42, 52, 66], [255, 214, 158], u),
    deep: mix([5, 10, 18], [3, 72, 104], u),
    mid: mix([12, 24, 38], [14, 124, 154], u),
    lit: mix([24, 38, 54], [118, 204, 214], u),
    cloud: mix([54, 62, 74], [255, 255, 255], u),
    sun: mix([186, 196, 210], [255, 236, 186], u),
    sunY: 236 + chop * 186,
    sunOpacity: 0.1 + u * 0.9,
    sunR: 24 + u * 30,
    rain: Math.max(0, (0.4 - u) / 0.4),
    amp: 2.5 + chop * 28,
    freq: 0.72 + chop * 1.15,
    glitter: u,
    bob: 1.6 + chop * 9.5,
    roll: chop * 1.25,
    whitecap: 0.08 + chop * 0.92,
    shade: chop * 0.48,
    displace: 0.8 + chop * 20,
    turbulence: 0.003 + chop * 0.02,
    spray: 0.12 + chop * 0.78,
    reflection: 0.05 + u * 0.22,
  }
}

const SPAN = 1400

function waveY(x: number, y: number, amp: number, freq: number, phase: number): number {
  const primary = Math.sin((x / SPAN) * Math.PI * 2 * freq + phase) * amp
  const cross = Math.sin((x / SPAN) * Math.PI * 2 * freq * 1.8 + phase * 1.4) * amp * 0.16
  return y + primary + cross
}

export function crestPath(
  y: number,
  amp: number,
  freq: number,
  phase: number,
  x0 = -180,
  x1 = 1580,
  step = 16,
): string {
  let d = ''
  for (let x = x0; x <= x1; x += step) {
    const yy = waveY(x, y, amp, freq, phase)
    d += `${d ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`
  }
  return d
}

export function wavePath(
  y: number,
  amp: number,
  freq: number,
  phase: number,
  x0 = -180,
  x1 = 1580,
  bottom = 860,
): string {
  return `${crestPath(y, amp, freq, phase, x0, x1)} L${x1} ${bottom} L${x0} ${bottom} Z`
}

export function pathYRange(d: string): number {
  const ys: number[] = []
  for (const match of d.matchAll(/[ML](-?\d+\.?\d*) (-?\d+\.?\d*)/g)) {
    ys.push(Number(match[2]))
  }
  if (!ys.length) return 0
  return Math.max(...ys) - Math.min(...ys)
}

export function raindrops(n = 56): { x1: number; y1: number; x2: number; y2: number }[] {
  const drops = []
  for (let i = 0; i < n; i += 1) {
    const x = (i * 137) % 1480 - 40
    const y = (i * 89) % 460
    drops.push({ x1: x, y1: y, x2: x - 14, y2: y + 36 })
  }
  return drops
}
