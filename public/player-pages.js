export function eligibleQuestions(questions) {
  return questions.filter(q => q.status === 'approved' && !q.needs_review);
}

export async function renderPractice({view,el,api,setNavCurrent,isStale,token}) {
  setNavCurrent('practice');
  const data=await api('/api/questions');
  if(isStale(token))return;
  const questions=eligibleQuestions(data.questions);
  const adopted=el('input',{type:'checkbox',id:'adopted-only'});
  const stage=el('div',{class:'practice-stage'});
  let active=[],index=0,score=0;
  function restart(){active=questions.filter(q=>!adopted.checked||q.game_versions?.length);index=0;score=0;draw();}
  function draw(){
    stage.replaceChildren();
    if(!active.length){stage.append(el('p',{text:'暂无可练习的已审定题目。'}));return;}
    if(index===active.length){const again=el('button',{class:'btn',text:'再练一次'});again.onclick=restart;stage.append(el('h2',{text:`完成 · ${score} / ${active.length}`}),again);return;}
    const q=active[index];let selected=null;
    const choices=el('fieldset',{},[el('legend',{text:q.prompt})]);
    q.options.forEach((text,i)=>{const input=el('input',{type:'radio',name:'answer',value:i});input.onchange=()=>{selected=i;submit.disabled=false;};choices.append(el('label',{class:'practice-option'},[input,' ',text]));});
    const submit=el('button',{class:'btn',text:'提交答案'});submit.disabled=true;
    const feedback=el('div',{role:'status'});
    submit.onclick=()=>{submit.disabled=true;choices.disabled=true;stage.querySelector('progress').value=index+1;if(selected===q.correct_index)score++;
      const next=el('button',{class:'btn',text:index+1===active.length?'查看结果':'下一题'});
      next.onclick=()=>{index++;draw();};
      feedback.className = selected === q.correct_index ? 'practice-feedback correct' : 'practice-feedback retry';
      feedback.replaceChildren(el('h3',{text:selected===q.correct_index?'回答正确':`正确答案：${q.options[q.correct_index]}`}),el('p',{text:q.explanation}),el('p',{text:q.evidence_note}),el('a',{href:`#/record/${encodeURIComponent(q.record_id)}`,text:'查看来源'}),el('div',{class:'form-actions'},[next]));
    };
    stage.append(el('progress',{max:active.length,value:index,'aria-label':'已完成题数'}),el('p',{text:`第 ${index+1} 题 / 共 ${active.length} 题`}),choices,submit,feedback);
  }
  adopted.onchange=restart;
  view.replaceChildren(el('h1',{class:'page-title',text:'答题练习'}),el('label',{},[adopted,' 只看游戏采用的题目']),stage);
  restart();
}

