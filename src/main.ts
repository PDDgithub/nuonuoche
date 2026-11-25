import './style.css'
import * as THREE from 'three'

// ==================== 常量 ====================
const PARK_SIZE = 16          // 停车场边长（世界单位）
const CELL = 2                // 每格边长
const GRID = PARK_SIZE / CELL // 网格数 8x8
const CAR_WIDTH = 1.8         // 车宽（垂直于行驶轴），略小于一格留出缝隙
const CAR_HALF_W = CAR_WIDTH / 2
const SPEED = 8               // 行驶速度（世界单位/秒）
const EXIT_BUFFER = 4         // 驶出停车场多远后移除

type Axis = 'x' | 'z'
type Dir = 1 | -1

/** 关卡中一辆车的静态定义：gx/gz 为沿轴的"尾格"（最小格索引） */
interface CarSpec {
  gx: number
  gz: number
  axis: Axis
  len: number   // 占几格
  dir: Dir      // 1 = 朝轴正方向，-1 = 朝负方向（点击只朝车头方向开）
}

interface CarData {
  mesh: THREE.Group
  axis: Axis
  dir: Dir
  len: number
  moving: boolean
}

const carColors = [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1, 0xf06292, 0xffa726]

// ==================== 场景初始化 ====================
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)

const W = window.innerWidth
const H = window.innerHeight
const aspect = W / H
const frustumSize = 30
const camera = new THREE.OrthographicCamera(
  -frustumSize * aspect / 2,
  frustumSize * aspect / 2,
  frustumSize / 2,
  -frustumSize / 2,
  0.1,
  1000
)
camera.position.set(0, 35, 22) // 俯角约 58°
camera.lookAt(0, 0, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(W, H)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.getElementById('app')!.appendChild(renderer.domElement)

// ==================== 灯光 ====================
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0)
dirLight.position.set(20, 40, 15)
dirLight.castShadow = true
dirLight.shadow.mapSize.set(1024, 1024)
dirLight.shadow.camera.left = -25
dirLight.shadow.camera.right = 25
dirLight.shadow.camera.top = 25
dirLight.shadow.camera.bottom = -25
scene.add(dirLight)

// ==================== 停车场地面 ====================
// 草地（外围）
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x7cb342, flatShading: true })
)
grass.rotation.x = -Math.PI / 2
grass.position.y = -0.01
grass.receiveShadow = true
scene.add(grass)

// 柏油路面
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(PARK_SIZE, PARK_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x424242, flatShading: true })
)
road.rotation.x = -Math.PI / 2
road.receiveShadow = true
scene.add(road)

// 停车格线
const lineMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee })
for (let i = -PARK_SIZE / 2 + CELL; i < PARK_SIZE / 2; i += CELL) {
  const hLine = new THREE.Mesh(new THREE.BoxGeometry(PARK_SIZE, 0.02, 0.08), lineMat)
  hLine.position.set(0, 0.01, i)
  scene.add(hLine)
  const vLine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, PARK_SIZE), lineMat)
  vLine.position.set(i, 0.01, 0)
  scene.add(vLine)
}

// 四条边的出口指示条（车辆可从任意一边驶出）
const exitMat = new THREE.MeshStandardMaterial({ color: 0xffeb3b, emissive: 0xffeb3b, emissiveIntensity: 0.4 })
const edge = PARK_SIZE / 2
const exitStrips = [
  { geo: [PARK_SIZE, 0.05, 0.4], pos: [0, 0.03, edge + 0.2] },       // +Z 顶
  { geo: [PARK_SIZE, 0.05, 0.4], pos: [0, 0.03, -edge - 0.2] },      // -Z 底
  { geo: [0.4, 0.05, PARK_SIZE], pos: [edge + 0.2, 0.03, 0] },       // +X 右
  { geo: [0.4, 0.05, PARK_SIZE], pos: [-edge - 0.2, 0.03, 0] },      // -X 左
]
for (const e of exitStrips) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(e.geo[0], e.geo[1], e.geo[2]), exitMat)
  m.position.set(e.pos[0], e.pos[1], e.pos[2])
  scene.add(m)
}

