import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  EquirectangularReflectionMapping,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  PMREMGenerator,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { facadeKind, frameDistance, layoutCampus, massTiers, MIN_ZOOM, type FacadeKind } from './campus'
import { paintFacade, paintGrass, paintSky } from './facade'
import type { ShipSector } from './ShipScene'

type Props = {
  sectors: ShipSector[]
  active: string | null
  hover: string | null
  onSelect: (part: string | null) => void
  onHover: (part: string | null) => void
}

type TexSpec = {
  upper: string
  base?: string
  /** World size of one upper-facade repeat. Matches the photo aspect so windows are not stretched. */
  tileW: number
  tileH: number
  baseW?: number
  baseH?: number
  metalness: number
  roughness: number
  roof: string
}

const TEX: Record<FacadeKind, TexSpec> = {
  glass: { upper: 'glass.jpg', tileW: 11, tileH: 9.3, metalness: 0.42, roughness: 0.18, roof: '#1a3c5c' },
  stone: { upper: 'stone-upper.jpg', base: 'stone-base.jpg', tileW: 16, tileH: 3.2, baseW: 14, baseH: 5, metalness: 0.04, roughness: 0.88, roof: '#c9b79a' },
  brick: { upper: 'brick-upper.jpg', base: 'brick-base.jpg', tileW: 22, tileH: 2.6, baseW: 16, baseH: 3.2, metalness: 0.03, roughness: 0.86, roof: '#6a4038' },
  sand: { upper: 'sand.jpg', tileW: 12, tileH: 6.8, metalness: 0.03, roughness: 0.84, roof: '#a88462' },
  rose: { upper: 'rose.jpg', tileW: 12, tileH: 6.8, metalness: 0.02, roughness: 0.9, roof: '#d7aeb2' },
  power: { upper: 'power.jpg', tileW: 14, tileH: 7.9, metalness: 0.08, roughness: 0.8, roof: '#5c4e42' },
  industrial: { upper: 'industrial.jpg', tileW: 14, tileH: 6.6, metalness: 0.38, roughness: 0.46, roof: '#b9a56a' },
  white: { upper: 'white.jpg', tileW: 14, tileH: 7.9, metalness: 0.28, roughness: 0.4, roof: '#d5d8dc' },
  vault: { upper: '', tileW: 9, tileH: 6.8, metalness: 0.12, roughness: 0.72, roof: '#8d9094' },
  copper: { upper: '', tileW: 9, tileH: 6.8, metalness: 0.48, roughness: 0.38, roof: '#8d5a3a' },
}

function tileRepeat(spec: TexSpec, faceW: number, faceH: number, slot: 'upper' | 'base'): [number, number] {
  const tileW = slot === 'base' ? spec.baseW || spec.tileW : spec.tileW
  const tileH = slot === 'base' ? spec.baseH || spec.tileH : spec.tileH
  return [Math.max(0.65, faceW / tileW), Math.max(0.65, faceH / tileH)]
}

type View = {
  host: HTMLElement
  groups: Group[]
  pads: Mesh[]
}

function tintFor(part: string): string {
  if (part === 'engine') return '#8d8882'
  if (part === 'market') return '#f3f0e8'
  if (part === 'midship') return '#e8c4a6'
  return '#ffffff'
}

function hexOf(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}

function mix(a: string, b: string, t: number): string {
  const pa = hexOf(a)
  const pb = hexOf(b)
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  const h = (value: number) => value.toString(16).padStart(2, '0')
  return `#${h(ch(16))}${h(ch(8))}${h(ch(0))}`
}

function shade(hex: string, k: number): string {
  const n = hexOf(hex)
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)))
  const h = (value: number) => value.toString(16).padStart(2, '0')
  return `#${h(ch(16))}${h(ch(8))}${h(ch(0))}`
}

function applyLit(view: View | null, active: string | null, hover: string | null) {
  if (!view) return
  const lit = hover || active
  view.host.classList.toggle('is-dim', Boolean(lit))
  const paint = (object: Object3D, on: boolean) => {
    const list = object.userData.mats as MeshStandardMaterial[] | undefined
    if (!list) return
    for (const mat of list) {
      const hex = String(mat.userData.hex || '#ffffff')
      mat.color.set(lit && !on ? shade(hex, 0.62) : hex)
      mat.emissive.set(on ? String(object.userData.color || '#ffffff') : '#000000')
      mat.emissiveIntensity = on ? 0.16 : 0
    }
  }
  for (const group of view.groups) {
    const on = lit != null && group.userData.part === lit
    paint(group, on)
    const labels = group.userData.labels as HTMLElement[] | undefined
    labels?.forEach((el) => el.classList.toggle('is-hot', on))
  }
  for (const pad of view.pads) {
    const on = lit != null && pad.userData.part === lit
    paint(pad, on)
    const hood = pad.userData.hood as HTMLElement | undefined
    hood?.classList.toggle('is-hot', on)
  }
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right + 6 && a.right > b.left - 6 && a.top < b.bottom + 4 && a.bottom > b.top - 4
}

