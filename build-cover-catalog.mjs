import fs from 'node:fs';
const root=new URL('./public/assets/',import.meta.url);
const catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',root),'utf8'));
for(const entry of Object.values(catalog.assets)){
 entry.cover='/assets/'+entry.model+'-cover.png';
 const bytes=fs.readFileSync(new URL('models/'+entry.model+'.glb',root));
 const len=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+len)),bin=bytes.subarray(28+len);
 const node=doc.nodes.find(n=>['MosuoPleatedSkirt','MosuoBlouse'].includes(n.name));
 if(!node)continue;
 const prim=doc.meshes[node.mesh].primitives[0],idx=prim.attributes.TEXCOORD_0;
 if(idx===undefined)continue;
 const a=doc.accessors[idx],v=doc.bufferViews[a.bufferView];
 const uv=[];for(let i=0;i<a.count;i++){const off=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||8);uv.push([bin.readFloatLE(off),bin.readFloatLE(off+4)]);}
 const ind=doc.accessors[prim.indices],iv=doc.bufferViews[ind.bufferView],size=ind.componentType===5125?4:2;
 const indices=[];for(let i=0;i<ind.count;i++){const off=(iv.byteOffset||0)+(ind.byteOffset||0)+i*size;indices.push(size===4?bin.readUInt32LE(off):bin.readUInt16LE(off));}
 const xs=uv.map(p=>p[0]),ys=uv.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),dx=Math.max(...xs)-minX||1,dy=Math.max(...ys)-minY||1;
 const paths=[];for(let i=0;i<indices.length;i+=3){paths.push(indices.slice(i,i+3).map((id,j)=>`${j?'L':'M'}${(24+(uv[id][0]-minX)/dx*552).toFixed(1)} ${(24+(uv[id][1]-minY)/dy*552).toFixed(1)}`).join(' ')+'Z');}
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f5f6f3"/><path d="${paths.join(' ')}" fill="none" stroke="#748588" stroke-width=".35"/></svg>`;
 fs.writeFileSync(new URL(entry.model+'-uv.svg',root),svg);
 entry.drawing='/assets/'+entry.model+'-uv.svg';entry.drawing_label=(node.name==='MosuoPleatedSkirt'?'长裙':'上衣')+' UV 展开';
}
fs.writeFileSync(new URL('catalog.json',root),JSON.stringify(catalog,null,2));
