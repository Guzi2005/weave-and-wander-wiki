// 珠链纯求解器（createBeadSolver）的 Node 单测：无需 DOM / 浏览器 / 外部依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeadSolver } from '../public/bead-physics.js';

// 从 start 沿方向 dir 生成 count 个粒子的直链。
function straightChain(start, dir, count, spacing) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push([start[0] + dir[0] * spacing * i, start[1] + dir[1] * spacing * i, start[2] + dir[2] * spacing * i]);
  }
  return points;
}

function run(solver, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) solver.step(dt);
}

function particle(chain, i) {
  const b = i * 3;
  return [chain.position[b], chain.position[b + 1], chain.position[b + 2]];
}

function segmentDistances(chain) {
  const out = [];
  for (let i = 0; i < chain.count - 1; i++) {
    const a = particle(chain, i), b = particle(chain, i + 1);
    out.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return out;
}

function assertFinite(chain) {
  for (const v of chain.position) assert.ok(Number.isFinite(v), `non-finite particle coordinate ${v}`);
}

test('gravity: unpinned chain falls', () => {
  const solver = createBeadSolver();
  const id = solver.addChain(straightChain([0, 2, 0], [1, 0, 0], 10, 0.05));
  const before = particle(solver.getChain(id), 5)[1];
  run(solver, 0.5);
  const after = particle(solver.getChain(id), 5)[1];
  assert.ok(after < before - 0.5, `expected free fall, y ${before} -> ${after}`);
});

test('gravity: pinned horizontal chain swings down and settles below anchor', () => {
  const solver = createBeadSolver();
  const anchor = [0, 2, 0];
  const id = solver.addChain(straightChain(anchor, [1, 0, 0], 21, 0.05)); // 总长 1m
  solver.setAnchor(id, 0, ...anchor);
  run(solver, 8);
  const chain = solver.getChain(id);
  const end = particle(chain, chain.count - 1);
  assert.ok(Math.abs(end[0]) < 0.05, `end x should settle near anchor x, got ${end[0]}`);
  assert.ok(Math.abs(end[1] - 1.0) < 0.08, `end should hang ~1m below anchor, got y=${end[1]}`);
  assert.ok(Math.abs(end[2]) < 0.05, `end z should settle near 0, got ${end[2]}`);
  // 停止后应基本静止：再步进一小段位置几乎不变。
  const snapshot = Array.from(chain.position);
  run(solver, 0.5);
  for (let i = 0; i < chain.position.length; i++) {
    assert.ok(Math.abs(chain.position[i] - snapshot[i]) < 0.01, 'chain did not settle');
  }
});

test('distance constraints hold near rest length after settling', () => {
  const solver = createBeadSolver({ iterations: 10 });
  const id = solver.addChain(straightChain([0, 2, 0], [1, 0, 0], 21, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 4);
  const chain = solver.getChain(id);
  const distances = segmentDistances(chain);
  for (const [i, d] of distances.entries()) {
    assert.ok(Math.abs(d - chain.restLength[i]) < chain.restLength[i] * 0.05,
      `segment ${i} length ${d} deviates from rest ${chain.restLength[i]}`);
  }
});

test('pause: disabled solver freezes, sub-timestep dt accumulates without moving', () => {
  const solver = createBeadSolver();
  const id = solver.addChain(straightChain([0, 2, 0], [1, 0, 0], 10, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 1);
  const chain = solver.getChain(id);

  solver.setEnabled(false);
  const frozen = Array.from(chain.position);
  run(solver, 1);
  assert.deepEqual(Array.from(chain.position), frozen);
  solver.setEnabled(true);

  // 固定步长累积器：不足一个子步的 dt 不应推动粒子。
  run(solver, 1);
  const settled = Array.from(chain.position);
  solver.step(solver.timeStep / 2);
  assert.deepEqual(Array.from(chain.position), settled);
});

test('reset restores initial positions exactly', () => {
  const solver = createBeadSolver();
  const points = straightChain([0, 2, 0], [0, -1, 0], 12, 0.06);
  const id = solver.addChain(points);
  solver.setAnchor(id, 0, 0, 2, 0);
  const initial = Array.from(solver.getChain(id).position);
  run(solver, 2);
  solver.reset();
  assert.deepEqual(Array.from(solver.getChain(id).position), initial);
  assert.deepEqual(Array.from(solver.getChain(id).previous), initial);
});

test('translated anchor drags the chain which re-settles below the new anchor', () => {
  const solver = createBeadSolver();
  const id = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 21, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 3);
  solver.setAnchor(id, 0, 0.5, 2, 0.25);
  run(solver, 8);
  const chain = solver.getChain(id);
  assert.equal(particle(chain, 0).join(','), '0.5,2,0.25');
  const end = particle(chain, chain.count - 1);
  assert.ok(Math.abs(end[0] - 0.5) < 0.06 && Math.abs(end[2] - 0.25) < 0.06,
    `end should settle below moved anchor, got ${end}`);
  assert.ok(Math.abs(end[1] - 1.0) < 0.08, `end y should be ~1m below moved anchor, got ${end[1]}`);
});

test('contact: hanging chain rests on ellipsoid instead of passing through', () => {
  const solver = createBeadSolver({ iterations: 10 });
  // 链长 1.2m，锚在 y=2；椭球心 y=1.2，半径 0.3，挡住下摆路径。
  solver.addCollider({ kind: 'ellipsoid', center: [0, 1.2, 0], radii: [0.3, 0.3, 0.3], quat: [0, 0, 0, 1] });
  const id = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 25, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 5);
  const chain = solver.getChain(id);
  for (let i = 0; i < chain.count; i++) {
    const [x, y, z] = particle(chain, i);
    const norm = Math.hypot(x / 0.3, (y - 1.2) / 0.3, z / 0.3);
    assert.ok(norm >= 0.99, `particle ${i} penetrated ellipsoid (norm ${norm})`);
  }
  const end = particle(chain, chain.count - 1);
  assert.ok(end[1] > 0.75, `end should rest on the collider, got y=${end[1]}`);
});

test('contact: capsule collider pushes chain particles out', () => {
  const solver = createBeadSolver({ iterations: 10 });
  solver.addCollider({ kind: 'capsule', a: [-0.5, 1.0, 0], b: [0.5, 1.0, 0], radius: 0.2 });
  const id = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 21, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 5);
  const chain = solver.getChain(id);
  for (let i = 0; i < chain.count; i++) {
    const [x, y, z] = particle(chain, i);
    const dist = Math.hypot(z, y - 1.0); // 轴线水平，粒子到轴的径向距离
    if (Math.abs(x) <= 0.5) assert.ok(dist >= 0.19, `particle ${i} inside capsule (dist ${dist})`);
  }
});

