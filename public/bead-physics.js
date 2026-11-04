// 摩梭头饰珠串的真实重力物理：世界空间 Verlet/PBD 珠链求解器 + Three.js 绑定层。
// 纯求解器（createBeadSolver）不依赖 DOM/Three，可在 Node 中直接测试；
// createBeadPhysics 负责从 MosuoBeadStrands 蒙皮网格提取真实珠串曲线、
// 按骨骼静止姿态烘焙碰撞体，并用 InstancedMesh 渲染动态珠子。
import * as THREE from './vendor/three/build/three.module.js';

const GRAVITY = [0, -9.81, 0];

// ---------------------------------------------------------------------------
// 纯求解器：多链 Verlet + 距离约束 + 椭球/胶囊碰撞。全部为扁平数组与 Plain
// Data，无任何 Three/DOM 依赖，便于 Node 单测。
// ---------------------------------------------------------------------------
export function createBeadSolver(options = {}) {
  const timeStep = options.timeStep ?? 1 / 60;
  const gravity = [...(options.gravity ?? GRAVITY)];
  let damping = options.damping ?? 0.08;
  const iterations = options.iterations ?? 8;
  const strainLimit = options.strainLimit ?? true; // 珠串不可伸长：末端应变限制
  const maxSubSteps = options.maxSubSteps ?? 4;
  const maxSpeed = options.maxSpeed ?? 8; // 单位/秒，防爆保护
  const chains = [];
  const colliders = [];
  let garmentContact = null;
  let accumulator = 0;
  let enabled = true;

  function addChain(points, opts = {}) {
    const src = Array.isArray(points[0]) ? points.flat() : points;
    const count = Math.floor(src.length / 3);
    if (count < 2) throw new Error('bead chain needs at least two particles');
    const chain = {
      count,
      position: Float64Array.from(src.slice(0, count * 3)),
      previous: Float64Array.from(src.slice(0, count * 3)),
      initial: Float64Array.from(src.slice(0, count * 3)),
      restLength: new Float64Array(count - 1),
      pins: new Map(),
    };
    const restScale = opts.restScale ?? 1;
    for (let i = 0; i < count - 1; i++) {
      chain.restLength[i] = distance(chain.position, i * 3, (i + 1) * 3) * restScale;
    }
    chains.push(chain);
    return chains.length - 1;
  }

  function setAnchor(chainId, index, x, y, z) {
    const chain = chains[chainId];
    if (!chain) return;
    let pin = chain.pins.get(index);
    if (!pin) { pin = { x, y, z }; chain.pins.set(index, pin); return; }
    pin.x = x; pin.y = y; pin.z = z;
  }

  function clearAnchor(chainId, index) {
    chains[chainId]?.pins.delete(index);
  }

  // 碰撞体为纯数据：
  // {kind:'ellipsoid', center:[x,y,z], radii:[rx,ry,rz], quat:[x,y,z,w]}
  // {kind:'capsule', a:[x,y,z], b:[x,y,z], radius}
  function addCollider(collider) {
    colliders.push(collider);
    return colliders.length - 1;
  }

  function distance(p, a, b) {
    const dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
    return Math.hypot(dx, dy, dz);
  }

  function substep(h) {
    const damp = 1 - damping;
    const gx = gravity[0] * h * h, gy = gravity[1] * h * h, gz = gravity[2] * h * h;
    const maxDisp = maxSpeed * h;
    for (const chain of chains) {
      const p = chain.position, q = chain.previous;
      for (let i = 0; i < chain.count; i++) {
        const b = i * 3;
        const pin = chain.pins.get(i);
        if (pin) {
          p[b] = pin.x; p[b + 1] = pin.y; p[b + 2] = pin.z;
          q[b] = pin.x; q[b + 1] = pin.y; q[b + 2] = pin.z;
          continue;
        }
        let vx = (p[b] - q[b]) * damp;
        let vy = (p[b + 1] - q[b + 1]) * damp;
        let vz = (p[b + 2] - q[b + 2]) * damp;
        const speed = Math.hypot(vx, vy, vz);
        if (speed > maxDisp) { const s = maxDisp / speed; vx *= s; vy *= s; vz *= s; }
        q[b] = p[b]; q[b + 1] = p[b + 1]; q[b + 2] = p[b + 2];
        p[b] += vx + gx; p[b + 1] += vy + gy; p[b + 2] += vz + gz;
      }
    }
    for (let it = 0; it < iterations; it++) {
      for (const chain of chains) satisfyDistances(chain, it % 2 === 1);
      for (const chain of chains) resolveCollisions(chain);
    }
    if (strainLimit) {
      for (const chain of chains) limitStrain(chain);
      for (const chain of chains) resolveCollisions(chain);
    }
  }

  // 自锚点向下的 follow-the-leader 应变限制：只剪除拉伸（允许松弛下垂），
  // 保证长链顶端不会被重力拉离超过静止长度。
  function limitStrain(chain) {
    const p = chain.position;
    for (let i = 0; i < chain.count - 1; i++) {
      if (chain.pins.has(i + 1)) continue;
      const a = i * 3, b = (i + 1) * 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const dist = Math.hypot(dx, dy, dz);
      const rest = chain.restLength[i];
      if (dist <= rest || dist < 1e-12) continue;
      const s = rest / dist;
      p[b] = p[a] + dx * s;
      p[b + 1] = p[a + 1] + dy * s;
      p[b + 2] = p[a + 2] + dz * s;
    }
  }

  // 交替正反向高斯-赛德尔扫描，减轻长链单向拉伸偏差。
  function satisfyDistances(chain, reverse) {
    const p = chain.position;
    const n = chain.count - 1;
    for (let s = 0; s < n; s++) {
      const i = reverse ? n - 1 - s : s;
      const j = i + 1;
      const bi = i * 3, bj = j * 3;
      const dx = p[bj] - p[bi], dy = p[bj + 1] - p[bi + 1], dz = p[bj + 2] - p[bi + 2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-9) continue;
      const diff = (dist - chain.restLength[i]) / dist;
      const pinI = chain.pins.has(i), pinJ = chain.pins.has(j);
      if (pinI && pinJ) continue;
      if (pinI) {
        p[bj] -= dx * diff; p[bj + 1] -= dy * diff; p[bj + 2] -= dz * diff;
      } else if (pinJ) {
        p[bi] += dx * diff; p[bi + 1] += dy * diff; p[bi + 2] += dz * diff;
      } else {
        const hx = dx * diff * 0.5, hy = dy * diff * 0.5, hz = dz * diff * 0.5;
        p[bi] += hx; p[bi + 1] += hy; p[bi + 2] += hz;
        p[bj] -= hx; p[bj + 1] -= hy; p[bj + 2] -= hz;
      }
    }
  }

  function resolveCollisions(chain) {
    const p = chain.position;
    for (let i = 0; i < chain.count; i++) {
      if (chain.pins.has(i)) continue;
      const b = i * 3;
      for (const c of colliders) {
        if (c.enabled === false) continue;
        if (c.kind === 'capsule') pushOutCapsule(p, b, c);
        else if (c.kind === 'ellipsoid') pushOutEllipsoid(p, b, c);
      }
      if (garmentContact) garmentContact(p,b,i);
    }
  }

  function pushOutCapsule(p, b, c) {
    const ax = c.a[0], ay = c.a[1], az = c.a[2];
    const abx = c.b[0] - ax, aby = c.b[1] - ay, abz = c.b[2] - az;
    const apx = p[b] - ax, apy = p[b + 1] - ay, apz = p[b + 2] - az;
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
    let dx = p[b] - cx, dy = p[b + 1] - cy, dz = p[b + 2] - cz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= c.radius) return;
    if (dist < 1e-9) { dx = 0; dy = 1; dz = 0; }
    else { dx /= dist; dy /= dist; dz /= dist; }
    p[b] = cx + dx * c.radius;
    p[b + 1] = cy + dy * c.radius;
    p[b + 2] = cz + dz * c.radius;
  }

  function pushOutEllipsoid(p, b, c) {
    // 转入椭球局部空间（逆四元数旋转），按半径归一化后径向投影回表面。
    let lx = p[b] - c.center[0], ly = p[b + 1] - c.center[1], lz = p[b + 2] - c.center[2];
    [lx, ly, lz] = rotateByQuatInverse(lx, ly, lz, c.quat);
    const nx = lx / c.radii[0], ny = ly / c.radii[1], nz = lz / c.radii[2];
    const d = Math.hypot(nx, ny, nz);
    if (d >= 1) return;
    const s = d < 1e-9 ? 1 : 1 / d;
    let tx = lx * s, ty = ly * s, tz = lz * s;
    if (d < 1e-9) { tx = c.radii[0]; ty = 0; tz = 0; }
    [tx, ty, tz] = rotateByQuat(tx, ty, tz, c.quat);
    p[b] = c.center[0] + tx;
    p[b + 1] = c.center[1] + ty;
    p[b + 2] = c.center[2] + tz;
  }

  function step(dt) {
    if (!enabled) return;
    accumulator += Math.min(Math.max(dt, 0), 0.25);
    let n = 0;
    while (accumulator >= timeStep && n < maxSubSteps) {
      substep(timeStep);
      accumulator -= timeStep;
      n++;
    }
    if (n === maxSubSteps) accumulator = 0; // 防止卡顿后的死亡螺旋
  }

  function reset() {
    for (const chain of chains) {
      chain.position.set(chain.initial);
      chain.previous.set(chain.initial);
    }
    accumulator = 0;
  }

  return {
    addChain, setAnchor, clearAnchor, addCollider, step, reset,
    setGarmentContact(fn) { garmentContact = fn; },
    getCollider: i => colliders[i],
    getChain: i => chains[i],
    get chainCount() { return chains.length; },
    get colliderCount() { return colliders.length; },
    setEnabled(value) { enabled = Boolean(value); },
    isEnabled() { return enabled; },
    timeStep,
    setParameters({damping:value,gravityScale}={}){if(Number.isFinite(value))damping=Math.min(.3,Math.max(0,value));if(Number.isFinite(gravityScale))gravity[1]=-9.81*Math.min(2,Math.max(0,gravityScale));},
  };
}