export async function renderHome({view, el, setNavCurrent, api, loadAssets, ensembleCard, recordCard, isStale, token}) {
  setNavCurrent('home');
  const search = el('input', {type:'search', placeholder:'查找套装、部件或专题', 'aria-label':'搜索资料库'});
  const form = el('form', {class:'home-search', role:'search'}, [search, el('button', {class:'btn', type:'submit', text:'检索资料'})]);
  form.onsubmit = event => {
    event.preventDefault();
    location.hash = '/archive?q=' + encodeURIComponent(search.value.trim());
  };
  const index = el('div', {class:'card-grid archive-grid home-ensembles', 'aria-busy':'true'});
  const links = [['游戏操作', '/guide'], ['答题练习', '/practice'], ['资产预览', '/workshop'], ['节点样式', '/node-styles']];
  view.replaceChildren(el('div', {class:'archive-layout home-layout'}, [
    el('aside', {class:'archive-sidebar home-directory'}, [
      el('nav', {class:'archive-tools', 'aria-label':'查阅入口'}, links.map(([text, path]) => el('a', {href:'#'+path, text}))),
    ]),
    el('section', {class:'archive-content'}, [
      el('header', {class:'archive-intro'}, [
        el('h1', {class:'page-title', text:'服饰图鉴'}),
        el('p', {text:'点图转看三维模型，点图名查阅原图、出处与考证记录。'}),
      ]),
      form,
      el('div', {class:'home-index-title'}, [el('h2', {text:'套装索引'}), el('a', {href:'#/archive', text:'全部资料 →'})]),
      index,
    ]),
  ]));
  try {
    const [data] = await Promise.all([api('/api/records'), loadAssets()]);
    if (isStale(token)) return;
    const ensembles = data.records.filter(record => record.record_type === 'ensemble');
    const details = await Promise.all(ensembles.map(record => api('/api/records/' + encodeURIComponent(record.id))));
    if (isStale(token)) return;
    for (const {record, children} of details) {
      const components = children.filter(child => child.record_type === 'component');
      index.append(components.length ? ensembleCard({record, components}) : recordCard(record));
    }
    if (!ensembles.length) index.append(el('p', {text:'暂无套装记录。'}));
  } catch (error) {
    if (!isStale(token)) index.replaceChildren(el('p', {text:'套装索引加载失败：' + error.message}));
  } finally {
    index.removeAttribute('aria-busy');
  }
}