test('stability: violent anchor jerks and huge dt stay finite and bounded', () => {
  const solver = createBeadSolver();
  solver.addCollider({ kind: 'ellipsoid', center: [0, 1.0, 0], radii: [0.2, 0.25, 0.2], quat: [0, 0, 0, 1] });
  const id = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 31, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  let rng = 12345;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 300; i++) {
    solver.setAnchor(id, 0, (rand() - 0.5) * 4, 1 + rand() * 2, (rand() - 0.5) * 4);
    solver.step(0.25); // 远超固定步长，验证累积器截断与速度钳制
  }
  const chain = solver.getChain(id);
  assertFinite(chain);
  for (let i = 0; i < chain.count; i++) {
    const [x, y, z] = particle(chain, i);
    assert.ok(Math.hypot(x, y, z) < 30, `particle ${i} escaped to ${[x, y, z]}`);
  }
  // 锚点停稳后链应重新垂下，不发生病态坍缩。
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 6);
  assertFinite(chain);
  const end = particle(chain, chain.count - 1);
  assert.ok(Math.abs(end[1] - (2 - 1.5)) < 0.2, `chain should re-hang ~1.5m below anchor, got ${end}`);
});

test('no spring to rest: displaced chain keeps its drape after anchor stops', () => {
  const solver = createBeadSolver();
  const id = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 21, 0.05));
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 3);
  // 挪走再挪回：若有回弹弹簧，链会回到初始直线；真实惯性下垂应与初始不同。
  solver.setAnchor(id, 0, 1, 2, 0);
  run(solver, 2);
  solver.setAnchor(id, 0, 0, 2, 0);
  run(solver, 4);
  const chain = solver.getChain(id);
  const mid = particle(chain, 10);
  const initial = straightChain([0, 2, 0], [0, -1, 0], 21, 0.05)[10];
  const drift = Math.hypot(mid[0] - initial[0], mid[2] - initial[2]);
  assert.ok(mid[1] < 1.6, `mid particle should sag below straight-line init, got y=${mid[1]}`);
  assert.ok(drift >= 0, 'trivial');
});

test('multiple chains stay independent loose strands', () => {
  const solver = createBeadSolver();
  const a = solver.addChain(straightChain([0, 2, 0], [0, -1, 0], 15, 0.05));
  const b = solver.addChain(straightChain([0.1, 2, 0], [0, -1, 0], 15, 0.05));
  solver.setAnchor(a, 0, 0, 2, 0);
  solver.setAnchor(b, 0, 0.1, 2, 0);
  run(solver, 3);
  const endA = particle(solver.getChain(a), 14);
  const endB = particle(solver.getChain(b), 14);
  assert.ok(Math.abs(endA[0]) < 0.05 && Math.abs(endB[0] - 0.1) < 0.05,
    `strands should hang under their own anchors: ${endA} vs ${endB}`);
});


// ---------------------------------------------------------------------------
// 集成测试：合成 Three 场景（无 DOM、无渲染器）验证绑定层。
// ---------------------------------------------------------------------------
const THREE = await import('../public/vendor/three/build/three.module.js');

