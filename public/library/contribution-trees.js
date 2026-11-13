const recordTags={'WW-MOS-001-C01':['头饰','珠串'],'WW-MOS-001-C02':['上衣','花纹'],'WW-MOS-001-C03':['裙装','褶裥'],'WW-MOS-001-P01':['鞋垫']};
export function seedUploadTrees(tags,data){
  const nodes=tags.filter(t=>['object-kind','object-type','feature'].includes(t.dimension)).map(t=>({...t,parentId:t.parentId||(t.dimension==='feature'?'tree-details':null),recordIds:data.records.filter(r=>t.dimension==='object-kind'?r.category===t.label:(recordTags[r.id]||[]).includes(t.label)).map(r=>r.id)}));
  nodes.push({id:'structure-ensemble',label:'套装',dimension:'structure',parentId:'tree-structure',recordIds:data.records.filter(r=>r.record_type==='ensemble').map(r=>r.id)});
  nodes.push({id:'type-supplementary-media',label:'补充影像',dimension:'record-type',parentId:'tree-structure',recordIds:data.records.filter(r=>r.collection_id==='mosuo_video_002'||r.record_type==='supplementary').map(r=>r.id)});
  nodes.push({id:'tree-structure',label:'资料类型',dimension:'group',parentId:null,recordIds:[]});
  nodes.push({id:'tree-details',label:'外观与结构',dimension:'group',parentId:null,recordIds:[]});return nodes;
}
export function descendants(nodes,id){const result=[],seen=new Set();const visit=nodeId=>{if(seen.has(nodeId))return;seen.add(nodeId);result.push(nodeId);nodes.filter(n=>n.parentId===nodeId).forEach(n=>visit(n.id));};visit(id);return result;}
export function expandSelection(nodes,selected){const result=new Set(selected);for(const id of selected){let node=nodes.find(n=>n.id===id);const seen=new Set();while(node?.parentId&&!seen.has(node.id)){seen.add(node.id);result.add(node.parentId);node=nodes.find(n=>n.id===node.parentId);}}return [...result];}
export function nodeUsage(nodes,id,drafts=[]){const ids=new Set(descendants(nodes,id)),used=new Set();for(const node of nodes)if(ids.has(node.id))for(const record of node.recordIds||[])used.add('record:'+record);for(const draft of drafts)if((draft.assignments?.tagIds||[]).some(tag=>ids.has(tag)))used.add(draft.status==='autosaved'&&draft.recordId?'record:'+draft.recordId:'draft:'+draft.id);return used.size;}
export function removeEmptyNode(nodes,id,drafts=[]){if(!nodes.some(n=>n.id===id))return nodes;if(nodeUsage(nodes,id,drafts))throw new Error('节点已有资料关联');const ids=new Set(descendants(nodes,id));return nodes.filter(n=>!ids.has(n.id));}