function rotateByQuat(x, y, z, q) {
  const [qx, qy, qz, qw] = q;
  const uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x;
  const uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx;
  return [
    x + 2 * (qw * uvx + uuvx),
    y + 2 * (qw * uvy + uuvy),
    z + 2 * (qw * uvz + uuvz),
  ];
}

function rotateByQuatInverse(x, y, z, q) {
  return rotateByQuat(x, y, z, [-q[0], -q[1], -q[2], q[3]]);
}

// ---------------------------------------------------------------------------
// Three.js 绑定层
// ---------------------------------------------------------------------------

const BEAD_MESH_PREFIX = 'MosuoBeadStrands';
const BEAD_COLOR = 0x722ac4;
const STRAND_RUN_JUMP = 0.1; // 相邻采样点 y 突增超过该值即视为新珠串起点
const CURVE_BANDS = 64;      // 提取初始曲线时的高度分带数

// 碰撞体定义：offset/from/to 为相对骨骼世界位置的静止姿态偏移（模型米），
// 创建时按骨骼实际静止坐标烘焙进骨骼局部空间，之后每帧随骨骼 matrixWorld 更新。
const COLLIDER_DEFS = [
  { bone: 'Head', kind: 'ellipsoid', offset: [0, 0.26, 0.02], radii: [0.285, 0.31, 0.265] },
  { bone: 'Spine', kind: 'ellipsoid', offset: [0, .12, 0], radii: [.235,.27,.17] },
  { bone: 'Hips', kind: 'ellipsoid', offset: [0, 0.03, 0], radii: [0.16, 0.14, 0.13] },
  { bone: 'UpperArmL', kind: 'capsule', toBone: 'ForearmL', radius: 0.048 },
  { bone: 'UpperArmR', kind: 'capsule', toBone: 'ForearmR', radius: 0.048 },
  { bone: 'ForearmL', kind: 'capsule', toBone: 'HandL', radius: 0.042 },
  { bone: 'ForearmR', kind: 'capsule', toBone: 'HandR', radius: 0.042 },
  // 裙摆近似身体碰撞体：从髋部垂直向下的粗胶囊。
  { bone: 'Hips', kind: 'capsule', from: [0, 0, 0], to: [0, -1.0, 0], radius: 0.26 },
];

