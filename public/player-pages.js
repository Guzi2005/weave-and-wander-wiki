export function eligibleQuestions(questions) {
  return questions.filter(q => q.status === 'approved' && !q.needs_review);
}

export async function renderPractice({view,el,api,setNavCurrent,isStale,token}) {
  setNavCurrent('practice');
  const data=await api('/api/questions');
  if(isStale(token))return;
  const questions=eligibleQuestions(data.questions);
  const adopted=el('input',{type:'checkbox',id:'adopted-only'});
  const stage=el('div',{class:'panel'});
  let active=[],index=0,score=0;
  function restart(){active=questions.filter(q=>!adopted.checked||q.game_versions?.length);index=0;score=0;draw();}
  function draw(){
    stage.replaceChildren();
    if(!active.length){stage.append(el('p',{text:'暂无可练习的已审定题目。'}));return;}
    if(index===active.length){const again=el('button',{class:'btn',text:'再练一次'});again.onclick=restart;stage.append(el('h2',{text:`完成 · ${score} / ${active.length}`}),again);return;}
    const q=active[index];let selected=null;
    const choices=el('fieldset',{},[el('legend',{text:q.prompt})]);
    q.options.forEach((text,i)=>{const input=el('input',{type:'radio',name:'answer',value:i});input.onchange=()=>{selected=i;submit.disabled=false;};choices.append(el('label',{style:'display:block;padding:10px 0'},[input,' ',text]));});
    const submit=el('button',{class:'btn',text:'提交答案'});submit.disabled=true;
    const feedback=el('div',{role:'status'});
    submit.onclick=()=>{submit.disabled=true;choices.disabled=true;if(selected===q.correct_index)score++;
      const next=el('button',{class:'btn',text:index+1===active.length?'查看结果':'下一题'});
      next.onclick=()=>{index++;draw();};
      feedback.replaceChildren(el('h3',{text:selected===q.correct_index?'回答正确':`正确答案：${q.options[q.correct_index]}`}),el('p',{text:q.explanation}),el('p',{text:q.evidence_note}),el('a',{href:`#/record/${encodeURIComponent(q.record_id)}`,text:'查看来源'}),el('div',{class:'form-actions'},[next]));
    };
    stage.append(el('p',{text:`${index+1} / ${active.length}`}),choices,submit,feedback);
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
  const mouse = text => el('span', {class:'input-command'}, [
    el('span', {class:'input-mouse input-mouse-left', 'aria-hidden':'true'}, [
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
    {id:'view', title:'视图与窗口', image:'view', content:[
      paragraph('先调整视角观察店铺，再查看', entry('员工个性', 'staff'), '与', entry('长椅休息', 'rest'), '。'),
      table('视图快捷键', ['按键', '操作'], [
        [keycap('F11'), '切换全屏'],
        [keycap('Home'), '返回初始视图并关闭衣橱'],
        [keycap('Esc'), '依次退出跟随、关闭衣橱或退出全屏'],
      ]),
      table('鼠标操作', ['输入', '操作'], [
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
        ['员工每次取糖', '体力增加 5 个百分点，上限 100%'],
        ['同一员工两次取糖间隔', '至少 45 秒模拟时间'],
        ['员工体力 > 95%', '不能取糖'],
        ['糖碟余量较低', '员工停止主动取糖，优先留给顾客'],
      ]),
      table('糖碟与补货', ['项目或条件', '数量与行为'], [
        ['开局糖碟', '8 颗'],
        ['糖碟容量', '12 颗'],
        ['余量 ≤ 3 颗，且后备糖还有剩余', '安排一名空闲员工补货'],
        ['每趟补货', '最多 6 颗'],
        ['每日后备糖', '12 颗；用完后当日停止补货'],
      ]),
    ]},
    {id:'staff', title:'员工个性', image:'staff', content:[
      paragraph('选中员工可查看个性。量力而行的员工较早休息，有始有终的员工倾向于做完当前工作。恢复倍率作用于', entry('坐休与小睡', 'rest'), '。'),
      table('个性影响', ['属性', '范围', '作用'], [
        ['恢复倍率', '0.7–1.3 倍', '调整坐休、小睡的恢复速度'],
        ['工速修正', '−5% 至 +15%', '调整按时间完成的岗位工作'],
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
  const sections = chapters.map(chapter => el('section', {
    class:'guide-row', id:'guide-' + chapter.id, tabindex:'-1', 'aria-labelledby':'heading-' + chapter.id,
  }, [
    chapter.image ? el('img', {class:'guide-illustration', src:'/assets/guide/' + chapter.image + '-game-blocks.png', alt:chapter.title, loading:'lazy'}) : null,
    el('div', {class:'guide-text'}, [
      el('h2', {id:'heading-' + chapter.id}, [entry(chapter.title, chapter.id)]),
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
  const publicSite = Boolean(document.querySelector('meta[name="ww-public"]'));
  const links = publicSite
    ? [['#/guide','游戏指南'],['#/archive','资料库'],['#/practice','答题练习'],['#/workshop','资产预览'],['#/node-styles','节点样式']]
    : [['#/intake','收录资料'],['#/questions','编辑题库'],['#/workshop','资产预览'],['#/node-styles','节点样式'],['/api/export','备份资料'],['/api/game-export','导出审定题目']];
  view.replaceChildren(el('h1',{class:'page-title',text:'参与共创'}),el('div',{class:'card-grid'},[
    ...links
  ].map(([href,title])=>el('a',{class:'panel',href},[el('h2',{text:title})]))));
}