/** Keep the tallest company names and the neighborhood names when pills would stack. */
function settleLabels(root: HTMLElement) {
  const nodes = [...root.querySelectorAll<HTMLElement>('.dga-campus-tag, .dga-campus-hood')]
  const placed: DOMRect[] = []
  const ranked = nodes
    .map((el) => ({
      el,
      pri: Number(el.dataset.pri || 0) + (el.classList.contains('is-hot') ? 500 : 0),
      rect: el.getBoundingClientRect(),
    }))
    .sort((a, b) => b.pri - a.pri || (a.el.textContent || '').localeCompare(b.el.textContent || ''))
  const host = root.getBoundingClientRect()
  for (const item of ranked) {
    const rect = item.rect
    const outside = rect.right < host.left || rect.left > host.right || rect.bottom < host.top || rect.top > host.bottom
    const hit = !outside && placed.some((other) => overlaps(rect, other))
    item.el.style.visibility = outside || hit || rect.width < 2 ? 'hidden' : 'visible'
    if (item.el.style.visibility === 'visible') placed.push(rect)
  }
}

function partOf(object: Object3D): string | null {
  let current: Object3D | null = object
  while (current) {
    const part = current.userData?.part
    if (typeof part === 'string') return part
    current = current.parent
  }
  return null
}