export function renderGuide({view, el, setNavCurrent, params}) {
  setNavCurrent('guide');
  const link = (text, href) => el('a', {class:'wiki-link', href, text});
  const entry = (text, id) => link(text, '#/guide?section=' + id);
  const paragraph = (...children) => el('p', {}, children);
  const keycap = key => el('kbd', {class:'input-keycap', text:key});
  const mouse = (text, button = 'left') => el('span', {class:'input-command'}, [
    el('span', {class:'input-mouse input-mouse-' + button, 'aria-hidden':'true'}, [
      el('span', {class:'input-mouse-wheel'}),
    ]),
    el('span', {text}),
  ]);
  function table(caption, headers, rows) {
    return el('div', {class:'rule-table-scroll', tabindex:'0', 'aria-label':caption}, [
      el('table', {class:'rule-table'}, [
        el('caption', {text:caption}),
        el('thead', {}, [el('tr', {}, headers.map(text => el('th', {scope:'col', text})))]),
        el('tbody', {}, rows.map(row => el('tr', {}, row.map((text, index) =>
          el(index === 0 ? 'th' : 'td', {...(index === 0 ? {scope:'row'} : {})}, [text])
        )))),
      ]),
    ]);
  }
  const chapters = [
    {id:'start', title:'第一次开店', image:'view', content:[
      paragraph('从观察店铺开始：选中一名员工，安排一次工作，再留意体力与休息。熟悉这一轮之后，再逐步安排其他员工。'),
      table('上手顺序', ['先做什么', '接下来留意'], [
        [entry('观察与选择', 'view'), '单击小人跟随观察；需要回到全店视角时按 Home。'],
        [entry('安排工作', 'staff'), '拖放员工，或选中员工后单击设施。查看个性，了解工作与恢复节奏。'],
        [entry('照顾体力', 'rest'), '留出长椅空位，体力很低时需要两个相邻空位才能躺下。'],
        [entry('认识服饰', 'research'), '从套装进入部件档案，对照来源图像与三维模型。'],
      ]),
    ]},
    {id:'view', title:'视图与窗口', image:'camera', content:[
      paragraph('先调整视角观察店铺，再查看', entry('员工个性', 'staff'), '与', entry('长椅休息', 'rest'), '。'),
      table('视图快捷键', ['按键', '操作'], [
        [keycap('F11'), '切换全屏'],
        [keycap('Home'), '返回初始视图并关闭衣橱'],
        [keycap('Esc'), '依次退出跟随、关闭衣橱或退出全屏'],
      ]),
      table('鼠标操作', ['输入', '操作'], [
        [mouse('右键拖动', 'right'), '旋转观察角度'],
        [mouse('中键拖动', 'middle'), '平移视图'],
        [mouse('空白处左键拖动'), '平移视图'],
        [mouse('滚轮', 'middle'), '推进 / 拉远视图，同时调整缩放'],
        [el('span', {}, [keycap('Ctrl'), ' + ', mouse('滚轮', 'middle')]), '缩放视图'],
        [mouse('左键单击小人'), '跟随所点击的小人'],
        [mouse('按住左键拖动员工'), '在店内拖放员工，安排工作'],
        [mouse('左键单击设施'), '已选中员工时，在店内分配对应工作'],
      ]),
    ]},
    {id:'rest', title:'长椅与小睡', image:'rest', content:[
      paragraph('长椅提供持续体力恢复。', entry('员工个性', 'staff'), '影响休息时机与恢复速度；', entry('薄荷糖', 'mint'), '提供一次性的体力补充。'),
      table('休息条件', ['条件或项目', '行为或数值'], [
        ['长椅容量', '3 个座位'],
        ['预约时体力 ≤ 15%，且有两个相邻空位', '侧躺小睡，占用两席'],
        ['只有一席可用', '坐下休息'],
        ['恢复到 85%', '起身，恢复工作'],
      ]),
    ]},
    {id:'mint', title:'前台薄荷糖', image:'mint', content:[
      paragraph('顾客离店前有机会去茶桌取糖，无需购物。员工也能取糖；需要持续恢复时，会使用', entry('长椅', 'rest'), '。'),
      table('取糖与体力', ['项目或条件', '规则'], [
        ['员工每次取糖', '体力 +5%，≤ 100%'],
        ['同一员工两次取糖间隔', '≥ 45 秒模拟时间'],
        ['员工体力 > 95%', '不能取糖'],
        ['糖碟余量较低', '员工停止主动取糖，优先留给顾客'],
      ]),
      table('糖碟与补货', ['项目或条件', '数量与行为'], [
        ['开局糖碟', '8 颗'],
        ['糖碟容量', '12 颗'],
        ['余量 ≤ 3 颗，且后备糖还有剩余', '安排一名空闲员工补货'],
        ['每趟补货', '≤ 6 颗'],
        ['每日后备糖', '12 颗；用完后当日停止补货'],
      ]),
    ]},
    {id:'staff', title:'员工个性', image:'staff', content:[
      paragraph('选中员工可查看个性。量力而行的员工较早休息，有始有终的员工倾向于做完当前工作。恢复倍率作用于', entry('坐休与小睡', 'rest'), '。'),
      table('个性影响', ['属性', '范围', '作用'], [
        ['恢复倍率', '×0.7 ~ ×1.3', '调整坐休、小睡的恢复速度'],
        ['工速修正', '−5% ~ +15%', '调整按时间完成的岗位工作'],
        ['低体力', '15%', '停止硬撑，优先休息'],
      ]),
    ]},
    {id:'research', title:'查询与练习', image:'read', content:[
      paragraph('在', link('服饰图鉴', '#/'), '中点图打开模型，点图名进入档案。可从',
        link('摩梭人服饰套装', '#/record/WW-MOS-001'), '或',
        link('乌克兰套装', '#/record/WW-UKR-001'), '查看整套与部件的关系。'),
      paragraph('阅读原图与出处后，进入', link('答题练习', '#/practice'), '；答案解析会链接回相关资料。制作时可查阅',
        link('节点样式', '#/node-styles'), '与', link('纹样和材质', '#/motifs'), '。'),
      table('看图时可以做什么', ['入口', '用途'], [
        ['套装与部件', '先看穿着整体，再查看头饰、上衣、裙装等局部。'],
        ['来源图像', '观察照片里的纹样、配色与佩戴位置；打开原图查看细节。'],
        ['三维模型', '转动模型观察不同角度，对照游戏中的数字化呈现。'],
        ['图纸', '查看模型 UV 展开；它用于贴图定位，并不是可直接裁布的纸样。'],
      ]),
    ]},
  ];
  chapters.push(
    {id:'mobile', title:'手机与平板', image:'mobile', content:[
      paragraph('手机和平板可以直接浏览 Wiki。游戏本体的触屏操作说明将在移动端适配完成后补充；本页的键盘快捷键对应桌面版。'),
      table('在触屏上查阅', ['想做什么', '操作'], [
        ['打开资料', '轻点条目名称；轻点带 3D 标记的图像进入模型预览。'],
        ['查看原图', '进入条目后打开原图，用浏览器查看细节。'],
        ['阅读宽表格', '在表格区域横向滑动；也可以将设备横过来。'],
        ['切换来源与模型', '通过条目和模型入口切换，触屏无需依赖鼠标悬停。'],
      ]),
    ]},
    {id:'wiki', title:'怎样使用 Wiki', image:'wiki', content:[
      paragraph('把 Wiki 当作随手翻阅的服饰图鉴与游戏说明书。从', link('资料库', '#/archive'), '寻找感兴趣的图像，再沿条目链接阅读套装、部件与相关资料。'),
      table('从问题找到入口', ['你的问题', '去哪里'], [
        ['这件衣服有哪些部件？', link('套装图鉴', '#/')],
        ['照片与游戏模型有哪些不同？', link('原图与模型对照', '#/record/WW-MOS-001')],
        ['想转动模型，看看动作效果', link('资产预览', '#/workshop')],
        ['珠串、发辫、纹样能怎样变化？', link('节点样式', '#/node-styles')],
        ['想检查自己记住了多少', link('答题练习', '#/practice')],
      ]),
      paragraph('正文中有下划线的条目名称可以继续点开。指南目录也可以直接跳到对应章节，分享当前地址即可定位到这一节。'),
    ]},
    {id:'co-create', title:'一起共创', image:'co-create', content:[
      paragraph('你可以从一张照片、一条来源或一个制作方法开始参与。打开', link('参与共创', '#/contribute'), '查看入口；公开站目前以查阅为主，资料编辑与题目整理在本地研究模式中进行。'),
      table('可以贡献什么', ['内容', '一起提供的信息'], [
        ['图像与资料', '原始链接、作者或收藏机构，以及你想指出的部位。'],
        ['条目修订', '条目名称、需要更正的内容与可追溯的依据。'],
        ['题目', '题干、选项、答案、解析与对应资料。'],
        ['模型与参数样式', '预览、参考来源、参数配置和使用许可。'],
      ]),
      paragraph('数字化编辑器系列成熟后，Wiki 将提供直达编辑器的入口。现在可以先从', link('节点样式', '#/node-styles'), '与', link('纹样和材质', '#/motifs'), '了解可生成的变化。'),
    ]},
    ...[
      ['workshop-design','工坊设计','规划自己的制作空间，围绕手作安排工坊。', '先通过资产预览熟悉服饰与部件；空间编辑和制作流程正在筹备。', '#/workshop','浏览资产'],
      ['supply','供应目录','查阅制作所需的材料与供应内容，为工坊准备物料。','供应目录、采购方式与材料消耗规则正在筹备。','#/motifs','认识纹样与材质'],
      ['quiz','答题','把观察到的服饰细节变成知识，在问答中回到资料寻找依据。','Wiki 已提供练习入口；游戏内答题流程与奖励正在筹备，公开练习内容随审定题目更新。','#/practice','进入练习'],
      ['market','赶集','走进集市，与小贩和各色人物相遇，发现手作与物件。','集市活动、交易内容与开放安排正在筹备。','#/archive','先逛资料库'],
      ['fieldwork','采风','带着问题观察不同地方的衣饰、工艺与日常生活。','采风地点、记录方式与游戏内收集流程正在筹备。','#/archive','查看来源资料'],
      ['exhibition','布展','把收集与制作的成果组织成展示，让服饰与背后的故事一起被看见。先看整套穿着，再对照头饰、上衣、裙装等部件，沿来源链接阅读背后的故事。','布展空间、展品摆放与观展互动正在筹备。','#/','浏览套装图鉴'],
      ['residence','换个驻地','把旅途带到新的驻地，在新的环境中继续手作与探索。','驻地选择、迁移条件与物品携带规则正在筹备。','#/guide?section=start','回到起步指南'],
    ].map(([id,title,intro,note,href,label])=>({id,title,image:id,planned:true,content:[paragraph(intro),paragraph(note),paragraph(link(label,href))]})),
  );
  const illustratedNotes = {
    rest: ['rest', '工坊小憩'],
    supply: ['banner', '供应目录中的布料与缝线'],
    'workshop-design': ['finished', '制作完成的绣花上衣'],
  };
  for (const chapter of chapters) {
    const illustration = illustratedNotes[chapter.id];
    if (illustration) chapter.content.push(el('img', {
      class:'guide-event-art', src:'/assets/guide/ui-' + illustration[0] + '.jpg',
      alt:illustration[1], loading:'lazy',
    }));
  }
  const sections = chapters.map(chapter => el('section', {
    class:'guide-row', id:'guide-' + chapter.id, tabindex:'-1', 'aria-labelledby':'heading-' + chapter.id,
  }, [
    chapter.image ? el('img', {class:'guide-illustration', src:'/assets/guide/' + chapter.image + '-game-blocks.png', alt:chapter.title, width:138, height:138, loading:'lazy'}) : null,
    el('div', {class:'guide-text'}, [
      el('h2', {id:'heading-' + chapter.id}, [entry(chapter.title, chapter.id)]),
      ...(chapter.planned ? [el('span',{class:'guide-planned',text:'筹备中'})] : []),
      ...chapter.content,
    ]),
  ]));
  view.replaceChildren(
    el('header', {class:'guide-heading'}, [
      el('img', {src:'/assets/ww-logo.jpg', alt:'Weave & Wander', class:'guide-logo'}),
      el('div', {}, [el('h1', {class:'page-title', text:'游戏指南'}),
        el('nav', {class:'guide-contents', 'aria-label':'指南目录'}, chapters.map(chapter => entry(chapter.title, chapter.id)))]),
    ]),
    el('div', {class:'guide-chapters'}, sections),
  );
  const requested = params?.get('section');
  const target = sections.find(section => section.id === 'guide-' + requested);
  if (target) {
    target.scrollIntoView({block:'start'});
    target.focus({preventScroll:true});
  }
}
export function renderContribute({view,el,setNavCurrent}) {
  setNavCurrent('contribute');
  const entries=[
    {title:'资料库管理',description:'整理专题、标签树与资料，上传和维护文件。',href:'#/contribute/library',action:'进入管理 →'},
    {title:'题库编辑',description:'进入题目编辑与维护功能。',href:'#/questions',action:'进入题库 →'},
    {title:'GitHub 项目',description:'查看项目代码、提交问题与参与协作。',href:'https://github.com/Guzi2005/weave-and-wander-wiki',action:'打开 GitHub ↗',external:true},
  ];
  view.replaceChildren(el('section',{class:'contribute-home'},[
    el('header',{class:'contribute-home-heading'},[el('div',{class:'rm-eyebrow',text:'Contribute'}),el('h1',{class:'page-title',text:'参与共创'}),el('p',{text:'选择一个入口，一起完善资料与内容。'})]),
    el('nav',{class:'contribute-entry-grid','aria-label':'共创入口'},entries.map(entry=>el('a',{class:'contribute-entry',href:entry.href,...(entry.external?{target:'_blank',rel:'noopener noreferrer'}:{})},[
      el('h2',{text:entry.title}),el('p',{text:entry.description}),el('span',{class:'contribute-entry-action',text:entry.action}),
    ]))),
  ]));
}
