/** JSON-only contract. Flat questions keep topic membership independent from rendering. */
export const BANK_SCHEMA_VERSION = 1;
const fail = message => { throw new Error(`题库校验失败：${message}`); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v,n,max=10000) => {if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${n} 必须为非空文本（最多 ${max} 字）`);return v.trim();};
const id = (v,n) => {text(v,n,100);if(!/^[\w-]+$/.test(v))fail(`${n} 只能包含字母、数字、下划线和连字符`);return v;};
const order = (v,n) => {if(!Number.isSafeInteger(v)||v<0)fail(`${n} 必须为非负整数`);return v;};
const timestamp = v => v===null||(typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v)));
export function isPlayableQuestion(q) {
  return ['approved','validated'].includes(q.review?.status)&&q.generation?.verified===true&&(q.review.status==='validated'||q.generation.provider==='manual'||q.review.humanReviewed===true);
}
export function normalizeQuestionBank(input) {
  if(!object(input)||input.schemaVersion!==1)fail('schemaVersion 必须为 1');
  if(!Array.isArray(input.stages)||!input.stages.length||input.stages.length>100)fail('须有 1–100 个关卡');
  if(!Array.isArray(input.questions)||input.questions.length>2000)fail('questions 必须为数组，最多 2000 题');
  const sids=new Set(),qids=new Set(),sorders=new Set(),qorders=new Set();
  const stages=input.stages.map(s=>{
    if(!object(s))fail('关卡必须为对象');
    const sid=id(s.id,'关卡 ID'),n=order(s.order,'关卡 order');
    if(sids.has(sid))fail(`重复关卡 ID：${sid}`);sids.add(sid);
    if(sorders.has(n))fail('关卡 order 不能重复');sorders.add(n);
    if(typeof s.passRate!=='number'||!Number.isFinite(s.passRate)||s.passRate<0||s.passRate>100)fail(`${sid}.passRate 须在 0–100 之间`);
    return {id:sid,title:text(s.title,'关卡名称',200),description:text(s.description,'关卡介绍'),order:n,passRate:s.passRate};
  }).sort((a,b)=>a.order-b.order);
  const questions=input.questions.map(q=>{
    if(!object(q))fail('题目必须为对象');
    const qid=id(q.id,'题目 ID');if(qids.has(qid))fail(`重复题目 ID：${qid}`);qids.add(qid);
    if(!sids.has(q.stageId))fail(`${qid} 的 stageId 不存在`);
    if(!['single','boolean','knowledge'].includes(q.type))fail(`${qid} 的题型无效`);
    const n=order(q.order,'题目 order'),key=`${q.stageId}:${n}`;
    if(qorders.has(key))fail(`${qid} 在关卡中的 order 重复`);qorders.add(key);
    let options=[],answer=null;
    if(q.type!=='knowledge'){
      if(!Array.isArray(q.options)||q.options.length<2||q.options.length>4)fail(`${qid} 须有 2–4 个选项`);
      const oids=new Set();options=q.options.map(o=>{
        if(!object(o))fail('选项须为对象');const oid=id(o.id,'选项 ID');
        if(oids.has(oid))fail('选项 ID 重复');oids.add(oid);return {id:oid,text:text(o.text,'选项文本',3000)};
      });
      if(!oids.has(q.answer))fail(`${qid} 缺少正确答案或答案未指向选项`);
      if(q.type==='boolean'&&(options.length!==2||!oids.has('T')||!oids.has('F')))fail('判断题须使用 T / F 两个选项');
      answer=q.answer;
    }else if((q.options?.length??0)!==0||q.answer!=null)fail('知识拓展题不得设置选项或答案');
    if(!object(q.source)||!Array.isArray(q.source.recordIds)||!Array.isArray(q.source.references))fail(`${qid} 缺少来源信息`);
    const recordIds=q.source.recordIds.map(r=>text(r,'档案 ID',100));
    const references=q.source.references.map(r=>{
      if(!object(r))fail('来源引用须为对象');let url;try{url=new URL(r.url);}catch{fail('来源 URL 无效');}
      if(!['https:','http:'].includes(url.protocol))fail('来源仅允许 http(s) URL');
      return {title:text(r.title,'来源标题',300),url:url.href};
    });
    const g=q.generation,r=q.review;
    if(!object(g)||typeof g.verified!=='boolean'||!timestamp(g.generatedAt)||!(g.model===null||typeof g.model==='string'))fail(`${qid} 生成元数据不完整`);
    const provider=text(g.provider,'生成提供方',100);
    if(!object(r)||!['draft','approved','rejected','validated'].includes(r.status)||typeof r.humanReviewed!=='boolean'||typeof r.reviewer!=='string'||!timestamp(r.reviewedAt))fail(`${qid} 审核元数据不完整`);
    if(r.status==='approved'&&(!g.verified||!r.reviewer.trim()||!r.reviewedAt))fail(`${qid} 已审定题须有核查、审核人及时间`);
    if(provider!=='manual'&&r.status==='approved'&&(!r.humanReviewed||!g.model?.trim()||!g.generatedAt))fail(`${qid} AI 题须记录模型、生成时间并经过人工审核后才能批准`);
    return {id:qid,stageId:q.stageId,order:n,type:q.type,question:text(q.question,'题干'),options,answer,explanation:text(q.explanation,'解析'),hint:typeof q.hint==='string'?q.hint.slice(0,10000):'',
      source:{type:text(q.source.type,'来源类型',100),recordIds:[...new Set(recordIds)],references},generation:{provider,model:g.model,generatedAt:g.generatedAt,verified:g.verified},
      review:{status:r.status,humanReviewed:r.humanReviewed,reviewer:r.reviewer.trim(),reviewedAt:r.reviewedAt}};
  }).sort((a,b)=>stages.findIndex(s=>s.id===a.stageId)-stages.findIndex(s=>s.id===b.stageId)||a.order-b.order);
  for(const s of stages)if(!questions.some(q=>q.stageId===s.id&&q.type!=='knowledge'&&isPlayableQuestion(q)))fail(`关卡「${s.title}」至少需要一道已审定普通题`);
  return {schemaVersion:1,bankId:id(input.bankId,'题库 ID'),title:text(input.title,'题库名称',200),description:text(input.description,'题库介绍'),stages,questions};
}
export function importQuestionBank(json){
  if(typeof json!=='string'||json.length>5*1024*1024)fail('JSON 须为文本，且不超过 5 MB');let input;
  try{input=JSON.parse(json);}catch{fail('JSON 语法错误');}return normalizeQuestionBank(input);
}
export function exportQuestionBank(bank){return JSON.stringify(normalizeQuestionBank(bank),null,2);}

// Sources were checked against museum/heritage descriptions and original poem texts.
const references={
 silk:{title:'中国非物质文化遗产网：中国传统桑蚕丝织技艺',url:'https://www.ihchina.cn/sangcansi.html'},
 museum:{title:'中国丝绸博物馆：锦程，中国丝绸与丝绸之路',url:'https://chinasilkmuseum.com/zz/info_17.aspx?itemid=26320'},
 han:{title:'中国农业博物馆：素纱襌衣',url:'https://www.agriculturalmuseum.com/detail/zh/36289.html'},
 blue:{title:'中国非物质文化遗产网：传统蓝印花布的现状',url:'https://www.ihchina.cn/project_details/10693/'},
 protein:{title:'中国丝绸博物馆：蚕丝的主要成分',url:'https://www.chinasilkmuseum.com/gwgk/info_4.aspx?itemid=26483'},
 poem:{title:'中国哲学书电子化计划：全唐诗·游子吟',url:'https://ctext.org/text.pl?if=gb&node=179348&remap=gb'},
 wuyi:{title:'中国哲学书电子化计划：诗经·秦风·无衣',url:'https://ctext.org/book-of-poetry/wu-yi1'}
};
const definitions=[
 ['history','历史','从丝织遗物出发，认识服饰的历史线索。',80,[
 ['single','马王堆一号汉墓出土的素纱襌衣属于哪个时期？',['西汉','唐代','明代','清代'],'A','这件素纱襌衣是西汉丝织服饰实物。','留意墓葬的时代。','han'],
 ['boolean','中国古代已经掌握植桑养蚕、缫丝织绸的技术。',null,'T','中国丝绸博物馆以相关实物展示古代丝绸技术的发展。','丝绸并非现代才出现。','museum'],
 ['single','研究清代官服时，哪种实物属于服饰资料？',['补子','青铜鼎','石磨','瓦当'],'A','博物馆丝绸史陈列列有清代官服与补子；具体品级需查对应制度。','选择与衣服直接相关的实物。','museum'],
 ['single','中国传统桑蚕丝织技艺何时列入联合国教科文组织代表作名录？',['2009年','1909年','1809年','1709年'],'A','该项目于2009年列入人类非物质文化遗产代表作名录。','这是21世纪的保护工作。','silk'],
 ['knowledge','一件衣物，不等于一个时代的全部服饰',null,null,'服饰史需要结合实物、年代与使用背景。素纱襌衣提供了西汉纺织技术的实物线索，但不能据此推断所有人都穿同一种衣服。','','han']]],
 ['geography','地理','循着产地和出土地，认识地域文化。',75,[
 ['single','素纱襌衣所出的马王堆汉墓位于哪里？',['湖南长沙','陕西西安','河南洛阳','江苏南京'],'A','馆藏说明将出土地标为湖南长沙马王堆一号汉墓。','答案在湖南。','han'],
 ['single','南通蓝印花布所关联的南通位于哪个省？',['浙江','江苏','四川','福建'],'B','非遗资料明确介绍了江苏南通的蓝印花布。','想一想长江入海口附近的城市。','blue'],
 ['boolean','桑蚕丝织技艺既包含生产技术，也包含相关民俗活动。',null,'T','非遗项目将生产技艺、工具产品及相关民俗一起纳入。','文化专题不只有地名。','silk'],
 ['single','认识一种地域工艺时，哪种做法更符合来源阅读？',['只凭颜色猜民族','用一地代表全国','核对产地与工艺资料','忽略出土地'],'C','南通蓝印花布的资料将地点与工艺联系说明；地点需要来源支撑。','避免把局部案例推广为全部。','blue'],
 ['knowledge','同一技术，也可能连接多个地区',null,null,'桑蚕丝织包含多道工序。未来的地域关卡应明确档案的地区、来源和适用范围，不用一个案例概括整个群体。','','silk']]],
 ['literature','文学','在针线与衣裳的诗句之间，读懂文字。',75,[
 ['single','“慈母手中线”的下一句是什么？',['春眠不觉晓','游子身上衣','黄河入海流','明月松间照'],'B','《游子吟》开篇将母亲手中的线与游子身上的衣相连。','留意针线意象。','poem'],
 ['single','《游子吟》的作者是谁？',['王维','杜甫','孟郊','白居易'],'C','《全唐诗》孟郊诗作中收录《游子吟》。','作者姓孟。','poem'],
 ['boolean','《游子吟》中“临行密密缝”写到了缝衣的动作。',null,'T','诗句描写临行前细密缝衣的场景。','“缝”是动作线索。','poem'],
 ['single','“岂曰无衣？与子同袍”见于哪部典籍？',['诗经','史记','论语','山海经'],'A','这句出自《诗经·秦风·无衣》。','它是古代诗歌总集。','wuyi'],
 ['knowledge','诗歌意象与服饰实物，需要分开阅读',null,null,'诗句提示衣物与人的情感关系；确定衣服的结构、材料和年代仍需实物或其他证据。不要把诗意表达直接当作制衣图纸。','','wuyi']]],
 ['science','科学','从蚕丝与防染，探索材料和工艺。',75,[
 ['single','蚕丝的主要成分是什么？',['蛋白质','玻璃','金属','砂粒'],'A','中国丝绸博物馆指出，蚕丝主要由丝蛋白组成。','它来自蚕的丝腺。','protein'],
 ['single','从蚕茧取得丝的工序通常称为什么？',['冶炼','烧制','缫丝','锻造'],'C','桑蚕丝织技艺包含养蚕、缫丝、染色和丝织等工序。','该名称中有“丝”。','silk'],
 ['boolean','南通蓝印花布的形成与靛蓝业的发展有关。',null,'T','非遗资料将棉纺业、靛蓝业、型纸板作为工艺发展的相关条件。','蓝色染料是线索。','blue'],
 ['single','哪一组均属于传统桑蚕丝织生产工序？',['栽桑、养蚕、缫丝','采矿、炼钢、铸造','磨石、烧砖、砌墙','制玻璃、吹瓶、退火'],'A','项目介绍列出栽桑、养蚕、缫丝、染色与丝织。','从桑树到织物。','silk'],
 ['knowledge','材料、染色和织造，是不同的问题',null,null,'理解织物，可以分别问它用什么纤维、怎样染色、如何织成。单凭颜色无法确定纤维成分，外观也不能替代材料分析。','','silk']]],
 ['final','终极挑战','把历史、地域、文字与工艺的线索连起来。',100,[
 ['single','“西汉、长沙、丝织衣物”最适合指向什么？',['青铜鼎','素纱襌衣','唐三彩马','青花瓷瓶'],'B','素纱襌衣的年代、出土地和材料与这组信息对应。','回想历史关与地理关。','han'],
 ['single','哪一项把材料与成分正确对应？',['蚕丝—蛋白质','蚕丝—钢铁','蚕丝—玻璃','蚕丝—砂岩'],'A','蚕丝主要由丝蛋白组成，不能因光泽而归为金属或玻璃。','回想科学关。','protein'],
 ['boolean','《游子吟》的开篇把“线”和“衣”联系在一起。',null,'T','开篇两句分别提到母亲手中的线和游子身上的衣。','回想文学关。','poem'],
 ['single','整理南通蓝印花布专题，哪组标签最有来源依据？',['任意民族、铁器','江苏南通、染织工艺','所有地区、同一种衣服','西汉皇帝、玻璃'],'B','资料说明江苏南通与蓝印花布印染技艺的关系。','同时检查地点和工艺。','blue'],
 ['knowledge','带着来源，开始下一段探索',null,null,'你已完成样本旅程。未来可以把同一套规则用于地区、民族或服饰专题：每道题保留来源，让知识范围与证据范围相匹配。','','silk']]]
];
export function createDefaultQuestionBank(){
 const stages=[],questions=[];
 definitions.forEach(([name,title,description,passRate,items],si)=>{
  const stageId=`sample-${name}`;stages.push({id:stageId,title,description,order:si+1,passRate});
  items.forEach(([type,question,labels,answer,explanation,hint,reference],qi)=>questions.push({
   id:`${stageId}-q${qi+1}`,stageId,order:qi+1,type,question,
   options:type==='boolean'?[{id:'T',text:'正确'},{id:'F',text:'错误'}]:(labels||[]).map((v,i)=>({id:String.fromCharCode(65+i),text:v})),
   answer,explanation,hint,source:{type:'sample',recordIds:[],references:[structuredClone(references[reference])]},
   generation:{provider:'manual',model:null,generatedAt:null,verified:true},
   review:{status:'approved',humanReviewed:false,reviewer:'样本来源核查（非人工审定）',reviewedAt:'2026-11-09T00:00:00.000Z'}
  }));
 });
 return normalizeQuestionBank({schemaVersion:1,bankId:'ww-wiki-sample',title:'针线之间 · 知识漫游',description:'从一根丝线出发，走过历史、山川、诗句与工艺。五段小小的旅程，慢慢发现衣裳里的世界。',stages,questions});
}
