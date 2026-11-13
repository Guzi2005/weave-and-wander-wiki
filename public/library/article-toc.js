const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createArticleToc(){
  let dispose=()=>{};
  function mount(id,article){
    dispose();
    if(id==='contribute')return;
    const shell=article.closest('.rm-shell'),h1=article.querySelector('h1');if(!h1)return;
    const entries=[{element:h1,label:id==='contribute'?'开始':'简介'}];
    const found=article.querySelectorAll('[data-toc-title],h2,.rm-reference-footer');
    for(const element of found){if(element.closest('aside')||element.closest('[data-toc-title]')!==element&&element.closest('[data-toc-title]'))continue;const label=element.dataset.tocTitle||(element.matches('.rm-reference-footer')?'参考资料':element.textContent.replace(/^\d+\s*/,'').trim());if(label&&entries.every(e=>e.element!==element))entries.push({element,label});}
    if(entries.length<3)return;
    const toc=document.createElement('aside');toc.className='rm-article-toc';toc.setAttribute('aria-label','本页目录');toc.innerHTML=`<details open><summary><span>本页目录</span><small>收起</small></summary><nav aria-label="文章章节">${entries.map((e,i)=>`<button type="button" data-section="${i}">${i?`<small>${String(i).padStart(2,'0')}</small>`:'<small>○</small>'}<span>${esc(e.label)}</span></button>`).join('')}</nav></details>`;
    const media=matchMedia('(min-width:1200px)'),abort=new AbortController();let raf=0;const opts={signal:abort.signal},details=toc.querySelector('details');
    const place=()=>{shell.classList.toggle('has-article-toc',media.matches);if(media.matches){shell.append(toc);details.open=true;}else{const anchor=article.querySelector('.rm-breadcrumb');if(anchor)anchor.after(toc);else h1.before(toc);details.open=false;}};
    const buttons=[...toc.querySelectorAll('[data-section]')];
    const update=()=>{raf=0;let active=0;const atBottom=window.scrollY+innerHeight>=document.documentElement.scrollHeight-2;const threshold=atBottom?innerHeight*.6:160;for(let i=1;i<entries.length;i++)if(entries[i].element.getBoundingClientRect().top<=threshold)active=i;for(let i=0;i<buttons.length;i++){if(i===active)buttons[i].setAttribute('aria-current','location');else buttons[i].removeAttribute('aria-current');}};
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(update);};
    toc.addEventListener('click',event=>{const button=event.target.closest('[data-section]');if(!button)return;const entry=entries[Number(button.dataset.section)];if(entry.element.matches('.rm-reference-footer')){const source=entry.element.querySelector('details');if(source)source.open=true;}if(!media.matches)details.open=false;entry.element.style.scrollMarginTop='28px';entry.element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});},opts);
    details.addEventListener('toggle',()=>{toc.querySelector('summary small').textContent=details.open?'收起':'展开';},opts);
    window.addEventListener('scroll',schedule,{...opts,passive:true});window.addEventListener('resize',schedule,opts);media.addEventListener('change',place,opts);place();update();
    dispose=()=>{abort.abort();cancelAnimationFrame(raf);toc.remove();shell.classList.remove('has-article-toc');};
  }
  return {mount,cleanup:()=>dispose()};
}