function findBeadMesh(model) {
  let named = null;
  model.traverse(object => {
    if (!named && object.name.startsWith(BEAD_MESH_PREFIX)) named = object;
  });
  if (!named) return null;
  if (named.isSkinnedMesh || named.isMesh) return named;
  let mesh = null;
  named.traverse(child => {
    if (!mesh && (child.isSkinnedMesh || child.isMesh)) mesh = child;
  });
  return mesh;
}

// 以当前（静止）姿态采样蒙皮顶点，返回世界坐标样本。
function sampleSkinnedVertices(mesh, targetSamples) {
  const total = mesh.geometry.attributes.position.count;
  const stride = Math.max(1, Math.floor(total / targetSamples));
  const v = new THREE.Vector3();
  const samples = [];
  for (let i = 0; i < total; i += stride) {
    mesh.getVertexPosition(i, v); // 蒙皮后的网格局部坐标
    v.applyMatrix4(mesh.matrixWorld);
    samples.push([v.x, v.y, v.z]);
  }
  return samples;
}

// GLB 中珠串按生成顺序连续排布：相邻顶点 y 大幅上跳即新串起点。
// 若模型变化导致检测失败，则退化为绕锚点方位角分簇。
function splitStrandRuns(samples, fallbackStrands) {
  const runs = [[samples[0]]];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i][1] - samples[i - 1][1] > STRAND_RUN_JUMP) runs.push([]);
    runs[runs.length - 1].push(samples[i]);
  }
  const merged = [];
  for (const run of runs) {
    if (run.length < 8 && merged.length) merged[merged.length - 1].push(...run);
    else merged.push(run);
  }
  if (merged.length >= 2) return merged;
  // 退化路径：按相对样本质心的水平方位角均分。
  const cx = samples.reduce((s, p) => s + p[0], 0) / samples.length;
  const cz = samples.reduce((s, p) => s + p[2], 0) / samples.length;
  const buckets = Array.from({ length: fallbackStrands }, () => []);
  for (const p of samples) {
    const angle = Math.atan2(p[2] - cz, p[0] - cx) + Math.PI;
    buckets[Math.min(fallbackStrands - 1, Math.floor(angle / (2 * Math.PI) * fallbackStrands))].push(p);
  }
  return buckets.filter(b => b.length >= 2);
}

