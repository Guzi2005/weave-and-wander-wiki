import * as T from './vendor/three/build/three.module.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';
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
  const camera=new T.OrthographicCamera(-1,1,1,-1,.01,100);
  let aspect=1;
  const originalMaterials=new Map(), flatMaterials=new Map();
  const renderer=new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1;
  renderer.domElement.setAttribute('aria-label','可拖动旋转、滚轮缩放的游戏资产三维预览');
  container.replaceChildren(renderer.domElement);
  container.dataset.renderStyle='flat';
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.minDistance=.4;orbit.maxDistance=12;orbit.minZoom=.35;orbit.maxZoom=8;
  const pivot=new T.Group();scene.add(pivot);
  // OrbitControls owns elevation, pan and pinch. Horizontal dragging turns
  // the physical frame, so a stationary camera still sees cloth lag behind.
  orbit.minAzimuthAngle = orbit.maxAzimuthAngle = 0;
  const pointers = new Map();
  const canvas = renderer.domElement;
  on(canvas,'pointerdown', e => { if (e.button === 0) pointers.set(e.pointerId,e.clientX); });
  on(canvas,'pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const dx = e.clientX - pointers.get(e.pointerId);
    pointers.set(e.pointerId,e.clientX);
    if (pointers.size === 1 && !e.ctrlKey && !e.shiftKey && !e.metaKey)
      pivot.rotation.y += dx * Math.PI * 2 / Math.max(240,canvas.clientWidth);
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture'])
    on(canvas,event,e => pointers.delete(e.pointerId));
  let lastYaw=0, clothLag=0, lagSpeed=0, hems=[];
  function resetCloth() { lastYaw=pivot.rotation.y; clothLag=0; lagSpeed=0; }
  function simulateCloth(dt) {
    const turn = Math.atan2(Math.sin(pivot.rotation.y-lastYaw),Math.cos(pivot.rotation.y-lastYaw));
    lastYaw=pivot.rotation.y;
    clothLag=T.MathUtils.clamp(clothLag-turn,-.65,.65);
    for(let remaining=dt; remaining>0.00001;) {
      const h=Math.min(remaining,1/120);
      lagSpeed+=(-55*clothLag-8*lagSpeed)*h;
      clothLag+=lagSpeed*h; remaining-=h;
    }
    for(const hem of hems) {
      const x=hem.rest.x, z=hem.rest.z;
      hem.delta.set(x*(Math.cos(clothLag)-1)+z*Math.sin(clothLag),0,
        z*(Math.cos(clothLag)-1)-x*Math.sin(clothLag));
      hem.bone.position.add(hem.delta);
    }
  }
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
  const floor=new T.Mesh(new T.CircleGeometry(1.3,64),new T.MeshBasicMaterial({color:0xdad2c1}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.visible=false;scene.add(floor);
  const grid=new T.GridHelper(3.2,16,0xbeb6a3,0xd8d1c2);grid.position.y=-.01;grid.visible=false;scene.add(grid);
  const actions={},outputs=options.outputs||{};
  function on(target,event,fn){if(target){target.addEventListener(event,fn);listeners.push([target,event,fn]);}}
  function applyFlatMaterials(){
    const convert=source=>{
      if(source.isMeshBasicMaterial)return source;
      if(!flatMaterials.has(source)){
        flatMaterials.set(source,new T.MeshBasicMaterial({
          color:source.color,map:source.map,alphaMap:source.alphaMap,
          vertexColors:source.vertexColors,transparent:source.transparent,
          opacity:source.opacity,alphaTest:source.alphaTest,
          side:source.side,depthWrite:source.depthWrite,
        }));
      }
      return flatMaterials.get(source);
    };
    model.traverse(node=>{
      if(!node.isMesh)return;
      originalMaterials.set(node,node.material);
      node.material=Array.isArray(node.material)?node.material.map(convert):convert(node.material);
    });
  }
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
  function fitHome(){
    const height=1.15*Math.max(modelSize.y,.5,modelSize.x/aspect,modelSize.z/aspect);
    camera.left=-height*aspect/2;
    camera.right=height*aspect/2;
    camera.top=height/2;
    camera.bottom=-height/2;
    camera.updateProjectionMatrix();
    homeCamera=homeTarget.clone().add(new T.Vector3(0,.15,Math.max(3,height)));
  }
  let homeTarget=new T.Vector3(0,1.4,0),homeCamera=new T.Vector3(0,1.7,6);
  function setAngle(degrees){pivot.rotation.y=degrees*Math.PI/180;container.dataset.angle=pivot.rotation.y.toFixed(4);beadPhysics?.reset();}
  function resetView(){setAngle(0);resetCloth();elapsed=0;camera.zoom=1;camera.updateProjectionMatrix();camera.position.copy(homeCamera);orbit.target.copy(homeTarget);orbit.update();}
  async function load(url){
    const serial=++request;state.modelReady=false;container.dataset.modelReady='false';container.dataset.animationTime='0.000';sync();
    try{
      const gltf=await new GLTFLoader().register(nodeVisibility).loadAsync(url);
      if(disposed||serial!==request){release(gltf.scene);return;}
      if(model){clearStyle();beadPhysics?.dispose();beadPhysics=null;mixer?.stopAllAction();mixer?.uncacheRoot(model);pivot.remove(model);release(model);}
      model=gltf.scene;
      applyFlatMaterials();
      pivot.add(model);mixer=new T.AnimationMixer(model);currentAction=null;
      hems=['HemL','HemR','HemFront','HemBack'].map(name=>model.getObjectByName(name))
        .filter(Boolean).map(bone=>({bone,rest:bone.position.clone(),delta:new T.Vector3()}));
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
          if(id==='spin'||actions[id]||(id==='idle'&&options.allowStatic))select.add(new Option(id==='idle'&&!actions.idle?'静止':label,id));
        }
        if(state.mode!=='spin'&&!actions[state.mode])state.mode='idle';
        select.value=state.mode;
      }
      if(!options.allowStatic&&(!actions.idle||!actions.walk))throw Error('模型缺少 idle / walk 动画');
      const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3());
      modelSize.copy(size);homeTarget=bounds.getCenter(new T.Vector3());fitHome();
      state.modelReady=true;container.dataset.modelReady='true';container.dataset.modelUrl=url;container.dataset.clips=gltf.animations.map(c=>c.name).join(',');
      resetView();sync();
    }catch(e){if(disposed||serial!==request)return;container.dataset.modelReady='false';if(c('motion-status'))c('motion-status').textContent='模型加载失败：'+e.message;options.onError?.(e);}
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
  const resize=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);aspect=Math.max(w,1)/Math.max(h,1);fitHome();camera.position.copy(homeCamera);orbit.target.copy(homeTarget);orbit.update();});resize.observe(container);
  function advanceMotion(delta){
    if(!state.modelReady)return;
    elapsed+=delta;mixer.update(delta);
    const speed=state.spinSpeed*(1+state.spinVariation*Math.sin(elapsed*Math.PI/2));
    if(state.mode==='spin')pivot.rotation.y+=T.MathUtils.degToRad(speed)*delta;
    container.dataset.angle=pivot.rotation.y.toFixed(4);container.dataset.animationTime=mixer.time.toFixed(3);

  }
  let previous=performance.now();
  function animate(now){
    if(disposed)return;frame=requestAnimationFrame(animate);const delta=Math.min((now-previous)/1000,.08);previous=now;
    for(const hem of hems) { hem.bone.position.sub(hem.delta); hem.delta.set(0,0,0); }
    if(!state.paused)advanceMotion(delta);
    simulateCloth(delta);
    beadPhysics?.update(delta);
    if(currentAction&&c('motion-progress'))c('motion-progress').value=String(currentAction.time/currentAction.getClip().duration);
    orbit.update();renderer.render(scene,camera);
    container.dataset.triangles=String(renderer.info.render.triangles);
    container.dataset.drawCalls=String(renderer.info.render.calls);
  }
  frame=requestAnimationFrame(animate);load(options.modelUrl||'/assets/models/mosuo_ensemble.glb');
  return{state,load,cleanup(){if(disposed)return;disposed=true;request++;cancelAnimationFrame(frame);resize.disconnect();listeners.forEach(([t,e,f])=>t.removeEventListener(e,f));beadPhysics?.dispose();mixer?.stopAllAction();if(mixer&&model)mixer.uncacheRoot(model);orbit.dispose();clearStyle();release(scene);renderer.dispose();container.replaceChildren();}};
}
export function cleanup(handle){handle?.cleanup();}
