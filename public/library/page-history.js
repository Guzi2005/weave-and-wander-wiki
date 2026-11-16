import {lineIcon} from './line-icons.js';

export function mountPageHistory(container){
  const saved=history.state?.wwWikiHistory;let index=saved?.index??0,max=saved?.max??index,lastURL=location.href,travelling=false;
  const bar = document.createElement('nav');
  bar.className = 'rm-page-history';
  bar.setAttribute('aria-label', '浏览历史');
  bar.innerHTML = `
    <button type="button" data-history-back aria-label="返回上一页" title="返回上一页">${lineIcon('chevron-left')}</button>
    <button type="button" data-history-forward aria-label="前进到下一页" title="前进到下一页">${lineIcon('chevron-right')}</button>`;
  const back = bar.querySelector('[data-history-back]');
  const forward = bar.querySelector('[data-history-forward]');

  const path=document.createElement('ol');
  path.className='rm-location-path';
  path.setAttribute('aria-label','当前位置');
  bar.append(path);
  function paintPath(breadcrumb){
    const crumbs=[{label:'首页',href:'#/'}];
    if(breadcrumb)for(const node of breadcrumb.children){
      const label=node.textContent.trim();
      if(label&&label!=='/'&&label!=='首页')crumbs.push({label,href:node.getAttribute('href'),source:node.tagName==='BUTTON'?node:null});
    }
    const title=container.querySelector('h1')?.textContent.trim();
    if(!breadcrumb){
      const names={'#/assets':'资料库','#/archive':'资料库','#/contribute':'参与共创','#/contribute/library':'资料库管理','#/regions':'地域与民族'};
      const label=title||names[location.hash.split('?')[0]];
      if(label&&label!=='首页')crumbs.push({label});
    }else if(title&&!container.querySelector('.cm-workspace')&&crumbs.at(-1).label!==title)crumbs.push({label:title});
    path.replaceChildren(...crumbs.map((crumb,index)=>{
      const item=document.createElement('li'),last=index===crumbs.length-1;
      const node=document.createElement(!last&&crumb.source?'button':!last&&crumb.href?'a':'span');
      node.textContent=crumb.label;
      if(node.tagName==='A')node.href=crumb.href;
      if(node.tagName==='BUTTON'){node.type='button';node.onclick=()=>crumb.source.click();}
      if(last)node.setAttribute('aria-current','page');
      item.append(node);return item;
    }));
  }
  function place(){
    const breadcrumb=container.querySelector('.rm-breadcrumb');
    if(!breadcrumb){
      if(bar.nextElementSibling!==container)container.before(bar);
    }else{
      let row=breadcrumb.parentElement;
      if(!row.classList.contains('rm-history-row')){
        row=document.createElement('div');row.className='rm-history-row';
        breadcrumb.before(row);row.append(breadcrumb);
      }
      if(bar.parentElement!==row)row.append(bar);
    }
    paintPath(breadcrumb);
  }
  place();
  new MutationObserver(records=>{
    if(records.every(record=>bar.contains(record.target)))return;
    place();
  }).observe(container,{childList:true,subtree:true,characterData:true});
  window.addEventListener('hashchange',place);
  const paint=()=>{back.disabled=index<=0;forward.disabled=index>=max;};
  const stamp=()=>history.replaceState({...history.state,wwWikiHistory:{index,max}},'',location.href);
  stamp();paint();back.onclick=()=>history.back();forward.onclick=()=>history.forward();
  window.addEventListener('popstate',()=>{const state=history.state?.wwWikiHistory;if(state){index=state.index;max=Math.max(max,index);travelling=true;paint();}});
  window.addEventListener('hashchange',()=>{if(lastURL===location.href)return;lastURL=location.href;if(travelling){travelling=false;stamp();paint();return;}const state=history.state?.wwWikiHistory;if(state&&state.index!==index){index=state.index;max=Math.max(max,index);}else{index++;max=index;}stamp();paint();});
}