// ==================== 车辆构建 ====================
function createCar(color: number, len: number): THREE.Group {
  const group = new THREE.Group()
  const bodyLen = len * CELL // 视觉长度 = 占格数 × 格长，与碰撞盒严格一致

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_WIDTH, 0.6, bodyLen),
    new THREE.MeshStandardMaterial({ color, flatShading: true })
  )
  body.position.y = 0.5
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // 车顶偏向后部（本地 -Z），让车头（+Z）有更长的引擎盖，可辨识朝向
  const roofLen = bodyLen * 0.55
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_WIDTH * 0.85, 0.5, roofLen),
    new THREE.MeshStandardMaterial({ color: 0x263238, flatShading: true })
  )
  roof.position.set(0, 1.05, -bodyLen * 0.12)
  roof.castShadow = true
  group.add(roof)

  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  const wheelZ = bodyLen / 2 - 0.5
  const wheelX = CAR_WIDTH / 2 + 0.05
  for (const [wx, wz] of [[-wheelX, wheelZ], [wheelX, wheelZ], [-wheelX, -wheelZ], [wheelX, -wheelZ]] as const) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(wx, 0.35, wz)
    w.castShadow = true
    group.add(w)
  }
  return group
}

function cellCenter(i: number): number {
  return -PARK_SIZE / 2 + CELL / 2 + i * CELL
}

/** 车辆中心世界坐标（gx/gz 是尾格，中心在尾格 + (len-1)/2 处） */
function carCenter(spec: CarSpec): { x: number; z: number } {
  const along = (spec.axis === 'x' ? spec.gx : spec.gz) + (spec.len - 1) / 2
  const fixed = spec.axis === 'x' ? spec.gz : spec.gx
  return spec.axis === 'x'
    ? { x: cellCenter(along), z: cellCenter(fixed) }
    : { x: cellCenter(fixed), z: cellCenter(along) }
}

/** 车头朝向旋转角：本地 +Z 为车头 */
function carRotation(spec: CarSpec): number {
  if (spec.axis === 'z') return spec.dir === 1 ? 0 : Math.PI
  return spec.dir === 1 ? Math.PI / 2 : -Math.PI / 2
}

// ==================== 关卡数据（均通过可解性校验） ====================
const levels: CarSpec[][] = [
  // L1 入门（7 车）
  [
    { gx: 1, gz: 0, axis: 'z', len: 2, dir: 1 },
    { gx: 3, gz: 0, axis: 'z', len: 2, dir: -1 },
    { gx: 5, gz: 2, axis: 'x', len: 2, dir: 1 },
    { gx: 0, gz: 3, axis: 'x', len: 3, dir: 1 },
    { gx: 6, gz: 4, axis: 'z', len: 2, dir: -1 },
    { gx: 2, gz: 5, axis: 'z', len: 3, dir: 1 },
    { gx: 4, gz: 6, axis: 'x', len: 2, dir: -1 },
  ],
  // L2 中等（9 车）
  [
    { gx: 0, gz: 0, axis: 'z', len: 2, dir: 1 },
    { gx: 2, gz: 0, axis: 'z', len: 3, dir: 1 },
    { gx: 5, gz: 0, axis: 'z', len: 2, dir: -1 },
    { gx: 7, gz: 1, axis: 'z', len: 2, dir: -1 },
    { gx: 1, gz: 3, axis: 'x', len: 2, dir: 1 },
    { gx: 4, gz: 3, axis: 'x', len: 3, dir: 1 },
    { gx: 0, gz: 5, axis: 'x', len: 2, dir: 1 },
    { gx: 3, gz: 6, axis: 'z', len: 2, dir: 1 },
    { gx: 6, gz: 5, axis: 'z', len: 3, dir: -1 },
  ],
  // L3 较难（9 车）
  [
    { gx: 3, gz: 0, axis: 'z', len: 2, dir: -1 },
    { gx: 5, gz: 0, axis: 'z', len: 3, dir: 1 },
    { gx: 1, gz: 1, axis: 'x', len: 3, dir: 1 },
    { gx: 0, gz: 3, axis: 'z', len: 2, dir: 1 },
    { gx: 2, gz: 3, axis: 'z', len: 2, dir: -1 },
    { gx: 6, gz: 3, axis: 'z', len: 2, dir: 1 },
    { gx: 4, gz: 4, axis: 'x', len: 2, dir: -1 },
    { gx: 0, gz: 6, axis: 'x', len: 3, dir: 1 },
    { gx: 4, gz: 6, axis: 'x', len: 2, dir: 1 },
  ],
]

