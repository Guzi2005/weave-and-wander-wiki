import * as T from './vendor/three/build/three.module.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from './vendor/three/addons/environments/RoomEnvironment.js';
import { createBeadPhysics } from './bead-physics.js';

// Godot exports visibility for alternate eye meshes; Three does not yet ship
// this extension. Honor its node state instead of showing both eye states.
function nodeVisibility(parser) {
  return {
    name: 'KHR_node_visibility',
    afterRoot(gltf) {
      for (const scene of gltf.scenes) scene.traverse(object => {
        const index = parser.associations.get(object)?.nodes;
        const visible = parser.json.nodes?.[index]?.extensions?.KHR_node_visibility?.visible;
        if (typeof visible === 'boolean') object.visible = visible;
      });
    },
  };
}

export function mountViewer(container, options={}) {
  const root=options.root||container.parentElement, c=id=>root.querySelector('#'+id);
  const state={mode:'idle',pace:1,spinSpeed:45,spinVariation:0,paused:false,modelReady:false};
  const listeners=[];
  // 重挂载时沿用现有控件值，保持动作/节奏/暂停状态连续。
  {const modeInit=c('motion-mode');if(modeInit?.value)state.mode=modeInit.value;
  for(const[id,key]of[['pace','pace'],['spin-speed','spinSpeed'],['spin-variation','spinVariation']]){const input=c(id);if(input)state[key]=Number(input.value);}
  const pauseInit=c('pause-motion');if(pauseInit)state.paused=pauseInit.textContent==='继续动作';}
  let disposed=false, frame=0, elapsed=0, model, mixer, currentAction, request=0;
  let beadPhysics=null;
  const scene=new T.Scene();
  const perspective=new T.PerspectiveCamera(33,1,.01,100);
  const orthographic=new T.OrthographicCamera(-1,1,1,-1,.01,100);
  let camera=perspective, flat=false;
  const originalMaterials=new Map(), flatMaterials=new Map();
  const renderer=new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1;
  const pmrem=new T.PMREMGenerator(renderer);
  const room=new RoomEnvironment();
  const envRT=pmrem.fromScene(room,.04);
  scene.environment=envRT.texture;
  scene.environmentIntensity=.35;
  release(room);
  renderer.domElement.setAttribute('aria-label','可拖动旋转、滚轮缩放的游戏资产三维预览');
  container.replaceChildren(renderer.domElement);
  const styleControls=document.createElement('div');
  styleControls.className='preview-style';
  styleControls.setAttribute('role','group');
  styleControls.setAttribute('aria-label','渲染风格');
  const styleButtons=['原版透视','扁平正交'].map((label,index)=>{
    const button=document.createElement('button');
    button.type='button';button.textContent=label;
    button.setAttribute('aria-pressed',String(index===0));
    styleControls.append(button);
    return button;
  });
  container.append(styleControls);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.minDistance=.4;orbit.maxDistance=12;
  const pivot=new T.Group();scene.add(pivot);
  const benchRoot=new T.Group();pivot.add(benchRoot);benchRoot.position.z=-.30;benchRoot.visible=false;
  let benchRequest;
  function ensureBench(){return benchRequest??=Promise.all([fetch('/assets/bench/bench.json').then(r=>{if(!r.ok)throw Error('bench');return r.json();}),fetch('/assets/bench/bench.bin').then(r=>{if(!r.ok)throw Error('bench');return r.arrayBuffer();})]).then(([info,bytes])=>{
    if(disposed)return;
    const count=info.vertexCount*3,geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(bytes,0,count),3));
    geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(bytes,count*4,count),3));
    geometry.setAttribute('color',new T.BufferAttribute(new Float32Array(bytes,count*8,count),3));
    geometry.setIndex(new T.BufferAttribute(new Uint32Array(bytes,count*12,info.indexCount),1));
    benchRoot.add(new T.Mesh(geometry,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide})));
  }).catch(()=>{container.dataset.benchError='true';benchRequest=null;});}
  scene.add(new T.HemisphereLight(0xfff8ec,0x7a756d,0.35));
  const light=new T.DirectionalLight(0xfff6e7,0.65);light.position.set(-3,5,4);scene.add(light);
  const floor=new T.Mesh(new T.CircleGeometry(1.3,64),new T.MeshBasicMaterial({color:0xdad2c1}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.visible=false;scene.add(floor);
  const grid=new T.GridHelper(3.2,16,0xbeb6a3,0xd8d1c2);grid.position.y=-.01;grid.visible=false;scene.add(grid);
  const actions={},outputs=options.outputs||{};
  function on(target,event,fn){if(target){target.addEventListener(event,fn);listeners.push([target,event,fn]);}}
  function applyStyle(){
    if(model)model.traverse(node=>{
      if(!node.isMesh)return;
      if(!originalMaterials.has(node))originalMaterials.set(node,node.material);
      const original=originalMaterials.get(node);
      const convert=source=>{
        if(!flatMaterials.has(source)){
          flatMaterials.set(source,new T.MeshBasicMaterial({
            color:source.color??0xffffff,map:source.map,vertexColors:source.vertexColors,
            transparent:source.transparent,opacity:source.opacity,alphaTest:source.alphaTest,
            side:source.side,depthWrite:source.depthWrite
          }));
        }
        return flatMaterials.get(source);
      };
      node.material=flat?(Array.isArray(original)?original.map(convert):convert(original)):original;
    });
    container.dataset.renderStyle=flat?'flat':'original';
  }
  function orthoBounds(height,aspect){
    orthographic.left=-height*aspect/2;orthographic.right=height*aspect/2;
    orthographic.top=height/2;orthographic.bottom=-height/2;
    orthographic.updateProjectionMatrix();
  }
  function setFlat(enabled){
    if(flat===enabled)return;
    orbit.update();
    const distance=camera.position.distanceTo(orbit.target);
    const height=flat?(orthographic.top-orthographic.bottom)/orthographic.zoom:2*distance*Math.tan(T.MathUtils.degToRad(33/2));
    const previous=camera;flat=enabled;camera=flat?orthographic:perspective;
    camera.position.copy(previous.position);camera.quaternion.copy(previous.quaternion);
    if(flat){orthographic.zoom=1;orthoBounds(height,perspective.aspect);}
    else camera.position.copy(orbit.target).add(previous.position.clone().sub(orbit.target).normalize().multiplyScalar(height/(2*Math.tan(T.MathUtils.degToRad(33/2)))));
    orbit.object=camera;orbit.update();applyStyle();
    styleButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(flat===(i===1))));
  }
  styleButtons.forEach((button,i)=>on(button,'click',()=>setFlat(i===1)));
  function clearStyle(){
    for(const [mesh,material] of originalMaterials)mesh.material=material;
    originalMaterials.clear();
    for(const material of flatMaterials.values())material.dispose();
    flatMaterials.clear();
  }
  function release(object,seen=new Set()) {
    object?.traverse(n => {
      if (!(n.isMesh || n.isLine || n.isPoints)) return;
      for (const resource of [n.skeleton, n.geometry]) {
        if (resource && !seen.has(resource)) { seen.add(resource); resource.dispose(); }
      }
      for (const material of [].concat(n.material || [])) {
        if (seen.has(material)) continue;
        seen.add(material);
        for (const texture of Object.values(material)) {
          if (!texture?.isTexture || seen.has(texture)) continue;
          seen.add(texture);
          // GLTFLoader uses ImageBitmap; GPU disposal alone retains its CPU data.
          const bitmap = texture.source?.data;
          if (bitmap?.close && !seen.has(bitmap)) { seen.add(bitmap); bitmap.close(); }
          texture.dispose();
        }
        material.dispose();
      }
    });
  }
  function sync(){
    benchRoot.visible=!!actions[state.mode] && ['sit','lie'].includes(state.mode);
    if(benchRoot.visible)ensureBench();
    if(outputs.pace)outputs.pace.textContent=state.pace.toFixed(2)+'×';
    if(outputs.spinSpeed)outputs.spinSpeed.textContent=state.spinSpeed+'°/s';
    if(outputs.spinVariation)outputs.spinVariation.textContent=Math.round(state.spinVariation*100)+'%';
    const key=actions[state.mode]?state.mode:'idle',next=actions[key]||actions.idle;
    if(next&&next!==currentAction){currentAction?.stop();next.reset().play();currentAction=next;}
    if(currentAction)currentAction.timeScale=key==='walk'?state.pace:1;
    if(c('motion-status'))c('motion-status').textContent=state.modelReady?`${state.paused?'已暂停':({idle:'待机 · 呼吸',walk:'原地行走',spin:'转圈',sewing:'缝制',handwork:'手持鞋垫',sit:'坐下',lie:'坐下 → 躺卧'})[state.mode]} · 拖动旋转 / 滚轮缩放`:'正在读取游戏模型…';
    container.dataset.motion=state.mode;container.dataset.paused=String(state.paused);
  }
  let modelSize=new T.Vector3(1,2.8,1);
  function fitHome(){const fov=T.MathUtils.degToRad(33/2),height=Math.max(modelSize.y,.5),width=Math.max(modelSize.x,modelSize.z,.5);homeCamera=homeTarget.clone().add(new T.Vector3(0,.15,1.15*Math.max(height/(2*Math.tan(fov)),width/(2*Math.tan(fov)*perspective.aspect))));orthoBounds(2*homeCamera.distanceTo(homeTarget)*Math.tan(fov),perspective.aspect);}
  let homeTarget=new T.Vector3(0,1.4,0),homeCamera=new T.Vector3(0,1.7,6);
  function setAngle(degrees){pivot.rotation.y=degrees*Math.PI/180;container.dataset.angle=pivot.rotation.y.toFixed(4);beadPhysics?.reset();}
  function resetView(){setAngle(0);elapsed=0;orthographic.zoom=1;orthographic.updateProjectionMatrix();camera.position.copy(homeCamera);orbit.target.copy(homeTarget);orbit.update();}
  async function load(url){
    const serial=++request;state.modelReady=false;container.dataset.modelReady='false';container.dataset.animationTime='0.000';sync();
    try{
      const gltf=await new GLTFLoader().register(nodeVisibility).loadAsync(url);
      if(disposed||serial!==request){release(gltf.scene);return;}
      if(model){clearStyle();beadPhysics?.dispose();beadPhysics=null;mixer?.stopAllAction();mixer?.uncacheRoot(model);pivot.remove(model);release(model);}
      model=gltf.scene;pivot.add(model);mixer=new T.AnimationMixer(model);currentAction=null;
      beadPhysics=createBeadPhysics(model,scene);
      beadPhysics.setFurnitureRoot?.(benchRoot);
      updatePhysicsParameters();
      container.dataset.beadPhysics=String(beadPhysics.active);
      for(const key of Object.keys(actions))delete actions[key];
      for(const clip of gltf.animations){const key=['walk','idle','sewing','handwork','sit','lie'].find(name=>clip.name.endsWith(name));if(key){actions[key]=mixer.clipAction(clip);if(['sit','lie'].includes(key)){actions[key].setLoop(T.LoopOnce,1);actions[key].clampWhenFinished=true;}}}
      const select=c('motion-mode');
      if(select){
        select.replaceChildren();
        for(const [id,label] of Object.entries({idle:'待机',walk:'行走',spin:'转圈',sewing:'缝制',handwork:'手持鞋垫',sit:'坐下',lie:'躺卧'})){
          if(id==='spin'||actions[id])select.add(new Option(label,id));
        }
        if(state.mode!=='spin'&&!actions[state.mode])state.mode='idle';
        select.value=state.mode;
      }
      if(!actions.idle||!actions.walk)throw Error('模型缺少 idle / walk 动画');
      const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3());
      modelSize.copy(size);homeTarget=bounds.getCenter(new T.Vector3());fitHome();
      state.modelReady=true;container.dataset.modelReady='true';container.dataset.modelUrl=url;container.dataset.clips=gltf.animations.map(c=>c.name).join(',');
      resetView();sync();applyStyle();
    }catch(e){if(disposed||serial!==request)return;container.dataset.modelReady='false';if(c('motion-status'))c('motion-status').textContent='模型加载失败：'+e.message;}
  }
  on(c('motion-mode'),'change',e=>{state.mode=e.target.value;beadPhysics?.reset();sync();});
  function updatePhysicsParameters(){beadPhysics?.setParameters?.({damping:Number(c('physics-damping')?.value??.08),gravityScale:Number(c('physics-gravity')?.value??1),beadDiameter:Number(c('bead-size')?.value??.008)});}
  for(const id of ['physics-damping','physics-gravity','bead-size'])on(c(id),'input',updatePhysicsParameters);
  on(c('reset-physics'),'click',()=>{updatePhysicsParameters();beadPhysics?.reset();});
  for(const[id,key]of[['pace','pace'],['spin-speed','spinSpeed'],['spin-variation','spinVariation']])on(c(id),'input',e=>{state[key]=Number(e.target.value);sync();});
  on(c('pause-motion'),'click',e=>{state.paused=!state.paused;e.target.textContent=state.paused?'继续动作':'暂停动作';sync();});
  on(c('reset-view'),'click',resetView);
  on(c('replay-motion'),'click',()=>{elapsed=0;currentAction?.reset().play();mixer?.update(0);beadPhysics?.reset();state.paused=false;if(c('pause-motion'))c('pause-motion').textContent='暂停动作';sync();});
  on(c('step-motion'),'click',()=>{state.paused=true;if(c('pause-motion'))c('pause-motion').textContent='继续动作';advanceMotion(1/60);sync();});
  on(c('motion-progress'),'input',e=>{if(!currentAction)return;state.paused=true;currentAction.paused=false;currentAction.time=Number(e.target.value)*currentAction.getClip().duration;mixer.update(0);beadPhysics?.reset();if(c('pause-motion'))c('pause-motion').textContent='继续动作';sync();});
  root.querySelectorAll('[data-pace]').forEach(b=>on(b,'click',()=>{state.mode='walk';state.pace=Number(b.dataset.pace);c('motion-mode').value='walk';c('pace').value=state.pace;sync();}));
  // The viewer itself also has data-angle. Only buttons are angle presets;
  // otherwise clicks that bubble from the canvas unexpectedly rotate the model.
  root.querySelectorAll('button[data-angle]').forEach(b=>on(b,'click',()=>setAngle(Number(b.dataset.angle))));
  const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);perspective.aspect=w/Math.max(h,1);perspective.updateProjectionMatrix();fitHome();camera.position.copy(homeCamera);orbit.target.copy(homeTarget);orbit.update();});resize.observe(container);
  function advanceMotion(delta){
    if(!state.modelReady)return;
    elapsed+=delta;mixer.update(delta);
    const speed=state.spinSpeed*(1+state.spinVariation*Math.sin(elapsed*Math.PI/2));
    if(state.mode==='spin')pivot.rotation.y+=T.MathUtils.degToRad(speed)*delta;
    container.dataset.angle=pivot.rotation.y.toFixed(4);container.dataset.animationTime=mixer.time.toFixed(3);
    beadPhysics?.update(delta);
  }
  let previous=performance.now();
  function animate(now){
    if(disposed)return;frame=requestAnimationFrame(animate);const delta=Math.min((now-previous)/1000,.08);previous=now;
    if(!state.paused)advanceMotion(delta);
    if(currentAction&&c('motion-progress'))c('motion-progress').value=String(currentAction.time/currentAction.getClip().duration);
    orbit.update();renderer.render(scene,camera);
    container.dataset.triangles=String(renderer.info.render.triangles);
    container.dataset.drawCalls=String(renderer.info.render.calls);
  }
  frame=requestAnimationFrame(animate);load(options.modelUrl||'/assets/models/mosuo_ensemble.glb');
  return{state,load,cleanup(){if(disposed)return;disposed=true;request++;cancelAnimationFrame(frame);resize.disconnect();listeners.forEach(([t,e,f])=>t.removeEventListener(e,f));beadPhysics?.dispose();mixer?.stopAllAction();if(mixer&&model)mixer.uncacheRoot(model);orbit.dispose();clearStyle();release(scene);scene.environment=null;envRT.dispose();pmrem.dispose();renderer.dispose();container.replaceChildren();}};
}
export function cleanup(handle){handle?.cleanup();}