// 把一串散乱样本整理为自上而下的平滑曲线：高度分带求均值，再用弧长重采样。
function buildStrandCurve(run, segments) {
  let yTop = -Infinity, yBottom = Infinity;
  for (const p of run) {
    if (p[1] > yTop) yTop = p[1];
    if (p[1] < yBottom) yBottom = p[1];
  }
  const span = Math.max(yTop - yBottom, 1e-6);
  const bands = Array.from({ length: CURVE_BANDS }, () => null);
  const sums = Array.from({ length: CURVE_BANDS }, () => [0, 0, 0, 0]);
  for (const p of run) {
    const band = Math.min(CURVE_BANDS - 1, Math.floor((yTop - p[1]) / span * CURVE_BANDS));
    const s = sums[band];
    s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
  }
  for (let i = 0; i < CURVE_BANDS; i++) {
    const s = sums[i];
    if (s[3] > 0) bands[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  }
  // 空带用最近有效带线性插值补齐。
  for (let i = 0; i < CURVE_BANDS; i++) {
    if (bands[i]) continue;
    let lo = i - 1, hi = i + 1;
    while (lo >= 0 && !bands[lo]) lo--;
    while (hi < CURVE_BANDS && !bands[hi]) hi++;
    if (lo < 0 && hi >= CURVE_BANDS) return null;
    if (lo < 0) bands[i] = bands[hi].slice();
    else if (hi >= CURVE_BANDS) bands[i] = bands[lo].slice();
    else {
      const t = (i - lo) / (hi - lo);
      bands[i] = [
        bands[lo][0] + (bands[hi][0] - bands[lo][0]) * t,
        bands[lo][1] + (bands[hi][1] - bands[lo][1]) * t,
        bands[lo][2] + (bands[hi][2] - bands[lo][2]) * t,
      ];
    }
  }
  // 弧长重采样到 segments+1 个点。
  const cumulative = [0];
  for (let i = 1; i < CURVE_BANDS; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(
      bands[i][0] - bands[i - 1][0],
      bands[i][1] - bands[i - 1][1],
      bands[i][2] - bands[i - 1][2],
    ));
  }
  const length = cumulative[CURVE_BANDS - 1];
  if (length < span * 0.5) return null; // 退化串，放弃
  const curve = [];
  let cursor = 0;
  for (let s = 0; s <= segments; s++) {
    const target = length * s / segments;
    while (cursor < CURVE_BANDS - 2 && cumulative[cursor + 1] < target) cursor++;
    const segLen = cumulative[cursor + 1] - cumulative[cursor];
    const t = segLen > 1e-12 ? (target - cumulative[cursor]) / segLen : 0;
    curve.push([
      bands[cursor][0] + (bands[cursor + 1][0] - bands[cursor][0]) * t,
      bands[cursor][1] + (bands[cursor + 1][1] - bands[cursor][1]) * t,
      bands[cursor][2] + (bands[cursor + 1][2] - bands[cursor][2]) * t,
    ]);
  }
  return { curve, length };
}

