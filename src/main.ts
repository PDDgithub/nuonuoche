import './style.css'
import * as THREE from 'three'

// ==================== 场景初始化 ====================
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)

// 正交相机（这是等距立体感的关键）
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
camera.position.set(0, 35, 22)   // 俯角约 58°
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
const PARK_SIZE = 16   // 停车场总尺寸（方形）
const CELL = 2         // 每格大小

// 草地（外围）
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x7cb342, flatShading: true })
)
grass.rotation.x = -Math.PI / 2
grass.position.y = -0.01
grass.receiveShadow = true
scene.add(grass)

// 柏油路面（停车场）
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(PARK_SIZE, PARK_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x424242, flatShading: true })
)
road.rotation.x = -Math.PI / 2
road.receiveShadow = true
scene.add(road)

// 画停车格线（简化：用细 box 拼）
const lineMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee })
for (let i = -PARK_SIZE / 2 + CELL; i < PARK_SIZE / 2; i += CELL) {
  const hLine = new THREE.Mesh(new THREE.BoxGeometry(PARK_SIZE, 0.02, 0.08), lineMat)
  hLine.position.set(0, 0.01, i)
  scene.add(hLine)
  const vLine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, PARK_SIZE), lineMat)
  vLine.position.set(i, 0.01, 0)
  scene.add(vLine)
}

// 出口箭头（顶部中间的绿色区域表示出口方向）
const exitZone = new THREE.Mesh(
  new THREE.BoxGeometry(CELL * 2, 0.05, 0.4),
  new THREE.MeshStandardMaterial({ color: 0xffeb3b, emissive: 0xffeb3b, emissiveIntensity: 0.3 })
)
exitZone.position.set(0, 0.03, PARK_SIZE / 2 + 0.2)
scene.add(exitZone)

// ==================== 车辆 ====================
interface CarData {
  mesh: THREE.Group
  gridPos: { x: number; z: number }  // 占据起始格
  direction: 1 | -1                    // 1=朝+Z(上), -1=朝-Z(下)；或 X 方向
  axis: 'z' | 'x'                      // 行驶轴
  length: number                       // 占几格
  moving: boolean
  color: number
}

const carColors = [0xe53935, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1]

function createCar(color: number): THREE.Group {
  const group = new THREE.Group()

  // 车身
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 3.2),
    new THREE.MeshStandardMaterial({ color, flatShading: true })
  )
  body.position.y = 0.5
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // 车顶
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.5, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x263238, flatShading: true })
  )
  roof.position.set(0, 1.05, -0.1)
  roof.castShadow = true
  group.add(roof)

  // 轮子
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  const wheelPositions = [
    [-0.85, 0.35, 1.1], [0.85, 0.35, 1.1],
    [-0.85, 0.35, -1.1], [0.85, 0.35, -1.1],
  ]
  for (const p of wheelPositions) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.position.set(p[0], p[1], p[2])
    w.castShadow = true
    group.add(w)
  }

  return group
}

// 把车辆放到指定格位置
function placeCar(car: THREE.Group, gridX: number, gridZ: number, axis: 'z' | 'x') {
  // gridX, gridZ 是格子索引（0 ~ PARK_SIZE/CELL-1）
  const worldX = -PARK_SIZE / 2 + CELL / 2 + gridX * CELL
  const worldZ = -PARK_SIZE / 2 + CELL / 2 + gridZ * CELL
  car.position.set(worldX, 0, worldZ)
  if (axis === 'x') car.rotation.y = Math.PI / 2
}

const cars: CarData[] = []

function addCar(gridX: number, gridZ: number, axis: 'z' | 'x', length: number) {
  const color = carColors[cars.length % carColors.length]
  const mesh = createCar(color)
  // 车身沿 z 轴长 3.2，若 length=2 则缩一点
  if (length === 2) {
    mesh.scale.set(1, 1, 2 / 1.6)  // 缩短
  }
  placeCar(mesh, gridX, gridZ, axis)
  scene.add(mesh)

  // 计算朝向：axis=z 时，direction=1 朝+Z（出口方向），-1 朝-Z
  // 出口在 +Z 方向，所以想让车能开出去，需要 direction=1
  cars.push({
    mesh,
    gridPos: { x: gridX, z: gridZ },
    direction: axis === 'z' ? 1 : 1,  // 默认朝向出口
    axis,
    length,
    moving: false,
    color,
  })
}

