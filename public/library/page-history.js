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

  function place() {
    const breadcrumb = container.querySelector('.rm-breadcrumb');
    if (!breadcrumb) {
      if (bar.nextElementSibling !== container) container.before(bar);
      return;
    }
    let row = breadcrumb.parentElement;
    if (!row.classList.contains('rm-history-row')) {
      row = document.createElement('div');
      row.className = 'rm-history-row';
      breadcrumb.before(row);
      row.append(breadcrumb);
    }
    if (bar.parentElement !== row) row.append(bar);
  }

  place();
  new MutationObserver(place).observe(container, {childList: true, subtree: true});
  const paint=()=>{back.disabled=index<=0;forward.disabled=index>=max;};
  const stamp=()=>history.replaceState({...history.state,wwWikiHistory:{index,max}},'',location.href);
  stamp();paint();back.onclick=()=>history.back();forward.onclick=()=>history.forward();
  window.addEventListener('popstate',()=>{const state=history.state?.wwWikiHistory;if(state){index=state.index;max=Math.max(max,index);travelling=true;paint();}});
  window.addEventListener('hashchange',()=>{if(lastURL===location.href)return;lastURL=location.href;if(travelling){travelling=false;stamp();paint();return;}const state=history.state?.wwWikiHistory;if(state&&state.index!==index){index=state.index;max=Math.max(max,index);}else{index++;max=index;}stamp();paint();});
}
