import {createProjectPersistence} from './project-persistence.js';
import {createLibraryStore} from './library-store.js';
import {createLibraryModule} from './library-module.js';
import {LIBRARY_TAGS} from './tag-vocabulary.js';
import {createAssetPreview} from './asset-preview.js';
import {mountRegionMap} from './region-map.js';
import {createArticleToc} from './article-toc.js';
import {loadKnowledgeBase,readTagRoute,tagHref} from './knowledge-base.js';
export function createProjectLibrary(view,{readOnly=false}={}){
 let instance=null,initPromise=null,host=null,latest=0,lastId=null,attached=false;
 async function initialize(){
  const [persistence,knowledge]=await Promise.all([createProjectPersistence({readOnly}),loadKnowledgeBase()]);
  const store=createLibraryStore(persistence.data,{tags:LIBRARY_TAGS,readFiles:persistence.readFiles,storage:persistence.storage});
  Object.assign(store,{persistence:persistence.storage,readFiles:persistence.readFiles,saveFiles:persistence.saveFiles,onSave:persistence.onSave});await store.ready();
  const assets=createAssetPreview(store.data),libraryView=createLibraryModule(store.data,knowledge,store),toc=createArticleToc();
  return {persistence,store,assets,libraryView,toc,knowledge};
 }
 function idFor(hash){const path=hash.split('?')[0];if(path==='#/contribute/library')return'contribute';if(['#/archive','#/assets'].includes(path))return'assets';if(path.startsWith('#/culture/'))return'culture:'+decodeURIComponent(path.slice(10));const match=/^#\/(?:asset|record)\/([^/]+)$/.exec(path);return match?'asset:'+decodeURIComponent(match[1]):readTagRoute(path);}
 async function render(hash){
  const token=++latest;attached=true;if(!instance)view.innerHTML='<p class="rm-note" role="status">正在加载资料库…</p>';
  try{
   instance=await(initPromise??=initialize());if(token!==latest||!attached)return;
   if(!host){host=document.createElement('div');host.id='region-module';}
   if(host.parentNode!==view)view.replaceChildren(host);
   if(!instance.map){instance.map=await mountRegionMap(host,{knowledge:instance.knowledge,renderExtraArticle:id=>{const content=instance.libraryView.render(id),asset=instance.assets.render(id);return content??asset;},onArticleRendered:(id,root)=>{instance.assets.mount(root);instance.libraryView.mount(id,root);instance.toc.mount(id,root);},getContextRegions:id=>instance.libraryView.regions(id),onNavigate:id=>location.hash=tagHref(id)});
    instance.store.subscribe(({origin})=>{if(!attached||!host.isConnected)return;if(idFor(location.hash)==='contribute')return;const y=scrollY;instance.map.select(idFor(location.hash));scrollTo({top:y,behavior:'instant'});});
    window.addEventListener('ww-project-refresh',()=>{instance.store.changedExternal?.();});
   }
   if(token!==latest||!attached)return;
   const id=idFor(hash),y=scrollY,sameTopic=id.startsWith('culture:')&&id===lastId;
   instance.map.select(id);lastId=id;
   document.title=(host.querySelector('h1')?.textContent||'资料库')+' · W&W Wiki';
   document.querySelectorAll('.site-nav [data-nav]').forEach(link=>{if(link.dataset.nav===(id==='contribute'?'contribute':'archive'))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
   scrollTo({top:sameTopic?y:0,behavior:'instant'});
  }catch(error){if(token!==latest)return;view.innerHTML='<p class="rm-error" role="alert">资料库未能加载。<button type="button">重新加载</button></p>';view.querySelector('button').onclick=()=>{initPromise=null;render(location.hash);};console.error(error);}
 }
 function leave(){attached=false;latest++;instance?.assets.cleanup();instance?.libraryView.cleanup();instance?.toc.cleanup();}
 return {render,leave};
}