// 摆几辆初始车（硬编码一个简单关卡）
addCar(1, 1, 'z', 2)
addCar(3, 1, 'z', 3)
addCar(5, 1, 'x', 2)
addCar(2, 3, 'z', 3)
addCar(4, 4, 'x', 2)
addCar(6, 5, 'z', 2)
addCar(1, 5, 'z', 3)
addCar(3, 6, 'x', 2)

// ==================== 点击移动逻辑 ====================
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

function onPointerDown(e: PointerEvent) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(mouse, camera)

  const meshes = cars.map(c => c.mesh)
  const hits = raycaster.intersectObjects(meshes, true)
  if (hits.length > 0) {
    // 找到对应的 CarData
    let root = hits[0].object
    while (root.parent && !cars.find(c => c.mesh === root)) root = root.parent
    const car = cars.find(c => c.mesh === root)
    if (car && !car.moving) {
      tryMoveCar(car)
    }
  }
}

// 移动速度（世界单位/秒）
const SPEED = 8

function tryMoveCar(car: CarData) {
  car.moving = true
}

// 检测车辆沿轴方向是否被阻挡（简化：检查矩形重叠）
function isBlocked(car: CarData, newPos: THREE.Vector3): boolean {
  // 计算这辆车在 newPos 时占据的世界坐标范围
  const halfW = (car.axis === 'z' ? 0.8 : 1.6)
  const halfL = (car.axis === 'z' ? 1.6 * (car.length / 2) : 0.8)

  for (const other of cars) {
    if (other === car || other.moving) continue
    const op = other.mesh.position
    const oHalfW = (other.axis === 'z' ? 0.8 : 1.6)
    const oHalfL = (other.axis === 'z' ? 1.6 * (other.length / 2) : 0.8)

    const overlapX = Math.abs(newPos.x - op.x) < halfW + oHalfW
    const overlapZ = Math.abs(newPos.z - op.z) < halfL + oHalfL
    if (overlapX && overlapZ) return true
  }
  return false
}

function updateCars(dt: number) {
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i]
    if (!car.moving) continue

    const dir = car.direction
    const delta = SPEED * dt * dir
    const pos = car.mesh.position.clone()

    if (car.axis === 'z') {
      pos.z += delta
    } else {
      pos.x += delta
    }

    // 超出停车场 + 缓冲区 → 移出场景
    const outBound = PARK_SIZE / 2 + 4
    const isOut = car.axis === 'z'
      ? (car.direction === 1 ? pos.z > outBound : pos.z < -outBound)
      : (car.direction === 1 ? pos.x > outBound : pos.x < -outBound)

    if (isOut) {
      scene.remove(car.mesh)
      cars.splice(i, 1)
      continue
    }

    // 碰撞检测
    if (isBlocked(car, pos)) {
      // 停在当前位置（不动）
      car.moving = false
      continue
    }

    car.mesh.position.copy(pos)
  }
}

// ==================== 主循环 ====================
const clock = new THREE.Clock()
renderer.domElement.addEventListener('pointerdown', onPointerDown)

window.addEventListener('resize', () => {
  const w = window.innerWidth
  const h = window.innerHeight
  const aspect = w / h
  camera.left = -frustumSize * aspect / 2
  camera.right = frustumSize * aspect / 2
  camera.top = frustumSize / 2
  camera.bottom = -frustumSize / 2
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
})

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  updateCars(dt)
  renderer.render(scene, camera)
}
animate()

// HUD
const hud = document.createElement('div')
hud.id = 'hud'
hud.innerHTML = `<h1>🚗 挪挪车</h1><p>点击车辆 → 直线开出去</p>`
document.getElementById('app')!.appendChild(hud)
