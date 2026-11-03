import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../public/vendor/three/build/three.module.js';
import {createBeadPhysics} from '../public/bead-physics.js';

test('actual exported bead mesh: chains move, stay finite and release cleanly',()=>{
 const bytes=readFileSync(new URL('../public/assets/models/mosuo_ensemble.glb',import.meta.url));
 const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length);
 function attribute(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};const types={5126:Float32Array,5123:Uint16Array,5125:Uint32Array,5121:Uint8Array};const Type=types[a.componentType],size=sizes[a.type];if(v.byteStride && v.byteStride!==size*Type.BYTES_PER_ELEMENT){const out=new Type(a.count*size);for(let i=0;i<a.count;i++){const start=(v.byteOffset||0)+(a.byteOffset||0)+i*v.byteStride;const data=binary.subarray(start,start+size*Type.BYTES_PER_ELEMENT);out.set(new Type(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)),i*size);}return new T.BufferAttribute(out,size);}const data=binary.subarray((v.byteOffset||0)+(a.byteOffset||0),(v.byteOffset||0)+(a.byteOffset||0)+a.count*size*Type.BYTES_PER_ELEMENT);return new T.BufferAttribute(new Type(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)),size);}
 const nodes=doc.nodes.map(n=>{const o=new T.Bone();o.name=n.name||'';if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}return o;});
 doc.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>nodes[i].add(nodes[c])));
 const model=new T.Group(),scene=new T.Scene();scene.add(model);doc.scenes[doc.scene||0].nodes.forEach(i=>model.add(nodes[i]));scene.updateMatrixWorld(true);
 const index=doc.nodes.findIndex(n=>n.name?.startsWith('MosuoBeadStrands'));assert.ok(index>=0);
 const n=doc.nodes[index],p=doc.meshes[n.mesh].primitives[0],g=new T.BufferGeometry();
 for(const [source,target] of [['POSITION','position'],['JOINTS_0','skinIndex'],['WEIGHTS_0','skinWeight']])g.setAttribute(target,attribute(p.attributes[source]));
 const mesh=new T.SkinnedMesh(g,new T.MeshBasicMaterial());mesh.name='MosuoBeadStrands';nodes[index].name='BeadContainer';nodes[index].add(mesh);
 const skin=doc.skins[n.skin],inv=attribute(skin.inverseBindMatrices).array;
 const skeleton=new T.Skeleton(skin.joints.map(i=>nodes[i]),skin.joints.map((_,i)=>new T.Matrix4().fromArray(inv,i*16)));mesh.bind(skeleton,new T.Matrix4());scene.updateMatrixWorld(true);skeleton.update();
 const physics=createBeadPhysics(model,scene);assert.equal(physics.active,true);assert.equal(physics.strandCount,28);
 const initial=physics.solver.getChain(0).position.slice();
 for(let i=0;i<120;i++){model.rotation.y=Math.sin(i/30)*.4;physics.update(1/60);}
 const after=physics.solver.getChain(0).position;assert.ok(after.every(Number.isFinite));assert.notDeepEqual([...after],[...initial]);
 const snapshot=after.slice();physics.update(0);assert.deepEqual(after,snapshot);
 model.rotation.y=0;physics.reset();
 for(let i=0;i<600;i++)physics.update(1/60);
 const chain=physics.solver.getChain(0),last=chain.position.length-3;
 assert.ok(chain.pins.size>1 && chain.pins.size<chain.count/2,'preserve shoulder support, leave lower majority free');
 assert.ok(chain.position[last+2]>0,'settled free end must stay in front of body');
 assert.ok(chain.position[last+1]<1,'free end hangs below waist');
 // A horizontal pose must not reclassify strands by world-space height.
 model.rotation.x=Math.PI/2;physics.reset();
 assert.ok(chain.position.every(Number.isFinite));
 assert.ok(chain.position.every((v,i)=>v===chain.previous[i]),'reset injects no velocity');
 physics.setParameters({beadDiameter:.01,damping:.12,gravityScale:1});
 const matrix=new T.Matrix4();physics.beadMesh.getMatrixAt(0,matrix);
 assert.ok(Math.abs(new T.Vector3().setFromMatrixScale(matrix).x-.005)<1e-7);
 assert.equal(mesh.visible,false);physics.dispose();assert.equal(mesh.visible,true);
 for(const name of ['sit','lie']){const clip=doc.animations.find(a=>a.name===name);assert.ok(clip);assert.equal(clip.channels.filter(c=>c.target.path==='weights').length,2);
  const rootChannel=clip.channels.find(c=>c.target.node===14&&c.target.path==='translation');assert.ok(rootChannel);
  const rootOut=attribute(doc.animations[doc.animations.indexOf(clip)].samplers[rootChannel.sampler].output).array;
  if(name==='lie')assert.ok(Math.abs(rootOut[rootOut.length-2]-.60)<.02,'lie pelvis stays inside bench depth');
 }
});
