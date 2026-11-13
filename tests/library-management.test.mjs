import data from './fixtures/library-data.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {INITIAL_TOPICS,recordsForTopic,entryNodes,draftEditorState} from '../public/library/library-management.js';

test('library roots cover every real record once including unassigned material',()=>{const all=INITIAL_TOPICS.flatMap(t=>recordsForTopic(data,INITIAL_TOPICS,t.id));assert.equal(all.length,30);assert.equal(new Set(all.map(r=>r.id)).size,30);assert.equal(recordsForTopic(data,INITIAL_TOPICS,'culture-mosuo').length,6);});
test('ensemble and component relationships enter the selection tree',()=>{const nodes=entryNodes(data,INITIAL_TOPICS);assert.equal(nodes.find(n=>n.id==='entry:WW-MOS-001-C02').parentId,'entry:WW-MOS-001');assert.equal(nodes.find(n=>n.id==='entry:WW-MOS-001').parentId,'tree-entries');assert.equal(nodes.filter(n=>n.recordId).length,30);});
test('local edits keep source records intact and can reassign topic membership',()=>{const edits={'WW-MOS-001-C02':{title:'编辑后的上衣',topicId:'topic-game-basics'}};assert.equal(recordsForTopic(data,INITIAL_TOPICS,'culture-mosuo',edits).length,5);assert.equal(recordsForTopic(data,INITIAL_TOPICS,'topic-game-basics',edits).find(r=>r.id==='WW-MOS-001-C02').title,'编辑后的上衣');assert.notEqual(data.records.find(r=>r.id==='WW-MOS-001-C02').title,'编辑后的上衣');});
test('draft restores editor mode and context while legacy uploads remain editable',()=>{const state={mode:'upload',topicId:'culture-mosuo',nodeId:'shape-top',recordId:'WW-MOS-001'};assert.deepEqual(draftEditorState({editorState:state}),state);assert.equal(draftEditorState({fields:{parent:'WW-MOS-001'}}).recordId,'WW-MOS-001');assert.equal(draftEditorState({fields:{}}).mode,'upload');});
