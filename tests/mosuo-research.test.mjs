import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supplementRecords, researchQuestions, recordPatch, INSOLE_ID } from '../import-mosuo-research.mjs';
const seed = JSON.parse(readFileSync(new URL('../seed/records.json', import.meta.url), 'utf8'));

test('research import is idempotent and preserves unrelated user content and local source ID', () => {
  const records = structuredClone(seed.records).filter(r => r.id !== INSOLE_ID);
  const video = records.find(r => r.collection_id === 'mosuo_video_002');
  video.id = 'WW-L-EXISTING-VIDEO';
  video.notes += '\n用户后续笔记不可覆盖。';
  video.observations.push('用户自己的观察。');
  records.push({ id: 'WW-L-UNRELATED', title: '其他项目记录', notes: '保留', revision: 91 });
  const once = supplementRecords(records, '2026-10-29T03:00:00Z');
  const twice = supplementRecords(once, '2026-11-01T03:00:00Z');
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.find(r => r.id === 'WW-L-UNRELATED'), records.at(-1));
  const updated = twice.find(r => r.collection_id === 'mosuo_video_002');
  assert.equal(updated.id, video.id);
  assert.match(updated.notes, /用户后续笔记不可覆盖/);
  assert.ok(updated.observations.includes('用户自己的观察。'));
  assert.equal(twice.filter(r => r.id === INSOLE_ID).length, 1);
  assert.deepEqual(recordPatch(once[0], twice[0]), {});
});

test('insole remains a related handcraft object while the core clothing set has three components', () => {
  const records = supplementRecords(seed.records);
  const insole = records.find(r => r.id === INSOLE_ID);
  assert.equal(insole.parent_id, 'WW-MOS-001');
  assert.equal(insole.record_type, 'object');
  assert.equal(insole.culture, null);
  assert.match(insole.notes, /用户/);
  assert.deepEqual(records.filter(r => r.parent_id === 'WW-MOS-001' && r.record_type === 'component').map(r => r.id).sort(),
    ['WW-MOS-001-C01', 'WW-MOS-001-C02', 'WW-MOS-001-C03']);
  const photo = records.find(r => r.id === 'WW-MOS-001');
  assert.ok(!photo.observations.some(s => s.includes('暂不建立套装部件关系')));
  assert.ok(photo.observations.some(s => s.includes('宽腰带')));
});

test('source questions stay attributed draft questions and bind to the actual video record', () => {
  const questions = researchQuestions({ id: 'WW-L-EXISTING-VIDEO', revision: 6 });
  assert.equal(questions.length, 2);
  for (const question of questions) {
    assert.equal(question.record_id, 'WW-L-EXISTING-VIDEO');
    assert.equal(question.record_revision, 6);
    assert.equal(question.status, 'draft');
    assert.equal(question.evidence_kind, 'source');
    assert.equal(question.reviewed_by, null);
    assert.match(question.prompt, /字幕/);
    assert.match(question.evidence_note, /V-MOS-002/);
  }
});