// ==================== 关卡可解性校验（网格 BFS） ====================
function specCells(spec: CarSpec, tail: number): [number, number][] {
  const cells: [number, number][] = []
  for (let i = 0; i < spec.len; i++) {
    const t = tail + i
    if (t < 0 || t >= GRID) continue // 越界格不占位、不阻挡
    cells.push(spec.axis === 'z' ? [spec.gx, t] : [t, spec.gz])
  }
  return cells
}

/** 计算 car idx 从 state 出发沿车头方向最多能滑到的尾格；-1 表示完全驶出 */
function slideMax(specs: CarSpec[], state: number[], idx: number): number {
  const spec = specs[idx]
  let t = state[idx]
  while (true) {
    const nextT = t + spec.dir
    const nextCells = specCells(spec, nextT)
    if (nextCells.length === 0) return -1 // 全车越界 → 驶出
    let collide = false
    for (let j = 0; j < specs.length; j++) {
      if (j === idx || state[j] === -1) continue
      const jc = specCells(specs[j], state[j])
      if (nextCells.some(c => jc.some(k => k[0] === c[0] && k[1] === c[1]))) { collide = true; break }
    }
    if (collide) break
    t = nextT
  }
  return t
}

function isSolvable(specs: CarSpec[]): boolean {
  const n = specs.length
  const start = specs.map(s => (s.axis === 'z' ? s.gz : s.gx))
  const seen = new Set<string>()
  const queue: number[][] = [start]
  while (queue.length) {
    const s = queue.shift()!
    const key = s.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    if (s.every(t => t === -1)) return true
    for (let i = 0; i < n; i++) {
      if (s[i] === -1) continue
      const nt = slideMax(specs, s, i)
      if (nt !== s[i]) {
        const ns = s.slice(); ns[i] = nt
        queue.push(ns)
      }
    }
  }
  return false
}

// ==================== 关卡加载 ====================
const cars: CarData[] = []
let currentLevel = 0
let won = false

function clearCars() {
  for (const c of cars) scene.remove(c.mesh)
  cars.length = 0
}

function loadLevel(idx: number) {
  currentLevel = ((idx % levels.length) + levels.length) % levels.length
  clearCars()
  won = false
  hideWinOverlay()

  const specs = levels[currentLevel]
  const solvable = isSolvable(specs)
  if (!solvable) {
    console.warn(`[nuonuoche] 关卡 ${currentLevel + 1} 未通过可解性校验！玩家可能无法通关。`)
  } else {
    console.info(`[nuonuoche] 关卡 ${currentLevel + 1} 可解性校验通过（${specs.length} 辆车）。`)
  }

  specs.forEach((spec, i) => {
    const color = carColors[i % carColors.length]
    const mesh = createCar(color, spec.len)
    const c = carCenter(spec)
    mesh.position.set(c.x, 0, c.z)
    mesh.rotation.y = carRotation(spec)
    scene.add(mesh)
    cars.push({ mesh, axis: spec.axis, dir: spec.dir, len: spec.len, moving: false })
  })

  updateHud()
}

function resetLevel() {
  loadLevel(currentLevel)
}

function nextLevel() {
  loadLevel(currentLevel + 1)
}

