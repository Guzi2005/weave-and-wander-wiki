// Labels live in screen space: their font and hit targets never scale with the map.
const SMALL_REGIONS=new Set(['110000','120000','310000','810000','820000']);
const project=([lon,lat])=>[(lon-73)*9,(54-lat)*10];
const overlaps=(a,b,gap=3)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
function ringArea(ring){return Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0));}
function interiorScore(x,y,ring){
  let inside=false,distance=Infinity;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length)):0;
    distance=Math.min(distance,(x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2);
  }
  return inside?Math.sqrt(distance):-Math.sqrt(distance);
}
// Pick the widest interior of the largest land polygon, rather than a centroid in water.
export function labelAnchor(feature){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const ring=polygons.map(p=>p[0].map(project)).sort((a,b)=>ringArea(b)-ringArea(a))[0];
  const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
  const bounds={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  let best={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2,score:-Infinity};
  let search={...bounds};
  for(let pass=0;pass<4;pass++){
    const stepX=search.w/8,stepY=search.h/8;
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const x=search.x+(col+.5)*stepX,y=search.y+(row+.5)*stepY,score=interiorScore(x,y,ring);
      if(score>best.score)best={x,y,score};
    }
    search={x:best.x-stepX,y:best.y-stepY,w:stepX*2,h:stepY*2};
  }
  return {x:best.x,y:best.y,area:ringArea(ring)};
}
export function mountMapLabels({slot,svg,regions,paths,signal,onHover,onLeave}){
  const layer=document.createElement('div');layer.className='rm-screen-labels';

  const rows=regions.map(region=>{
    const anchor=labelAnchor(region.feature);
    const label=document.createElement('span');label.className='rm-map-label';label.dataset.id=region.id;label.setAttribute('aria-hidden','true');label.textContent=region.short;layer.append(label);
    let marker=null;
    if(SMALL_REGIONS.has(region.id)){
      marker=document.createElement('button');marker.type='button';marker.className='rm-location-marker is-pin';
      marker.dataset.region=region.id;marker.setAttribute('aria-label',`${region.name}，查看地域词条`);marker.title=region.name;
      const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');marker.append(dot);
      marker.addEventListener('focus',()=>{if(marker.matches(':focus-visible'))onHover(region,paths.get(region.id));},{signal});
      marker.addEventListener('blur',()=>onLeave(paths.get(region.id)),{signal});
      layer.append(marker);
    }
    return {region,anchor,label,marker,visible:false,desired:false,pendingSince:0};
  });
  slot.append(layer);
  function nearestPin(event){
    const rect=slot.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    return rows.filter(row=>row.marker&&!row.marker.hidden&&row.point&&Math.abs(row.point.x-x)<=11&&Math.abs(row.point.y-y)<=11)
      .sort((a,b)=>Math.hypot(a.point.x-x,a.point.y-y)-Math.hypot(b.point.x-x,b.point.y-y))[0];
  }
  layer.addEventListener('pointermove',event=>{
    const row=nearestPin(event);rows.forEach(item=>item.marker?.classList.toggle('is-point-hovered',item===row));
    if(row)onHover(row.region,paths.get(row.region.id));
  },{signal});
  layer.addEventListener('pointerleave',()=>{rows.forEach(row=>row.marker?.classList.remove('is-point-hovered'));onLeave();},{signal});
  layer.addEventListener('click',event=>{
    if(event.detail!==0){const row=nearestPin(event);if(row)event.mapRegionId=row.region.id;}
  },{signal});
  let settleFrame=0,lastSelected=null;
  function layout(selected){
    if(signal.aborted)return;
    cancelAnimationFrame(settleFrame);settleFrame=0;lastSelected=selected;
    const now=performance.now();let pending=false;
    const matrix=svg.getScreenCTM(),rect=slot.getBoundingClientRect();if(!matrix||!rect.width||!rect.height)return;
    const scale=Math.hypot(matrix.a,matrix.b);
    const screen=anchor=>({x:anchor.x*matrix.a+matrix.e-rect.left,y:anchor.y*matrix.d+matrix.f-rect.top});
    const within=(box,pad=5)=>box.x>=pad&&box.y>=pad&&box.x+box.w<=rect.width-pad&&box.y+box.h<=rect.height-pad;
    const accepted=[];

    const inset=svg.querySelector('.rm-inset')?.getBoundingClientRect();
    if(inset)accepted.push({x:inset.x-rect.x,y:inset.y-rect.y,w:inset.width,h:inset.height});

    function fits(row,box){
      const path=paths.get(row.region.id),pad=row.visible?0:2;
      // Test the text rectangle against the actual province, including concave borders.
      for(const fx of [0,.25,.5,.75,1])for(const fy of [0,.5,1]){
        const point=new DOMPoint((box.x-pad+(box.w+2*pad)*fx+rect.left-matrix.e)/matrix.a,(box.y-pad+(box.h+2*pad)*fy+rect.top-matrix.f)/matrix.d);
        if(!path.isPointInFill(point))return false;
      }
      return true;
    }
    for(const row of rows){
      if(row.marker)row.marker.hidden=true;
      row.label.classList.toggle('is-selected',row.region.id===selected);
      const point=screen(row.anchor),w=row.label.offsetWidth,h=14;
      row.point=point;row.box={x:point.x-w/2,y:point.y-h/2,w,h};
      row.fits=within(row.box,row.visible?2:5)&&fits(row,row.box);
      row.label.style.left=`${row.box.x}px`;row.label.style.top=`${row.box.y}px`;
    }
    // Pins stay at their geographic anchor. Never clamp them to viewport edges.
    for(const row of rows.filter(r=>r.marker)){
      const {point,marker}=row;
      const box={x:point.x-11,y:point.y-11,w:22,h:22};
      if(!within(box))continue;
      marker.style.left=`${box.x}px`;marker.style.top=`${box.y}px`;
      marker.hidden=row.visible;marker.setAttribute('aria-current',row.region.id===selected?'page':'false');
      if(!row.visible)accepted.push({x:point.x-5,y:point.y-5,w:10,h:10,id:row.region.id});
    }
    // Preserve established labels and use separate entry/exit margins and dwell times.
    const ordered=[...rows].sort((a,b)=>Number(b.region.id===selected)-Number(a.region.id===selected)||Number(b.visible)-Number(a.visible)||b.anchor.area-a.anchor.area);
    for(const row of ordered){
      const desired=row.fits&&!accepted.some(box=>box.id!==row.region.id&&overlaps(row.box,box,row.visible?1:4));
      if(desired!==row.desired){row.desired=desired;row.pendingSince=now;}
      if(!within(row.box,0)){row.visible=false;}
      else if(desired!==row.visible){
        if(now-row.pendingSince>=(desired?75:100))row.visible=desired;
        else pending=true;
      }
      row.label.style.visibility=row.visible?'visible':'hidden';
      if(row.visible||desired)accepted.push({...row.box,id:row.region.id});
      if(row.marker){const box={x:row.point.x-11,y:row.point.y-11,w:22,h:22};row.marker.hidden=row.visible||!within(box);}
    }
    if(pending)settleFrame=requestAnimationFrame(()=>layout(lastSelected));
    const caption=svg.querySelector('.rm-map-caption');if(caption)caption.style.fontSize=`${10/scale}px`;
  }
  return {layout,destroy(){cancelAnimationFrame(settleFrame);layer.remove();}};
}
