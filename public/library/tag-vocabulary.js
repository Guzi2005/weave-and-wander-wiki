export const OBJECT_TYPES={'服装':['上衣','裙装','鞋履'],'饰品':['头饰','珠饰','腰饰'],'布艺':['鞋垫','面料','流苏'],'工具':['制作工具','测量工具','生活工具'],'玩具':['玩偶','游戏用具'],'其他':[]};
export const LIBRARY_TAGS=[
  {id:'culture-mosuo',dimension:'culture',label:'摩梭人'},
  ...Object.keys(OBJECT_TYPES).map((label,index)=>({id:`object-kind-${index+1}`,dimension:'object-kind',label})),
  ...Object.entries(OBJECT_TYPES).flatMap(([parent,labels],i)=>labels.map((label,j)=>({id:`object-type-${i+1}-${j+1}`,dimension:'object-type',label,parentId:`object-kind-${i+1}`}))),
  ...['珠串','花纹','褶裥'].map((label,i)=>({id:`feature-${i+1}`,dimension:'feature',label})),
  ...['三维模型','图片','图纸','配方与数据','视频'].map((label,i)=>({id:`representation-${i+1}`,dimension:'representation',label}))
];

export function inferFileKind(name){const ext=name.split('.').pop().toLowerCase();return ext==='glb'?'三维模型':['tres','json'].includes(ext)?'配方与数据':['mp4','webm','mov'].includes(ext)?'视频':ext==='pdf'?'图纸':'图片';}
