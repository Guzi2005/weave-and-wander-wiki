import {createContribution} from './contribution.js';
import {createLibraryReading} from './library-reading.js';
import {routeTopic} from './library-store.js';
import {LIBRARY_TAGS,inferFileKind} from './tag-vocabulary.js';
export function createLibraryModule(data,knowledge,store){
  const reading=createLibraryReading(store,knowledge);
  const contribution=createContribution(data,knowledge,{tags:LIBRARY_TAGS,readDrafts:store.readFiles,saveDraft:store.saveFiles,inferFileKind,store});
  const cleanup=()=>{contribution.cleanup();reading.cleanup();};
  return {
    render(id){cleanup();if(id==='contribute')return contribution.render();if(id.startsWith('culture:'))return reading.render(id);return null;},
    mount(id,root){if(id==='contribute')contribution.mount(root);else reading.mount(id,root);},
    regions:id=>store.topic(routeTopic(id))?.regions||[],
    cleanup,
  };
}
