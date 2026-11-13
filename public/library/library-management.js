export const INITIAL_TOPICS=[
  {id:'culture-mosuo',name:'摩梭人 · 服饰与手作',regions:['530000','510000'],ethnicities:['ethnic-27','ethnic-02'],collections:['mosuo_photo_001','mosuo_video_002'],note:'云南摩梭人关联纳西族；四川左所摩梭人关联蒙古族。'},
  {id:'topic-ukrainian',name:'乌克兰服饰',regions:[],ethnicities:[],collections:['ukrainian_photo_001'],note:''},
  {id:'topic-game-basics',name:'游戏基础资产',regions:[],ethnicities:[],collections:['ww_game_basics'],note:''},
  {id:'topic-unassigned',name:'待整理资料',regions:[],ethnicities:[],collections:[],note:''}
];
export function recordsForTopic(data,topics,topicId,overrides={}){
  const topic=topics.find(t=>t.id===topicId);if(!topic)return [];
  return data.records.filter(r=>{if(overrides[r.id]?.topicId)return overrides[r.id].topicId===topicId;if(topic.collections?.includes(r.collection_id))return true;return topicId==='topic-unassigned'&&!topics.some(t=>t.collections?.includes(r.collection_id));}).map(r=>({...r,...overrides[r.id]}));
}
export function entryNodes(data,topics){return [{id:'tree-entries',label:'套装与条目',dimension:'group',parentId:null,recordIds:[]},...data.records.map(r=>({id:'entry:'+r.id,label:r.title,dimension:'record',recordId:r.id,parentId:r.parent_id?'entry:'+r.parent_id:'tree-entries',topicId:topics.find(t=>t.collections?.includes(r.collection_id))?.id||'topic-unassigned',recordIds:[r.id]}))];}
export function draftEditorState(draft){return draft.editorState||{mode:'upload',topicId:draft.topicId||draft.fields?.topic||'culture-mosuo',nodeId:null,recordId:draft.fields?.parent||null};}