function bakeColliders(model, solver, hasGarments) {
  const baked = [];
  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  for (const def of COLLIDER_DEFS) {
    if (hasGarments && def.kind === 'capsule' && def.bone === 'Hips') continue;
    const bone = model.getObjectByName(def.bone);
    if (!bone) continue;
    const bonePos = bone.getWorldPosition(new THREE.Vector3());
    if (def.kind === 'ellipsoid') {
      const centerLocal = bone.worldToLocal(tmp.copy(bonePos).add(new THREE.Vector3(...def.offset)).clone());
      bone.getWorldQuaternion(tmpQ);
      const localQuat = tmpQ.clone().invert(); // 静止姿态下世界四元数为单位阵
      const index = solver.addCollider({
        kind: 'ellipsoid', center: [0, 0, 0], radii: def.radii.slice(), quat: [0, 0, 0, 1],
      });
      baked.push({ def, bone, index, centerLocal, localQuat });
    } else {
      let aLocal, bLocal;
      if (def.toBone) {
        const toBone = model.getObjectByName(def.toBone);
        if (!toBone) continue;
        aLocal = new THREE.Vector3(0, 0, 0);
        bLocal = bone.worldToLocal(toBone.getWorldPosition(new THREE.Vector3()));
      } else {
        aLocal = bone.worldToLocal(tmp.copy(bonePos).add(new THREE.Vector3(...def.from)).clone());
        bLocal = bone.worldToLocal(tmp.copy(bonePos).add(new THREE.Vector3(...def.to)).clone());
      }
      const index = solver.addCollider({
        kind: 'capsule', a: [0, 0, 0], b: [0, 0, 0], radius: def.radius,
      });
      baked.push({ def, bone, index, aLocal, bLocal });
    }
  }
  return baked;
}