export function ShipCampus({ sectors, active, hover, onSelect, onHover }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const onSelectRef = useRef(onSelect)
  const onHoverRef = useRef(onHover)
  const activeRef = useRef(active)
  const hoverRef = useRef(hover)
  const [failed, setFailed] = useState(false)
  const [gen, setGen] = useState(0)
  onSelectRef.current = onSelect
  onHoverRef.current = onHover
  activeRef.current = active
  hoverRef.current = hover

  const sceneKey = sectors.map((sector) => [
    sector.part,
    sector.name,
    sector.color,
    ...sector.holdings.map((holding) => `${holding.symbol}@${holding.market_cap ?? ''}`),
  ].join(',')).join('|')
  const sectorsRef = useRef(sectors)
  sectorsRef.current = sectors

  useEffect(() => {
    applyLit(viewRef.current, active, hover)
  }, [active, hover, gen])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sectorsNow = sectorsRef.current
    const layout = layoutCampus(sectorsNow.map((sector) => ({
      part: sector.part,
      holdings: sector.holdings.map((holding) => ({
        symbol: holding.symbol,
        market_cap: holding.market_cap ?? null,
      })),
    })))
    const meta = new Map<string, ShipSector>(sectorsNow.map((sector) => [sector.part, sector]))
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      setFailed(true)
      return
    }
    const dprCap = (host.clientWidth || 1200) < 900 ? 1.5 : 2
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.setClearColor('#8ec8f0')
    host.appendChild(renderer.domElement)

    const labels = new CSS2DRenderer()
    labels.domElement.className = 'dga-campus-labels'
    host.appendChild(labels.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 0.1, 4000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.enableZoom = true
    controls.zoomToCursor = true
    controls.autoRotate = false
    controls.minPolarAngle = 0.18
    controls.maxPolarAngle = Math.PI / 2 - 0.06
    controls.zoomSpeed = 1
    controls.minDistance = MIN_ZOOM

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onReduce = () => {
      controls.enableDamping = !reduce.matches
    }
    reduce.addEventListener('change', onReduce)

    const box = new BoxGeometry(1, 1, 1)
    const cyl = new CylinderGeometry(1, 1.12, 1, 14)
    const trunkGeo = new CylinderGeometry(0.18, 0.26, 2.1, 6)
    const canopyGeo = new SphereGeometry(1.2, 8, 6)
    const groundGeo = new PlaneGeometry(1, 1)
    const geos = [box, cyl, trunkGeo, canopyGeo, groundGeo]
    const mats: Material[] = []
    const maps: Texture[] = []
    const groups: Group[] = []
    const pads: Mesh[] = []

    const grass = new CanvasTexture(paintGrass())
    grass.colorSpace = SRGBColorSpace
    grass.wrapS = RepeatWrapping
    grass.wrapT = RepeatWrapping
    maps.push(grass)

    const span = Math.max(layout.bounds.maxX - layout.bounds.minX, layout.bounds.maxZ - layout.bounds.minZ, 48)
    const cx = (layout.bounds.minX + layout.bounds.maxX) / 2
    const cz = (layout.bounds.minZ + layout.bounds.maxZ) / 2
    scene.add(new HemisphereLight('#e7f3ff', '#c6b48a', 0.95))
    const sun = new DirectionalLight('#fff4dc', 1.35)
    sun.position.set(cx - span * 0.72, span * 1.7, cz + span * 0.62)
    sun.castShadow = true
    sun.shadow.mapSize.set((host.clientWidth || 1200) < 900 ? 2048 : 4096, (host.clientWidth || 1200) < 900 ? 2048 : 4096)
    sun.shadow.bias = -0.00035
    sun.shadow.normalBias = 0.04
    const shadow = sun.shadow.camera
    shadow.left = -span * 1.2
    shadow.right = span * 1.2
    shadow.top = span * 1.2
    shadow.bottom = -span * 1.2
    shadow.near = 0.5
    shadow.far = span * 5
    sun.target.position.set(cx, 0, cz)
    scene.add(sun)
    scene.add(sun.target)
    const fill = new DirectionalLight('#d5e4f4', 0.55)
    fill.position.set(cx + span * 0.8, span * 0.7, cz + span * 0.2)
    scene.add(fill)

    const skyMap = new CanvasTexture(paintSky())
    skyMap.colorSpace = SRGBColorSpace
    const envMap = skyMap.clone()
    envMap.mapping = EquirectangularReflectionMapping
    envMap.needsUpdate = true
    maps.push(skyMap, envMap)
    const pmrem = new PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(envMap).texture
    scene.environment = env
    maps.push(env)
    let pmremOpen = true
    const dropPmrem = () => {
      if (!pmremOpen) return
      pmremOpen = false
      pmrem.dispose()
    }
    const skyGeo = new SphereGeometry(span * 9, 64, 40)
    geos.push(skyGeo)
    const skyMat = new MeshBasicMaterial({ map: skyMap, side: BackSide, depthWrite: false })
    mats.push(skyMat)
    const sky = new Mesh(skyGeo, skyMat)
    sky.position.set(cx, 0, cz)
    sky.renderOrder = -2
    scene.add(sky)

    const lawnW = Math.max(48, layout.bounds.maxX - layout.bounds.minX + 28)
    const lawnD = Math.max(48, layout.bounds.maxZ - layout.bounds.minZ + 28)
    grass.repeat.set(lawnW / 16, lawnD / 16)
    const grassMat = new MeshStandardMaterial({ map: grass, color: '#ffffff', roughness: 1, metalness: 0 })
    grassMat.userData.hex = '#ffffff'
    mats.push(grassMat)
    const farMat = new MeshStandardMaterial({ color: '#e6eadc', roughness: 1, metalness: 0 })
    farMat.userData.hex = '#e6eadc'
    mats.push(farMat)
    const far = new Mesh(groundGeo, farMat)
    // PlaneGeometry faces +z. A negative quarter-turn lays it on xz, facing +y.
    far.rotation.x = -Math.PI / 2
    far.position.set(cx, -0.04, cz)
    far.scale.set(span * 8, span * 8, 1)
    far.receiveShadow = true
    scene.add(far)
    const ground = new Mesh(groundGeo, grassMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(cx, 0, cz)
    ground.scale.set(lawnW, lawnD, 1)
    ground.receiveShadow = true
    scene.add(ground)

    const walkMat = new MeshStandardMaterial({ color: '#d7d1c4', roughness: 0.96 })
    walkMat.userData.hex = '#d7d1c4'
    mats.push(walkMat)
    const roadMat = new MeshStandardMaterial({ color: '#c9c3b6', roughness: 0.97 })
    roadMat.userData.hex = '#c9c3b6'
    mats.push(roadMat)
    const trunkMat = new MeshStandardMaterial({ color: '#6b4a32', roughness: 0.9 })
    trunkMat.userData.hex = '#6b4a32'
    mats.push(trunkMat)
    const leafA = new MeshStandardMaterial({ color: '#3f6c34', roughness: 0.9 })
    leafA.userData.hex = '#3f6c34'
    mats.push(leafA)
    const leafB = new MeshStandardMaterial({ color: '#4d7c3c', roughness: 0.9 })
    leafB.userData.hex = '#4d7c3c'
    mats.push(leafB)
    const concrete = new MeshStandardMaterial({ color: '#c2bbb2', roughness: 0.86 })
    concrete.userData.hex = '#c2bbb2'
    mats.push(concrete)
    const yellow = new MeshStandardMaterial({ color: '#e2b31c', roughness: 0.48, metalness: 0.25 })
    yellow.userData.hex = '#e2b31c'
    mats.push(yellow)
    const whiteMetal = new MeshStandardMaterial({ color: '#f4f7f8', roughness: 0.4, metalness: 0.2 })
    whiteMetal.userData.hex = '#f4f7f8'
    mats.push(whiteMetal)
    const poleMat = new MeshStandardMaterial({ color: '#8e99a3', roughness: 0.45, metalness: 0.35 })
    poleMat.userData.hex = '#8e99a3'
    mats.push(poleMat)

    const addTree = (x: number, z: number, salt: number) => {
      const trunk = new Mesh(trunkGeo, trunkMat)
      trunk.position.set(x, 1.05, z)
      trunk.castShadow = true
      const canopy = new Mesh(canopyGeo, salt % 2 ? leafA : leafB)
      canopy.position.set(x, 2.85, z)
      canopy.scale.set(1.2, 0.82, 1.2)
      canopy.castShadow = true
      const side = new Mesh(canopyGeo, salt % 2 ? leafB : leafA)
      side.position.set(x + 0.85, 2.35, z + 0.4)
      side.scale.set(0.72, 0.55, 0.72)
      side.castShadow = true
      scene.add(trunk, canopy, side)
    }

    let cancelled = false
    let frame = 0
    let stop = false
    const sunDir = new Vector3(-0.72, 1.7, 0.62).normalize()
    const tick = () => {
      if (stop) return
      frame = requestAnimationFrame(tick)
      controls.update()
      if (camera.position.y < 1.2) {
        const lift = 1.2 - camera.position.y
        camera.position.y += lift
        controls.target.y += lift
      }
      const distNow = camera.position.distanceTo(controls.target)
      const reach = Math.min(span * 1.25, Math.max(16, distNow * 1.25))
      sun.target.position.set(controls.target.x, 0, controls.target.z)
      sun.position.copy(sun.target.position).addScaledVector(sunDir, span * 2.2)
      shadow.left = -reach
      shadow.right = reach
      shadow.top = reach
      shadow.bottom = -reach
      shadow.updateProjectionMatrix()
      renderer.render(scene, camera)
      labels.render(scene, camera)
      settleLabels(host)
    }

    const resize = () => {
      const w = host.clientWidth || 800
      const h = host.clientHeight || 600
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      labels.setSize(w, h)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const ndc = new Vector2()
    const raycaster = new Raycaster()
    const pick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects([...groups, ...pads], true)
      return hits.length ? partOf(hits[0].object) : null
    }
    let downX = 0
    let downY = 0
    const onDown = (event: PointerEvent) => {
      downX = event.clientX
      downY = event.clientY
    }
    const onUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return
      onSelectRef.current(pick(event))
    }
    const onMove = (event: PointerEvent) => {
      if (event.buttons) return
      onHoverRef.current(pick(event))
    }
    const onLeave = () => onHoverRef.current(null)
    const onDouble = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects([...groups, ...pads], true)
      if (!hits.length) return
      let owner: Object3D | null = hits[0].object
      let focus: Vector3 | null = null
      let next = 18
      while (owner) {
        const marked = owner.userData?.focus as Vector3 | undefined
        if (marked) {
          focus = marked
          const height = owner.userData.height as number | undefined
          const span = owner.userData.span as number | undefined
          if (typeof height === 'number') next = frameDistance(height)
          else if (typeof span === 'number') next = Math.max(18, Math.min(48, span * 0.72))
          break
        }
        owner = owner.parent
      }
      if (!focus) return
      const back = camera.position.clone().sub(controls.target)
      if (back.lengthSq() < 1e-6) return
      back.normalize()
      if (back.y < 0.28) {
        back.y = 0.28
        back.normalize()
      }
      controls.target.copy(focus)
      camera.position.copy(focus).addScaledVector(back, next)
      controls.update()
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)
    renderer.domElement.addEventListener('dblclick', onDouble)
    const onMenu = (event: Event) => event.preventDefault()
    renderer.domElement.addEventListener('contextmenu', onMenu)
    const onDragStart = () => host.classList.add('is-drag')
    const onDragEnd = () => host.classList.remove('is-drag')
    controls.addEventListener('start', onDragStart)
    controls.addEventListener('end', onDragEnd)

    const loader = new TextureLoader()
    const files = [...new Set([
      ...Object.values(TEX).flatMap((spec) => [spec.upper, spec.base].filter((name): name is string => Boolean(name))),
      'sky.jpg',
      'lawn.jpg',
      'park.jpg',
    ])]
    const loadOne = async (file: string): Promise<[string, Texture | null]> => {
      try {
        const tex = await loader.loadAsync(`${import.meta.env.BASE_URL}ship/campus/${file}`)
        tex.colorSpace = SRGBColorSpace
        tex.wrapS = RepeatWrapping
        tex.wrapT = RepeatWrapping
        tex.anisotropy = 8
        return [file, tex]
      } catch {
        return [file, null]
      }
    }

    const painted = new Map<string, Texture>()
    const paintTex = (kind: FacadeKind, slot: 'upper' | 'base') => {
      const key = `${kind}:${slot}`
      const prior = painted.get(key)
      if (prior) return prior
      const tex = new CanvasTexture(paintFacade(kind, slot))
      tex.colorSpace = SRGBColorSpace
      tex.wrapS = RepeatWrapping
      tex.wrapT = RepeatWrapping
      tex.anisotropy = 8
      painted.set(key, tex)
      maps.push(tex)
      return tex
    }

    const boot = async () => {
      const loaded = new Map<string, Texture>()
      const rows = await Promise.all(files.map(loadOne))
      if (cancelled) {
        rows.forEach(([, tex]) => tex?.dispose())
        dropPmrem()
        return
      }
      rows.forEach(([file, tex]) => {
        if (tex) {
          loaded.set(file, tex)
          maps.push(tex)
        }
      })

      const maxAniso = renderer.capabilities.getMaxAnisotropy()
      const skyTex = loaded.get('sky.jpg')
      if (skyTex) {
        skyTex.colorSpace = SRGBColorSpace
        skyTex.wrapS = RepeatWrapping
        skyTex.wrapT = ClampToEdgeWrapping
        skyTex.anisotropy = maxAniso
        skyMat.map = skyTex
        skyMat.needsUpdate = true
        const envPhoto = skyTex.clone()
        envPhoto.mapping = EquirectangularReflectionMapping
        envPhoto.colorSpace = SRGBColorSpace
        envPhoto.needsUpdate = true
        maps.push(envPhoto)
        const nextEnv = pmrem.fromEquirectangular(envPhoto).texture
        scene.environment = nextEnv
        maps.push(nextEnv)
      }
      const lawnTex = loaded.get('lawn.jpg')
      if (lawnTex) {
        lawnTex.colorSpace = SRGBColorSpace
        lawnTex.wrapS = MirroredRepeatWrapping
        lawnTex.wrapT = MirroredRepeatWrapping
        lawnTex.anisotropy = maxAniso
        lawnTex.repeat.set(lawnW / 16, lawnD / 16)
        grassMat.map = lawnTex
        grassMat.color.set('#ffffff')
        grassMat.needsUpdate = true
      }

      const sourceFor = (kind: FacadeKind, slot: 'upper' | 'base') => {
        const spec = TEX[kind]
        const file = slot === 'base' ? spec.base : spec.upper
        if (file && loaded.get(file)) return loaded.get(file) as Texture
        return paintTex(kind, slot)
      }

      const tiled = (source: Texture, rx: number, ry: number) => {
        const map = source.clone()
        map.wrapS = RepeatWrapping
        map.wrapT = RepeatWrapping
        map.repeat.set(Math.max(0.8, rx), Math.max(0.8, ry))
        map.anisotropy = renderer.capabilities.getMaxAnisotropy()
        map.needsUpdate = true
        maps.push(map)
        return map
      }

      const makeMat = (hex: string, source: Texture, rx: number, ry: number, spec: TexSpec) => {
        const glass = spec === TEX.glass
        const mat = new MeshStandardMaterial({
          map: tiled(source, rx, ry),
          color: glass ? '#d7e7f3' : hex,
          roughness: glass ? 0.14 : spec.roughness,
          metalness: glass ? 0.74 : spec.metalness,
          envMapIntensity: glass ? 1.25 : 1,
        })
        mat.userData.hex = glass ? '#d7e7f3' : hex
        mats.push(mat)
        return mat
      }

      for (const block of layout.blocks) {
        const sector = meta.get(block.part)
        const padHex = mix('#d9d3c6', sector?.color || '#d9d3c6', 0.2)
        const padMat = new MeshStandardMaterial({ color: padHex, roughness: 0.94 })
        padMat.userData.hex = padHex
        mats.push(padMat)
        const pad = new Mesh(box, padMat)
        pad.scale.set(block.w, 0.28, block.d)
        pad.position.set(block.x, 0.12, block.z)
        pad.receiveShadow = true
        pad.userData.part = block.part
        pad.userData.mats = [padMat]
        pad.userData.color = sector?.color || '#ffffff'
        pad.userData.focus = new Vector3(block.x, 4, block.z)
        pad.userData.span = Math.max(block.w, block.d)
        scene.add(pad)
        pads.push(pad)

        const walk = new Mesh(box, walkMat)
        walk.scale.set(Math.max(4, block.w * 0.92), 0.1, 2.3)
        walk.position.set(block.x, 0.08, block.z + block.d / 2 + 1.4)
        walk.receiveShadow = true
        scene.add(walk)

        const road = new Mesh(box, roadMat)
        road.scale.set(block.w + 10, 0.07, 5.4)
        road.position.set(block.x, 0.045, block.z + block.d / 2 + 8.2)
        road.receiveShadow = true
        scene.add(road)

        const hood = document.createElement('div')
        hood.className = 'dga-campus-hood'
        hood.dataset.part = block.part
        hood.dataset.pri = String(Math.round(80 + block.w))
        hood.textContent = sector?.name || block.part
        const hoodLabel = new CSS2DObject(hood)
        hoodLabel.center.set(0.5, 1)
        hoodLabel.position.set(block.x, 1.6, block.z + block.d / 2 + 2.4)
        scene.add(hoodLabel)
        pad.userData.hood = hood

        const trees = Math.max(2, Math.round(block.w / 11))
        for (let i = 0; i < trees; i += 1) {
          const x = block.x - block.w / 2 + ((i + 0.5) * block.w) / trees
          addTree(x, block.z + block.d / 2 + 5.2, i + block.part.length)
        }
      }

      const spanX = Math.max(1, layout.bounds.maxX - layout.bounds.minX)
      const spanZ = Math.max(1, layout.bounds.maxZ - layout.bounds.minZ)
      for (let i = 0; i < 28; i += 1) {
        const side = i % 4
        const t = ((i * 47) % 97) / 97
        const o = 12 + (i % 4) * 1.6
        const jitter = ((i * 13) % 5) - 2
        let x = cx
        let z = cz
        if (side === 0) {
          x = layout.bounds.minX + t * spanX
          z = layout.bounds.minZ - o
        } else if (side === 1) {
          x = layout.bounds.minX + t * spanX
          z = layout.bounds.maxZ + o
        } else if (side === 2) {
          x = layout.bounds.minX - o
          z = layout.bounds.minZ + t * spanZ
        } else {
          x = layout.bounds.maxX + o
          z = layout.bounds.minZ + t * spanZ
        }
        addTree(x + jitter * 0.15, z + jitter * 0.1, i + 4)
      }

      const placeBox = (
        group: Group,
        mat: MeshStandardMaterial,
        w: number,
        h: number,
        d: number,
        x: number,
        y: number,
        z: number,
      ) => {
        const mesh = new Mesh(box, mat)
        mesh.scale.set(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d))
        mesh.position.set(x, y, z)
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)
        return mesh
      }

      for (const building of layout.buildings) {
        const kind = facadeKind(building.part)
        const spec = TEX[kind]
        const tint = tintFor(building.part)
        const sector = meta.get(building.part)
        const group = new Group()
        group.position.set(building.x, 0, building.z)
        group.userData.part = building.part
        group.userData.color = sector?.color || '#ffffff'
        group.userData.height = building.height
        group.userData.focus = new Vector3(building.x, building.height * 0.42, building.z)
        const owned: MeshStandardMaterial[] = []

        const tiers = massTiers(building.height, building.foot, building.depth, kind)
        let topMat: MeshStandardMaterial = concrete
        let roofFoot = building.foot
        let roofDepth = building.depth
        let topY = 0
        const plinthHex = mix('#d9d3c8', tint, 0.28)
        const plinthMat = new MeshStandardMaterial({ color: plinthHex, roughness: 0.9, metalness: 0.02 })
        plinthMat.userData.hex = plinthHex
        mats.push(plinthMat)
        owned.push(plinthMat)
        for (const tier of tiers) {
          const usePhoto = tier.role === 'shaft' || Boolean(spec.base)
          let mat = plinthMat
          if (usePhoto) {
            const slot = tier.role === 'plinth' ? 'base' : 'upper'
            const [rx, ry] = tileRepeat(spec, tier.foot, tier.h, slot)
            mat = makeMat(tint, sourceFor(kind, slot), rx, ry, spec)
            owned.push(mat)
          }
          placeBox(group, mat, tier.foot, tier.h, tier.depth, 0, tier.y0 + tier.h / 2, 0)
          if (tier.role === 'shaft') {
            topMat = mat
            roofFoot = tier.foot
            roofDepth = tier.depth
            topY = tier.y0 + tier.h
          }
        }
        const shaft = tiers.find((tier) => tier.role === 'shaft')
        const roofMat = new MeshStandardMaterial({
          color: spec.roof,
          roughness: 0.78,
          metalness: kind === 'copper' ? 0.35 : 0.04,
        })
        roofMat.userData.hex = spec.roof
        mats.push(roofMat)
        owned.push(roofMat)
        const equipHex = shade(spec.roof, 0.72)
        const equipMat = new MeshStandardMaterial({
          color: equipHex,
          roughness: kind === 'glass' ? 0.45 : 0.7,
          metalness: kind === 'glass' || kind === 'copper' || kind === 'power' ? 0.42 : 0.08,
        })
        equipMat.userData.hex = equipHex
        mats.push(equipMat)
        owned.push(equipMat)
        placeBox(group, roofMat, roofFoot * 1.07, 0.32, roofDepth * 1.07, 0, topY + 0.16, 0)
        placeBox(group, roofMat, roofFoot * 0.9, 0.2, roofDepth * 0.9, 0, topY + 0.42, 0)
        const parapetY = topY + 0.78
        placeBox(group, roofMat, roofFoot, 0.5, 0.14, 0, parapetY, roofDepth / 2)
        placeBox(group, roofMat, roofFoot, 0.5, 0.14, 0, parapetY, -roofDepth / 2)
        placeBox(group, roofMat, 0.14, 0.5, roofDepth, roofFoot / 2, parapetY, 0)
        placeBox(group, roofMat, 0.14, 0.5, roofDepth, -roofFoot / 2, parapetY, 0)
        if (shaft && kind === 'glass') {
          const finHex = '#e7eef3'
          const finMat = new MeshStandardMaterial({ color: finHex, roughness: 0.32, metalness: 0.62 })
          finMat.userData.hex = finHex
          mats.push(finMat)
          owned.push(finMat)
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              placeBox(
                group,
                finMat,
                0.16,
                shaft.h * 0.94,
                0.16,
                sx * (shaft.foot / 2 + 0.02),
                shaft.y0 + shaft.h / 2,
                sz * (shaft.depth / 2 + 0.02),
              )
            }
          }
          for (const frac of [0.36, 0.68]) {
            placeBox(group, finMat, shaft.foot * 1.03, 0.1, shaft.depth * 1.03, 0, shaft.y0 + shaft.h * frac, 0)
          }
        }
        if (shaft && (kind === 'stone' || kind === 'sand' || kind === 'rose')) {
          placeBox(group, roofMat, shaft.foot * 1.05, 0.2, shaft.depth * 1.05, 0, shaft.y0 + shaft.h * 0.48, 0)
        }
        if (shaft && kind === 'copper') {
          for (const x of [-0.3, 0, 0.3]) {
            placeBox(
              group,
              equipMat,
              0.1,
              shaft.h * 0.88,
              0.08,
              shaft.foot * x,
              shaft.y0 + shaft.h / 2,
              shaft.depth / 2 + 0.03,
            )
          }
        }
        if (kind !== 'power' && building.height > 8) {
          placeBox(
            group,
            roofMat,
            Math.min(building.foot * 0.46, 4.4),
            0.1,
            1.05,
            0,
            3.05,
            building.depth * 0.54 + 0.32,
          )
        }
        let top = topY + 1.15
        if (kind === 'glass') {
          const pentH = Math.max(1.4, building.height * 0.06)
          placeBox(group, equipMat, roofFoot * 0.42, pentH, roofDepth * 0.42, 0, topY + 0.7 + pentH / 2, 0)
          top = Math.max(top, topY + 0.7 + pentH)
        }
        if ((kind === 'brick' || kind === 'sand' || kind === 'rose') && building.height > 12) {
          const chimneyH = Math.max(1.5, building.height * 0.07)
          placeBox(
            group,
            equipMat,
            0.45,
            chimneyH,
            0.45,
            roofFoot * 0.22,
            topY + 0.55 + chimneyH / 2,
            -roofDepth * 0.12,
          )
          top = Math.max(top, topY + 0.55 + chimneyH)
          if (building.height > 20) {
            placeBox(group, equipMat, roofFoot * 0.28, 0.7, roofDepth * 0.22, -roofFoot * 0.16, topY + 0.85, roofDepth * 0.08)
          }
        }
        if (kind === 'power' && !(building.landmark && building.part === 'keel')) {
          const stackH = Math.max(3.2, building.height * 0.2)
          const stack = new Mesh(cyl, equipMat)
          stack.scale.set(Math.max(0.28, roofFoot * 0.07), stackH, Math.max(0.28, roofFoot * 0.07))
          stack.position.set(roofFoot * 0.16, topY + stackH / 2 + 0.3, 0)
          stack.castShadow = true
          group.add(stack)
          top = Math.max(top, topY + stackH + 0.3)
        }
        if (kind === 'industrial' || kind === 'white') {
          const monitorH = kind === 'white' ? 1.15 : 1.45
          placeBox(
            group,
            equipMat,
            roofFoot * 0.62,
            monitorH,
            Math.max(0.7, roofDepth * 0.22),
            0,
            topY + 0.7 + monitorH / 2,
            0,
          )
          top = Math.max(top, topY + 0.7 + monitorH)
        }
        const crownBase = topY + 0.95
        if (building.landmark && building.part === 'bridge') {
          const crownH = Math.max(3.5, building.height * 0.15)
          const crown = new Mesh(box, topMat)
          crown.scale.set(building.foot * 0.58, crownH, building.depth * 0.58)
          crown.position.y = crownBase + crownH / 2
          crown.castShadow = true
          group.add(crown)
          top = crownBase + crownH
        }
        if (building.landmark && building.part === 'keel') {
          const towerH = Math.max(8, building.height * 0.4)
          for (const side of [-1, 1]) {
            const tower = new Mesh(cyl, concrete)
            tower.scale.set(building.foot * 0.15, towerH, building.foot * 0.15)
            tower.position.set(side * building.foot * 0.24, crownBase + towerH / 2, -building.depth * 0.06)
            tower.castShadow = true
            group.add(tower)
          }
          top = Math.max(top, crownBase + towerH)
        }
        if (building.landmark && (building.part === 'deck' || building.part === 'aero')) {
          const metal = building.part === 'deck' ? yellow : whiteMetal
          const postH = Math.max(5, building.height * 0.26)
          for (const side of [-1, 1]) {
            const post = new Mesh(box, metal)
            post.scale.set(0.42, postH, 0.42)
            post.position.set(side * building.foot * 0.3, crownBase + postH / 2, 0)
            post.castShadow = true
            group.add(post)
          }
          const beam = new Mesh(box, metal)
          beam.scale.set(building.foot * 0.74, 0.38, 0.38)
          beam.position.y = crownBase + postH
          beam.castShadow = true
          group.add(beam)
          top = Math.max(top, crownBase + postH)
        }
        if (building.landmark && (building.part === 'mast' || building.part === 'bow')) {
          const poleH = building.part === 'mast' ? Math.max(12, building.height * 0.55) : 7
          const pole = new Mesh(cyl, poleMat)
          pole.scale.set(building.part === 'mast' ? 0.12 : 0.08, poleH, building.part === 'mast' ? 0.12 : 0.08)
          pole.position.y = crownBase + poleH / 2
          pole.castShadow = true
          group.add(pole)
          top = Math.max(top, crownBase + poleH)
        }

        const tag = document.createElement('div')
        tag.className = 'dga-campus-tag'
        tag.dataset.part = building.part
        tag.dataset.pri = String(Math.round(building.height))
        tag.style.setProperty('--hood', sector?.color || '#9fb4c8')
        tag.textContent = building.symbol
        const label = new CSS2DObject(tag)
        label.center.set(0.5, 1)
        label.position.set(0, top + 0.35, 0)
        group.add(label)
        group.userData.mats = owned
        group.userData.labels = [tag]
        scene.add(group)
        groups.push(group)
      }

      const tallest = layout.buildings.reduce((max, building) => Math.max(max, building.height), 12)
      const fit = Math.max(layout.bounds.maxX - layout.bounds.minX, layout.bounds.maxZ - layout.bounds.minZ, tallest * 2.2)
      const halfFov = (32 * Math.PI) / 360
      const horizontal = 2 * Math.atan(Math.tan(halfFov) * Math.max(camera.aspect, 0.7))
      const dist = (fit * 0.56) / Math.tan(horizontal / 2)
      const eye = new Vector3(-0.22, 0.46, 1).normalize()
      const targetY = Math.min(7, tallest * 0.16)
      controls.target.set(cx, targetY, cz)
      camera.position.set(cx, targetY, cz).addScaledVector(eye, dist)
      controls.minDistance = MIN_ZOOM
      controls.maxDistance = dist * 2.35
      const parkTex = loaded.get('park.jpg')
      const farSpan = Math.max(span * 14, dist * 6)
      far.scale.set(farSpan, farSpan, 1)
      if (parkTex) {
        parkTex.colorSpace = SRGBColorSpace
        parkTex.wrapS = MirroredRepeatWrapping
        parkTex.wrapT = MirroredRepeatWrapping
        parkTex.anisotropy = maxAniso
        parkTex.repeat.set(Math.max(1, farSpan / 160), Math.max(1, farSpan / 160))
        farMat.map = parkTex
        farMat.color.set('#ffffff')
        farMat.needsUpdate = true
      }
      dropPmrem()
      controls.update()
      const polar = controls.getPolarAngle()
      if (polar <= 0.05 || polar >= Math.PI / 2 - 0.02) {
        console.warn('[campus] opening camera is not above the ground')
      }

      viewRef.current = { host, groups, pads }
      applyLit(viewRef.current, activeRef.current, hoverRef.current)
      host.dataset.campus = 'ready'
      tick()
      setGen((n) => n + 1)
    }
    void boot()

    return () => {
      cancelled = true
      stop = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      reduce.removeEventListener('change', onReduce)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('dblclick', onDouble)
      renderer.domElement.removeEventListener('contextmenu', onMenu)
      controls.removeEventListener('start', onDragStart)
      controls.removeEventListener('end', onDragEnd)
      controls.dispose()
      dropPmrem()
      geos.forEach((geo) => geo.dispose())
      mats.forEach((mat) => mat.dispose())
      maps.forEach((map) => map.dispose())
      labels.domElement.remove()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      if (viewRef.current?.host === host) viewRef.current = null
    }
  }, [sceneKey])

  if (failed) {
    return <p className="dga-campus-fallback">This browser could not open the campus view.</p>
  }

  return (
    <div
      ref={hostRef}
      className="dga-campus"
      data-campus="mount"
      role="img"
      aria-label="Portfolio campus. Drag to rotate. Scroll or pinch to zoom into a building. Double-click a building to move closer. Each building is a company."
    />
  )
}
