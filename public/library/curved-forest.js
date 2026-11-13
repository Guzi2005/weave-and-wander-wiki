export function connectForest(host){
  if(!host)return()=>{};
  host.classList.add('cm-curved-forest');
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.classList.add('cm-forest-curves');svg.setAttribute('aria-hidden','true');host.append(svg);
  let frame=0,disposed=false;
  const draw=()=>{
    frame=0;if(disposed||!host.isConnected)return;
    const bounds=host.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${Math.max(bounds.width,1)} ${Math.max(bounds.height,1)}`);svg.setAttribute('width',bounds.width);svg.setAttribute('height',bounds.height);
    const paths=[];
    for(const node of host.querySelectorAll('.cu-node')){
      const parent=node.querySelector(':scope > .cu-node-row');if(!parent)continue;
      const start=parent.getBoundingClientRect();
      for(const child of node.querySelectorAll(':scope > .cm-mind-children > ul > .cu-node > .cu-node-row')){
        const end=child.getBoundingClientRect(),x1=start.right-bounds.left,y1=start.top+start.height/2-bounds.top,x2=end.left-bounds.left,y2=end.top+end.height/2-bounds.top;
        const bend=Math.max(6,(x2-x1)*.55),path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);paths.push(path);
      }
    }
    svg.replaceChildren(...paths);
  };
  const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(draw);};
  const observer=new ResizeObserver(schedule);observer.observe(host);host.querySelectorAll('.cu-node-row').forEach(row=>observer.observe(row));window.addEventListener('resize',schedule);document.fonts?.ready.then(schedule);schedule();
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);svg.remove();};
}