export function createBeadPhysics(model, scene, options = {}) {
  const solver = createBeadSolver(options.solver ?? options);
  const handle = {
    update() {}, reset() { solver.reset(); }, dispose() {},
    setEnabled(value) { solver.setEnabled(value); },
    isEnabled: () => solver.isEnabled(),
    solver, active: false,
  };

  const mesh = findBeadMesh(model);
  const headBone = model.getObjectByName(options.headBone ?? 'Head');
  if (!mesh || !headBone || !mesh.geometry?.attributes?.position) return handle;

  model.updateWorldMatrix(true, true);
  mesh.skeleton?.update?.();

  // Sample the visible animated cloth into a front-depth map in torso space.
  // Folding, hem-bone lag and waist trim are included by getVertexPosition.
  const clothSamples=[];
  const blouseSamples=[];
  const clothPoint=new THREE.Vector3(), inverseTorso=new THREE.Matrix4();
  const torso=model.getObjectByName('Spine') || headBone;
  for(const name of ['MosuoBlouse','MosuoPleatedSkirt','MosuoBroadWaistSash','MosuoRaisedRedHemStripe']) {
    model.getObjectByName(name)?.traverse(part=>{
      if(!part.isMesh) return;
      const count=part.geometry.attributes.position.count;
      for(let i=0;i<count;i+=Math.max(1,Math.floor(count/2200))) {
        const sample={part,i};
        clothSamples.push(sample);
        if(name==='MosuoBlouse') blouseSamples.push(sample);
      }
    });
  }
  function worldSample(sample,target) {
    return sample.part.getVertexPosition(sample.i,target).applyMatrix4(sample.part.matrixWorld);
  }
  const cell=.045, cols=40, rows=88, depth=new Float32Array(cols*rows);
  let clearance=.009;
  function sampleClothes() {
    inverseTorso.copy(torso.matrixWorld).invert();
    depth.fill(-Infinity);
    for(const sample of clothSamples) {
      worldSample(sample,clothPoint).applyMatrix4(inverseTorso);
      const x=Math.floor(clothPoint.x/cell)+20, y=Math.floor(clothPoint.y/cell)+54;
      if(x<0||x>=cols||y<0||y>=rows) continue;
      const k=y*cols+x;
      depth[k]=Math.max(depth[k],clothPoint.z);
    }
  }
  if(clothSamples.length) solver.setGarmentContact((p,b,i)=>{
    clothPoint.fromArray(p,b).applyMatrix4(inverseTorso);
    const x=Math.floor(clothPoint.x/cell)+20,y=Math.floor(clothPoint.y/cell)+54;
    if(x<0||x>=cols||y<0||y>=rows||clothPoint.z<-.015) return;
    const surface=depth[y*cols+x]+clearance;
    if(clothPoint.z<surface) {
      clothPoint.z=surface;
      clothPoint.applyMatrix4(torso.matrixWorld).toArray(p,b);
    }
  });

  const runs = splitStrandRuns(
    sampleSkinnedVertices(mesh, options.sampleCount ?? 16000),
    options.strands ?? 28,
  );

  // 每串：从真实蒙皮顶点云推导顶/底端与初始垂坠曲线，链段数 24-40。
  const chainIds = [];
  const anchorLocals = [];
  const dressingSupports = [];
  const resetCurves = [];
  const beadCounts = [];
  const beadSpacing = options.beadSpacing ?? 0.0075;
  for (const run of runs) {
    let yTop = -Infinity, yBottom = Infinity;
    for (const p of run) { yTop = Math.max(yTop, p[1]); yBottom = Math.min(yBottom, p[1]); }
    const approxLength = yTop - yBottom;
    const segments = Math.min(40, Math.max(24, Math.round(approxLength / 0.055)));
    const built = buildStrandCurve(run, segments);
    if (!built) continue;
    const id = solver.addChain(built.curve);
    solver.setAnchor(id, 0, ...built.curve[0]);
    chainIds.push(id);
    // 头端随头骨移动，绕肩承托段在下方单独保存。
    anchorLocals.push(headBone.worldToLocal(new THREE.Vector3(...built.curve[0])));
    // Only the head attachment and the shoulder guide constrain the drape.
    const spine=model.getObjectByName('Spine')||headBone;
    const shoulderY=spine.getWorldPosition(new THREE.Vector3()).y+.30;
    let contact=0;
    for(let j=0;j<built.curve.length-1;j++)if(built.curve[j][1]>=shoulderY)contact=j;
    const supports=[];
    if (contact > 0) {
      const j = contact;
      const point=new THREE.Vector3(...built.curve[j]);
      let nearest=null, distance=Infinity;
      for(const sample of blouseSamples) {
        worldSample(sample,clothPoint);
        if(clothPoint.z<0 || clothPoint.x*point.x<0) continue;
        const d=clothPoint.distanceToSquared(point);
        if(d<distance) { nearest=sample; distance=d; }
      }
      supports.push({index:j,local:spine.worldToLocal(point),bone:spine,sample:nearest});

    }
    dressingSupports.push(supports);
    resetCurves.push(built.curve.map(p=>({bone:spine,local:spine.worldToLocal(new THREE.Vector3(...p))})));
    beadCounts.push(Math.min(320, Math.max(24, Math.round(built.length / beadSpacing) + 1)));
  }
  if (!chainIds.length) return handle;

  const colliders = bakeColliders(model, solver, clothSamples.length > 0);

  // 动态珠子：单个 InstancedMesh，世界空间矩阵，共享几何体无需重算法线。
  const totalBeads = beadCounts.reduce((s, n) => s + n, 0);
  const beadRadius = options.beadRadius ?? 0.004; // 直径 0.008 模型单位
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: BEAD_COLOR });
  const beads = new THREE.InstancedMesh(geometry, material, totalBeads);
  beads.frustumCulled = false;
  beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(beads);

  const originalVisible = mesh.visible;
  mesh.visible = false;

  // 预分配全部临时对象，避免每帧产生垃圾。
  const tmpMatrix = new THREE.Matrix4();
  const tmpVec = new THREE.Vector3();
  const tmpVecB = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const worldQuat = new THREE.Quaternion();
  const IDENTITY_QUAT = new THREE.Quaternion();
  const beadScale = new THREE.Vector3(beadRadius, beadRadius, beadRadius);

  function syncColliders() {
    for (const c of colliders) {
      const collider = solver.getCollider(c.index);
      if (c.def.kind === 'ellipsoid') {
        c.bone.localToWorld(tmpVec.copy(c.centerLocal));
        collider.center[0] = tmpVec.x; collider.center[1] = tmpVec.y; collider.center[2] = tmpVec.z;
        c.bone.getWorldQuaternion(tmpQuat);
        worldQuat.copy(tmpQuat).multiply(c.localQuat);
        collider.quat[0] = worldQuat.x; collider.quat[1] = worldQuat.y;
        collider.quat[2] = worldQuat.z; collider.quat[3] = worldQuat.w;
      } else {
        c.bone.localToWorld(tmpVec.copy(c.aLocal));
        c.bone.localToWorld(tmpVecB.copy(c.bLocal));
        collider.a[0] = tmpVec.x; collider.a[1] = tmpVec.y; collider.a[2] = tmpVec.z;
        collider.b[0] = tmpVecB.x; collider.b[1] = tmpVecB.y; collider.b[2] = tmpVecB.z;
      }
    }
  }

  function syncAnchors() {
    for (let k = 0; k < chainIds.length; k++) {
      headBone.localToWorld(tmpVec.copy(anchorLocals[k]));
      solver.setAnchor(chainIds[k], 0, tmpVec.x, tmpVec.y, tmpVec.z);
      for(const support of dressingSupports[k]){
        if(support.sample) {
          worldSample(support.sample,tmpVec);
          tmpVec.applyMatrix4(inverseTorso);
          tmpVec.y+=clearance*.7; tmpVec.z+=clearance;
          tmpVec.applyMatrix4(torso.matrixWorld);
        } else support.bone.localToWorld(tmpVec.copy(support.local));
        solver.setAnchor(chainIds[k],support.index,tmpVec.x,tmpVec.y,tmpVec.z);
      }
    }
  }

  function writeBeads() {
    let instance = 0;
    for (let k = 0; k < chainIds.length; k++) {
      const chain = solver.getChain(chainIds[k]);
      const p = chain.position;
      const count = beadCounts[k];
      const last = chain.count - 1;
      for (let bIndex = 0; bIndex < count; bIndex++) {
        const t = (bIndex / (count - 1)) * last;
        const i0 = Math.min(last - 1, Math.floor(t));
        const f = t - i0;
        const b0 = i0 * 3, b1 = (i0 + 1) * 3;
        tmpVec.set(
          p[b0] + (p[b1] - p[b0]) * f,
          p[b0 + 1] + (p[b1 + 1] - p[b0 + 1]) * f,
          p[b0 + 2] + (p[b1 + 2] - p[b0 + 2]) * f,
        );
        tmpMatrix.compose(tmpVec, IDENTITY_QUAT, beadScale);
        beads.setMatrixAt(instance++, tmpMatrix);
      }
    }
    beads.instanceMatrix.needsUpdate = true;
  }

  let enabled = true;

  handle.update = function update(dt) {
    if (!enabled) return;
    // 世界空间求解：锚点/碰撞体直接读骨骼 matrixWorld（含展台 pivot 旋转），
    // InstancedMesh 挂在场景根下写入世界矩阵，避免二次变换。
    model.updateWorldMatrix(true, true);
    sampleClothes();
    syncAnchors();
    syncColliders();
    handle._syncFurniture?.();
    solver.step(dt);
    writeBeads();
  };

  handle.reset = function reset() {
    solver.reset();
    if (enabled) {
      model.updateWorldMatrix(true, true);
      // Scrubbing/teleporting must reseed in the current pose, not the old
      // world-space rest pose. Continuous animation never runs this reset.
      // Retain strand ordering even in a horizontal lying pose. Re-sorting
      // posed vertices by world height would merge/swap unrelated strands.
      for(let k=0;k<chainIds.length;k++){
        const chain=solver.getChain(chainIds[k]);
        resetCurves[k].forEach((point,i)=>{
          point.bone.localToWorld(tmpVec.copy(point.local));
          tmpVec.toArray(chain.position,i*3);
        });
        chain.previous.set(chain.position);
      }
      sampleClothes();syncAnchors();syncColliders();writeBeads();
    }
  };

  handle.setEnabled = function setEnabled(value) {
    const next = Boolean(value);
    if (next === enabled) return;
    enabled = next;
    solver.setEnabled(next);
    mesh.visible = next ? false : originalVisible;
    beads.visible = next;
    if (next) handle.reset();
  };
  handle.isEnabled = () => enabled;
  handle.setParameters = parameters => {solver.setParameters(parameters);if(Number.isFinite(parameters.beadDiameter)){clearance=.005+parameters.beadDiameter/2;beadScale.setScalar(Math.max(.002,Math.min(.008,parameters.beadDiameter/2)));writeBeads();}};
  handle.setFurnitureRoot = function setFurnitureRoot(root) {
    if (!root) return;
    // The bench is a support surface, not a visual-only prop. Keep colliders
    // in its local frame so pivot rotation carries them with the furniture.
    const seat = solver.addCollider({kind:'ellipsoid',center:[0,.72,0],radii:[1.82,.13,.47],quat:[0,0,0,1]});
    const back = solver.addCollider({kind:'ellipsoid',center:[0,1.40,-.49],radii:[1.82,.52,.08],quat:[0,0,0,1]});
    const local = [
      {index:seat, center:new THREE.Vector3(0,.72,0)},
      {index:back, center:new THREE.Vector3(0,1.40,-.49)},
    ];
    handle._syncFurniture = () => {
      for (const entry of local) {
        const collider = solver.getCollider(entry.index);
        collider.enabled = root.visible;
        root.localToWorld(tmpVec.copy(entry.center));
        collider.center[0]=tmpVec.x; collider.center[1]=tmpVec.y; collider.center[2]=tmpVec.z;
        root.getWorldQuaternion(tmpQuat);
        collider.quat[0]=tmpQuat.x; collider.quat[1]=tmpQuat.y;
        collider.quat[2]=tmpQuat.z; collider.quat[3]=tmpQuat.w;
      }
    };
    handle._syncFurniture();
  };

  handle.dispose = function dispose() {
    mesh.visible = originalVisible;
    scene.remove(beads);
    geometry.dispose();
    material.dispose();
    solver.setEnabled(false);
    handle.update = () => {};
  };

  Object.defineProperty(handle, 'strandCount', { get: () => chainIds.length });
  Object.defineProperty(handle, 'beadMesh', { get: () => beads });
  Object.defineProperty(handle, 'sourceMesh', { get: () => mesh });
  handle.active = true;

  writeBeads();
  return handle;
}
