import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const modelDir = path.join(root, 'public', 'assets', 'models');
const assetDir = path.join(root, 'public', 'assets');
const models = process.argv.slice(2);
if (!models.length) throw new Error('Usage: node build-uv-atlas.mjs model_name [...]');

const components = {
  5120: {bytes:1, read:'getInt8'}, 5121: {bytes:1, read:'getUint8'},
  5122: {bytes:2, read:'getInt16'}, 5123: {bytes:2, read:'getUint16'},
  5125: {bytes:4, read:'getUint32'}, 5126: {bytes:4, read:'getFloat32'},
};

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB header');
  let offset = 12, json, bin;
  while (offset < bytes.length) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).replace(/\0+$/g, ''));
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB is missing JSON or BIN chunk');
  return {json, bin};
}

function accessorReader(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const info = components[accessor.componentType];
  const width = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[accessor.type];
  if (!info || !width) throw new Error(`Unsupported accessor ${accessorIndex}`);
  const stride = bufferView.byteStride || info.bytes * width;
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return {
    count:accessor.count,
    get(index, component=0) { return view[info.read](start + index * stride + component * info.bytes, true); },
  };
}

function uvSvg(gltf, bin, modelName) {
  const edges = new Set();
  const point = (uv, i) => [Math.max(0,Math.min(1,uv.get(i,0))), Math.max(0,Math.min(1,uv.get(i,1)))];
  const key = (a,b) => {
    const pa=`${a[0].toFixed(5)},${a[1].toFixed(5)}`, pb=`${b[0].toFixed(5)},${b[1].toFixed(5)}`;
    return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
  };
  for (const mesh of gltf.meshes || []) for (const primitive of mesh.primitives || []) {
    if (primitive.attributes?.TEXCOORD_0 === undefined) continue;
    const uv = accessorReader(gltf, bin, primitive.attributes.TEXCOORD_0);
    const indices = primitive.indices === undefined ? null : accessorReader(gltf, bin, primitive.indices);
    const count = indices?.count || uv.count;
    for (let i=0;i+2<count;i+=3) {
      const ids=[0,1,2].map(j => indices ? indices.get(i+j) : i+j);
      const pts=ids.map(id => point(uv,id));
      edges.add(key(pts[0],pts[1]));edges.add(key(pts[1],pts[2]));edges.add(key(pts[2],pts[0]));
    }
  }
  const scale = ([u,v]) => `${(28+u*744).toFixed(2)} ${(772-v*744).toFixed(2)}`;
  const pathData = [...edges].map(edge => {
    const [a,b]=edge.split('|').map(text=>text.split(',').map(Number));
    return `M${scale(a)}L${scale(b)}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-labelledby="title desc"><title id="title">${modelName} UV 展开</title><desc id="desc">从游戏模型 TEXCOORD_0 自动生成的 UV 边线图</desc><rect x="28" y="28" width="744" height="744" fill="none" stroke="#9bbdb2" stroke-width="1"/><path d="${pathData}" fill="none" stroke="#3936a5" stroke-width=".42" vector-effect="non-scaling-stroke"/></svg>`;
}

for (const model of models) {
  const bytes = await readFile(path.join(modelDir, `${model}.glb`));
  const {json, bin} = parseGlb(bytes);
  const svg = uvSvg(json, bin, model);
  await writeFile(path.join(assetDir, `${model}-uv.svg`), svg);
  console.log(`${model}: ${svg.length} bytes`);
}