// ==================== 点击移动 ====================
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function onPointerDown(e: PointerEvent) {
  if (won) return
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  const hits = raycaster.intersectObjects(cars.map(c => c.mesh), true)
  if (hits.length === 0) return
  let root: THREE.Object3D | null = hits[0].object
  while (root && !cars.find(c => c.mesh === root)) root = root.parent
  const car = cars.find(c => c.mesh === root)
  if (car && !car.moving) tryMoveCar(car)
}

function tryMoveCar(car: CarData) {
  car.moving = true
}

/** 车辆占据的世界半尺寸（沿 x / z） */
function halfExtents(car: CarData): { x: number; z: number } {
  const halfL = (car.len * CELL) / 2
  return car.axis === 'z'
    ? { x: CAR_HALF_W, z: halfL }
    : { x: halfL, z: CAR_HALF_W }
}

function isBlocked(car: CarData, newPos: THREE.Vector3): boolean {
  const h = halfExtents(car)
  for (const other of cars) {
    if (other === car || other.moving) continue
    const oh = halfExtents(other)
    const op = other.mesh.position
    // 接触即视为阻挡（<=），避免穿透
    if (Math.abs(newPos.x - op.x) <= h.x + oh.x && Math.abs(newPos.z - op.z) <= h.z + oh.z) return true
  }
  return false
}

function updateCars(dt: number) {
  // 子步进：把一帧位移切成 ≤0.05 的小步，减小"被挡停车"时的视觉缝隙
  const dist = SPEED * dt
  const steps = Math.max(1, Math.ceil(dist / 0.05))
  const stepDt = dt / steps

  for (let s = 0; s < steps; s++) {
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i]
      if (!car.moving) continue

      const delta = SPEED * stepDt * car.dir
      const pos = car.mesh.position.clone()
      if (car.axis === 'z') pos.z += delta
      else pos.x += delta

      // 驶出边界 → 移除
      const outBound = PARK_SIZE / 2 + EXIT_BUFFER
      const isOut = car.axis === 'z'
        ? (car.dir === 1 ? pos.z > outBound : pos.z < -outBound)
        : (car.dir === 1 ? pos.x > outBound : pos.x < -outBound)
      if (isOut) {
        scene.remove(car.mesh)
        cars.splice(i, 1)
        continue
      }

      if (isBlocked(car, pos)) {
        car.moving = false
        continue
      }
      car.mesh.position.copy(pos)
    }
  }
}

// ==================== UI ====================
const hud = document.createElement('div')
hud.id = 'hud'
document.getElementById('app')!.appendChild(hud)

function updateHud() {
  hud.innerHTML = `<h1>🚗 挪挪车</h1><p>第 ${currentLevel + 1} / ${levels.length} 关 · 点击车辆朝车头方向开出去</p>`
}

// 通关弹窗
const overlay = document.createElement('div')
overlay.id = 'win-overlay'
overlay.innerHTML = `
  <div class="win-card">
    <h2>🎉 通关！</h2>
    <p>停车场已清空</p>
    <div class="win-btns">
      <button id="btn-replay">重玩本关</button>
      <button id="btn-next">下一关</button>
    </div>
  </div>
`
document.getElementById('app')!.appendChild(overlay)
overlay.querySelector('#btn-replay')!.addEventListener('click', resetLevel)
overlay.querySelector('#btn-next')!.addEventListener('click', nextLevel)

function showWinOverlay() {
  overlay.classList.add('show')
}
function hideWinOverlay() {
  overlay.classList.remove('show')
}

// ==================== 主循环 ====================
const clock = new THREE.Clock()
renderer.domElement.addEventListener('pointerdown', onPointerDown)

window.addEventListener('resize', () => {
  const w = window.innerWidth
  const h = window.innerHeight
  const a = w / h
  camera.left = -frustumSize * a / 2
  camera.right = frustumSize * a / 2
  camera.top = frustumSize / 2
  camera.bottom = -frustumSize / 2
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
})

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  updateCars(dt)
  if (!won && cars.length === 0) {
    won = true
    showWinOverlay()
  }
  renderer.render(scene, camera)
}

loadLevel(0)
animate()
