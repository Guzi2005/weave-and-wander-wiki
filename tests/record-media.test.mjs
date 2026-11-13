import test from 'node:test';
import assert from 'node:assert/strict';
import {baseMedia,fileMediaId,orderMedia,moveMedia} from '../public/library/record-media.js';
test('order uses stable ids and appends newly added media in original order',()=>{const items=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(orderMedia(items,['b','a']).map(m=>m.id),['b','a','c']);assert.deepEqual(items.map(m=>m.id),['a','b','c']);});
test('move preserves every media entry and respects first and last boundaries',()=>{const items=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(moveMedia(items,'b',-1),['b','a','c']);assert.deepEqual(moveMedia(items,'a',-1),['a','b','c']);assert.deepEqual(moveMedia(items,'c',1),['a','b','c']);});
test('base and uploaded files have identities independent of temporary blob URLs',()=>{assert.equal(fileMediaId({name:'x.png',size:12,lastModified:34}),'file:x.png:12:34');const items=baseMedia({media:[{path:'/source.png',label:'来源'},{path:'blob:temporary'}]},{cover:'/model.png'});assert.deepEqual(items.map(m=>m.id),['cover']);assert.deepEqual(baseMedia({media:[{path:'/frame.png',label:'资料影像'}]},null).map(m=>m.id),['media:/frame.png']);});
