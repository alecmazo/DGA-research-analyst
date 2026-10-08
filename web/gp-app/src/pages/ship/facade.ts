/** Painted fallback for the vault and the copper block, and for a photo that fails to load. */

function mulberry(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const value = Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)))
    return value.toString(16).padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

const WALL: Record<string, string> = {
  glass: '#2c74c2',
  stone: '#e4d0ac',
  brick: '#8a4032',
  sand: '#c6a56e',
  rose: '#f0cfd1',
  power: '#6e5948',
  industrial: '#d5d7d2',
  white: '#f3f4f5',
  vault: '#a4a69f',
  copper: '#b56b43',
}

function windows(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  frame: string,
  glass: string,
) {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const px = x + col * cellW + cellW * 0.18
      const py = y + row * cellH + cellH * 0.16
      const ww = cellW * 0.64
      const wh = cellH * 0.62
      ctx.fillStyle = frame
      ctx.fillRect(px, py, ww, wh)
      const grad = ctx.createLinearGradient(px, py, px + ww, py + wh)
      grad.addColorStop(0, '#f7fbff')
      grad.addColorStop(0.35, glass)
      grad.addColorStop(1, shade(glass, 0.72))
      ctx.fillStyle = grad
      ctx.fillRect(px + 3, py + 3, ww - 6, wh - 6)
      ctx.fillStyle = frame
      ctx.fillRect(px + ww / 2 - 1, py, 2, wh)
    }
  }
}

function drawVault(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) {
  ctx.fillStyle = '#a3a59e'
  ctx.fillRect(0, 0, w, h)
  const bw = 86
  const bh = 48
  for (let y = 0; y < h; y += bh) {
    const off = (Math.floor(y / bh) % 2) * 28
    for (let x = -bw; x < w; x += bw) {
      ctx.fillStyle = rand() > 0.5 ? '#b0b2ab' : '#989a93'
      ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4)
    }
  }
  windows(ctx, 18, 20, 4, 3, 120, 100, '#dedcd4', '#7f8d98')
  ctx.fillStyle = '#7e807a'
  ctx.fillRect(0, h - 36, w, 36)
}

function drawCopper(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) {
  ctx.fillStyle = '#b56b43'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 1800; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,220,180,0.08)' : 'rgba(80,30,10,0.08)'
    ctx.fillRect(rand() * w, rand() * h, 3, 2)
  }
  ctx.strokeStyle = '#8a4e30'
  ctx.lineWidth = 4
  for (let x = 0; x <= w; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y <= h; y += h / 2) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  windows(ctx, 10, 16, 6, 2, 82, h / 2 - 8, '#6d3e28', '#d7e4ee')
}

function drawGeneric(ctx: CanvasRenderingContext2D, w: number, h: number, kind: string, rand: () => number) {
  const wall = WALL[kind] || '#d9d3c6'
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(rand() * w, rand() * h, 2, 2)
  }
  const frame = kind === 'glass' ? '#d5dde6' : shade(wall, 0.55)
  const glass = kind === 'glass' ? '#b9ddf5' : '#c5d5e2'
  windows(ctx, 8, 8, 6, 3, (w - 16) / 6, (h - 16) / 3, frame, glass)
}

export function paintFacade(kind: string, slot: 'upper' | 'base'): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = slot === 'base' ? 280 : 384
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const rand = mulberry(kind.length * 31 + (slot === 'base' ? 5 : 11))
  if (kind === 'vault') drawVault(ctx, canvas.width, canvas.height, rand)
  else if (kind === 'copper') drawCopper(ctx, canvas.width, canvas.height, rand)
  else drawGeneric(ctx, canvas.width, canvas.height, kind, rand)
  return canvas
}

export function paintSky(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const sky = ctx.createLinearGradient(0, 0, 0, 1024)
  sky.addColorStop(0, '#4e92d0')
  sky.addColorStop(0.42, '#8ec4ee')
  sky.addColorStop(0.72, '#d5ecfa')
  sky.addColorStop(1, '#f4f0e6')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 2048, 1024)
  const rand = mulberry(19)
  for (let i = 0; i < 7; i += 1) {
    const x = rand() * 2048
    const y = 620 + rand() * 280
    const rx = 90 + rand() * 180
    const ry = 18 + rand() * 28
    ctx.fillStyle = `rgba(255,255,255,${0.18 + rand() * 0.22})`
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvas
}

export function paintGrass(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const field = ctx.createLinearGradient(0, 0, 512, 512)
  field.addColorStop(0, '#d5d7b8')
  field.addColorStop(0.45, '#c9d2a4')
  field.addColorStop(1, '#b7c48e')
  ctx.fillStyle = field
  ctx.fillRect(0, 0, 512, 512)
  const rand = mulberry(41)
  for (let i = 0; i < 80; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,90,40,0.05)'
    ctx.fillRect(rand() * 512, rand() * 512, 40 + rand() * 80, 24 + rand() * 40)
  }
  return canvas
}
