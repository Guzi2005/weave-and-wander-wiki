import {readFile,open} from 'node:fs/promises';
import path from 'node:path';
let manifestPromise;
export function loadLibraryAssets(publicDir){return manifestPromise??= (async()=>{
 const read=async file=>JSON.parse(await readFile(path.join(publicDir,file),'utf8'));
 const [catalog,motifs,nodes]=await Promise.all([read('assets/catalog.json'),read('assets/motifs/manifest.json'),read('assets/node-styles/manifest.json')]);
 const assets={};for(const [id,asset] of Object.entries(catalog.assets)){let modelAvailable=false;try{const handle=await open(path.join(publicDir,'assets/models',asset.model+'.glb'));try{const buffer=Buffer.alloc(4);await handle.read(buffer,0,4,0);modelAvailable=buffer.toString()==='glTF';}finally{await handle.close();}}catch{}assets[id]={...asset,modelAvailable};}
 return {assets,motifs:motifs.entries,nodes:nodes.entries};
})();}