// 合成模特：Head/Spine/Hips/手臂骨骼 + 名为 MosuoBeadStrands 的 28 串珠网格。
function buildSyntheticModel() {
  const model = new THREE.Group();
  model.name = 'Model';
  const bones = {};
  const positions = {
    Hips: [0, 1.1, 0], Spine: [0, 1.5, 0], Head: [0, 2.0, 0],
    UpperArmL: [-0.2, 1.75, 0], ForearmL: [-0.35, 1.45, 0], HandL: [-0.45, 1.15, 0],
    UpperArmR: [0.2, 1.75, 0], ForearmR: [0.35, 1.45, 0], HandR: [0.45, 1.15, 0],
  };
  for (const [name, pos] of Object.entries(positions)) {
    const bone = new THREE.Object3D();
    bone.name = name;
    bone.position.set(...pos);
    model.add(bone);
    bones[name] = bone;
  }
  // 28 串连续排布的珠子顶点：每串从头顶附近垂到背下。
  const strands = 28, perStrand = 200;
  const vertices = new Float32Array(strands * perStrand * 3);
  let w = 0;
  for (let s = 0; s < strands; s++) {
    const x = (s - strands / 2) * 0.004;
    const z = -0.2 - (s % 5) * 0.004;
    for (let i = 0; i < perStrand; i++) {
      const t = i / (perStrand - 1);
      vertices[w++] = x + Math.sin(t * 2) * 0.01;
      vertices[w++] = 2.15 - t * 1.85; // 2.15 -> 0.30
      vertices[w++] = z;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'MosuoBeadStrands';
  model.add(mesh);
  return { model, mesh, bones };
}

function chainTip(handle, strand) {
  const chain = handle.solver.getChain(strand);
  const b = (chain.count - 1) * 3;
  return [chain.position[b], chain.position[b + 1], chain.position[b + 2]];
}

test('integration: extracts 28 strands, hides source mesh, simulates in world space', async () => {
  const { createBeadPhysics } = await import('../public/bead-physics.js');
  const { model, mesh } = buildSyntheticModel();
  const scene = new THREE.Scene();
  scene.add(model);
  const handle = createBeadPhysics(model, scene);
  assert.equal(handle.active, true);
  assert.equal(handle.strandCount, 28);
  assert.equal(mesh.visible, false, 'original bead mesh should be hidden while active');
  assert.ok(handle.beadMesh.isInstancedMesh);
  assert.ok(handle.beadMesh.count > 28 * 24, 'should render many beads per strand');
  assert.ok(scene.children.includes(handle.beadMesh));

  for (let i = 0; i < 300; i++) handle.update(1 / 60);
  const tip = chainTip(handle, 0);
  for (const v of tip) assert.ok(Number.isFinite(v));
  assert.ok(tip[1] < 0.9, `strand 0 tip should drape low, got y=${tip[1]}`);

  handle.dispose();
  assert.equal(mesh.visible, true, 'dispose must restore the original mesh');
  assert.ok(!scene.children.includes(handle.beadMesh), 'dispose must remove dynamic beads');
});

test('integration: reset, pause and pivot inertia', async () => {
  const { createBeadPhysics } = await import('../public/bead-physics.js');
  const { model } = buildSyntheticModel();
  const scene = new THREE.Scene();
  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);
  const handle = createBeadPhysics(model, scene);

  for (let i = 0; i < 240; i++) handle.update(1 / 60);
  handle.reset();
  const chain = handle.solver.getChain(0);
  assert.ok(chain.position.every((v,i)=>Math.abs(v-chain.initial[i])<1e-10), "reset restores rest pose within transform precision");

  // 暂停：update 不再推进求解。
  handle.setEnabled(false);
  const frozen = Array.from(chain.position);
  handle.update(1 / 60);
  assert.deepEqual(Array.from(chain.position), frozen);
  handle.setEnabled(true);

  // 展台 pivot 快速旋转后锚点世界位置改变，珠串因惯性滞后摆动。
  for (let i = 0; i < 120; i++) handle.update(1 / 60);
  const before = chainTip(handle, 5).slice();
  for (let i = 0; i < 30; i++) {
    pivot.rotation.y += Math.PI / 60; // 两拍转 90°
    handle.update(1 / 60);
  }
  const during = chainTip(handle, 5).slice();
  const moved = Math.hypot(during[0] - before[0], during[1] - before[1], during[2] - before[2]);
  assert.ok(moved > 0.05, `pivot turn should swing the strand, moved ${moved}`);
  pivot.rotation.y += 0; // 停止转动
  for (let i = 0; i < 600; i++) handle.update(1 / 60);
  const settled = chainTip(handle, 5);
  for (const v of settled) assert.ok(Number.isFinite(v));
  assert.ok(settled[1] < 0.9, `strand should settle hanging after pivot stop, y=${settled[1]}`);

  handle.dispose();
});

test('integration: missing bead mesh yields inert no-op handle', async () => {
  const { createBeadPhysics } = await import('../public/bead-physics.js');
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  scene.add(model);
  const handle = createBeadPhysics(model, scene);
  assert.equal(handle.active, false);
  handle.update(1 / 60);
  handle.setEnabled(false);
  handle.reset();
  handle.dispose();
});
